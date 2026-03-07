import { computeGeometry } from "./core/geometry.js";
import { deriveScaleK, loadCalibration, saveCalibration } from "./calibration/store.js";
import { InteractionPipeline } from "./signals/interactionPipeline.js";
import { appState } from "./state/store.js";
import { createWorld } from "./render/world.js";
import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
import * as THREE from "three";

const MODEL_PATH = new URL("../models/hand_landmarker.task", window.location.href).toString();
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];
const SHOW_HAND_MARKERS = true;
const HAND_OVERLAY_SCALE = 0.88;
const PALM_CENTER_INDEXES = [0, 5, 9, 13, 17];
const SPAWN_COOLDOWN_MS = 220;
const FIST_DELETE_COOLDOWN_MS = 420;
const FIST_HOLD_MS = 180;
const OPERATION_COOLDOWN_MS = 2500;
const PLACEMENT_PULSE_BASE = 8;
const PLACEMENT_PULSE_GAIN = 7;
const PLACEMENT_PULSE_TRIGGER_RADIUS = 12.2;
const SIGNALS = {
  FIST_DELETE: "fist_delete",
};

function pinchDistance(hand) {
  const a = hand?.[4];
  const b = hand?.[8];
  if (!a || !b) return Infinity;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

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
  const resetViewBtn = document.querySelector("#resetViewBtn");
  const resetViewSceneBtn = document.querySelector("#resetViewSceneBtn");
  const loadSceneInput = document.querySelector("#loadSceneInput");
  const shapeTypeEl = document.querySelector("#shapeType");
  const gestureModeEl = document.querySelector("#gestureMode");
  const sizeInputEl = document.querySelector("#sizeInput");
  const colorInputEl = document.querySelector("#colorInput");
  const smoothingInputEl = document.querySelector("#smoothingInput");
  const trackingProfileEl = document.querySelector("#trackingProfile");
  const calibrateBtn = document.querySelector("#calibrateBtn");
  const calibrationPresetEl = document.querySelector("#calibrationPreset");
  const snapToggleEl = document.querySelector("#snapToggle");
  const gridStepInputEl = document.querySelector("#gridStepInput");
  const transformSnapModeEl = document.querySelector("#transformSnapMode");
  const transformLockModeEl = document.querySelector("#transformLockMode");
  const navigationModeEl = document.querySelector("#navigationMode");
  const rotationStepInputEl = document.querySelector("#rotationStepInput");
  const debugStateEl = document.querySelector("#debugState");
  const intentBadgeEl = document.querySelector("#intentBadge");
  const statusEl = document.querySelector("#status");
  const objectListEl = document.querySelector("#objectList");
  const objectCountEl = document.querySelector("#objectCount");

  const ctx = overlayEl.getContext("2d");
  const world = createWorld(worldMount);
  if (navigationModeEl && typeof world.setNavigationMode === "function") {
    world.setNavigationMode(navigationModeEl.value || "blender");
  }

  appState.calibration = loadCalibration();
  const pipeline = new InteractionPipeline({ alpha: appState.calibration.smoothingAlpha });
  smoothingInputEl.value = String(appState.calibration.smoothingAlpha);
  pipeline.setProfile("balanced");

  let handLandmarker = null;
  let stream = null;
  let rafId = null;
  let lastInferAt = 0;
  let running = false;
  let prevPinch = false;
  let prevPlacementPulseActive = false;
  let smoothedPalm = null;
  let smoothedPinch = null;
  let lastSpawnAt = 0;
  let lastFistDeleteAt = 0;
  let lastOperationAt = 0;
  let fistHoldStartAt = null;
  let prevTwoHandAngle = null;
  let transformLocked = false;
  let activeMesh = null;
  const placedMeshes = [];
  const MAX_MESHES = 220;
  const calibrationPresets = {
    custom: null,
    desk: { scaleK: 1.12, smoothingAlpha: 0.46, baselineDistance: 0.085 },
    room: { scaleK: 1.0, smoothingAlpha: 0.38, baselineDistance: 0.11 },
    far: { scaleK: 0.9, smoothingAlpha: 0.3, baselineDistance: 0.145 },
  };

  const selectionRing = world.createSelectionRing();
  const rotationGuide = world.createRotationGuide();
  world.scene.add(selectionRing);
  world.scene.add(rotationGuide);

  function setActiveMesh(mesh) {
    if (activeMesh === mesh) return;
    if (activeMesh?.material?.emissive) {
      const baseEmissive = activeMesh.userData?.baseEmissive ?? 0x00111d;
      activeMesh.material.emissive.setHex(baseEmissive);
    }
    activeMesh = mesh;
    if (activeMesh?.material?.emissive) {
      if (activeMesh.userData.baseEmissive == null) {
        activeMesh.userData.baseEmissive = activeMesh.material.emissive.getHex();
      }
      activeMesh.material.emissive.setHex(0x2ccbd3);
    }
    if (!activeMesh) {
      selectionRing.visible = false;
      rotationGuide.visible = false;
      renderObjectList();
      return;
    }
    selectionRing.visible = true;
    selectionRing.position.set(activeMesh.position.x, 0.02, activeMesh.position.z);
    rotationGuide.visible = true;
    rotationGuide.position.set(activeMesh.position.x, 0.05, activeMesh.position.z);
    renderObjectList();
  }

  function snapValue(v) {
    if (snapToggleEl.value !== "on") return v;
    const step = Number(gridStepInputEl.value || 0.25);
    return Math.round(v / step) * step;
  }

  function smoothPoint(prev, point, alpha = 0.28) {
    if (!point) return prev;
    if (!prev) return point.clone();
    prev.lerp(point, alpha);
    return prev;
  }

  function midpointLandmark(a, b) {
    if (!a || !b) return null;
    return {
      x: (a.x + b.x) * 0.5,
      y: (a.y + b.y) * 0.5,
      z: (a.z + b.z) * 0.5,
    };
  }

  function palmCenterLandmark(hand) {
    if (!hand) return null;
    const sum = { x: 0, y: 0, z: 0 };
    let count = 0;
    for (const idx of PALM_CENTER_INDEXES) {
      const p = hand[idx];
      if (!p) continue;
      sum.x += p.x;
      sum.y += p.y;
      sum.z += p.z;
      count += 1;
    }
    if (!count) return null;
    return {
      x: sum.x / count,
      y: sum.y / count,
      z: sum.z / count,
    };
  }

  function applyDeadzone(current, target, dz = 0.045) {
    if (!current) return target;
    if (current.distanceTo(target) < dz) return current;
    return target;
  }

  function shouldSnapPosition() {
    return transformSnapModeEl.value === "position" || transformSnapModeEl.value === "all";
  }

  function shouldSnapRotation() {
    return transformSnapModeEl.value === "rotation" || transformSnapModeEl.value === "all";
  }

  function snapRotation(rad) {
    if (!shouldSnapRotation()) return rad;
    const stepDeg = Number(rotationStepInputEl.value || 15);
    const step = (Math.PI / 180) * stepDeg;
    return Math.round(rad / step) * step;
  }

  function pickNearestMesh(hitPoint, maxDist = 1.5) {
    let best = null;
    let dist = Infinity;
    for (const mesh of placedMeshes) {
      const d = mesh.position.distanceTo(hitPoint);
      if (d < dist && d <= maxDist) {
        best = mesh;
        dist = d;
      }
    }
    return best;
  }

  function lmkDist(a, b) {
    if (!a || !b) return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function palmScale(hand) {
    if (!hand) return 1;
    // stable hand size reference
    return Math.max(1e-4, lmkDist(hand[0], hand[9]));
  }

  function isFistPose(hand) {
    if (!hand) return false;
    const scale = palmScale(hand);
    const wrist = hand[0];

    const tips = [8, 12, 16, 20];
    const pips = [6, 10, 14, 18];
    const mcps = [5, 9, 13, 17];

    // 1) Fingertips should sit close to palm center/wrist for a fist
    const tipToWrist = tips.map((i) => lmkDist(hand[i], wrist) / scale);
    const avgTipToWrist = tipToWrist.reduce((a, b) => a + b, 0) / tipToWrist.length;

    // 2) Fingers should be tightly curled: tip not farther than pip/mcp from wrist
    let curledCount = 0;
    for (let i = 0; i < tips.length; i += 1) {
      const td = lmkDist(hand[tips[i]], wrist);
      const pd = lmkDist(hand[pips[i]], wrist);
      const md = lmkDist(hand[mcps[i]], wrist);
      if (td <= Math.max(pd, md) * 0.98) curledCount += 1;
    }

    // 2b) Fingertips must be drawn inward toward palm center (not semi-open)
    const palmCenter = {
      x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
      y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
      z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
    };
    const avgTipToPalm = tips
      .map((i) => lmkDist(hand[i], palmCenter) / scale)
      .reduce((a, b) => a + b, 0) / tips.length;

    // 2c) Knuckle-fist silhouette: each fingertip should be close to/behind its MCP in extension direction.
    // In MediaPipe image coords, more open fingers usually have noticeably smaller y at tips.
    // For fist, tip y tends to be near or greater than MCP y (folded back toward palm).
    let foldedSilhouetteCount = 0;
    for (let i = 0; i < tips.length; i += 1) {
      const tip = hand[tips[i]];
      const mcp = hand[mcps[i]];
      if ((tip.y - mcp.y) > -0.02) foldedSilhouetteCount += 1;
    }

    // 3) Thumb should also be tucked (tip close to palm)
    const thumbToPalm = lmkDist(hand[4], palmCenter) / scale;
    const thumbTucked = (lmkDist(hand[4], wrist) / scale) < 1.18 && thumbToPalm < 0.92;

    // strict closed-fist gate
    return (
      avgTipToWrist < 1.08 &&
      avgTipToPalm < 0.88 &&
      curledCount >= 4 &&
      foldedSilhouetteCount >= 3 &&
      thumbTucked
    );
  }

  function classifySignal(primary, interaction) {
    if (!primary || !interaction?.handsDetected) return null;
    if (isFistPose(primary)) return SIGNALS.FIST_DELETE;
    return null;
  }

  function setStatus(msg, state = "ok") {
    statusEl.textContent = msg;
    statusEl.dataset.state = state;
  }

  function fmt(n) {
    return Number.isFinite(n) ? Number(n).toFixed(2) : "0.00";
  }

  function renderObjectList() {
    if (!objectListEl || !objectCountEl) return;

    objectCountEl.textContent = String(placedMeshes.length);
    if (!placedMeshes.length) {
      objectListEl.innerHTML = `<div class="object-meta">No objects placed yet.</div>`;
      return;
    }

    objectListEl.innerHTML = placedMeshes.map((mesh, idx) => {
      const shape = mesh.userData?.shape || "mesh";
      const pos = mesh.position || { x: 0, y: 0, z: 0 };
      const scale = mesh.scale || { x: 1, y: 1, z: 1 };
      return `
        <article class="object-item">
          <div class="object-title">
            <strong>${idx + 1}. ${shape}</strong>
            <span>${mesh === activeMesh ? "active" : ""}</span>
          </div>
          <div class="object-meta">
            pos: (${fmt(pos.x)}, ${fmt(pos.y)}, ${fmt(pos.z)})<br/>
            scale: (${fmt(scale.x)}, ${fmt(scale.y)}, ${fmt(scale.z)})
          </div>
        </article>
      `;
    }).join("");
  }

  function setIntent(msg, state = "idle") {
    intentBadgeEl.textContent = `Intent: ${msg}`;
    intentBadgeEl.dataset.state = state;
  }

  function pinchPulseRadius(pinchStrength = 0) {
    return PLACEMENT_PULSE_BASE + (Math.max(0, pinchStrength) * PLACEMENT_PULSE_GAIN);
  }

  function drawPlacementReticle(x, y, radius) {
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(120, 205, 235, 0.55)";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(5, radius * 0.36), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawLandmarkDot(x, y, radius, fill, glow, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.shadowBlur = radius * 2.5;
    ctx.shadowColor = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDebug(hands, interaction, primaryHand = null) {
    ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    if (!hands?.length) return;

    // Minimal futuristic overlay with subtle contrast.
    const hand = primaryHand || hands[0];
    if (!hand) return;

    const palm = palmCenterLandmark(hand) || hand[0] || { x: 0.5, y: 0.5, z: 0 };
    const palmScreenX = (1 - palm.x) * overlayEl.width;
    const palmScreenY = palm.y * overlayEl.height;
    const toOverlay = (p) => {
      const sx = (1 - p.x) * overlayEl.width;
      const sy = p.y * overlayEl.height;
      return {
        x: palmScreenX + (sx - palmScreenX) * HAND_OVERLAY_SCALE,
        y: palmScreenY + (sy - palmScreenY) * HAND_OVERLAY_SCALE,
      };
    };

    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(125, 210, 235, 0.45)";
    ctx.shadowBlur = 4;
    ctx.shadowColor = "rgba(90, 190, 220, 0.35)";
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = toOverlay(hand[a]);
      const p2 = toOverlay(hand[b]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    const fingertipIdx = [4, 8, 12, 16, 20];
    for (const idx of fingertipIdx) {
      const p = toOverlay(hand[idx]);
      ctx.fillStyle = "rgba(90, 190, 220, 0.5)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (SHOW_HAND_MARKERS) {
      const contact = midpointLandmark(hand[4], hand[8]) || hand[8];
      const c = toOverlay(contact);
      const pulse = pinchPulseRadius(interaction?.pinchStrength || 0);
      drawPlacementReticle(c.x, c.y, pulse);
      drawLandmarkDot(c.x, c.y, 3.8, "rgba(126, 210, 238, 0.75)", "rgba(84, 170, 235, 0.2)", 0.8);
    }

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
  }

  function refreshDebug() {
    debugStateEl.textContent = JSON.stringify({
      interaction: appState.interaction,
      calibration: appState.calibration,
      snap: {
        enabled: snapToggleEl.value === "on",
        step: Number(gridStepInputEl.value),
        transformMode: transformSnapModeEl.value,
        rotationStepDeg: Number(rotationStepInputEl.value),
        lockMode: transformLockModeEl.value,
      },
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

  function enforceMeshBudget() {
    while (placedMeshes.length > MAX_MESHES) {
      const old = placedMeshes.shift();
      removeMesh(old);
      if (activeMesh === old) setActiveMesh(null);
    }
    renderObjectList();
  }

  function undo() {
    const mesh = placedMeshes.pop();
    if (!mesh) return;
    removeMesh(mesh);
    if (activeMesh === mesh) setActiveMesh(null);
    setStatus(`Undid one shape. Remaining ${placedMeshes.length}`, "ok");
    renderObjectList();
    refreshDebug();
  }

  function deleteNearestToPalm(palmHit) {
    if (!palmHit) return false;
    const target = pickNearestMesh(palmHit, Infinity);
    if (!target) return false;
    const idx = placedMeshes.indexOf(target);
    if (idx >= 0) placedMeshes.splice(idx, 1);
    if (target === activeMesh) setActiveMesh(null);
    removeMesh(target);
    setStatus("Deleted nearest object to palm", "ok");
    renderObjectList();
    return true;
  }

  function clearAll() {
    while (placedMeshes.length) removeMesh(placedMeshes.pop());
    setActiveMesh(null);
    setStatus("Cleared scene", "idle");
    renderObjectList();
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
      const mesh = world.buildMesh(item.shape || "cube", Number(item.baseSize || 1), item.color || "#7cf7e4");
      mesh.position.fromArray(item.position || [0, 0.5, 0]);
      mesh.rotation.y = Number(item.rotationY || 0);
      if (Array.isArray(item.scale)) mesh.scale.fromArray(item.scale);
      mesh.userData.shape = item.shape || "cube";
      mesh.userData.baseSize = Number(item.baseSize || 1);
      world.scene.add(mesh);
      placedMeshes.push(mesh);
    });
    setStatus(`Loaded ${placedMeshes.length} shapes`, "ok");
    renderObjectList();
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
    const now = performance.now();
    const minInferMs = 28;

    if (webcamEl.readyState >= 2 && (now - lastInferAt >= minInferMs)) {
      lastInferAt = now;
      const results = handLandmarker.detectForVideo(webcamEl, now);
      const hands = results?.landmarks || [];
      const handA = hands[0] || null;
      const handB = hands[1] || null;

      let primary = handA;
      let secondary = handB;
      if (handA && handB) {
        const pa = pinchDistance(handA);
        const pb = pinchDistance(handB);
        if (pb < pa) {
          primary = handB;
          secondary = handA;
        }
      }

      const interaction = pipeline.update(primary, secondary);
      const rawSignal = classifySignal(primary, interaction);
      if (rawSignal === SIGNALS.FIST_DELETE) {
        if (fistHoldStartAt == null) fistHoldStartAt = now;
      } else {
        fistHoldStartAt = null;
      }
      const signal = (fistHoldStartAt != null && (now - fistHoldStartAt) >= FIST_HOLD_MS)
        ? SIGNALS.FIST_DELETE
        : null;
      const palmCenter = primary ? palmCenterLandmark(primary) : null;
      drawDebug(hands, interaction, primary);
      appState.interaction = interaction;
      appState.interaction.signal = signal;

      if (!interaction.handsDetected) {
        setIntent("waiting for hands", "idle");
      } else if (interaction.pinch && gestureModeEl.value === "spawn") {
        setIntent("placing shape", "ok");
      } else if (interaction.pinch && gestureModeEl.value === "transform") {
        setIntent(transformLocked ? "transform lock active" : "acquiring transform lock", "ok");
      } else if (signal === SIGNALS.FIST_DELETE) {
        setIntent("fist delete", "ok");
      } else {
        setIntent(gestureModeEl.value === "transform" ? "hovering for selection" : "ready to place", "idle");
      }

      const dynamicAlpha = Math.max(0.16, Math.min(0.62, 0.55 - interaction.jitter * 2.2));
      pipeline.setAlpha(dynamicAlpha);

      if (primary) {
        const pinchContact = midpointLandmark(primary[4], primary[8]);
        const palmHitRaw = palmCenter ? world.projectToGround(palmCenter) : null;
        const pinchHitRaw = pinchContact ? world.projectToGround(pinchContact) : null;
        smoothedPalm = smoothPoint(smoothedPalm, palmHitRaw, 0.24);
        smoothedPinch = smoothPoint(smoothedPinch, pinchHitRaw, 0.3);
        const palmHit = smoothedPalm;
        const pinchHit = smoothedPinch;

        // Palm proxy intentionally disabled to keep the world view clean.

        const pinchActive = interaction.pinch && signal !== SIGNALS.FIST_DELETE;
        const pinchStart = pinchActive && !prevPinch;
        const pulseRadius = pinchPulseRadius(interaction.pinchStrength || 0);
        const placementPulseActive = pinchActive && pulseRadius >= PLACEMENT_PULSE_TRIGGER_RADIUS;
        const placementPulseTrigger = placementPulseActive && !prevPlacementPulseActive;
        const pinchHitForSpawn = pinchHitRaw || pinchHit;
        const canSpawn = now - lastSpawnAt >= SPAWN_COOLDOWN_MS;
        const canOperate = now - lastOperationAt >= OPERATION_COOLDOWN_MS;

        const shouldSpawn = canOperate && canSpawn && pinchHitForSpawn && (pinchStart || placementPulseTrigger);
        if (shouldSpawn) {
          const mesh = world.buildMesh(shapeTypeEl.value, Number(sizeInputEl.value), colorInputEl.value);
          mesh.position.x = shouldSnapPosition() ? snapValue(pinchHitForSpawn.x) : pinchHitForSpawn.x;
          mesh.position.z = shouldSnapPosition() ? snapValue(pinchHitForSpawn.z) : pinchHitForSpawn.z;
          mesh.rotation.y = snapRotation(Math.random() * Math.PI);
          mesh.userData.shape = shapeTypeEl.value;
          mesh.userData.baseSize = Number(sizeInputEl.value);
          world.scene.add(mesh);
          setActiveMesh(mesh);
          placedMeshes.push(mesh);
          enforceMeshBudget();
          renderObjectList();
          setStatus(`Placed ${shapeTypeEl.value}`, "ok");
          lastSpawnAt = now;
          lastOperationAt = now;
        }

        const canDeleteWithFist =
          signal === SIGNALS.FIST_DELETE &&
          palmHit &&
          now - lastOperationAt >= OPERATION_COOLDOWN_MS &&
          now - lastFistDeleteAt >= FIST_DELETE_COOLDOWN_MS;
        if (canDeleteWithFist && deleteNearestToPalm(palmHit)) {
          lastFistDeleteAt = now;
          lastOperationAt = now;
        }

        if (pinchStart && palmHit && gestureModeEl.value === "transform") {
          setActiveMesh(pickNearestMesh(palmHit));
          transformLocked = Boolean(activeMesh);
          prevTwoHandAngle = null;
          if (transformLocked) setStatus("Transform lock acquired", "ok");
        }

        if (pinchActive && activeMesh && palmHit && gestureModeEl.value === "transform") {
          const nextPos = new THREE.Vector3(
            shouldSnapPosition() ? snapValue(palmHit.x) : palmHit.x,
            activeMesh.position.y,
            shouldSnapPosition() ? snapValue(palmHit.z) : palmHit.z
          );
          const stablePos = applyDeadzone(activeMesh.position.clone(), nextPos, 0.05);
          activeMesh.position.x = stablePos.x;
          activeMesh.position.z = stablePos.z;
          activeMesh.rotation.y = snapRotation(interaction.rotation);
          rotationGuide.setDirection(new THREE.Vector3(Math.cos(activeMesh.rotation.y), 0, Math.sin(activeMesh.rotation.y)).normalize());
          rotationGuide.position.set(activeMesh.position.x, 0.05, activeMesh.position.z);

          const calibratedScale = appState.calibration.scaleK || 1;
          const twoHand = interaction.twoHandBoost == null ? 1 : (0.85 + interaction.twoHandBoost * 0.7);
          const scale = (0.45 + interaction.resize * 2.4) * calibratedScale * twoHand;
          activeMesh.scale.setScalar(scale);

          if (secondary) {
            const p1 = primary[8];
            const p2 = secondary[8];
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            if (prevTwoHandAngle != null) {
              const delta = angle - prevTwoHandAngle;
              activeMesh.rotation.y += delta * 1.2;
            }
            prevTwoHandAngle = angle;
          } else {
            prevTwoHandAngle = null;
          }

          selectionRing.position.set(activeMesh.position.x, 0.02, activeMesh.position.z);
          updateGeometryMetrics(activeMesh.userData.shape || shapeTypeEl.value, Number(sizeInputEl.value) * scale);
        }

        if (!pinchActive && prevPinch && transformLocked) {
          transformLocked = transformLockModeEl.value === "sticky";
          prevTwoHandAngle = null;
          if (!transformLocked) {
            setStatus("Transform released", "idle");
          } else {
            setStatus("Transform sticky-lock maintained", "ok");
          }
        }

        prevPlacementPulseActive = placementPulseActive;
        prevPinch = pinchActive;
      }

      refreshDebug();
      if (!primary) {
        prevPinch = false;
        prevPlacementPulseActive = false;
        fistHoldStartAt = null;
        smoothedPalm = null;
        smoothedPinch = null;
      }
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
    setIntent("stopped", "idle");
  }

  function bindValueEvents(el, handler) {
    if (!el) return;
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) {
      stop();
      setStatus("Paused (tab hidden)", "idle");
      setIntent("paused", "idle");
    }
  });

  bindValueEvents(smoothingInputEl, () => {
    const alpha = Number(smoothingInputEl.value);
    appState.calibration.smoothingAlpha = alpha;
    pipeline.setAlpha(alpha);
    saveCalibration(appState.calibration);
    refreshDebug();
  });

  trackingProfileEl.addEventListener("change", () => {
    const profile = trackingProfileEl.value;
    pipeline.setProfile(profile);
    if (profile === "stable") smoothingInputEl.value = "0.52";
    else if (profile === "responsive") smoothingInputEl.value = "0.24";
    else smoothingInputEl.value = String(appState.calibration.smoothingAlpha);

    setStatus(`Tracking profile: ${profile}`, "ok");
    refreshDebug();
  });

  transformSnapModeEl.addEventListener("change", refreshDebug);
  transformLockModeEl.addEventListener("change", refreshDebug);
  navigationModeEl?.addEventListener("change", () => {
    if (typeof world.setNavigationMode === "function") {
      world.setNavigationMode(navigationModeEl.value || "blender");
    }
    setStatus(`Navigation: ${navigationModeEl.value}`, "ok");
    refreshDebug();
  });
  bindValueEvents(rotationStepInputEl, refreshDebug);
  snapToggleEl.addEventListener("change", refreshDebug);
  bindValueEvents(gridStepInputEl, refreshDebug);

  calibrateBtn.addEventListener("click", () => {
    const reference = appState.interaction.wristToIndex || appState.calibration.baselineDistance;
    appState.calibration.baselineDistance = reference;
    appState.calibration.scaleK = deriveScaleK(reference);
    saveCalibration(appState.calibration);
    setStatus("Calibration captured", "ok");
    refreshDebug();
  });

  calibrationPresetEl.addEventListener("change", () => {
    const preset = calibrationPresets[calibrationPresetEl.value];
    if (!preset) return;
    appState.calibration = { ...appState.calibration, ...preset };
    smoothingInputEl.value = String(appState.calibration.smoothingAlpha);
    pipeline.setAlpha(appState.calibration.smoothingAlpha);
    saveCalibration(appState.calibration);
    setStatus(`Calibration preset: ${calibrationPresetEl.value}`, "ok");
    refreshDebug();
  });

  undoBtn.addEventListener("click", undo);
  clearBtn.addEventListener("click", clearAll);
  saveSceneBtn.addEventListener("click", saveScene);
  loadSceneBtn.addEventListener("click", () => loadSceneInput.click());
  const onResetView = () => {
    if (typeof world.resetView === "function") {
      world.resetView();
      setStatus("View reset to default", "ok");
    }
  };
  resetViewBtn?.addEventListener("click", onResetView);
  resetViewSceneBtn?.addEventListener("click", onResetView);
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
  renderObjectList();
  setStatus("Ready. Start camera to begin.", "idle");
  setIntent("ready", "idle");
}
