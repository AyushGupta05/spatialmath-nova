import { computeGeometry } from "./core/geometry.js";
import { deriveScaleK, loadCalibration, saveCalibration } from "./calibration/store.js";
import { InteractionPipeline } from "./signals/interactionPipeline.js";
import { appState } from "./state/store.js";
import { createWorld } from "./render/world.js";
import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

const MODEL_PATH = new URL("../models/hand_landmarker.task", window.location.href).toString();

export function bootstrapApp() {
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
  const smoothingInputEl = document.querySelector("#smoothingInput");
  const calibrateBtn = document.querySelector("#calibrateBtn");
  const debugStateEl = document.querySelector("#debugState");
  const statusEl = document.querySelector("#status");

  const ctx = overlayEl.getContext("2d");
  const world = createWorld(worldMount);

  appState.calibration = loadCalibration();
  const pipeline = new InteractionPipeline({ alpha: appState.calibration.smoothingAlpha });
  smoothingInputEl.value = String(appState.calibration.smoothingAlpha);

  let handLandmarker = null;
  let stream = null;
  let rafId = null;
  let running = false;
  let prevPinch = false;
  let activeMesh = null;
  const placedMeshes = [];

  function setStatus(msg, state = "ok") {
    statusEl.textContent = msg;
    statusEl.dataset.state = state;
  }

  function drawDebug(hand) {
    ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    if (!hand) return;
    const p = hand[8];
    const x = (1 - p.x) * overlayEl.width;
    const y = p.y * overlayEl.height;
    ctx.strokeStyle = "#f9ff9a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  function refreshDebug() {
    debugStateEl.textContent = JSON.stringify({
      interaction: appState.interaction,
      calibration: appState.calibration,
      shape: appState.shape,
      dimension: Number(appState.dimension.toFixed(3)),
      volume: Number(appState.volume.toFixed(3)),
      surfaceArea: Number(appState.surfaceArea.toFixed(3)),
      meshCount: placedMeshes.length,
    }, null, 2);
  }

  function updateGeometryMetrics(shape, size) {
    let metrics;
    if (shape === "sphere") metrics = computeGeometry(shape, { r: size * 0.6 });
    else if (shape === "cylinder") metrics = computeGeometry(shape, { r: size * 0.45, h: size * 1.4 });
    else if (shape === "cuboid") metrics = computeGeometry(shape, { w: size * 1.6, h: size, d: size * 0.9 });
    else metrics = computeGeometry("cube", { a: size });

    appState.shape = shape;
    appState.dimension = size;
    appState.volume = metrics.volume;
    appState.surfaceArea = metrics.surfaceArea;
  }

  function removeMesh(mesh) {
    if (!mesh) return;
    world.scene.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }

  function undo() {
    const mesh = placedMeshes.pop();
    if (!mesh) return;
    removeMesh(mesh);
    if (activeMesh === mesh) activeMesh = null;
    setStatus(`Undid one shape. Remaining ${placedMeshes.length}`, "ok");
    refreshDebug();
  }

  function clearAll() {
    while (placedMeshes.length) removeMesh(placedMeshes.pop());
    activeMesh = null;
    setStatus("Cleared scene", "idle");
    refreshDebug();
  }

  function serializeScene() {
    return placedMeshes.map((m) => ({
      shape: m.userData.shape || "cube",
      baseSize: m.userData.baseSize || 1,
      color: `#${m.material.color.getHexString()}`,
      position: m.position.toArray(),
      rotationY: m.rotation.y,
      scale: m.scale.toArray(),
    }));
  }

  function saveScene() {
    const payload = serializeScene();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nova-scene-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Saved ${payload.length} shapes`, "ok");
  }

  function loadScene(data) {
    clearAll();
    data.forEach((item) => {
      const mesh = world.buildMesh(item.shape || "cube", Number(item.baseSize || 1), item.color || "#39d0b8");
      mesh.position.fromArray(item.position || [0, 0.5, 0]);
      mesh.rotation.y = Number(item.rotationY || 0);
      if (Array.isArray(item.scale)) mesh.scale.fromArray(item.scale);
      mesh.userData.shape = item.shape || "cube";
      mesh.userData.baseSize = Number(item.baseSize || 1);
      world.scene.add(mesh);
      placedMeshes.push(mesh);
    });
    setStatus(`Loaded ${placedMeshes.length} shapes`, "ok");
    refreshDebug();
  }

  async function ensureLandmarker() {
    if (handLandmarker) return;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  function detectLoop() {
    if (!running || !handLandmarker) return;

    if (webcamEl.readyState >= 2) {
      const results = handLandmarker.detectForVideo(webcamEl, performance.now());
      const handA = results?.landmarks?.[0] || null;
      const handB = results?.landmarks?.[1] || null;

      drawDebug(handA);
      const interaction = pipeline.update(handA, handB);
      appState.interaction = interaction;

      const dynamicAlpha = Math.max(0.16, Math.min(0.62, 0.55 - interaction.jitter * 2.2));
      pipeline.setAlpha(dynamicAlpha);

      if (handA) {
        const hit = world.projectToGround(handA[8]);
        const pinchStart = interaction.pinch && !prevPinch;

        if (pinchStart && hit && gestureModeEl.value === "spawn") {
          const mesh = world.buildMesh(shapeTypeEl.value, Number(sizeInputEl.value), colorInputEl.value);
          mesh.position.x = hit.x;
          mesh.position.z = hit.z;
          mesh.rotation.y = Math.random() * Math.PI;
          mesh.userData.shape = shapeTypeEl.value;
          mesh.userData.baseSize = Number(sizeInputEl.value);
          world.scene.add(mesh);
          activeMesh = mesh;
          placedMeshes.push(mesh);
          setStatus(`Placed ${shapeTypeEl.value}`, "ok");
        }

        if (interaction.pinch && activeMesh && hit && gestureModeEl.value === "transform") {
          activeMesh.position.x = hit.x;
          activeMesh.position.z = hit.z;
          activeMesh.rotation.y = interaction.rotation;

          const calibratedScale = appState.calibration.scaleK || 1;
          const twoHand = interaction.twoHandBoost == null ? 1 : (0.85 + interaction.twoHandBoost * 0.7);
          const scale = (0.45 + interaction.resize * 2.4) * calibratedScale * twoHand;
          activeMesh.scale.setScalar(scale);
          updateGeometryMetrics(activeMesh.userData.shape || shapeTypeEl.value, Number(sizeInputEl.value) * scale);
        }

        prevPinch = interaction.pinch;
      }

      refreshDebug();
    }

    rafId = requestAnimationFrame(detectLoop);
  }

  async function start() {
    try {
      await ensureLandmarker();
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      webcamEl.srcObject = stream;
      await webcamEl.play();
      running = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      setStatus("Tracking live interaction signals", "ok");
      detectLoop();
    } catch (e) {
      setStatus(`Start failed: ${e?.message || e}`, "error");
    }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    webcamEl.srcObject = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Stopped", "idle");
  }

  smoothingInputEl.addEventListener("input", () => {
    const alpha = Number(smoothingInputEl.value);
    appState.calibration.smoothingAlpha = alpha;
    pipeline.setAlpha(alpha);
    saveCalibration(appState.calibration);
    refreshDebug();
  });

  calibrateBtn.addEventListener("click", () => {
    const reference = appState.interaction.wristToIndex || appState.calibration.baselineDistance;
    appState.calibration.baselineDistance = reference;
    appState.calibration.scaleK = deriveScaleK(reference);
    saveCalibration(appState.calibration);
    setStatus("Calibration captured", "ok");
    refreshDebug();
  });

  undoBtn.addEventListener("click", undo);
  clearBtn.addEventListener("click", clearAll);
  saveSceneBtn.addEventListener("click", saveScene);
  loadSceneBtn.addEventListener("click", () => loadSceneInput.click());
  loadSceneInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!Array.isArray(payload)) throw new Error("Invalid JSON");
      loadScene(payload);
    } catch (err) {
      setStatus(`Load failed: ${err?.message || err}`, "error");
    } finally {
      loadSceneInput.value = "";
    }
  });

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", stop);
  window.addEventListener("beforeunload", stop);

  refreshDebug();
  setStatus("Ready. Start camera to begin.", "idle");
}
