# AGENTS.md

Static p5.js + ml5.js sketch. No build step, no package manager, no tests, no linter, no CI.
There are no generated files and no lockfiles — do not look for or invent commands for them.

## Running

- Must be served over HTTP on **localhost or HTTPS**: `getUserMedia` (webcam) is unavailable on `file://`. e.g. `python3 -m http.server` and open `http://localhost:8000`.
- `index.html` loads p5 (`2.3.3`) and ml5 (`1.4.0`) as UMD globals from jsdelivr, then `sketch.js` as `type="module"` (deferred, so it runs after both).
- Verified working combo: p5 2.3.3 + ml5 1.4.0. p5 2.x awaits an `async setup()` and still has `createCapture`. If the model ever fails to start, the fallback is pinning `p5@1.11.10`.

## Architecture: composition root + adapters

Four files, one feature each, so three people can work in parallel. Only `sketch.js` knows all of them.

```
sketch.js        composition root: instantiates, owns setup/draw, orders the frame
js/handpose.js   HandTracker  — input adapter: ml5 + webcam + skeleton drawing
js/gamelogic.js  GameState    — model: pure logic, zero dependencies
js/ui.js         Renderer     — presentation: HUD, game visuals
```

Dependency rules (violating these is what breaks parallel work):

- `gamelogic.js` imports **nothing** from p5, ml5, or the DOM. It must be testable with fake hand data.
- `ui.js` must never touch ml5. It reads `GameState` and draws.
- `handpose.js` never knows game rules or game UI.
- `ui.js` and `gamelogic.js` never import each other; data flows through parameters from `sketch.js`.

Frame order in `draw`: `background(0)` → `tracker.drawVideo()` → `ui.draw(...)` → `tracker.drawSkeleton()` (skeleton last, on top). `ui.draw` never clears the canvas; the composition root owns the background.

## Camera viewport

- `HandTracker` maps the camera to the canvas with a single **cover** fit (uniform scale, centered, equal crop on both sides) computed in `#viewport()`. Both `drawVideo()` and `drawSkeleton()` use it, so landmarks sit exactly on the real joints.
- `tracker.toScreen({x, y})` exposes the same mapping for game/UI code. Never re-derive it.
- The capture requests 1280×720 ideals; the stream's real size comes from `elt.videoWidth/videoHeight`, which is what normalization uses. Do not normalize by the requested size — browsers ignore constraints.
- `showVideo` (default `true` in the class) draws the camera behind the skeleton for debugging. `sketch.js` currently passes `showVideo: false`, so only the skeleton is visible. Flip that one flag to debug again.
- The webcam element is always `hide()`den; we draw the stream ourselves. Never append the raw element to the page.

## HandPose contract (do not break without telling the team)

`tracker.getHands()` returns `Hand[]`, where

```
Hand     = { handedness: "Left"|"Right"|"Unknown", score: 0..1, landmarks: Landmark[21] }
Landmark = { x: 0..1, y: 0..1, z: relative depth }
```

- 21 landmarks in MediaPipe order; use the exported `LANDMARK` constants, not raw indices.
- x/y are normalized to the video frame and **not mirrored**. Mirroring happens only at draw time (`HandTracker.mirrored`) and is applied identically to the video and the skeleton.
- `createCapture()` does not expose its `getUserMedia` promise. `init()` waits on `loadedmetadata` with a 10s timeout and throws a readable error instead of hanging forever.

## Current state

- `gamelogic.js` (hand count, wrist pointer, pinch distance with hysteresis) and `ui.js` (debug HUD) are minimal scaffolds owned by their feature devs — replace them, keep the contracts.
- `style.css` is only a baseline reset. `list-style: none` is intentionally scoped to `ul/ol[role="list"]` for accessibility; keep it that way.
- p5 runs in **instance mode**: no globals, no `preload`, `setup` and `draw` are set on the instance (`p.setup = ...`).

## Git

- gitflow is configured (`.git/config`): `main` + `develop`, with `feature/`, `release/`, `hotfix/`, `bugfix/` prefixes. Long-lived work belongs on a `feature/*` branch off `develop`.
- Commit messages in history are short and in Spanish; match the existing style rather than the conventional-commits default.
- Branch `feature/hadnpose` is misspelled relative to `js/handpose.js`. Don't copy that typo into new names.
