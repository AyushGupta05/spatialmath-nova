import { computeGeometry } from "./core/geometry.js";
import { clamp } from "./core/math.js";
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
const OVERLAY_MIN_ALPHA = 0.1;
const OVERLAY_MAX_ALPHA = 0.48;
const OVERLAY_MOTION_GAIN = 10.5;
const OVERLAY_TRAIL_LENGTH = 7;
const OVERLAY_TRAIL_MIN_STEP = 0.0032;
const PALM_CENTER_INDEXES = [0, 5, 9, 13, 17];
const SPAWN_COOLDOWN_MS = 220;
const FIST_DELETE_COOLDOWN_MS = 420;
const FIST_HOLD_MS = 180;
const OPERATION_COOLDOWN_MS = 2500;
const PLACEMENT_PULSE_BASE = 8;
const PLACEMENT_PULSE_GAIN = 7;
const PLACEMENT_PULSE_TRIGGER_RADIUS = 12.2;
const SELECTION_RING_BASE_RADIUS = 0.31;
const TRANSFORM_SELECT_BUFFER = 0.95;
const TRANSFORM_MIDPOINT_RADIUS_FACTOR = 1.08;
const TRANSFORM_OPPOSITION_DOT_MAX = 0.72;
const MIN_TRANSFORM_SPAN = 0.3;
const MIN_HAND_AXIS_SPAN = 0.05;
const MIN_MESH_SCALE = 0.25;
const MAX_MESH_SCALE = 8;
const TRANSFORM_LOCK_MS = 90;
const SIGNALS = {
  FIST_DELETE: "fist_delete",
};

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
  if (gestureModeEl) {
    gestureModeEl.disabled = true;
    gestureModeEl.title = "Mode switches automatically: one hand places/deletes, two hands transform.";
    gestureModeEl.value = "spawn";
  }

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
  let smoothedSecondaryPalm = null;
  let overlayHandStates = [];
  let transformSession = null;
  let pendingTransformCandidate = null;
  let pendingTransformSince = null;
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
      selectionRing.scale.setScalar(1);
      selectionRing.material.opacity = 0.95;
      rotationGuide.visible = false;
      renderObjectList();
      return;
    }
    selectionRing.position.set(activeMesh.position.x, 0.02, activeMesh.position.z);
    rotationGuide.visible = false;
    renderObjectList();
  }

  function beginTransformSession(mesh, hitA, hitB, palmA, palmB, now) {
    if (!mesh || !hitA || !hitB || !palmA || !palmB) return false;

    const span = Math.max(MIN_TRANSFORM_SPAN, planarDistance(hitA, hitB));
    const midpoint = hitA.clone().lerp(hitB, 0.5);
    const startAngle = Math.atan2(hitB.z - hitA.z, hitB.x - hitA.x);
    const axisSpan = handAxisSpan(palmA, palmB);
    const startingScale = {
      x: clamp(mesh.scale.x || 1, MIN_MESH_SCALE, MAX_MESH_SCALE),
      y: clamp(mesh.scale.y || 1, MIN_MESH_SCALE, MAX_MESH_SCALE),
      z: clamp(mesh.scale.z || 1, MIN_MESH_SCALE, MAX_MESH_SCALE),
    };

    setActiveMesh(mesh);
    transformSession = {
      mesh,
      startSpan: span,
      startScale: startingScale,
      startAxisSpan: axisSpan,
      startAngle,
      startRotationY: mesh.rotation.y,
      startMidpoint: midpoint.clone(),
      startPosition: mesh.position.clone(),
    };
    selectionRing.userData.pulseStartAt = now;
    setStatus("Transform locked: horizontal spread changes width, vertical spread changes length", "ok");
    return true;
  }

  function endTransformSession(statusMsg = "Transform released") {
    if (!transformSession && !activeMesh) return;
    transformSession = null;
    setActiveMesh(null);
    setStatus(statusMsg, "idle");
  }

  function updateSelectionFeedback(now) {
    if (!transformSession?.mesh || activeMesh !== transformSession.mesh) {
      selectionRing.visible = false;
      rotationGuide.visible = false;
      return;
    }

    const pulseStartAt = selectionRing.userData.pulseStartAt ?? now;
    const pulseT = Math.max(0, now - pulseStartAt);
    const entryBoost = Math.max(0, 1 - pulseT / 220);
    const idlePulse = 1 + Math.sin(now * 0.01) * 0.05;
    const targetRadius = Math.max(0.48, meshSelectionRadius(activeMesh) - TRANSFORM_SELECT_BUFFER * 0.4);
    const scale = (targetRadius / SELECTION_RING_BASE_RADIUS) * (idlePulse + entryBoost * 0.35);

    selectionRing.visible = true;
    selectionRing.position.set(activeMesh.position.x, 0.02, activeMesh.position.z);
    selectionRing.scale.setScalar(scale);
    selectionRing.material.opacity = 0.46 + entryBoost * 0.28 + (idlePulse - 1) * 1.8;

    rotationGuide.visible = false;
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

  function cloneLandmark(point) {
    if (!point) return null;
    return {
      x: point.x,
      y: point.y,
      z: point.z,
    };
  }

  function smoothOverlayLandmark(prev, next) {
    if (!next) return prev ? cloneLandmark(prev) : null;
    if (!prev) return cloneLandmark(next);

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dz = (next.z || 0) - (prev.z || 0);
    const motion = Math.hypot(dx, dy, dz);
    const alpha = clamp(
      OVERLAY_MIN_ALPHA + (motion * OVERLAY_MOTION_GAIN),
      OVERLAY_MIN_ALPHA,
      OVERLAY_MAX_ALPHA
    );

    prev.x += dx * alpha;
    prev.y += dy * alpha;
    prev.z += dz * alpha;
    return prev;
  }

  function updateOverlayTrail(trail, point) {
    if (!point) return [];

    if (!trail?.length) {
      return [cloneLandmark(point)];
    }

    const nextTrail = [...trail];
    const last = nextTrail[nextTrail.length - 1];
    const step = lmkDist(last, point);

    if (step < OVERLAY_TRAIL_MIN_STEP) {
      last.x += (point.x - last.x) * 0.24;
      last.y += (point.y - last.y) * 0.24;
      last.z += ((point.z || 0) - (last.z || 0)) * 0.24;
      return nextTrail;
    }

    nextTrail.push(cloneLandmark(point));
    if (nextTrail.length > OVERLAY_TRAIL_LENGTH) nextTrail.shift();
    return nextTrail;
  }

  function smoothHandsForOverlay(hands) {
    overlayHandStates = hands.map((hand, index) => {
      const prevState = overlayHandStates[index];
      const landmarks = hand.map((point, pointIndex) =>
        smoothOverlayLandmark(prevState?.landmarks?.[pointIndex], point)
      );
      const contact = midpointLandmark(landmarks[4], landmarks[8]) || landmarks[8];

      return {
        landmarks,
        trail: updateOverlayTrail(prevState?.trail || [], contact),
      };
    });

    return overlayHandStates;
  }

  function handAxisSpan(a, b) {
    if (!a || !b) {
      return { x: MIN_HAND_AXIS_SPAN, y: MIN_HAND_AXIS_SPAN };
    }
    return {
      x: Math.max(MIN_HAND_AXIS_SPAN, Math.abs(a.x - b.x)),
      y: Math.max(MIN_HAND_AXIS_SPAN, Math.abs(a.y - b.y)),
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

  function planarDistance(a, b) {
    if (!a || !b) return Infinity;
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function updateMeshMetadata(mesh) {
    if (!mesh) return;
    const bbox = new THREE.Box3().setFromObject(mesh);
    const footprint = Math.max(bbox.max.x - bbox.min.x, bbox.max.z - bbox.min.z);
    const scale = Math.max(Math.abs(mesh.scale.x || 1), Math.abs(mesh.scale.z || 1), 1e-4);
    mesh.userData.selectionRadius = Math.max(0.42, (footprint / scale) * 0.55);
  }

  function meshSelectionRadius(mesh) {
    if (!mesh) return 0;
    const baseRadius = mesh.userData.selectionRadius ?? 0.42;
    const scale = Math.max(Math.abs(mesh.scale.x || 1), Math.abs(mesh.scale.z || 1), 1);
    return (baseRadius * scale) + TRANSFORM_SELECT_BUFFER;
  }

  function pickNearestMesh(hitPoint, maxDist = 1.5) {
    let best = null;
    let dist = Infinity;
    for (const mesh of placedMeshes) {
      const d = planarDistance(mesh.position, hitPoint);
      if (d < dist && d <= maxDist) {
        best = mesh;
        dist = d;
      }
    }
    return best;
  }

  function pickMeshForTransform(hitA, hitB) {
    if (!hitA || !hitB) return null;

    const midpoint = hitA.clone().lerp(hitB, 0.5);
    let best = null;
    let bestScore = Infinity;

    for (const mesh of placedMeshes) {
      const radius = meshSelectionRadius(mesh);
      const dA = planarDistance(mesh.position, hitA);
      const dB = planarDistance(mesh.position, hitB);
      const midpointDist = planarDistance(mesh.position, midpoint);
      if (dA > radius * 1.3 || dB > radius * 1.3) continue;
      if (midpointDist > radius * TRANSFORM_MIDPOINT_RADIUS_FACTOR) continue;

      const vecAX = hitA.x - mesh.position.x;
      const vecAZ = hitA.z - mesh.position.z;
      const vecBX = hitB.x - mesh.position.x;
      const vecBZ = hitB.z - mesh.position.z;
      const lenA = Math.hypot(vecAX, vecAZ);
      const lenB = Math.hypot(vecBX, vecBZ);
      if (lenA < 0.08 || lenB < 0.08) continue;

      const oppositionDot = ((vecAX * vecBX) + (vecAZ * vecBZ)) / (lenA * lenB);
      if (oppositionDot > TRANSFORM_OPPOSITION_DOT_MAX) continue;

      const score = dA + dB + midpointDist * 0.9 + (oppositionDot + 1) * 0.35;
      if (score < bestScore) {
        best = mesh;
        bestScore = score;
      }
    }

    // Fallback: if hands are around but not perfectly opposite, use midpoint-nearest object.
    if (!best) {
      best = pickNearestMesh(midpoint, 2.8);
    }

    return best;
  }

  function updatePendingTransformCandidate(candidate, now) {
    if (!candidate) {
      pendingTransformCandidate = null;
      pendingTransformSince = null;
      return false;
    }

    if (pendingTransformCandidate !== candidate) {
      pendingTransformCandidate = candidate;
      pendingTransformSince = now;
      return false;
    }

    return pendingTransformSince != null && (now - pendingTransformSince) >= TRANSFORM_LOCK_MS;
  }

  function lmkDist(a, b) {
    if (!a || !b) return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function sortHandsForTracking(hands) {
    return [...hands].sort((handA, handB) => {
      const palmA = palmCenterLandmark(handA);
      const palmB = palmCenterLandmark(handB);
      return (palmA?.x ?? 0.5) - (palmB?.x ?? 0.5);
    });
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

  function isThumbsUpPose(hand) {
    if (!hand) return false;
    const scale = palmScale(hand);
    const wrist = hand[0];
    const palmCenter = {
      x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
      y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
      z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
    };
    const tips = [8, 12, 16, 20];
    const pips = [6, 10, 14, 18];
    const mcps = [5, 9, 13, 17];

    let curledCount = 0;
    for (let i = 0; i < tips.length; i += 1) {
      const tip = hand[tips[i]];
      const tipToPalm = lmkDist(tip, palmCenter) / scale;
      const tipToWrist = lmkDist(tip, wrist);
      const pipToWrist = lmkDist(hand[pips[i]], wrist);
      const mcpToWrist = lmkDist(hand[mcps[i]], wrist);
      if (tipToPalm < 0.96 && tipToWrist <= Math.max(pipToWrist, mcpToWrist) * 1.05) {
        curledCount += 1;
      }
    }

    const thumbTip = hand[4];
    const thumbIp = hand[3];
    const thumbMcp = hand[2];
    const thumbExtended =
      (lmkDist(thumbTip, wrist) / scale) > 1.35 &&
      (lmkDist(thumbTip, palmCenter) / scale) > 1.08 &&
      (lmkDist(thumbTip, thumbMcp) / scale) > 0.52 &&
      lmkDist(thumbTip, wrist) > lmkDist(thumbIp, wrist) * 1.08;
    const thumbAbovePalm = thumbTip.y < palmCenter.y - 0.02;
    const thumbAboveFingers = thumbTip.y < (Math.min(...tips.map((idx) => hand[idx].y)) - 0.01);

    return thumbExtended && curledCount >= 3 && thumbAbovePalm && thumbAboveFingers;
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

  function drawPalmHalo(x, y, radius = 26) {
    ctx.save();
    const gradient = ctx.createRadialGradient(x, y, radius * 0.12, x, y, radius);
    gradient.addColorStop(0, "rgba(124, 247, 228, 0.2)");
    gradient.addColorStop(0.5, "rgba(90, 190, 220, 0.09)");
    gradient.addColorStop(1, "rgba(90, 190, 220, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawContactTrail(trail, toOverlay) {
    if (!trail?.length) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < trail.length; i += 1) {
      const point = toOverlay(trail[i]);
      const t = (i + 1) / trail.length;
      drawLandmarkDot(
        point.x,
        point.y,
        1.6 + (t * 3.8),
        `rgba(126, 210, 238, ${0.05 + (t * 0.2)})`,
        "rgba(84, 170, 235, 0.18)",
        0.34 + (t * 0.34)
      );
    }

    if (trail.length > 1) {
      ctx.beginPath();
      trail.forEach((point, index) => {
        const projected = toOverlay(point);
        if (index === 0) ctx.moveTo(projected.x, projected.y);
        else ctx.lineTo(projected.x, projected.y);
      });
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = "rgba(126, 210, 238, 0.18)";
      ctx.shadowBlur = 14;
      ctx.shadowColor = "rgba(84, 170, 235, 0.22)";
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawDebug(hands, interaction) {
    ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    if (!hands?.length) return;
    const visualHands = smoothHandsForOverlay(hands);

    // Minimal futuristic overlay with subtle contrast.
    for (const handState of visualHands) {
      const hand = handState?.landmarks;
      if (!hand) continue;

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
      const contact = midpointLandmark(hand[4], hand[8]) || hand[8];
      const contactScreen = contact ? toOverlay(contact) : null;

      drawPalmHalo(palmScreenX, palmScreenY, 28);
      drawContactTrail(handState.trail, toOverlay);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = "rgba(126, 210, 238, 0.12)";
      ctx.shadowBlur = 18;
      ctx.shadowColor = "rgba(84, 170, 235, 0.12)";
      for (const [a, b] of HAND_CONNECTIONS) {
        const p1 = toOverlay(hand[a]);
        const p2 = toOverlay(hand[b]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.35;
      ctx.strokeStyle = "rgba(150, 233, 255, 0.52)";
      ctx.shadowBlur = 8;
      ctx.shadowColor = "rgba(84, 170, 235, 0.32)";
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
        drawLandmarkDot(p.x, p.y, 3.2, "rgba(138, 229, 247, 0.72)", "rgba(84, 170, 235, 0.22)", 0.88);
      }
      ctx.restore();

      if (!SHOW_HAND_MARKERS) continue;

      const pulse = interaction?.mode === "transform"
        ? PLACEMENT_PULSE_BASE + 1.5
        : pinchPulseRadius(interaction?.pinchStrength || 0);
      if (contactScreen) {
        drawPlacementReticle(contactScreen.x, contactScreen.y, pulse);
        drawLandmarkDot(
          contactScreen.x,
          contactScreen.y,
          4.4,
          "rgba(124, 247, 228, 0.9)",
          "rgba(84, 170, 235, 0.32)",
          0.9
        );
      }
    }

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
  }

  function drawTransformLockBadge() {
    if (!transformSession?.mesh || activeMesh !== transformSession.mesh) return;

    const worldPos = transformSession.mesh.position.clone();
    worldPos.y += 0.65;
    const ndc = worldPos.project(world.camera);

    if (ndc.z < -1 || ndc.z > 1) return;
    const x = ((ndc.x + 1) * 0.5) * overlayEl.width;
    const y = ((1 - ndc.y) * 0.5) * overlayEl.height;

    ctx.save();
    ctx.font = "600 11px 'IBM Plex Sans', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text = "LOCKED";
    const padX = 8;
    const padY = 4;
    const w = ctx.measureText(text).width + padX * 2;
    const h = 18;
    const rx = x - w * 0.5;
    const ry = y - h - 10;

    ctx.fillStyle = "rgba(9, 24, 42, 0.78)";
    ctx.strokeStyle = "rgba(120, 220, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(rx, ry, w, h, 7);
    } else {
      // fallback for browsers without Canvas roundRect support
      ctx.rect(rx, ry, w, h);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(170, 235, 255, 0.95)";
    ctx.fillText(text, x, ry + h * 0.53);
    ctx.restore();
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
      if (transformSession?.mesh === old) transformSession = null;
      removeMesh(old);
      if (activeMesh === old) setActiveMesh(null);
    }
    renderObjectList();
  }

  function undo() {
    const mesh = placedMeshes.pop();
    if (!mesh) return;
    if (transformSession?.mesh === mesh) transformSession = null;
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
    if (transformSession?.mesh === target) transformSession = null;
    if (target === activeMesh) setActiveMesh(null);
    removeMesh(target);
    setStatus("Deleted nearest object to palm", "ok");
    renderObjectList();
    return true;
  }

  function clearAll() {
    transformSession = null;
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
      updateMeshMetadata(mesh);
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
      const hands = sortHandsForTracking(results?.landmarks || []);
      const primary = hands[0] || null;
      const secondary = hands[1] || null;
      const handCount = hands.length;
      const baseInteraction = pipeline.update(primary, secondary);
      const detectedMode = handCount >= 2 ? "transform" : "spawn";

      const rawSignal = handCount === 1
        ? classifySignal(primary, { ...baseInteraction, handsDetected: handCount > 0 })
        : null;
      if (rawSignal === SIGNALS.FIST_DELETE) {
        if (fistHoldStartAt == null) fistHoldStartAt = now;
      } else {
        fistHoldStartAt = null;
      }

      const signal = (fistHoldStartAt != null && (now - fistHoldStartAt) >= FIST_HOLD_MS)
        ? SIGNALS.FIST_DELETE
        : null;

      const primaryPalm = primary ? palmCenterLandmark(primary) : null;
      const secondaryPalm = secondary ? palmCenterLandmark(secondary) : null;
      const primaryPalmHitRaw = primaryPalm ? world.projectToGround(primaryPalm) : null;
      const secondaryPalmHitRaw = secondaryPalm ? world.projectToGround(secondaryPalm) : null;
      const pinchContact = primary ? midpointLandmark(primary[4], primary[8]) : null;
      const pinchHitRaw = pinchContact ? world.projectToGround(pinchContact) : null;

      smoothedPalm = smoothPoint(smoothedPalm, primaryPalmHitRaw, 0.24);
      smoothedSecondaryPalm = smoothPoint(smoothedSecondaryPalm, secondaryPalmHitRaw, 0.24);
      smoothedPinch = smoothPoint(smoothedPinch, pinchHitRaw, 0.3);

      const primaryPalmHit = primaryPalmHitRaw || smoothedPalm;
      const secondaryPalmHit = secondaryPalmHitRaw || smoothedSecondaryPalm;
      const pinchHit = pinchHitRaw || smoothedPinch;
      const transformDistance = handCount >= 2 && primaryPalmHit && secondaryPalmHit
        ? planarDistance(primaryPalmHit, secondaryPalmHit)
        : 0;
      const thumbsUpRelease = Boolean(transformSession) && [primary, secondary].some(
        (hand) => hand && isThumbsUpPose(hand)
      );
      const lockMode = transformLockModeEl.value || "hold";
      let transformEndedThisFrame = false;

      if (thumbsUpRelease && transformSession) {
        endTransformSession("Transform ended");
        pendingTransformCandidate = null;
        pendingTransformSince = null;
        transformEndedThisFrame = true;
      } else if (transformSession && handCount < 2 && lockMode !== "sticky") {
        endTransformSession("Transform released");
        pendingTransformCandidate = null;
        pendingTransformSince = null;
        transformEndedThisFrame = true;
      }

      const interaction = {
        ...baseInteraction,
        handsDetected: handCount > 0,
        handCount,
        mode: transformSession ? "transform" : detectedMode,
      };

      if (gestureModeEl) gestureModeEl.value = interaction.mode;

      drawDebug(hands, interaction);
      appState.interaction = {
        ...interaction,
        signal,
        transformDistance,
        thumbsUp: thumbsUpRelease,
        transformActive: Boolean(transformSession),
      };

      if (!interaction.handsDetected) {
        setIntent("waiting for hands", "idle");
      } else if (transformEndedThisFrame && thumbsUpRelease) {
        setIntent("ending transform", "ok");
      } else if (transformSession) {
        setIntent(handCount >= 2 ? "scaling selected object" : "transform locked", "ok");
      } else if (detectedMode === "transform") {
        setIntent("align hands around object", "idle");
      } else if (signal === SIGNALS.FIST_DELETE) {
        setIntent("fist delete", "ok");
      } else if (interaction.pinch) {
        setIntent("placing shape", "ok");
      } else {
        setIntent("ready to place", "idle");
      }

      const dynamicAlpha = Math.max(0.16, Math.min(0.62, 0.55 - interaction.jitter * 2.2));
      pipeline.setAlpha(dynamicAlpha);

      if (!transformSession && !transformEndedThisFrame && detectedMode === "spawn" && primary) {
        const pinchActive = interaction.pinch && signal !== SIGNALS.FIST_DELETE;
        const pinchStart = pinchActive && !prevPinch;
        const pulseRadius = pinchPulseRadius(interaction.pinchStrength || 0);
        const placementPulseActive = pinchActive && pulseRadius >= PLACEMENT_PULSE_TRIGGER_RADIUS;
        const placementPulseTrigger = placementPulseActive && !prevPlacementPulseActive;
        const canSpawn = now - lastSpawnAt >= SPAWN_COOLDOWN_MS;
        const canOperate = now - lastOperationAt >= OPERATION_COOLDOWN_MS;

        const shouldSpawn = canOperate && canSpawn && pinchHit && (pinchStart || placementPulseTrigger);
        if (shouldSpawn) {
          const mesh = world.buildMesh(shapeTypeEl.value, Number(sizeInputEl.value), colorInputEl.value);
          mesh.position.x = shouldSnapPosition() ? snapValue(pinchHit.x) : pinchHit.x;
          mesh.position.z = shouldSnapPosition() ? snapValue(pinchHit.z) : pinchHit.z;
          mesh.rotation.y = snapRotation(Math.random() * Math.PI);
          mesh.userData.shape = shapeTypeEl.value;
          mesh.userData.baseSize = Number(sizeInputEl.value);
          updateMeshMetadata(mesh);
          world.scene.add(mesh);
          placedMeshes.push(mesh);
          enforceMeshBudget();
          updateGeometryMetrics(mesh.userData.shape, mesh.userData.baseSize);
          renderObjectList();
          setStatus(`Placed ${shapeTypeEl.value}`, "ok");
          lastSpawnAt = now;
          lastOperationAt = now;
        }

        const canDeleteWithFist =
          signal === SIGNALS.FIST_DELETE &&
          primaryPalmHit &&
          now - lastOperationAt >= OPERATION_COOLDOWN_MS &&
          now - lastFistDeleteAt >= FIST_DELETE_COOLDOWN_MS;
        if (canDeleteWithFist && deleteNearestToPalm(primaryPalmHit)) {
          lastFistDeleteAt = now;
          lastOperationAt = now;
        }

        prevPlacementPulseActive = placementPulseActive;
        prevPinch = pinchActive;
      } else if (!transformEndedThisFrame && handCount >= 2) {
        fistHoldStartAt = null;
        prevPlacementPulseActive = false;
        prevPinch = interaction.pinch;

        if (!transformSession && primaryPalmHit && secondaryPalmHit && primaryPalm && secondaryPalm) {
          const candidate = pickMeshForTransform(primaryPalmHit, secondaryPalmHit);
          const canLock = updatePendingTransformCandidate(candidate, now);
          if (candidate && canLock) {
            beginTransformSession(candidate, primaryPalmHit, secondaryPalmHit, primaryPalm, secondaryPalm, now);
          }
        } else {
          pendingTransformCandidate = null;
          pendingTransformSince = null;
        }

        if (transformSession?.mesh && primaryPalm && secondaryPalm) {
          const axisSpan = handAxisSpan(primaryPalm, secondaryPalm);
          const scaleX = clamp(
            transformSession.startScale.x * (axisSpan.x / transformSession.startAxisSpan.x),
            MIN_MESH_SCALE,
            MAX_MESH_SCALE
          );
          const scaleZ = clamp(
            transformSession.startScale.z * (axisSpan.y / transformSession.startAxisSpan.y),
            MIN_MESH_SCALE,
            MAX_MESH_SCALE
          );

          transformSession.mesh.scale.set(
            scaleX,
            transformSession.startScale.y,
            scaleZ
          );
          updateMeshMetadata(transformSession.mesh);
          updateGeometryMetrics(
            transformSession.mesh.userData.shape || shapeTypeEl.value,
            Number(transformSession.mesh.userData.baseSize || sizeInputEl.value) * ((scaleX + scaleZ) * 0.5)
          );

          selectionRing.position.set(transformSession.mesh.position.x, 0.02, transformSession.mesh.position.z);
        }
      } else if (transformSession) {
        fistHoldStartAt = null;
        prevPlacementPulseActive = false;
        prevPinch = false;
      }

      updateSelectionFeedback(now);
      drawTransformLockBadge();
      refreshDebug();

      if (!primary) {
        prevPinch = false;
        prevPlacementPulseActive = false;
        fistHoldStartAt = null;
        smoothedPalm = null;
        smoothedPinch = null;
        smoothedSecondaryPalm = null;
        overlayHandStates = [];
        pendingTransformCandidate = null;
        pendingTransformSince = null;
      } else if (!secondary) {
        smoothedSecondaryPalm = null;
        pendingTransformCandidate = null;
        pendingTransformSince = null;
      }

      appState.interaction.transformActive = Boolean(transformSession);
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
    transformSession = null;
    setActiveMesh(null);
    prevPinch = false;
    prevPlacementPulseActive = false;
    fistHoldStartAt = null;
    smoothedPalm = null;
    smoothedPinch = null;
    smoothedSecondaryPalm = null;
    overlayHandStates = [];
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
