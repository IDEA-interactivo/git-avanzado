/**
 * HandTracker — input adapter.
 *
 * Owns ml5.js and the webcam. It produces normalized hand data and draws the
 * camera view plus the stick-figure skeleton. It knows nothing about game rules
 * or game UI.
 *
 * Contract with the rest of the app (do not break it without telling the team):
 *
 *   tracker.getHands()   -> Hand[]
 *   tracker.toScreen(lm) -> {x, y}   maps a normalized landmark to canvas pixels
 *
 *   Hand = {
 *     handedness: "Left" | "Right" | "Unknown",
 *     score: number,                // 0..1 detection confidence
 *     landmarks: Landmark[21],      // MediaPipe order, 0 = wrist
 *   }
 *
 *   Landmark = { x: 0..1, y: 0..1, z: number }
 *     x/y are normalized to the video frame.
 *     z is relative depth in the same scale as x (not normalized, sign = toward camera).
 *
 * Coordinates are NOT mirrored: x grows to the right of the raw camera image.
 * Mirroring is a presentation concern and only happens when drawing.
 */

/** MediaPipe hand landmark order. Use these instead of magic numbers. */
export const LANDMARK = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
});

const LANDMARK_COUNT = 21;

/** Bone pairs: wrist -> palm -> each finger chain. */
const HAND_CONNECTIONS = Object.freeze([
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  // palm base
  [0, 17],
]);

const TIP_INDICES = new Set([4, 8, 12, 16, 20]);
const HAND_COLORS = [
  [0, 229, 255], // cyan
  [255, 138, 0], // orange
];

export class HandTracker {
  /**
   * @param {p5} p p5 instance (instance mode).
   * @param {object} [options]
   * @param {number} [options.maxHands=2]
   * @param {boolean} [options.mirrored=true] Mirror the camera view and skeleton, like a mirror.
   * @param {boolean} [options.showVideo=true] Draw the camera image behind the skeleton (debug view).
   * @param {number} [options.videoWidth=1280] Ideal capture width.
   * @param {number} [options.videoHeight=720] Ideal capture height.
   */
  constructor(p, {
    maxHands = 2,
    mirrored = true,
    showVideo = true,
    videoWidth = 1280,
    videoHeight = 720,
  } = {}) {
    this.p = p;
    this.maxHands = maxHands;
    this.mirrored = mirrored;
    this.showVideo = showVideo;
    this.requestedWidth = videoWidth;
    this.requestedHeight = videoHeight;

    this.video = null;
    this.model = null;
    this.hands = [];
    this.ready = false;
    this.error = null;

    this.videoWidth = 0;
    this.videoHeight = 0;
  }

  /**
   * Loads the model and starts the webcam. Safe to await once.
   * Requires a secure context: localhost or HTTPS. Opening index.html via
   * file:// will fail on getUserMedia.
   */
  async init() {
    if (!globalThis.ml5) {
      throw new Error("ml5.js is not loaded. Check the ml5 script tag in index.html.");
    }

    this.model = await globalThis.ml5.handPose({
      maxHands: this.maxHands,
      runtime: "tfjs",
      modelType: "full",
    });

    this.video = this.p.createCapture({
      video: {
        width: { ideal: this.requestedWidth },
        height: { ideal: this.requestedHeight },
      },
      audio: false,
    });
    this.video.hide(); // The element stays out of the layout; we draw it ourselves.

    await new Promise((resolve, reject) => {
      const elt = this.video.elt;
      if (elt.readyState >= 1) return resolve();

      // createCapture() does not expose its getUserMedia promise: if permission is
      // denied or the device is missing, 'loadedmetadata' never fires. Fail loudly
      // instead of showing "Starting camera..." forever.
      const timer = setTimeout(() => {
        reject(
          new Error(
            "Camera did not start. Allow camera access and serve the page over http://localhost or HTTPS.",
          ),
        );
      }, 10000);

      elt.addEventListener(
        "loadedmetadata",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

    // Use the stream's real size, not the size we asked for: browsers may ignore it.
    this.videoWidth = this.video.elt.videoWidth || this.requestedWidth;
    this.videoHeight = this.video.elt.videoHeight || this.requestedHeight;

    this.model.detectStart(this.video, (results) => {
      this.hands = results.map((hand) => this.#normalize(hand));
    });

    this.ready = true;
  }

  /** @returns {Array<{handedness: string, score: number, landmarks: Array<{x:number,y:number,z:number}>}>} */
  getHands() {
    return this.hands;
  }

  /**
   * Maps a normalized landmark (or any {x, y} in 0..1 video space) to canvas
   * pixels, applying the same cover fit and mirroring used when drawing.
   * Use this from game/UI code instead of duplicating the math.
   * @returns {{x: number, y: number}}
   */
  toScreen(point) {
    const view = this.#viewport();
    if (!view) return { x: 0, y: 0 };
    return {
      x: view.ox + (this.mirrored ? 1 - point.x : point.x) * view.dw,
      y: view.oy + point.y * view.dh,
    };
  }

  /**
   * Draws the camera image, scaled to COVER the whole canvas and centered
   * (equal crop on both sides), mirrored when `mirrored` is true.
   * No-op when `showVideo` is false.
   */
  drawVideo() {
    const view = this.#viewport();
    if (!this.showVideo || !this.ready || !view) return;

    const { p } = this;
    p.push();
    p.noStroke();
    if (this.mirrored) {
      p.translate(p.width, 0);
      p.scale(-1, 1);
      p.image(this.video, p.width - view.ox - view.dw, view.oy, view.dw, view.dh);
    } else {
      p.image(this.video, view.ox, view.oy, view.dw, view.dh);
    }
    p.pop();
  }

  /**
   * Draws the skeleton as sticks with circles at the joints, using exactly the
   * same viewport as drawVideo so landmarks sit on top of the real joints.
   */
  drawSkeleton() {
    const view = this.#viewport();
    if (!this.ready || !view) return;

    const { p } = this;

    p.push();
    p.noFill();

    for (let h = 0; h < this.hands.length; h++) {
      const hand = this.hands[h];
      const color = HAND_COLORS[h % HAND_COLORS.length];
      const points = hand.landmarks.map((lm) => this.toScreen(lm));

      // Bones
      p.stroke(...color);
      p.strokeWeight(4);
      p.strokeCap(p.ROUND);
      for (const [a, b] of HAND_CONNECTIONS) {
        p.line(points[a].x, points[a].y, points[b].x, points[b].y);
      }

      // Joints
      p.noStroke();
      p.fill(...color);
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const radius = i === LANDMARK.WRIST ? 11 : TIP_INDICES.has(i) ? 9 : 6;
        p.circle(points[i].x, points[i].y, radius * 2);
      }

      // Tips get a hollow center so the fingertips read as distinct
      p.fill(0);
      for (const i of TIP_INDICES) {
        p.circle(points[i].x, points[i].y, 10);
      }
    }

    p.pop();
  }

  /**
   * Cover fit: same scale on both axes (proportions preserved), video centered,
   * overflow cropped equally. Recomputed every frame so resizing works.
   */
  #viewport() {
    if (!this.videoWidth || !this.videoHeight) return null;
    const { width, height } = this.p;
    const scale = Math.max(width / this.videoWidth, height / this.videoHeight);
    const dw = this.videoWidth * scale;
    const dh = this.videoHeight * scale;
    return { dw, dh, ox: (width - dw) / 2, oy: (height - dh) / 2, scale };
  }

  #normalize(hand) {
    const keypoints = hand.keypoints ?? [];
    const keypoints3D = hand.keypoints3D ?? [];
    const vw = this.videoWidth || 1;
    const vh = this.videoHeight || 1;

    const landmarks = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const kp = keypoints[i] ?? { x: 0, y: 0 };
      landmarks.push({
        x: kp.x / vw,
        y: kp.y / vh,
        z: keypoints3D[i]?.z ?? 0,
      });
    }

    return {
      handedness: hand.handedness ?? "Unknown",
      score: hand.confidence ?? hand.score ?? 0,
      landmarks,
    };
  }
}
