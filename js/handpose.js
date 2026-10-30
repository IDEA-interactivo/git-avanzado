/**
 * HandTracker — input adapter.
 *
 * Owns ml5.js and the webcam. It produces normalized hand data and draws the
 * stick-figure skeleton. It knows nothing about game rules or game UI.
 *
 * Contract with the rest of the app (do not break it without telling the team):
 *
 *   tracker.getHands() -> Hand[]
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
 * Mirroring is a presentation concern and only happens in drawSkeleton().
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
   * @param {boolean} [options.mirrored=true] Draw the skeleton mirrored, as a mirror would.
   */
  constructor(p, { maxHands = 2, mirrored = true } = {}) {
    this.p = p;
    this.maxHands = maxHands;
    this.mirrored = mirrored;

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

    this.video = this.p.createCapture(this.p.VIDEO);
    this.video.size(640, 480);
    this.video.hide(); // Never render the camera feed: only the skeleton is drawn.

    await new Promise((resolve) => {
      const elt = this.video.elt;
      if (elt.readyState >= 1) return resolve();
      elt.onloadedmetadata = () => resolve();
    });

    this.videoWidth = this.video.elt.videoWidth || 640;
    this.videoHeight = this.video.elt.videoHeight || 480;

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
   * Draws the skeleton as sticks with circles at the joints.
   * This is the sensor's own visualization, not game UI.
   */
  drawSkeleton() {
    if (!this.ready || !this.videoWidth) return;

    const { p } = this;
    const scale = Math.max(p.width / this.videoWidth, p.height / this.videoHeight); // cover
    const dw = this.videoWidth * scale;
    const dh = this.videoHeight * scale;
    const ox = (p.width - dw) / 2;
    const oy = (p.height - dh) / 2;

    const toScreen = (lm) => ({
      x: ox + (this.mirrored ? 1 - lm.x : lm.x) * dw,
      y: oy + lm.y * dh,
    });

    p.push();
    p.noFill();

    for (let h = 0; h < this.hands.length; h++) {
      const hand = this.hands[h];
      const color = HAND_COLORS[h % HAND_COLORS.length];
      const points = hand.landmarks.map(toScreen);

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
