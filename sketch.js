/**
 * Composition root. The ONLY file that knows all three features.
 *
 * Frame order matters:
 *   1. read input   -> tracker.getHands()
 *   2. advance logic -> game.update(hands, dt)
 *   3. draw         -> ui.draw(state) then tracker.drawSkeleton() (skeleton on top)
 *
 * p5 runs in instance mode: no globals, and `setup` is async so the model can
 * load before the first frame (p5 2.x awaits it).
 */

import { HandTracker } from "./js/handpose.js";
import { GameState } from "./js/gamelogic.js";
import { Renderer } from "./js/ui.js";

new p5((p) => {
  let tracker;
  let game;
  let ui;

  p.setup = async () => {
    p.createCanvas(p.windowWidth, p.windowHeight);

    tracker = new HandTracker(p, { maxHands: 2, mirrored: true });
    game = new GameState();
    ui = new Renderer(p);

    try {
      await tracker.init();
    } catch (error) {
      tracker.error = error;
      console.error("[handpose] init failed:", error);
    }
  };

  p.draw = () => {
    if (!tracker) return;

    const hands = tracker.getHands();
    game.update(hands, p.deltaTime);

    ui.draw(game, tracker);
    tracker.drawSkeleton();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };
});
