# SpatialMath Nova — Hand Sculpt

MediaPipe Hands + Three.js prototype for gesture-based 3D shape creation.

## Architecture (modular)
- `src/signals/interactionPipeline.js` — stable interaction state (~30 FPS semantics)
- `src/calibration/store.js` — calibration persistence + scale factor
- `src/core/geometry.js` — deterministic geometry formulas
- `src/render/world.js` — 3D scene + camera + projection
- `src/state/store.js` — app state object
- `src/app.js` — orchestration + UI wiring

## Features
- Real-time webcam hand tracking (MediaPipe Tasks Vision)
- Three.js 3D studio with orbit controls
- Gesture actions:
  - Spawn mode: pinch (thumb + index) → place selected shape
  - Transform mode: pinch near object to grab/move; spread index-middle fingers to scale
  - Fist → delete the object closest to the palm
- Shape types: cube, cuboid, sphere, cylinder
- Adjustable base size + color
- Scene save/load JSON for quick demo resets
- Transform precision controls: position/rotation snap modes + rotation step
- Live interaction intent badge for user guidance
- Long-session guardrails: mesh budget + auto-pause on hidden tab
- Sticky transform lock mode + visual rotation guide arrow
- Calibration presets for desk/room/far camera distance
- Full hand skeleton debug overlay (not just cursor dot)
- Palm-proxy in 3D world for spatial intent visualization
- Control split: palm drives transform movement, fingers drive placement/selection
- Two-hand overlay rendering with neon pulse fingertip cues
- Improved pinch consistency via wider hysteresis + stable-frame confirmation

## Offline tuning (Python)
Use `tools/signal_tuner.py` to tune EMA and pinch hysteresis from recorded CSV traces.

```bash
python3 tools/signal_tuner.py --input pinch_series.csv --alpha 0.38 --pinch-on 0.048 --pinch-off 0.062
```

Synthetic stress check:
```bash
python3 tools/stress_simulator.py
```

## TensorFlow gesture signal model
Train a 6-class gesture classifier for project signals:
- pinch_place (thumb+index) → place object
- fist_delete → delete object nearest to palm
- open_palm_cycle → change shape
- peace_draw → draw lines
- point_rotate → rotate object
- neutral_cancel (flat open palm still) → neutral/cancel

Train:
```bash
python3 tools/train_gesture_model_tf.py --samples-per-class 2200 --epochs 45
```

Stress test:
```bash
python3 tools/stress_test_gesture_model_tf.py --per-class 1200
```

Artifacts are saved in `models/tf_gesture/`:
- `gesture_signal_model.keras`
- `gesture_labels.json`
- `gesture_train_metrics.json`
- `gesture_stress_report.json`

## Run
Serve this folder with any static server and open `index.html`.

Example:
```bash
python3 -m http.server 8090
```
Then open `http://localhost:8090`.

## Camera troubleshooting
- Use `localhost` or HTTPS (camera access is blocked on insecure non-local origins).
- If preferred constraints fail, app now falls back to a generic camera request.
- Check in-app status pill for explicit camera/model error reason.
