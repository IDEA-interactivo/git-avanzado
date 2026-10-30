/**
 * GameState — the model. Pure logic, zero dependencies.
 *
 * Rules:
 *  - No p5, no ml5, no DOM. If it needs the browser, it does not belong here.
 *  - Receives hands as plain data and exposes plain state. Nothing else.
 *  - This file is the easiest thing in the repo to unit test: feed it fake hands.
 *
 * Owner: game logic. This ship is deliberately minimal — extend it, keep it pure.
 */

import { LANDMARK } from "./handpose.js";

/** Distance between two landmarks in aspect-corrected normalized space. */
function landmarkDistance(a, b, aspect) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export class GameState {
  /**
   * @param {object} [options]
   * @param {number} [options.pinchThreshold=0.05] Distance under which thumb+index count as a pinch.
   * @param {number} [options.pinchRelease=0.08] Distance above which the pinch releases (hysteresis).
   * @param {number} [options.aspect=4/3] Video aspect ratio used to correct horizontal distances.
   */
  constructor({ pinchThreshold = 0.05, pinchRelease = 0.08, aspect = 4 / 3 } = {}) {
    this.pinchThreshold = pinchThreshold;
    this.pinchRelease = pinchRelease;
    this.aspect = aspect;

    /** @type {Array<{handedness: string, score: number, landmarks: Array<{x:number,y:number,z:number}>}>} */
    this.hands = [];
    this.handCount = 0;

    /** @type {null | {x: number, y: number}} Center of the primary hand (wrist), normalized. */
    this.pointer = null;

    /** Current thumb/index distance of the primary hand, normalized. */
    this.pinchDistance = null;
    /** True while the primary hand holds a pinch (hysteresis applied). */
    this.isPinching = false;

    this.elapsedMs = 0;
  }

  /**
   * Advances one frame.
   * @param {Array} hands Output of HandTracker.getHands().
   * @param {number} [dtMs=0] Milliseconds since the previous frame.
   */
  update(hands, dtMs = 0) {
    this.elapsedMs += dtMs;
    this.hands = hands;
    this.handCount = hands.length;

    const primary = hands[0] ?? null;
    if (!primary) {
      this.pointer = null;
      this.pinchDistance = null;
      this.isPinching = false;
      return this;
    }

    const wrist = primary.landmarks[LANDMARK.WRIST];
    this.pointer = { x: wrist.x, y: wrist.y };

    this.pinchDistance = landmarkDistance(
      primary.landmarks[LANDMARK.THUMB_TIP],
      primary.landmarks[LANDMARK.INDEX_TIP],
      this.aspect,
    );

    // Hysteresis: a single threshold flickers when the distance sits on the edge.
    if (this.isPinching) {
      this.isPinching = this.pinchDistance < this.pinchRelease;
    } else {
      this.isPinching = this.pinchDistance < this.pinchThreshold;
    }

    return this;
  }
}
