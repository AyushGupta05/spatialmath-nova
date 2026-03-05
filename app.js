import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const MODEL_PATH = new URL("./models/hand_landmarker.task", window.location.href).toString();
const webcamEl = document.querySelector("#webcam");
const overlayEl = document.querySelector("#overlay");
const worldMount = document.querySelector("#worldMount");
const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const undoBtn = document.querySelector("#undoBtn");
const clearBtn = document.querySelector("#clearBtn");
const saveSceneBtn = document.querySelector("#saveSceneBtn");
const loadSceneBtn = document.querySelector("#loadSceneBtn");
const loadSceneInput = document.querySelector("#loadSceneInput");
const shapeTypeEl = document.querySelector("#shapeType");
const gestureModeEl = document.querySelector("#gestureMode");
const sizeInputEl = document.querySelector("#sizeInput");
const colorInputEl = document.querySelector("#colorInput");
const statusEl = document.querySelector("#status");
const ctx = overlayEl.getContext("2d");

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];

let handLandmarker = null;
let webcamStream = null;
let isRunning = false;
let rafId = null;
let lastVideoTime = -1;
let fistStartAt = null;
let selectedShape = null;
let isTransformPinching = false;
let prevPinch = false;
let smoothedCursorWorld = null;
const maxShapes = 300;
const placedShapes = [];

// --- Three.js world ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050a12);

const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
camera.position.set(0, 4.5, 8.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
worldMount.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.2, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const dir = new THREE.DirectionalLight(0xffffff, 0.95);
dir.position.set(5, 7, 3);
scene.add(dir);

const grid = new THREE.GridHelper(18, 18, 0x335566, 0x223344);
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 18),
  new THREE.MeshStandardMaterial({ color: 0x0b1320, metalness: 0.05, roughness: 0.9 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function resizeStage() {
  const w = worldMount.clientWidth;
  const h = worldMount.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (overlayEl.width !== w || overlayEl.height !== h) {
    overlayEl.width = w;
    overlayEl.height = h;
  }
}
window.addEventListener("resize", resizeStage);
resizeStage();

function animateWorld() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animateWorld);
}
animateWorld();

function setStatus(message, state = "ok") {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function waitForVideoReady(video, timeoutMs = 6000) {
  if (video.readyState >= 1) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
      resolve();
    };

    const onError = () => {
      clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
      reject(new Error("Video stream failed to initialize"));
    };

    const timeoutId = setTimeout(() => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
      reject(new Error("Camera metadata timeout"));
    }, timeoutMs);

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("error", onError, { once: true });
  });
}

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  const sharedOptions = {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  try {
    return await HandLandmarker.createFromOptions(vision, sharedOptions);
  } catch {
    return await HandLandmarker.createFromOptions(vision, {
      ...sharedOptions,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
    });
  }
}

async function ensureLandmarkerReady() {
  if (handLandmarker) return;
  setStatus("Loading MediaPipe model...", "ok");
  handLandmarker = await createHandLandmarker();
}

function drawHands(results) {
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  if (!results?.landmarks?.length) return;

  const colors = ["#39d0b8", "#7cc9ff"];
  results.landmarks.forEach((hand, i) => {
    const stroke = colors[i % colors.length];
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;
    ctx.lineWidth = 2;

    for (const [from, to] of HAND_CONNECTIONS) {
      const s = hand[from];
      const e = hand[to];
      ctx.beginPath();
      ctx.moveTo((1 - s.x) * overlayEl.width, s.y * overlayEl.height);
      ctx.lineTo((1 - e.x) * overlayEl.width, e.y * overlayEl.height);
      ctx.stroke();
    }

    for (const p of hand) {
      ctx.beginPath();
      ctx.arc((1 - p.x) * overlayEl.width, p.y * overlayEl.height, 3.6, 0, 2 * Math.PI);
      ctx.fill();
    }
  });
}

function drawCursor(landmark, color = "#f9ff9a") {
  const x = (1 - landmark.x) * overlayEl.width;
  const y = landmark.y * overlayEl.height;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, 2 * Math.PI);
  ctx.stroke();
}

function screenToWorldOnPlane(landmark, plane = groundPlane) {
  ndc.set((1 - landmark.x) * 2 - 1, -(landmark.y * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  const hasHit = raycaster.ray.intersectPlane(plane, hit);
  return hasHit ? hit : null;
}

function smoothWorldPoint(point) {
  if (!smoothedCursorWorld) {
    smoothedCursorWorld = point.clone();
  } else {
    smoothedCursorWorld.lerp(point, 0.42);
  }
  return smoothedCursorWorld.clone();
}

function isPinching(hand) {
  const thumb = hand[4];
  const index = hand[8];
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const dz = thumb.z - index.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return dist < 0.05;
}

function isFist(hand) {
  const wrist = hand[0];
  const tips = [8, 12, 16, 20].map((i) => hand[i]);
  const meanDist = tips.reduce((acc, tip) => {
    const dx = tip.x - wrist.x;
    const dy = tip.y - wrist.y;
    const dz = tip.z - wrist.z;
    return acc + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }, 0) / tips.length;
  return meanDist < 0.18;
}

function buildGeometry(type, size) {
  switch (type) {
    case "cuboid": return new THREE.BoxGeometry(size * 1.6, size, size * 0.9);
    case "sphere": return new THREE.SphereGeometry(size * 0.6, 28, 20);
    case "cylinder": return new THREE.CylinderGeometry(size * 0.45, size * 0.45, size * 1.4, 24);
    case "cube":
    default: return new THREE.BoxGeometry(size, size, size);
  }
}

function inferShapeTypeFromGeometry(geometry) {
  if (geometry.type === "SphereGeometry") return "sphere";
  if (geometry.type === "CylinderGeometry") return "cylinder";
  if (geometry.type === "BoxGeometry") {
    const p = geometry.parameters || {};
    if (Math.abs((p.width || 1) - (p.height || 1)) < 0.001 && Math.abs((p.height || 1) - (p.depth || 1)) < 0.001) return "cube";
    return "cuboid";
  }
  return "cube";
}

function placeMeshAtGround(mesh, worldPoint) {
  const bbox = new THREE.Box3().setFromObject(mesh);
  const halfHeight = (bbox.max.y - bbox.min.y) / 2;
  mesh.position.set(worldPoint.x, halfHeight, worldPoint.z);
}

function spawnShapeAtWorld(worldPoint) {
  if (!worldPoint) return;
  if (placedShapes.length >= maxShapes) {
    setStatus(`Shape limit reached (${maxShapes})`, "error");
    return;
  }

  const size = Number(sizeInputEl.value);
  const type = shapeTypeEl.value;
  const geometry = buildGeometry(type, size);
  const material = new THREE.MeshStandardMaterial({ color: colorInputEl.value, roughness: 0.46, metalness: 0.2 });
  const mesh = new THREE.Mesh(geometry, material);

  placeMeshAtGround(mesh, worldPoint);
  mesh.rotation.set(0, Math.random() * Math.PI, 0);
  mesh.userData.baseSize = size;
  mesh.userData.shapeType = type;

  placedShapes.push(mesh);
  scene.add(mesh);
  setStatus(`Placed ${type}. Total: ${placedShapes.length}`, "ok");
}

function undoLastShape() {
  const mesh = placedShapes.pop();
  if (!mesh) return;
  if (selectedShape === mesh) selectedShape = null;
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  setStatus(`Removed last shape. Remaining: ${placedShapes.length}`, "ok");
}

function pickNearestShape(point, maxDistance = 1.8) {
  let best = null;
  let bestDist = Infinity;
  for (const mesh of placedShapes) {
    const d = mesh.position.distanceTo(point);
    if (d < bestDist && d <= maxDistance) {
      best = mesh;
      bestDist = d;
    }
  }
  return best;
}

function setSelection(mesh) {
  if (selectedShape === mesh) return;
  if (selectedShape?.material?.emissive) selectedShape.material.emissive.setHex(0x000000);
  selectedShape = mesh;
  if (selectedShape?.material?.emissive) selectedShape.material.emissive.setHex(0x113333);
}

function clearShapes() {
  while (placedShapes.length) {
    const mesh = placedShapes.pop();
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  setSelection(null);
  setStatus("Cleared all shapes", "idle");
}

function saveScene() {
  const payload = placedShapes.map((mesh) => ({
    type: mesh.userData.shapeType || inferShapeTypeFromGeometry(mesh.geometry),
    size: Number(mesh.userData.baseSize || 1),
    color: `#${mesh.material.color.getHexString()}`,
    position: mesh.position.toArray(),
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    scale: mesh.scale.toArray(),
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nova-scene-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Saved ${payload.length} shapes`, "ok");
}

function loadSceneFromPayload(payload) {
  clearShapes();
  payload.forEach((item) => {
    const geometry = buildGeometry(item.type || "cube", Number(item.size || 1));
    const material = new THREE.MeshStandardMaterial({ color: item.color || "#39d0b8", roughness: 0.46, metalness: 0.2 });
    const mesh = new THREE.Mesh(geometry, material);
    if (Array.isArray(item.position)) mesh.position.set(item.position[0], item.position[1], item.position[2]);
    if (Array.isArray(item.rotation)) mesh.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2]);
    if (Array.isArray(item.scale)) mesh.scale.set(item.scale[0], item.scale[1], item.scale[2]);
    mesh.userData.baseSize = Number(item.size || 1);
    mesh.userData.shapeType = item.type || "cube";
    placedShapes.push(mesh);
    scene.add(mesh);
  });
  setStatus(`Loaded ${placedShapes.length} shapes`, "ok");
}

function processGestures(results) {
  if (!results?.landmarks?.length) {
    fistStartAt = null;
    prevPinch = false;
    isTransformPinching = false;
    return;
  }

  const hand = results.landmarks[0];
  drawCursor(hand[8]);

  const rawPoint = screenToWorldOnPlane(hand[8]);
  if (!rawPoint) return;
  const worldPoint = smoothWorldPoint(rawPoint);

  const pinching = isPinching(hand);
  const pinchStart = pinching && !prevPinch;
  const pinchEnd = !pinching && prevPinch;
  const mode = gestureModeEl?.value || "spawn";

  if (mode === "spawn") {
    if (pinchStart) spawnShapeAtWorld(worldPoint);
    setSelection(null);
  } else {
    if (pinchStart) {
      setSelection(pickNearestShape(worldPoint));
      isTransformPinching = true;
    }
    if (pinching && selectedShape && isTransformPinching) {
      const targetY = selectedShape.position.y;
      selectedShape.position.lerp(new THREE.Vector3(worldPoint.x, targetY, worldPoint.z), 0.35);
      setStatus("Transform mode: moving selected shape", "ok");
    }
    if (pinchEnd) isTransformPinching = false;
  }

  prevPinch = pinching;

  if (isFist(hand)) {
    if (fistStartAt === null) fistStartAt = performance.now();
    if (performance.now() - fistStartAt > 800) {
      undoLastShape();
      fistStartAt = null;
    }
  } else {
    fistStartAt = null;
  }
}

function detectLoop() {
  if (!isRunning || !handLandmarker) return;

  if (webcamEl.readyState >= 2 && webcamEl.currentTime !== lastVideoTime) {
    lastVideoTime = webcamEl.currentTime;
    const results = handLandmarker.detectForVideo(webcamEl, performance.now());
    drawHands(results);
    processGestures(results);
    const count = results?.landmarks?.length ?? 0;
    if (!count) setStatus("No hands detected", "idle");
  }

  rafId = requestAnimationFrame(detectLoop);
}

async function startTracking() {
  if (isRunning) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("getUserMedia is not available in this browser.", "error");
    return;
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  startBtn.disabled = true;
  stopBtn.disabled = true;
  setStatus("Requesting camera access...", "ok");

  try {
    const preferred = { audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } };
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia(preferred);
    } catch {
      webcamStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }

    webcamEl.srcObject = webcamStream;
    webcamEl.autoplay = true;
    webcamEl.muted = true;
    webcamEl.playsInline = true;

    await waitForVideoReady(webcamEl);
    try { await webcamEl.play(); } catch {}

    setStatus("Camera active. Loading hand model...", "ok");
    await ensureLandmarkerReady();

    startBtn.disabled = true;
    stopBtn.disabled = false;
    isRunning = true;
    lastVideoTime = -1;
    setStatus("Camera active. Pinch to place.", "ok");
    detectLoop();
  } catch (err) {
    console.error(err);
    const reason = err?.name || err?.message || "unknown error";

    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      webcamStream = null;
    }
    webcamEl.srcObject = null;

    startBtn.disabled = false;
    stopBtn.disabled = true;

    const hint = !window.isSecureContext && !isLocalhost ? " Try HTTPS or localhost." : "";
    setStatus(`Unable to start camera/model: ${reason}.${hint}`, "error");
  }
}

function stopTracking() {
  isRunning = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
  webcamEl.srcObject = null;
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("Stopped", "idle");
}

startBtn.addEventListener("click", startTracking);
stopBtn.addEventListener("click", stopTracking);
undoBtn.addEventListener("click", undoLastShape);
clearBtn.addEventListener("click", clearShapes);
saveSceneBtn.addEventListener("click", saveScene);
loadSceneBtn.addEventListener("click", () => loadSceneInput.click());
loadSceneInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!Array.isArray(payload)) throw new Error("Invalid scene format");
    loadSceneFromPayload(payload);
  } catch (err) {
    console.error(err);
    setStatus("Failed to load scene JSON", "error");
  } finally {
    loadSceneInput.value = "";
  }
});
window.addEventListener("beforeunload", stopTracking);
