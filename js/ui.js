/**
 * Renderer — presentation. Draws game state and HUD. Never touches ml5.
 *
 * Rules:
 *  - Reads GameState, draws it. Never mutates it, never computes game rules.
 *  - Does NOT clear the canvas: the composition root owns the background and the
 *    camera view, so this is a transparent overlay.
 *  - The hand skeleton is NOT drawn here: that is the sensor's own visualization
 *    (HandTracker.drawSkeleton), so the handpose owner can work independently.
 *
 * Owner: UI. This is a placeholder HUD so the pipeline is visible — replace it.
 */

export class Renderer {
  /** @param {p5} p p5 instance (instance mode). */
  constructor(p) {
    this.p = p;
  }

  /**
   * @param {import("./gamelogic.js").GameState} state
   * @param {{ready: boolean, error: Error|null}} tracker
   */
  draw(state, tracker) {
    const { p } = this;

    p.push();
    p.noStroke();
    p.textFont("monospace");

    if (tracker.error) {
      p.fill(255, 90, 90);
      p.textSize(16);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(tracker.error.message, p.width / 2, p.height / 2, p.width - 80, p.height - 80);
      p.pop();
      return;
    }

    if (!tracker.ready) {
      p.fill(200);
      p.textSize(16);
      p.textAlign(p.CENTER, p.CENTER);
      p.text("Starting camera and hand model…", p.width / 2, p.height / 2);
      p.pop();
      return;
    }

    p.fill(255);
    p.textSize(14);
    p.textAlign(p.LEFT, p.TOP);
    p.text(`hands: ${state.handCount}`, 16, 16);
    p.text(
      `pinch: ${state.pinchDistance === null ? "—" : state.pinchDistance.toFixed(3)}` +
        `  ${state.isPinching ? "● CLOSED" : "○ open"}`,
      16,
      38,
    );
    p.fill(160);
    p.text(`fps: ${p.frameRate().toFixed(0)}`, 16, 60);
    p.text(
      `video ${tracker.videoWidth}x${tracker.videoHeight}  canvas ${p.width}x${p.height}`,
      16,
      82,
    );

    p.pop();
  }
}
