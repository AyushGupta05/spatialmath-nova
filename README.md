# SpatialMath Nova — Hand Sculpt

MediaPipe Hands + Three.js prototype for gesture-based 3D shape creation.

## Features
- Real-time webcam hand tracking (MediaPipe Tasks Vision)
- Three.js 3D studio with orbit controls
- Gesture actions:
  - Pinch (thumb + index) → place selected shape
  - Fist hold (~0.8s) → undo last shape
- Shape types: cube, cuboid, sphere, cylinder
- Adjustable base size + color

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
