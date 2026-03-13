import { computeGeometry } from "./core/geometry.js";
import { clamp } from "./core/math.js";
import { deriveScaleK, loadCalibration, saveCalibration } from "./calibration/store.js";
import { InteractionPipeline } from "./signals/interactionPipeline.js";
import { appState } from "./state/store.js";
import { tutorState } from "./state/tutorState.js";
import { createWorld } from "./render/world.js";
import { createSceneRuntime } from "./scene/sceneRuntime.js";
import {
  applySceneObjectToMesh,
  buildMeshFromSceneObject,
  sceneObjectFromMesh,
  sceneParamsFromMesh,
} from "./scene/objectMesh.js";
import {
  baseSizeToParams,
  defaultPositionForShape,
  distanceBetween,
  normalizeSceneObject,
  paramsToBaseSize,
  scaleSceneParams,
} from "./scene/schema.js";
import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";
import * as THREE from "three";
import {
  isFistPose,
  lmkDist, palmScale, computeWristAngle,
} from "./tracking/poses.js";
import {
  HAND_CONNECTIONS, SHOW_HAND_MARKERS, HAND_OVERLAY_SCALE,
  OVERLAY_MIN_ALPHA, OVERLAY_MAX_ALPHA, OVERLAY_MOTION_GAIN,
  OVERLAY_SIDE_PROFILE_ALPHA, OVERLAY_MATCH_MAX_DIST,
  OVERLAY_TRAIL_LENGTH, OVERLAY_TRAIL_MIN_STEP,
  PALM_CENTER_INDEXES, SPAWN_COOLDOWN_MS, FIST_DELETE_COOLDOWN_MS,
  FIST_HOLD_MS, OPERATION_COOLDOWN_MS,
  PLACEMENT_PULSE_BASE, PLACEMENT_PULSE_GAIN, PLACEMENT_PULSE_TRIGGER_RADIUS,
  SELECTION_RING_BASE_RADIUS, VIEW_DRAG_GROUND_LOCK_THRESHOLD,
  LINE_DEPTH_RAY_GAIN, LINE_DEPTH_MAX_OFFSET, LINE_DEPTH_DEADZONE,
  TRANSFORM_SELECT_BUFFER, TRANSFORM_MIDPOINT_RADIUS_FACTOR, TRANSFORM_OPPOSITION_DOT_MAX,
  MIN_TRANSFORM_SPAN, MIN_MESH_SCALE, MAX_MESH_SCALE,
  TRANSFORM_LOCK_MS,
  TRANSFORM_SCALE_SMOOTHING, TRANSFORM_ROTATION_SMOOTHING,
  PLACEMENT_PREVIEW_OPACITY, PLACEMENT_SURFACE_GAP, PLACEMENT_COLLISION_TOLERANCE,
  PLACEMENT_NEAR_SNAP_BASE, PLACEMENT_NEAR_SNAP_GAIN, PLACEMENT_SURFACE_NUDGE_LIMIT,
  SHAPE_OPTIONS, SIGNALS,
} from "./config/constants.js";

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
  const resetViewBtn = document.querySelector("#resetViewBtn");
  const resetViewSceneBtn = document.querySelector("#resetViewSceneBtn");
  const loadSceneInput = document.querySelector("#loadSceneInput");
  const shapeTypeEl = document.querySelector("#shapeType");
  const sizeInputEl = document.querySelector("#sizeInput");
  const colorInputEl = document.querySelector("#colorInput");
  const smoothingInputEl = document.querySelector("#smoothingInput");
  const trackingProfileEl = document.querySelector("#trackingProfile");
  const calibrateBtn = document.querySelector("#calibrateBtn");
  const calibrationPresetEl = document.querySelector("#calibrationPreset");
  const snapToggleEl = document.querySelector("#snapToggle");
  const gridStepInputEl = document.querySelector("#gridStepInput");
  const transformSnapModeEl = document.querySelector("#transformSnapMode");
  const navigationModeEl = document.querySelector("#navigationMode");
  const rotationStepInputEl = document.querySelector("#rotationStepInput");
  const debugStateEl = document.querySelector("#debugState");
  const intentBadgeEl = document.querySelector("#intentBadge");
  const statusEl = document.querySelector("#status");
  const objectListEl = document.querySelector("#objectList");
  const objectCountEl = document.querySelector("#objectCount");
  const stageWrapEl = document.querySelector(".stage-wrap");
  const mousePlaceMenuEl = document.querySelector("#mousePlaceMenu");
  const mousePlaceActionEl = document.querySelector("#mousePlaceAction");

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
  let smoothedPrimaryIndex = null;
  let lastSpawnAt = -SPAWN_COOLDOWN_MS;
  let lastFistDeleteAt = -FIST_DELETE_COOLDOWN_MS;
  let lastOperationAt = -OPERATION_COOLDOWN_MS;
  let fistHoldStartAt = null;
  let smoothedSecondaryPalm = null;
  let transformMissingHandSince = null;
  let overlayHandStates = [];
  let transformSession = null;
  let pendingTransformCandidate = null;
  let pendingTransformSince = null;
  let rotationSession = null;
  let activeMesh = null;
  let dragIntent = null;
  let dragSession = null;
  let secondaryClickIntent = null;
  let mousePlaceContext = null;
  let placementPreview = null;
  let guidedScenePreview = null;
  let focusedSceneObjectIds = new Set();
  const sceneRuntime = createSceneRuntime({ world });
  const sceneEventTarget = new EventTarget();
  const placedMeshes = sceneRuntime.meshes;
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
  const selectionBounds = new THREE.Box3();
  const placementBounds = new THREE.Box3();
  const collisionBounds = new THREE.Box3();
  const placementSize = new THREE.Vector3();
  const placementNormal = new THREE.Vector3();
  const placementRayDirection = new THREE.Vector3();
  const dragPlaneNormal = new THREE.Vector3();
  const lineDepthDirection = new THREE.Vector3();

  function setActiveMesh(mesh) {
    if (activeMesh?.material?.emissive) {
      const baseEmissive = activeMesh.userData?.baseEmissive ?? 0x00111d;
      activeMesh.material.emissive.setHex(baseEmissive);
    }
    if (!mesh) {
      activeMesh = null;
      sceneRuntime.setSelection(null);
      selectionRing.visible = false;
      selectionRing.scale.setScalar(1);
      selectionRing.material.opacity = 0.95;
      rotationGuide.visible = false;
      renderObjectList();
      updateTutorFocusVisuals();
      sceneEventTarget.dispatchEvent(new CustomEvent("selection", {
        detail: { objectId: null, mesh: null },
      }));
      return;
    }
    if (activeMesh === mesh) return;
    activeMesh = mesh;
    if (activeMesh?.material?.emissive) {
      if (activeMesh.userData.baseEmissive == null) {
        activeMesh.userData.baseEmissive = activeMesh.material.emissive.getHex();
      }
      activeMesh.material.emissive.setHex(0xffc857);
    }
    sceneRuntime.setSelection(activeMesh);
    if (shapeTypeEl && activeMesh.userData?.shape) shapeTypeEl.value = activeMesh.userData.shape;
    if (colorInputEl && activeMesh.material?.color) colorInputEl.value = `#${activeMesh.material.color.getHexString()}`;
    selectionRing.userData.pulseStartAt = performance.now();
    syncSelectionMarker(activeMesh);
    rotationGuide.visible = false;
    renderObjectList();
    updateTutorFocusVisuals();
    sceneEventTarget.dispatchEvent(new CustomEvent("selection", {
      detail: {
        objectId: activeMesh.userData?.sceneObjectId || null,
        mesh: activeMesh,
      },
    }));
  }

  function currentPlan() {
    return tutorState.plan;
  }

  function currentStep() {
    return tutorState.getCurrentStep();
  }

  function currentSceneSnapshot() {
    return sceneRuntime.snapshot();
  }

  function suggestionAlreadyPlaced(snapshot, suggestion) {
    if (!snapshot || !suggestion) return false;
    return snapshot.objects.some((objectSpec) => {
      const metadata = objectSpec.metadata || {};
      return (
        objectSpec.id === suggestion.object.id ||
        metadata.sourceSuggestionId === suggestion.id ||
        metadata.suggestionId === suggestion.id ||
        metadata.guidedObjectId === suggestion.object.id
      );
    });
  }

  function placementSuggestionPool() {
    const plan = currentPlan();
    if (!plan) return [];
    const snapshot = currentSceneSnapshot();
    const step = currentStep();
    const suggestionById = new Map(plan.objectSuggestions.map((suggestion) => [suggestion.id, suggestion]));
    const pools = [];

    if (step?.requiredObjectIds?.length) {
      pools.push(step.requiredObjectIds);
    }

    const allRequiredIds = plan.objectSuggestions
      .filter((suggestion) => !suggestion.optional)
      .map((suggestion) => suggestion.id);
    pools.push(allRequiredIds);

    for (const suggestionIds of pools) {
      const suggestions = suggestionIds
        .map((suggestionId) => suggestionById.get(suggestionId))
        .filter(Boolean)
        .filter((suggestion) => !suggestionAlreadyPlaced(snapshot, suggestion));
      if (suggestions.length) {
        return suggestions;
      }
    }

    return [];
  }

  function resolvePlacementSuggestion(shape) {
    const suggestions = placementSuggestionPool();
    return suggestions.find((suggestion) => suggestion.object.shape === shape) || null;
  }

  function freePlacementObject(shape) {
    const params = baseSizeToParams(shape, Number(sizeInputEl?.value || 1));
    return normalizeSceneObject({
      shape,
      color: colorInputEl?.value || "#7cf7e4",
      position: defaultPositionForShape(shape, params),
      rotation: [0, 0, 0],
      params,
      metadata: { source: "manual-free-placement" },
    });
  }

  function buildPlacementTemplate(shape) {
    const suggestion = resolvePlacementSuggestion(shape);
    const objectSpec = suggestion
      ? normalizeSceneObject(structuredClone(suggestion.object))
      : freePlacementObject(shape);
    const metadata = {
      ...(objectSpec.metadata || {}),
      source: suggestion ? "guided-placement" : "manual-placement",
      sourceSuggestionId: suggestion?.id || null,
      suggestionId: suggestion?.id || null,
      sourceStepId: currentStep()?.id || null,
      guidedObjectId: suggestion?.object?.id || objectSpec.id || null,
      planId: currentPlan()?.problem?.id || null,
    };
    return {
      suggestion,
      objectSpec: normalizeSceneObject({
        ...objectSpec,
        metadata,
      }),
    };
  }

  function buildSceneObjectForMesh(mesh, overrides = {}) {
    const baseObject = sceneObjectFromMesh(mesh);
    return normalizeSceneObject({
      ...baseObject,
      ...overrides,
      params: overrides.params || baseObject.params,
      metadata: {
        ...(baseObject.metadata || {}),
        ...(overrides.metadata || {}),
      },
    });
  }

  function applySceneParamsUpdate(mesh, params, reason = "params-update") {
    if (!mesh) return null;
    const nextObject = buildSceneObjectForMesh(mesh, { params });
    applySceneObjectToMesh(world, mesh, nextObject);
    if (mesh.userData?.shape !== "line" && mesh.userData?.floorLocked !== false) {
      alignMeshToGround(mesh);
    }
    updateMeshMetadata(mesh);
    sceneRuntime.notifySceneChanged(reason, mesh);
    return mesh;
  }

  function scaleMeshSceneObject(mesh, ratio, reason = "scale") {
    if (!mesh) return null;
    const shape = mesh.userData?.shape || "cube";
    const nextParams = scaleSceneParams(shape, sceneParamsFromMesh(mesh), ratio);
    return applySceneParamsUpdate(mesh, nextParams, reason);
  }

  function interpolateSceneParams(shape, fromParams, toParams, t = TRANSFORM_SCALE_SMOOTHING) {
    const lerpNumber = (fromValue, toValue) => THREE.MathUtils.lerp(Number(fromValue || 0), Number(toValue || 0), t);

    switch (shape) {
      case "cube":
        return { size: lerpNumber(fromParams.size, toParams.size) };
      case "cuboid":
        return {
          width: lerpNumber(fromParams.width, toParams.width),
          height: lerpNumber(fromParams.height, toParams.height),
          depth: lerpNumber(fromParams.depth, toParams.depth),
        };
      case "sphere":
        return { radius: lerpNumber(fromParams.radius, toParams.radius) };
      case "cylinder":
      case "cone":
        return {
          radius: lerpNumber(fromParams.radius, toParams.radius),
          height: lerpNumber(fromParams.height, toParams.height),
        };
      case "pyramid":
        return {
          base: lerpNumber(fromParams.base, toParams.base),
          height: lerpNumber(fromParams.height, toParams.height),
        };
      case "plane":
        return {
          width: lerpNumber(fromParams.width, toParams.width),
          depth: lerpNumber(fromParams.depth, toParams.depth),
        };
      case "line":
        return {
          start: fromParams.start.map((value, index) => lerpNumber(value, toParams.start[index])),
          end: fromParams.end.map((value, index) => lerpNumber(value, toParams.end[index])),
          thickness: lerpNumber(fromParams.thickness, toParams.thickness),
        };
      default:
        return toParams;
    }
  }

  function disposePlacementPreview() {
    if (!placementPreview?.mesh) {
      if (placementPreview?.pointMarker) {
        world.scene.remove(placementPreview.pointMarker);
        placementPreview.pointMarker.geometry?.dispose?.();
        placementPreview.pointMarker.material?.dispose?.();
      }
      placementPreview = null;
      return;
    }
    world.scene.remove(placementPreview.mesh);
    placementPreview.mesh.geometry?.dispose?.();
    placementPreview.mesh.material?.dispose?.();
    if (placementPreview.pointMarker) {
      world.scene.remove(placementPreview.pointMarker);
      placementPreview.pointMarker.geometry?.dispose?.();
      placementPreview.pointMarker.material?.dispose?.();
    }
    placementPreview = null;
  }

  function disposeGuidedScenePreview() {
    if (!guidedScenePreview?.mesh) {
      guidedScenePreview = null;
      return;
    }
    world.scene.remove(guidedScenePreview.mesh);
    guidedScenePreview.mesh.geometry?.dispose?.();
    guidedScenePreview.mesh.material?.dispose?.();
    guidedScenePreview = null;
  }

  function applyGuidedPreviewAppearance(mesh) {
    if (!mesh?.material) return;
    mesh.material.transparent = true;
    mesh.material.opacity = Math.min(mesh.userData?.baseOpacity ?? 0.9, 0.26);
    mesh.material.depthWrite = false;
    if (mesh.material.emissive) {
      mesh.material.emissive.setRGB(0.32, 0.52, 0.72);
    }
  }

  function meshMatchesTutorTarget(mesh, targetId) {
    if (!mesh || !targetId) return false;
    const metadata = mesh.userData?.sceneMetadata || {};
    return (
      mesh.userData?.sceneObjectId === targetId
      || metadata.sourceSuggestionId === targetId
      || metadata.suggestionId === targetId
      || metadata.guidedObjectId === targetId
      || mesh.userData?.label === targetId
    );
  }

  function restoreMeshVisualState(mesh) {
    if (!mesh?.material) return;
    const baseOpacity = mesh.userData?.baseOpacity ?? (mesh.userData?.shape === "plane" ? 0.72 : 0.9);
    const faded = Boolean(mesh.userData?.containsNestedObject);
    mesh.material.transparent = true;
    mesh.material.opacity = faded ? Math.min(baseOpacity, 0.38) : baseOpacity;
    mesh.material.depthWrite = !faded;
    if (mesh.material.emissive) {
      const baseEmissive = mesh.userData?.baseEmissive ?? mesh.material.emissive.getHex();
      mesh.material.emissive.setHex(mesh === activeMesh ? 0xffc857 : baseEmissive);
    }
  }

  function updateTutorFocusVisuals() {
    for (const mesh of placedMeshes) {
      restoreMeshVisualState(mesh);
    }

    if (!focusedSceneObjectIds.size) {
      return;
    }

    for (const mesh of placedMeshes) {
      const isTarget = [...focusedSceneObjectIds].some((targetId) => meshMatchesTutorTarget(mesh, targetId));
      if (isTarget) {
        if (mesh.material?.emissive && mesh !== activeMesh) {
          mesh.material.emissive.setRGB(0.44, 0.7, 0.94);
        }
        continue;
      }

      if (mesh.material) {
        mesh.material.transparent = true;
        mesh.material.opacity = Math.min(mesh.userData?.baseOpacity ?? 0.9, 0.16);
        mesh.material.depthWrite = false;
      }
    }
  }

  function focusSceneObjects(targetIds = [], options = {}) {
    focusedSceneObjectIds = new Set((targetIds || []).filter(Boolean));
    updateTutorFocusVisuals();

    if (options.selectFirst) {
      const focusMesh = placedMeshes.find((mesh) => [...focusedSceneObjectIds].some((targetId) => meshMatchesTutorTarget(mesh, targetId)));
      if (focusMesh) {
        setActiveMesh(focusMesh);
      }
    }

    return [...focusedSceneObjectIds];
  }

  function clearTutorFocus() {
    focusedSceneObjectIds = new Set();
    updateTutorFocusVisuals();
    return [];
  }

  function previewSceneAction(action = {}) {
    const objectSpec = action?.objectSpec || action?.payload?.objectSpec || null;
    if (!objectSpec) return null;

    disposeGuidedScenePreview();
    const previewMesh = buildMeshFromSceneObject(world, normalizeSceneObject(objectSpec));
    applyGuidedPreviewAppearance(previewMesh);
    world.scene.add(previewMesh);
    guidedScenePreview = {
      objectSpec: normalizeSceneObject(objectSpec),
      mesh: previewMesh,
      highlightTargets: action?.highlightTargets || action?.payload?.highlightTargets || [],
    };

    if (guidedScenePreview.highlightTargets.length) {
      focusSceneObjects(guidedScenePreview.highlightTargets);
    }

    return guidedScenePreview.objectSpec;
  }

  function confirmGuidedScenePreview(reason = "place") {
    if (!guidedScenePreview?.mesh || !guidedScenePreview?.objectSpec) return null;
    const objectSpec = structuredClone(guidedScenePreview.objectSpec);
    disposeGuidedScenePreview();
    const mesh = sceneRuntime.addObject(objectSpec, { reason });
    updateMeshMetadata(mesh);
    enforceMeshBudget();
    updateGeometryMetrics(mesh.userData.shape, mesh.userData.baseSize, mesh);
    setActiveMesh(mesh);
    return sceneObjectFromMesh(mesh);
  }

  function cancelGuidedScenePreview() {
    disposeGuidedScenePreview();
    return true;
  }

  function buildLinePointMarker(color, point) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.16, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
      })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.copy(point);
    marker.position.y += 0.015;
    return marker;
  }

  function defaultLineEnd(startHit) {
    const endHit = startHit.clone();
    endHit.x += 0.28;
    return endHit;
  }

  function lineLength(startHit, endHit) {
    if (!startHit || !endHit) return 0;
    return startHit.distanceTo(endHit);
  }

  function lineEndpointsForMesh(mesh) {
    const start = Array.isArray(mesh?.userData?.lineStart)
      ? new THREE.Vector3().fromArray(mesh.userData.lineStart)
      : null;
    const end = Array.isArray(mesh?.userData?.lineEnd)
      ? new THREE.Vector3().fromArray(mesh.userData.lineEnd)
      : null;
    if (start && end) return { start, end };

    const center = mesh?.position?.clone?.() || new THREE.Vector3();
    const fallbackStart = center.clone().add(new THREE.Vector3(-0.45, 0, 0));
    const fallbackEnd = center.clone().add(new THREE.Vector3(0.45, 0, 0));
    return { start: fallbackStart, end: fallbackEnd };
  }

  function applyLineEndpoints(mesh, startHit, endHit, size = Number(sizeInputEl?.value || 1)) {
    if (!mesh || !startHit || !endHit) return;
    world.updateLineMesh(mesh, startHit, endHit, size);
    mesh.userData.lineStart = startHit.toArray();
    mesh.userData.lineEnd = endHit.toArray();
    mesh.userData.sceneParams = {
      ...(mesh.userData.sceneParams || {}),
      start: [...mesh.userData.lineStart],
      end: [...mesh.userData.lineEnd],
      thickness: mesh.userData?.sceneParams?.thickness || Math.max(0.08, size * 0.08),
    };
    mesh.userData.baseSize = paramsToBaseSize("line", mesh.userData.sceneParams);
  }

  function resolvePlacementTarget(targetLike, fallbackFloorLocked = true) {
    if (!targetLike) return null;
    const point = targetLike?.isVector3 ? targetLike : targetLike.point;
    if (!point?.isVector3) return null;
    return {
      point,
      floorLocked: targetLike?.isVector3
        ? fallbackFloorLocked
        : (targetLike.floorLocked ?? fallbackFloorLocked),
      surfaceNormal: targetLike?.surfaceNormal?.clone?.() || null,
      referencePoint: targetLike?.referencePoint?.clone?.() || null,
      referenceMesh: targetLike?.referenceMesh || null,
    };
  }

  function placementSurfaceNormal(intersection) {
    if (!intersection?.face?.normal || !intersection?.object) return null;
    placementNormal.copy(intersection.face.normal).transformDirection(intersection.object.matrixWorld).normalize();
    placementRayDirection.copy(intersection.point).sub(world.camera.position).normalize();
    if (placementNormal.dot(placementRayDirection) > 0) {
      placementNormal.multiplyScalar(-1);
    }
    return placementNormal.clone();
  }

  function placementTargetFromSurfaceHit(intersection, fallbackTarget = null) {
    if (!intersection?.point || !intersection?.object) {
      return resolvePlacementTarget(fallbackTarget);
    }
    const surfaceNormal = placementSurfaceNormal(intersection);
    if (!surfaceNormal) {
      return resolvePlacementTarget(fallbackTarget);
    }
    return {
      point: intersection.point.clone(),
      referencePoint: intersection.point.clone(),
      referenceMesh: intersection.object,
      surfaceNormal,
      floorLocked: false,
    };
  }

  function lineCollisionRadius(mesh) {
    if (!mesh?.geometry) return 0.035;
    mesh.geometry.computeBoundingBox?.();
    const bbox = mesh.geometry.boundingBox;
    if (!bbox) return 0.035;
    const localDiameter = Math.min(
      Math.max(0.0001, bbox.max.x - bbox.min.x),
      Math.max(0.0001, bbox.max.z - bbox.min.z)
    );
    return Math.max(0.035, (localDiameter * Math.max(Math.abs(mesh.scale.x || 1), Math.abs(mesh.scale.z || 1), 1e-4)) * 0.5);
  }

  function placementReferenceFromSolidMesh(mesh, point) {
    if (!mesh?.geometry || !point?.isVector3) return null;
    mesh.updateWorldMatrix?.(true, false);
    mesh.geometry.computeBoundingBox?.();
    const bbox = mesh.geometry.boundingBox;
    if (!bbox) return null;

    const inverseMatrix = mesh.matrixWorld.clone().invert();
    const localPoint = point.clone().applyMatrix4(inverseMatrix);
    const localSurface = localPoint.clone().clamp(bbox.min, bbox.max);
    const localNormal = localPoint.clone().sub(localSurface);

    if (localNormal.lengthSq() <= 1e-8) {
      const xFace = Math.abs(localPoint.x - bbox.min.x) <= Math.abs(localPoint.x - bbox.max.x) ? bbox.min.x : bbox.max.x;
      const yFace = Math.abs(localPoint.y - bbox.min.y) <= Math.abs(localPoint.y - bbox.max.y) ? bbox.min.y : bbox.max.y;
      const zFace = Math.abs(localPoint.z - bbox.min.z) <= Math.abs(localPoint.z - bbox.max.z) ? bbox.min.z : bbox.max.z;
      const dx = Math.min(Math.abs(localPoint.x - bbox.min.x), Math.abs(localPoint.x - bbox.max.x));
      const dy = Math.min(Math.abs(localPoint.y - bbox.min.y), Math.abs(localPoint.y - bbox.max.y));
      const dz = Math.min(Math.abs(localPoint.z - bbox.min.z), Math.abs(localPoint.z - bbox.max.z));

      if (dx <= dy && dx <= dz) {
        localSurface.x = xFace;
        localNormal.set(xFace === bbox.min.x ? -1 : 1, 0, 0);
      } else if (dy <= dz) {
        localSurface.y = yFace;
        localNormal.set(0, yFace === bbox.min.y ? -1 : 1, 0);
      } else {
        localSurface.z = zFace;
        localNormal.set(0, 0, zFace === bbox.min.z ? -1 : 1);
      }
    } else {
      localNormal.normalize();
    }

    const worldPoint = localSurface.applyMatrix4(mesh.matrixWorld);
    const worldNormal = localNormal.transformDirection(mesh.matrixWorld).normalize();
    return {
      point: worldPoint.clone(),
      referencePoint: worldPoint.clone(),
      referenceMesh: mesh,
      surfaceNormal: worldNormal.clone(),
      floorLocked: false,
      distance: point.distanceTo(worldPoint),
    };
  }

  function placementReferenceFromLineMesh(mesh, point) {
    if (!mesh || !point?.isVector3) return null;
    mesh.updateWorldMatrix?.(true, false);
    const endpoints = lineEndpointsForMesh(mesh);
    if (!endpoints?.start || !endpoints?.end) return null;

    const segment = endpoints.end.clone().sub(endpoints.start);
    const lengthSq = segment.lengthSq();
    if (lengthSq < 1e-6) return null;

    const axisDirection = segment.clone().normalize();
    const t = clamp(point.clone().sub(endpoints.start).dot(segment) / lengthSq, 0, 1);
    const axisPoint = endpoints.start.clone().addScaledVector(segment, t);
    const radial = point.clone().sub(axisPoint);
    radial.addScaledVector(axisDirection, -radial.dot(axisDirection));
    if (radial.lengthSq() <= 1e-8) {
      radial.copy(world.camera.position).sub(axisPoint);
      radial.addScaledVector(axisDirection, -radial.dot(axisDirection));
    }
    if (radial.lengthSq() <= 1e-8) {
      radial.copy(new THREE.Vector3(0, 1, 0).cross(axisDirection));
    }
    if (radial.lengthSq() <= 1e-8) {
      radial.set(1, 0, 0);
    }
    radial.normalize();

    const worldPoint = axisPoint.addScaledVector(radial, lineCollisionRadius(mesh));
    return {
      point: worldPoint.clone(),
      referencePoint: worldPoint.clone(),
      referenceMesh: mesh,
      surfaceNormal: radial.clone(),
      floorLocked: false,
      distance: point.distanceTo(worldPoint),
    };
  }

  function placementReferenceFromMesh(mesh, point) {
    if (!mesh || !point?.isVector3) return null;
    if (mesh.userData?.shape === "line") {
      return placementReferenceFromLineMesh(mesh, point);
    }
    return placementReferenceFromSolidMesh(mesh, point);
  }

  function placementNearSnapDistance() {
    const size = Number(sizeInputEl?.value || 1);
    return clamp((size * PLACEMENT_NEAR_SNAP_GAIN) + PLACEMENT_NEAR_SNAP_BASE, 0.14, 0.48);
  }

  function findNearbyPlacementReference(point) {
    if (!point?.isVector3) return null;
    let best = null;
    let bestDist = Infinity;

    for (const mesh of placedMeshes) {
      const candidate = placementReferenceFromMesh(mesh, point);
      if (!candidate) continue;
      const reach = placementNearSnapDistance() + Math.min(0.18, meshSelectionRadius(mesh) * 0.1);
      if (candidate.distance > reach || candidate.distance >= bestDist) continue;
      best = candidate;
      bestDist = candidate.distance;
    }
    return best;
  }

  function placementTargetFromProjectedPoint(projectedTarget = null) {
    const fallbackTarget = resolvePlacementTarget(projectedTarget);
    if (!fallbackTarget?.point) return null;
    const nearbyTarget = findNearbyPlacementReference(fallbackTarget.point);
    return nearbyTarget || fallbackTarget;
  }

  function placementTargetFromLandmark(landmark, anchorPoint = null) {
    const fallbackTarget = world.projectToPlacement(landmark, anchorPoint);
    const surfaceHit = world.pickObjectFromLandmark?.(landmark, placedMeshes);
    if (surfaceHit) {
      return placementTargetFromSurfaceHit(surfaceHit, fallbackTarget);
    }
    return placementTargetFromProjectedPoint(fallbackTarget);
  }

  function placementTargetFromClient(clientX, clientY, anchorPoint = null) {
    const fallbackTarget = world.projectClientToPlacement?.(clientX, clientY, anchorPoint);
    const surfaceHit = world.pickObject?.(clientX, clientY, placedMeshes);
    if (surfaceHit) {
      return placementTargetFromSurfaceHit(surfaceHit, fallbackTarget);
    }
    return placementTargetFromProjectedPoint(fallbackTarget);
  }

  function snapPlacementAxis(value, floorLocked = true, axis = "x") {
    if (!shouldSnapPosition()) return value;
    if (floorLocked && axis === "y") return value;
    return snapValue(value);
  }

  function meshHalfExtentAlongNormal(mesh, normal) {
    if (!mesh?.geometry || !normal) return 0;
    placementBounds.setFromObject(mesh);
    if (placementBounds.isEmpty()) return 0;
    placementBounds.getSize(placementSize);
    return (
      Math.abs(normal.x) * placementSize.x +
      Math.abs(normal.y) * placementSize.y +
      Math.abs(normal.z) * placementSize.z
    ) * 0.5;
  }

  function resolveSolidAnchorHit(targetLike, mesh, fallbackFloorLocked = true) {
    const placementTarget = resolvePlacementTarget(targetLike, fallbackFloorLocked);
    if (!placementTarget?.point) return null;
    if (!placementTarget.surfaceNormal || !mesh) {
      return anchoredPlacementHit(placementTarget, fallbackFloorLocked);
    }

    const anchorHit = (placementTarget.referencePoint || placementTarget.point).clone();
    anchorHit.addScaledVector(
      placementTarget.surfaceNormal,
      meshHalfExtentAlongNormal(mesh, placementTarget.surfaceNormal) + PLACEMENT_SURFACE_GAP
    );
    anchorHit.x = snapPlacementAxis(anchorHit.x, false, "x");
    anchorHit.y = snapPlacementAxis(anchorHit.y, false, "y");
    anchorHit.z = snapPlacementAxis(anchorHit.z, false, "z");
    return anchorHit;
  }

  function boxesOverlapWithTolerance(a, b, tolerance = PLACEMENT_COLLISION_TOLERANCE) {
    return (
      a.min.x < (b.max.x - tolerance) &&
      a.max.x > (b.min.x + tolerance) &&
      a.min.y < (b.max.y - tolerance) &&
      a.max.y > (b.min.y + tolerance) &&
      a.min.z < (b.max.z - tolerance) &&
      a.max.z > (b.min.z + tolerance)
    );
  }

  function boxOverlapDepthAlongAxis(a, b, axis) {
    const axisLengthSq = axis.lengthSq?.() || 0;
    if (axisLengthSq <= 1e-8) return 0;

    const nx = axis.x;
    const ny = axis.y;
    const nz = axis.z;

    const aCenterX = (a.min.x + a.max.x) * 0.5;
    const aCenterY = (a.min.y + a.max.y) * 0.5;
    const aCenterZ = (a.min.z + a.max.z) * 0.5;
    const bCenterX = (b.min.x + b.max.x) * 0.5;
    const bCenterY = (b.min.y + b.max.y) * 0.5;
    const bCenterZ = (b.min.z + b.max.z) * 0.5;

    const aHalfX = (a.max.x - a.min.x) * 0.5;
    const aHalfY = (a.max.y - a.min.y) * 0.5;
    const aHalfZ = (a.max.z - a.min.z) * 0.5;
    const bHalfX = (b.max.x - b.min.x) * 0.5;
    const bHalfY = (b.max.y - b.min.y) * 0.5;
    const bHalfZ = (b.max.z - b.min.z) * 0.5;

    const centerA = (aCenterX * nx) + (aCenterY * ny) + (aCenterZ * nz);
    const centerB = (bCenterX * nx) + (bCenterY * ny) + (bCenterZ * nz);
    const radiusA = (Math.abs(nx) * aHalfX) + (Math.abs(ny) * aHalfY) + (Math.abs(nz) * aHalfZ);
    const radiusB = (Math.abs(nx) * bHalfX) + (Math.abs(ny) * bHalfY) + (Math.abs(nz) * bHalfZ);

    const minA = centerA - radiusA;
    const maxA = centerA + radiusA;
    const minB = centerB - radiusB;
    const maxB = centerB + radiusB;
    return Math.min(maxA, maxB) - Math.max(minA, minB);
  }

  function findPlacementCollision(mesh, ignoredMesh = null) {
    if (!mesh) return null;
    placementBounds.setFromObject(mesh);
    if (placementBounds.isEmpty()) return null;

    for (const candidate of placedMeshes) {
      if (!candidate || candidate === ignoredMesh) continue;
      if (candidate.userData?.shape === "line") continue;
      collisionBounds.setFromObject(candidate);
      if (collisionBounds.isEmpty()) continue;
      if (boxesOverlapWithTolerance(placementBounds, collisionBounds)) {
        return candidate;
      }
    }
    return null;
  }

  function pushPlacementMeshOutOfCollision(mesh, preferredNormal = null, ignoredMesh = null) {
    if (!mesh || !preferredNormal?.isVector3 || preferredNormal.lengthSq() <= 1e-8) {
      return findPlacementCollision(mesh, ignoredMesh);
    }

    const axis = preferredNormal.clone().normalize();
    for (let step = 0; step < PLACEMENT_SURFACE_NUDGE_LIMIT; step += 1) {
      placementBounds.setFromObject(mesh);
      if (placementBounds.isEmpty()) return null;

      let blockingMesh = null;
      let pushDepth = 0;
      for (const candidate of placedMeshes) {
        if (!candidate || candidate === ignoredMesh) continue;
        if (candidate.userData?.shape === "line") continue;
        collisionBounds.setFromObject(candidate);
        if (collisionBounds.isEmpty() || !boxesOverlapWithTolerance(placementBounds, collisionBounds)) continue;

        blockingMesh = candidate;
        pushDepth = boxOverlapDepthAlongAxis(placementBounds, collisionBounds, axis);
        if (pushDepth > 0.0005) break;
      }

      if (!blockingMesh) return null;
      if (pushDepth <= 0.0005) return blockingMesh;
      mesh.position.addScaledVector(axis, pushDepth + PLACEMENT_SURFACE_GAP);
    }

    return findPlacementCollision(mesh, ignoredMesh);
  }

  function normalizeLineAnchor(hitPoint) {
    const placementTarget = resolvePlacementTarget(hitPoint);
    const anchor = anchoredPlacementHit(placementTarget);
    if (!anchor) return null;
    if (placementTarget?.floorLocked !== false) {
      anchor.y = 0.03;
    }
    return anchor;
  }

  function resolveLineEndpoint(hitPoint, contactLandmark, startHit, startLandmark) {
    if (!startHit) return null;
    const placementTarget = resolvePlacementTarget(hitPoint, true);
    const endpoint = anchoredPlacementHit(placementTarget) || startHit.clone();

    if (placementTarget?.floorLocked === false) {
      return applyLineDepthOffset(endpoint, placementTarget, contactLandmark, startLandmark);
    }

    endpoint.y = 0.03;

    if (!contactLandmark || !startLandmark) return endpoint;

    const screenDx = Math.abs((contactLandmark.x ?? 0.5) - (startLandmark.x ?? 0.5));
    const screenDy = (startLandmark.y ?? 0.5) - (contactLandmark.y ?? 0.5);
    const elevated = screenDy > 0.028;

    if (!elevated) return endpoint;

    const lift = clamp(screenDy * 18, 0, 7.5);
    endpoint.y = 0.03 + lift;
    if (screenDx < 0.06) {
      endpoint.x = startHit.x;
      endpoint.z = startHit.z;
    }
    return endpoint;
  }

  function applyLineDepthOffset(endpoint, placementTarget, contactLandmark, startLandmark) {
    if (
      !endpoint ||
      placementTarget?.floorLocked !== false ||
      !contactLandmark ||
      !startLandmark
    ) {
      return endpoint;
    }

    const depthDelta = (contactLandmark.z ?? 0) - (startLandmark.z ?? 0);
    if (Math.abs(depthDelta) < LINE_DEPTH_DEADZONE) {
      return endpoint;
    }

    lineDepthDirection.copy(endpoint).sub(world.camera.position);
    const rayLength = lineDepthDirection.length();
    if (rayLength < 1e-4) {
      return endpoint;
    }

    lineDepthDirection.multiplyScalar(1 / rayLength);
    const depthOffset = clamp(depthDelta * rayLength * LINE_DEPTH_RAY_GAIN, -LINE_DEPTH_MAX_OFFSET, LINE_DEPTH_MAX_OFFSET);
    endpoint.addScaledVector(lineDepthDirection, depthOffset);
    return endpoint;
  }

  function syncPreviewMeshAppearance(mesh, shape, color, previewObjectSpec = null) {
    if (!mesh) return;
    const previewShape = previewObjectSpec?.shape || shape;
    const previewColor = previewObjectSpec?.color || color;
    const previewKey = previewObjectSpec
      ? JSON.stringify({
        shape: previewObjectSpec.shape,
        color: previewObjectSpec.color,
        params: previewObjectSpec.params,
      })
      : null;

    if (previewObjectSpec && mesh.userData.previewObjectKey !== previewKey) {
      applySceneObjectToMesh(world, mesh, previewObjectSpec);
      mesh.userData.previewShape = previewShape;
      mesh.userData.previewObjectKey = previewKey;
    } else if (!previewObjectSpec && mesh.userData.previewShape !== previewShape) {
      const nextMesh = shape === "line"
        ? world.buildLineMesh(
          placementPreview?.lineStartHit || new THREE.Vector3(0, 0, 0),
          placementPreview?.lineEndHit || defaultLineEnd(placementPreview?.lineStartHit || new THREE.Vector3(0, 0, 0)),
          Number(sizeInputEl.value),
          color
        )
        : world.buildMesh(shape, Number(sizeInputEl.value), color);
      const oldGeometry = mesh.geometry;
      const oldMaterial = mesh.material;
      mesh.geometry = nextMesh.geometry;
      mesh.material = nextMesh.material;
      oldGeometry?.dispose?.();
      oldMaterial?.dispose?.();
      mesh.userData.previewShape = previewShape;
      delete mesh.userData.previewObjectKey;
    }
    mesh.material.color.set(previewColor);
    mesh.material.emissive.copy(mesh.material.color).multiplyScalar(0.08);
    mesh.material.opacity = PLACEMENT_PREVIEW_OPACITY;
    mesh.material.transparent = true;
    mesh.material.depthWrite = false;
  }

  function anchoredPlacementHit(hitPoint, fallbackFloorLocked = true) {
    const placementTarget = resolvePlacementTarget(hitPoint, fallbackFloorLocked);
    if (!placementTarget?.point) return null;
    const anchoredHit = placementTarget.point.clone();
    if (shouldSnapPosition()) {
      anchoredHit.x = snapValue(anchoredHit.x);
      anchoredHit.z = snapValue(anchoredHit.z);
      if (!placementTarget.floorLocked) {
        anchoredHit.y = snapValue(anchoredHit.y);
      }
    }
    if (placementTarget.floorLocked) {
      anchoredHit.y = 0;
    }
    return anchoredHit;
  }

  function lineUsesSuggestedPlacement() {
    return Boolean(resolvePlacementSuggestion("line"));
  }

  function createGuidedLinePlacementPreview(template) {
    const mesh = buildMeshFromSceneObject(world, template.objectSpec);
    world.scene.add(mesh);
    placementPreview = {
      shape: "line",
      mesh,
      pointMarker: null,
      previewSize: paramsToBaseSize("line", template.objectSpec.params),
      lineStartHit: new THREE.Vector3(...template.objectSpec.params.start),
      lineEndHit: new THREE.Vector3(...template.objectSpec.params.end),
      guidedLine: true,
      floorLocked: false,
      objectSpec: template.objectSpec,
      sourceSuggestionId: template.suggestion?.id || null,
      blockedBy: null,
    };
    syncPreviewMeshAppearance(mesh, "line", template.objectSpec.color, template.objectSpec);
    return placementPreview;
  }

  function createLinePlacementPreview(startHit, startLandmark, nextColor, nextSize, floorLocked = true) {
    const mesh = world.buildLineMesh(startHit, defaultLineEnd(startHit), nextSize, nextColor);
    const pointMarker = buildLinePointMarker(nextColor, startHit);
    world.scene.add(mesh);
    world.scene.add(pointMarker);
    placementPreview = {
      shape: "line",
      mesh,
      pointMarker,
      previewSize: nextSize,
      lineStartHit: startHit.clone(),
      lineStartLandmark: cloneLandmark(startLandmark),
      lineEndHit: null,
      stage: "await-end-point",
      floorLocked,
    };
    syncPreviewMeshAppearance(mesh, "line", nextColor);
    applyLineEndpoints(mesh, placementPreview.lineStartHit, defaultLineEnd(placementPreview.lineStartHit), nextSize);
    return placementPreview;
  }

  function ensureLinePlacementPreview(hitPoint = null, contactLandmark = null) {
    if (lineUsesSuggestedPlacement()) {
      const template = buildPlacementTemplate("line");
      if (!template?.suggestion) return null;
      if (
        !placementPreview?.mesh ||
        !placementPreview.guidedLine ||
        placementPreview.sourceSuggestionId !== template.suggestion.id
      ) {
        disposePlacementPreview();
        return createGuidedLinePlacementPreview(template);
      }
      placementPreview.objectSpec = template.objectSpec;
      placementPreview.lineStartHit = new THREE.Vector3(...template.objectSpec.params.start);
      placementPreview.lineEndHit = new THREE.Vector3(...template.objectSpec.params.end);
      syncPreviewMeshAppearance(placementPreview.mesh, "line", template.objectSpec.color, template.objectSpec);
      return placementPreview;
    }

    const nextColor = colorInputEl.value;
    const nextSize = Number(sizeInputEl.value);
    const previewTarget = placementPreview?.shape === "line"
      ? resolvePlacementTarget(hitPoint, placementPreview.floorLocked)
      : resolvePlacementTarget(hitPoint);

    if (!placementPreview?.mesh || placementPreview.shape !== "line") {
      const startHit = normalizeLineAnchor(previewTarget);
      if (!startHit || !contactLandmark) return null;
      return createLinePlacementPreview(
        startHit,
        contactLandmark,
        nextColor,
        nextSize,
        previewTarget?.floorLocked !== false
      );
    }

    if (placementPreview.previewSize !== nextSize) {
      const savedStartHit = placementPreview.lineStartHit.clone();
      const savedStartLandmark = cloneLandmark(placementPreview.lineStartLandmark);
      const savedEndHit = placementPreview.lineEndHit?.clone?.() || null;
      const savedFloorLocked = placementPreview.floorLocked !== false;
      disposePlacementPreview();
      createLinePlacementPreview(savedStartHit, savedStartLandmark, nextColor, nextSize, savedFloorLocked);
      placementPreview.lineEndHit = savedEndHit;
    }

    if (placementPreview.pointMarker) {
      placementPreview.pointMarker.material.color.set(nextColor);
      placementPreview.pointMarker.position.copy(placementPreview.lineStartHit);
      placementPreview.pointMarker.position.y = placementPreview.lineStartHit.y + 0.015;
    }

    if (hitPoint && contactLandmark) {
      const nextEndpoint = resolveLineEndpoint(
        previewTarget,
        contactLandmark,
        placementPreview.lineStartHit,
        placementPreview.lineStartLandmark
      );
      if (nextEndpoint) {
        placementPreview.lineEndHit = nextEndpoint;
      }
    }

    syncPreviewMeshAppearance(placementPreview.mesh, "line", nextColor);
    const renderEnd = placementPreview.lineEndHit || defaultLineEnd(placementPreview.lineStartHit);
    applyLineEndpoints(placementPreview.mesh, placementPreview.lineStartHit, renderEnd, nextSize);
    placementPreview.previewSize = nextSize;
    return placementPreview;
  }

  function ensurePlacementPreview(hitPoint = null, contactLandmark = null) {
    if (placementPreview?.shape && placementPreview.shape !== shapeTypeEl.value) {
      disposePlacementPreview();
    }
    if (shapeTypeEl.value === "line") {
      return ensureLinePlacementPreview(hitPoint, contactLandmark);
    }
    const previewTarget = placementPreview?.mesh
      ? resolvePlacementTarget(hitPoint, placementPreview.floorLocked)
      : resolvePlacementTarget(hitPoint);
    const anchorHit = placementPreview?.anchorHit || anchoredPlacementHit(previewTarget);
    if (!anchorHit) return null;
    const nextShape = shapeTypeEl.value;
    const template = buildPlacementTemplate(nextShape);
    const floorLocked = previewTarget?.floorLocked !== false;

    if (!placementPreview?.mesh) {
      const mesh = buildMeshFromSceneObject(world, template.objectSpec);
      mesh.userData.previewShape = nextShape;
      world.scene.add(mesh);
      placementPreview = {
        shape: nextShape,
        mesh,
        anchorHit: anchorHit.clone(),
        floorLocked,
        referencePoint: previewTarget?.referencePoint?.clone?.() || null,
        surfaceNormal: previewTarget?.surfaceNormal?.clone?.() || null,
        referenceMesh: previewTarget?.referenceMesh || null,
        blockedBy: null,
        objectSpec: template.objectSpec,
        sourceSuggestionId: template.suggestion?.id || null,
      };
    }

    placementPreview.objectSpec = template.objectSpec;
    placementPreview.sourceSuggestionId = template.suggestion?.id || null;

    const previewMesh = placementPreview.mesh;
    syncPreviewMeshAppearance(previewMesh, nextShape, template.objectSpec.color, template.objectSpec);
    const anchorSource = placementPreview.surfaceNormal
      ? placementPreview
      : (placementPreview.anchorHit ? { point: placementPreview.anchorHit, floorLocked: placementPreview.floorLocked } : previewTarget);
    const nextAnchorHit = resolveSolidAnchorHit(anchorSource, previewMesh, placementPreview.floorLocked);
    if (!nextAnchorHit) return null;
    placementPreview.anchorHit = nextAnchorHit.clone();
    previewMesh.position.copy(placementPreview.anchorHit);
    if (placementPreview.floorLocked !== false && !placementPreview.surfaceNormal) {
      alignMeshToGround(previewMesh);
    }
    placementPreview.blockedBy = placementPreview.surfaceNormal
      ? pushPlacementMeshOutOfCollision(previewMesh, placementPreview.surfaceNormal)
      : findPlacementCollision(previewMesh);
    placementPreview.anchorHit.copy(previewMesh.position);
    if (placementPreview.blockedBy) {
      previewMesh.material.emissive.setRGB(0.58, 0.1, 0.08);
      previewMesh.material.opacity = Math.min(previewMesh.material.opacity, 0.22);
    }
    return placementPreview;
  }

  function confirmPlacementPreview(now) {
    if (!placementPreview?.mesh) return false;
    if (placementPreview.shape !== "line" && placementPreview.blockedBy) {
      const label = placementPreview.blockedBy.userData?.label || placementPreview.blockedBy.userData?.shape || "another object";
      setStatus(`Move the preview clear of ${label} before placing`, "idle");
      return false;
    }
    if (placementPreview.shape === "line" && !placementPreview.guidedLine) {
      if (!placementPreview.lineEndHit || lineLength(placementPreview.lineStartHit, placementPreview.lineEndHit) < 0.08) {
        setStatus("Pick a second point a little farther away for the line end", "idle");
        return false;
      }
    }

    const previewObject = placementPreview.objectSpec || buildPlacementTemplate(placementPreview.shape).objectSpec;
    const objectSpec = placementPreview.shape === "line"
      ? normalizeSceneObject({
        ...previewObject,
        position: placementPreview.guidedLine
          ? previewObject.position
          : placementPreview.lineStartHit.clone().lerp(placementPreview.lineEndHit, 0.5).toArray(),
        params: placementPreview.guidedLine
          ? previewObject.params
          : {
            start: placementPreview.lineStartHit.toArray(),
            end: placementPreview.lineEndHit.toArray(),
            thickness: previewObject.params?.thickness || Math.max(0.08, Number(sizeInputEl.value) * 0.08),
          },
      })
      : normalizeSceneObject({
        ...previewObject,
        position: placementPreview.anchorHit.toArray(),
      });

    disposePlacementPreview();
    const mesh = sceneRuntime.addObject(objectSpec, { reason: "place" });
    updateMeshMetadata(mesh);
    enforceMeshBudget();
    updateGeometryMetrics(mesh.userData.shape, mesh.userData.baseSize, mesh);
    setActiveMesh(null);
    setStatus(`Placed ${mesh.userData.label || mesh.userData.shape}`, "ok");
    lastOperationAt = now;
    return true;
  }

  function clientToNormalizedLandmark(clientX, clientY, depth = 0) {
    const rect = stageCanvas?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      x: clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1),
      z: depth,
    };
  }

  function currentMousePlaceLabel() {
    if (shapeTypeEl.value === "line") {
      if (lineUsesSuggestedPlacement()) {
        const suggestion = resolvePlacementSuggestion("line");
        return suggestion?.title ? `Place ${suggestion.title}` : "Place Guided Line";
      }
      return placementPreview?.shape === "line" ? "Place Line End" : "Place Line Start";
    }
    const suggestion = resolvePlacementSuggestion(shapeTypeEl.value);
    if (suggestion?.title) {
      return `Place ${suggestion.title}`;
    }
    const shapeName = shapeTypeEl.value.charAt(0).toUpperCase() + shapeTypeEl.value.slice(1);
    return `Place ${shapeName}`;
  }

  function closeMousePlaceMenu() {
    mousePlaceContext = null;
    mousePlaceMenuEl?.classList.add("hidden");
    mousePlaceMenuEl?.setAttribute("aria-hidden", "true");
  }

  function openMousePlaceMenu(clientX, clientY) {
    if (!mousePlaceMenuEl || !mousePlaceActionEl || !stageWrapEl) return;
    mousePlaceContext = { clientX, clientY };
    mousePlaceActionEl.textContent = currentMousePlaceLabel();

    const rect = stageWrapEl.getBoundingClientRect();
    mousePlaceMenuEl.classList.remove("hidden");
    mousePlaceMenuEl.setAttribute("aria-hidden", "false");

    const menuWidth = mousePlaceMenuEl.offsetWidth || 168;
    const menuHeight = mousePlaceMenuEl.offsetHeight || 52;
    const left = Math.min(
      Math.max(10, clientX - rect.left),
      Math.max(10, rect.width - menuWidth - 10)
    );
    const top = Math.min(
      Math.max(10, clientY - rect.top),
      Math.max(10, rect.height - menuHeight - 10)
    );

    mousePlaceMenuEl.style.left = `${left}px`;
    mousePlaceMenuEl.style.top = `${top}px`;
  }

  function placeShapeFromMouse(clientX, clientY) {
    const now = performance.now();
    const lineToolActive = shapeTypeEl.value === "line";
    const anchorPoint = placementPreview?.shape === "line"
      ? (placementPreview.lineStartHit || world.getViewTarget())
      : world.getViewTarget();
    const placementTarget = placementTargetFromClient(clientX, clientY, anchorPoint);
    if (!placementTarget?.point) {
      setStatus("Couldn't place object at that point", "idle");
      return false;
    }

    const landmark = clientToNormalizedLandmark(clientX, clientY, 0);
    if (lineToolActive) {
      if (placementPreview?.shape && placementPreview.shape !== "line") {
        disposePlacementPreview();
      }
      if (lineUsesSuggestedPlacement()) {
        ensurePlacementPreview(placementTarget, landmark);
        if (confirmPlacementPreview(now)) {
          lastSpawnAt = now;
          return true;
        }
        return false;
      }
      if (placementPreview?.shape !== "line") {
        ensurePlacementPreview(placementTarget, landmark);
        setStatus("Line start placed. Right click again to place the end", "ok");
        return true;
      }
      ensurePlacementPreview(placementTarget, landmark);
      if (placementPreview?.lineEndHit && confirmPlacementPreview(now)) {
        lastSpawnAt = now;
        return true;
      }
      return false;
    }

    if (placementPreview) {
      disposePlacementPreview();
    }
    ensurePlacementPreview(placementTarget, landmark);
    if (confirmPlacementPreview(now)) {
      lastSpawnAt = now;
      return true;
    }
    return false;
  }

  function refreshTransformSessionAnchors(session, hitA, hitB, leftHand, rightHand) {
    if (!session?.mesh || !hitA || !hitB) return;
    session.startSpan = Math.max(MIN_TRANSFORM_SPAN, planarDistance(hitA, hitB));
    session.startParams = sceneParamsFromMesh(session.mesh);
    session.startRotationX = session.mesh.rotation.x || 0;
    session.startRotationY = session.mesh.rotation.y || 0;
    session.startLeftWristAngle = computeWristAngle(leftHand);
    session.startRightWristAngle = computeWristAngle(rightHand);
    session.intent = null;
  }

  function resolveTransformIntent(session, currentSpan, leftWristAngle, rightWristAngle, rotatePoseActive) {
    if (!session) return null;
    if (rotatePoseActive) {
      if (session.intent !== "rotate") {
        session.intent = "rotate";
        session.startRotationX = session.mesh?.rotation?.x || 0;
        session.startRotationY = session.mesh?.rotation?.y || 0;
        session.startLeftWristAngle = leftWristAngle;
        session.startRightWristAngle = rightWristAngle;
      }
      return session.intent;
    }
    if (session.intent === "rotate") {
      session.intent = null;
      session.startSpan = Math.max(MIN_TRANSFORM_SPAN, currentSpan || MIN_TRANSFORM_SPAN);
      session.startParams = sceneParamsFromMesh(session.mesh);
    }

    const spanBaseline = Math.max(MIN_TRANSFORM_SPAN, session.startSpan || MIN_TRANSFORM_SPAN);
    const spanDeltaRatio = Math.abs((currentSpan - spanBaseline) / spanBaseline);

    if (spanDeltaRatio >= 0.06) {
      session.intent = "scale";
    } else if (session.intent === "scale" && spanDeltaRatio < 0.025) {
      session.intent = null;
    }

    return session.intent;
  }

  function beginTransformSession(mesh, hitA, hitB, leftHand, rightHand, now) {
    if (!mesh || !hitA || !hitB || !leftHand || !rightHand) return false;

    const span = Math.max(MIN_TRANSFORM_SPAN, planarDistance(hitA, hitB));

    setActiveMesh(mesh);
    transformSession = {
      mesh,
      startSpan: span,
      startParams: sceneParamsFromMesh(mesh),
      startRotationX: mesh.rotation.x || 0,
      startRotationY: mesh.rotation.y || 0,
      startLeftWristAngle: computeWristAngle(leftHand),
      startRightWristAngle: computeWristAngle(rightHand),
      intent: null,
    };
    selectionRing.userData.pulseStartAt = now;
    setStatus("Transform locked: resize normally or show the rotate pose", "ok");
    return true;
  }

  function endTransformSession(statusMsg = "Transform released") {
    const focusMesh = rotationSession?.mesh || transformSession?.mesh || activeMesh;
    if (!focusMesh) return;
    transformSession = null;
    rotationSession = null;
    sceneRuntime.notifySceneChanged("transform-end", focusMesh);
    setActiveMesh(null);
    setStatus(statusMsg, "idle");
  }

  function updateSelectionFeedback(now) {
    const focusMesh = rotationSession?.mesh || transformSession?.mesh || dragSession?.mesh || activeMesh;
    if (!focusMesh || activeMesh !== focusMesh) {
      selectionRing.visible = false;
      rotationGuide.visible = false;
      return;
    }

    const pulseStartAt = selectionRing.userData.pulseStartAt ?? now;
    const pulseT = Math.max(0, now - pulseStartAt);
    const entryBoost = Math.max(0, 1 - pulseT / 220);
    const activeTransform = Boolean(rotationSession?.mesh === activeMesh || transformSession?.mesh === activeMesh || dragSession?.mesh === activeMesh);
    const idlePulse = activeTransform ? 1 + Math.sin(now * 0.01) * 0.05 : 1;
    const targetRadius = Math.max(0.48, meshSelectionRadius(activeMesh) - TRANSFORM_SELECT_BUFFER * (activeTransform ? 0.4 : 0.18));
    const scale = (targetRadius / SELECTION_RING_BASE_RADIUS) * (idlePulse + (activeTransform ? entryBoost * 0.35 : entryBoost * 0.16));

    selectionRing.visible = true;
    syncSelectionMarker(activeMesh);
    selectionRing.scale.setScalar(scale);
    selectionRing.material.opacity = activeTransform
      ? 0.46 + entryBoost * 0.28 + (idlePulse - 1) * 1.8
      : 0.34 + entryBoost * 0.16;

    if (rotationSession?.mesh === activeMesh) {
      const guideLength = Math.max(0.9, meshSelectionRadius(activeMesh) * 0.85);
      rotationGuide.position.copy(activeMesh.position);
      rotationGuide.setDirection(
        new THREE.Vector3(Math.cos(activeMesh.rotation.y), 0, Math.sin(activeMesh.rotation.y)).normalize()
      );
      rotationGuide.setLength(guideLength, 0.18, 0.11);
      rotationGuide.visible = true;
    } else {
      rotationGuide.visible = false;
    }
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

  function handProfileAlpha(hand) {
    if (!hand) return 1;
    const palmHeight = Math.max(0.0001, lmkDist(hand[0], hand[9]));
    const palmWidth = lmkDist(hand[5], hand[17]);
    const profileRatio = palmWidth / palmHeight;
    return clamp(profileRatio / 0.9, OVERLAY_SIDE_PROFILE_ALPHA, 1);
  }

  function findOverlayPrevState(hand, prevStates, usedIndexes) {
    const palm = palmCenterLandmark(hand) || hand?.[0];
    if (!palm || !prevStates?.length) return null;

    let bestIndex = -1;
    let bestScore = Infinity;
    prevStates.forEach((state, index) => {
      if (usedIndexes.has(index) || !state?.landmarks?.length) return;
      const prevPalm = palmCenterLandmark(state.landmarks) || state.landmarks[0];
      if (!prevPalm) return;
      const score = lmkDist(palm, prevPalm);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex === -1 || bestScore > OVERLAY_MATCH_MAX_DIST) return null;
    usedIndexes.add(bestIndex);
    return prevStates[bestIndex];
  }

  function smoothOverlayLandmark(prev, next, alphaScale = 1) {
    if (!next) return prev ? cloneLandmark(prev) : null;
    if (!prev) return cloneLandmark(next);

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dz = (next.z || 0) - (prev.z || 0);
    const motion = Math.hypot(dx, dy, dz);
    const baseAlpha = clamp(
      OVERLAY_MIN_ALPHA + (motion * OVERLAY_MOTION_GAIN),
      OVERLAY_MIN_ALPHA,
      OVERLAY_MAX_ALPHA
    );
    const alpha = clamp(baseAlpha * alphaScale, OVERLAY_MIN_ALPHA * 0.7, OVERLAY_MAX_ALPHA);

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
    const prevStates = overlayHandStates;
    const usedIndexes = new Set();
    overlayHandStates = hands.map((hand) => {
      const prevState = findOverlayPrevState(hand, prevStates, usedIndexes);
      const alphaScale = handProfileAlpha(hand);
      const landmarks = hand.map((point, pointIndex) =>
        smoothOverlayLandmark(prevState?.landmarks?.[pointIndex], point, alphaScale)
      );
      const contact = midpointLandmark(landmarks[4], landmarks[8]) || landmarks[8];

      return {
        landmarks,
        trail: updateOverlayTrail(prevState?.trail || [], contact),
      };
    });

    return overlayHandStates;
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

  function segmentMetrics2D(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = (abx * abx) + (aby * aby);
    if (lengthSq <= 1e-6) {
      return {
        distance: Math.hypot(px - ax, py - ay),
        projection: 0.5,
        span: 0,
      };
    }

    const projection = clamp((((px - ax) * abx) + ((py - ay) * aby)) / lengthSq, 0, 1);
    const closestX = ax + (abx * projection);
    const closestY = ay + (aby * projection);
    return {
      distance: Math.hypot(px - closestX, py - closestY),
      projection,
      span: Math.hypot(abx, aby),
    };
  }

  function planarSegmentMetrics(point, start, end) {
    if (!point || !start || !end) {
      return { distance: Infinity, projection: 0.5, span: 0 };
    }
    return segmentMetrics2D(point.x, point.z, start.x, start.z, end.x, end.z);
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

  function containmentFadeTarget(mesh) {
    if (!mesh) return null;
    const shape = mesh.userData?.shape || "cube";
    if (shape === "line") return null;
    return {
      opacity: mesh.userData?.baseOpacity ?? (shape === "plane" ? 0.72 : 0.9),
      depthWrite: true,
    };
  }

  function setContainmentFade(mesh, faded) {
    if (!mesh?.material) return;
    const base = containmentFadeTarget(mesh);
    if (!base) return;

    mesh.userData.containsNestedObject = Boolean(faded);
    mesh.material.transparent = true;
    mesh.material.opacity = faded ? Math.min(base.opacity, 0.38) : base.opacity;
    mesh.material.depthWrite = faded ? false : base.depthWrite;
  }

  function refreshContainedObjectVisibility() {
    const outerBounds = new THREE.Box3();
    const innerBounds = new THREE.Box3();
    const outerSize = new THREE.Vector3();
    const innerSize = new THREE.Vector3();
    const innerCenter = new THREE.Vector3();
    const candidates = placedMeshes.filter((mesh) => mesh && containmentFadeTarget(mesh));

    for (const mesh of candidates) {
      setContainmentFade(mesh, false);
    }

    for (const outerMesh of candidates) {
      outerBounds.setFromObject(outerMesh);
      if (outerBounds.isEmpty()) continue;
      outerBounds.getSize(outerSize);
      if (outerSize.lengthSq() <= 1e-6) continue;

      const margin = Math.max(0.02, Math.min(0.18, Math.min(outerSize.x, outerSize.y, outerSize.z) * 0.08));
      const outerVolume = outerSize.x * outerSize.y * outerSize.z;

      for (const innerMesh of placedMeshes) {
        if (!innerMesh || innerMesh === outerMesh) continue;
        innerBounds.setFromObject(innerMesh);
        if (innerBounds.isEmpty()) continue;

        innerBounds.getCenter(innerCenter);
        innerBounds.getSize(innerSize);
        const innerVolume = Math.max(1e-6, innerSize.x * innerSize.y * innerSize.z);
        if (outerVolume <= innerVolume * 1.04) continue;

        const insideOuter = (
          innerCenter.x >= outerBounds.min.x + margin &&
          innerCenter.x <= outerBounds.max.x - margin &&
          innerCenter.y >= outerBounds.min.y + margin &&
          innerCenter.y <= outerBounds.max.y - margin &&
          innerCenter.z >= outerBounds.min.z + margin &&
          innerCenter.z <= outerBounds.max.z - margin
        );

        if (insideOuter) {
          setContainmentFade(outerMesh, true);
          break;
        }
      }
    }
  }

  function syncSelectionMarker(mesh) {
    if (!mesh) return;
    selectionBounds.setFromObject(mesh);
    const baseY = selectionBounds.isEmpty()
      ? (mesh.position.y - groundAlignedY(mesh))
      : selectionBounds.min.y;
    const markerGap = Math.max(0.015, Math.min(0.04, meshSelectionRadius(mesh) * 0.03));
    selectionRing.position.set(mesh.position.x, baseY - markerGap, mesh.position.z);
    selectionRing.rotation.set(-Math.PI / 2, 0, 0);
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

  function pickReachableMesh(hitPoint, maxDist = 1.5, reachPadding = 0) {
    if (!hitPoint) return null;

    let best = null;
    let bestDist = Infinity;
    for (const mesh of placedMeshes) {
      const reach = Math.min(maxDist, Math.max(0.5, meshSelectionRadius(mesh) + reachPadding));
      const d = planarDistance(mesh.position, hitPoint);
      if (d < bestDist && d <= reach) {
        best = mesh;
        bestDist = d;
      }
    }
    return best;
  }

  function pickDeleteTargetFromHand(palmHit, pinchHit, indexHit) {
    return (
      pickReachableMesh(pinchHit, 1.55, 0.12) ||
      pickReachableMesh(indexHit, 1.5, 0.08) ||
      pickReachableMesh(palmHit, 1.4, -0.02)
    );
  }

  function shortestAngleDelta(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
  }

  function meshScreenPoint(mesh) {
    if (!mesh) return null;
    const projected = mesh.position.clone().project(world.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    return {
      x: (projected.x + 1) * 0.5,
      y: (1 - projected.y) * 0.5,
    };
  }

  function screenFrameMetrics(handA, handB, mesh) {
    if (!handA || !handB || !mesh) return null;
    const screenPoint = meshScreenPoint(mesh);
    if (!screenPoint) return null;

    const ax = handA.x ?? 0.5;
    const ay = handA.y ?? 0.5;
    const bx = handB.x ?? 0.5;
    const by = handB.y ?? 0.5;
    const segment = segmentMetrics2D(screenPoint.x, screenPoint.y, ax, ay, bx, by);
    const midpointX = (ax + bx) * 0.5;
    const midpointY = (ay + by) * 0.5;
    const vecAX = ax - screenPoint.x;
    const vecAY = ay - screenPoint.y;
    const vecBX = bx - screenPoint.x;
    const vecBY = by - screenPoint.y;
    const lenA = Math.hypot(vecAX, vecAY);
    const lenB = Math.hypot(vecBX, vecBY);
    const oppositionDot = (lenA > 1e-4 && lenB > 1e-4)
      ? (((vecAX * vecBX) + (vecAY * vecBY)) / (lenA * lenB))
      : 1;
    const handSpan = segment.span;
    const wrapsObject = segment.projection >= 0.08 && segment.projection <= 0.92;
    const laneWidth = Math.max(0.05, Math.min(0.2, handSpan * 0.34));
    const midpointDist = Math.hypot(midpointX - screenPoint.x, midpointY - screenPoint.y);

    return {
      screenPoint,
      segment,
      handSpan,
      wrapsObject,
      laneWidth,
      midpointDist,
      oppositionDot,
    };
  }

  function handsFrameSelectedMesh(handA, handB, mesh) {
    const metrics = screenFrameMetrics(handA, handB, mesh);
    if (!metrics) return false;

    return (
      metrics.handSpan >= 0.08 &&
      metrics.wrapsObject &&
      metrics.segment.distance <= metrics.laneWidth &&
      metrics.midpointDist <= Math.max(0.08, metrics.handSpan * 0.45) &&
      metrics.oppositionDot <= 0.7
    );
  }

  function pickScreenFramedMesh(handA, handB) {
    if (!handA || !handB) return null;

    let best = null;
    let bestScore = Infinity;

    for (const mesh of placedMeshes) {
      const metrics = screenFrameMetrics(handA, handB, mesh);
      if (!metrics) continue;
      if (metrics.handSpan < 0.08 || !metrics.wrapsObject) continue;
      if (metrics.segment.distance > metrics.laneWidth) continue;
      if (metrics.midpointDist > Math.max(0.1, metrics.handSpan * 0.48)) continue;
      if (metrics.oppositionDot > 0.75) continue;

      const score = (
        metrics.segment.distance * 2.1 +
        metrics.midpointDist * 1.35 +
        Math.abs(metrics.segment.projection - 0.5) * 0.25 +
        (metrics.oppositionDot + 1) * 0.3 -
        (mesh === activeMesh ? 0.28 : 0)
      );

      if (score < bestScore) {
        best = mesh;
        bestScore = score;
      }
    }

    return best;
  }

  function pickMeshForTransform(hitA, hitB, handA = null, handB = null) {
    if (!hitA || !hitB) return null;

    if (
      activeMesh &&
      placedMeshes.includes(activeMesh) &&
      handsFrameSelectedMesh(handA, handB, activeMesh)
    ) {
      return activeMesh;
    }

    const screenCandidate = pickScreenFramedMesh(handA, handB);
    if (screenCandidate) {
      return screenCandidate;
    }

    const midpoint = hitA.clone().lerp(hitB, 0.5);
    let best = null;
    let bestScore = Infinity;

    for (const mesh of placedMeshes) {
      const radius = meshSelectionRadius(mesh);
      const dA = planarDistance(mesh.position, hitA);
      const dB = planarDistance(mesh.position, hitB);
      const midpointDist = planarDistance(mesh.position, midpoint);
      const segment = planarSegmentMetrics(mesh.position, hitA, hitB);
      const handSpan = Math.max(segment.span, planarDistance(hitA, hitB));
      const wrapsObject = segment.projection >= 0.08 && segment.projection <= 0.92;
      const laneWidth = Math.max(radius * 1.15, handSpan * 0.18);
      if (!wrapsObject) continue;
      if (segment.distance > laneWidth) continue;
      if (midpointDist > radius * Math.max(TRANSFORM_MIDPOINT_RADIUS_FACTOR, 1.65)) continue;

      const vecAX = hitA.x - mesh.position.x;
      const vecAZ = hitA.z - mesh.position.z;
      const vecBX = hitB.x - mesh.position.x;
      const vecBZ = hitB.z - mesh.position.z;
      const lenA = Math.hypot(vecAX, vecAZ);
      const lenB = Math.hypot(vecBX, vecBZ);
      if (lenA < 0.08 || lenB < 0.08) continue;

      const oppositionDot = ((vecAX * vecBX) + (vecAZ * vecBZ)) / (lenA * lenB);
      if (oppositionDot > TRANSFORM_OPPOSITION_DOT_MAX) continue;

      const score = (
        segment.distance * 2.2 +
        midpointDist * 0.55 +
        (Math.abs(segment.projection - 0.5) * 0.25) +
        (oppositionDot + 1) * 0.3 +
        Math.min(dA, dB) * 0.08 -
        (mesh === activeMesh ? 0.22 : 0)
      );
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

  function sortHandsForTracking(hands) {
    return [...hands].sort((handA, handB) => {
      const palmA = palmCenterLandmark(handA);
      const palmB = palmCenterLandmark(handB);
      return (palmA?.x ?? 0.5) - (palmB?.x ?? 0.5);
    });
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

  function isThumbsDownPose(hand) {
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
      if (tipToPalm < 0.98 && tipToWrist <= Math.max(pipToWrist, mcpToWrist) * 1.06) {
        curledCount += 1;
      }
    }

    const thumbTip = hand[4];
    const thumbIp = hand[3];
    const thumbMcp = hand[2];
    const thumbExtended =
      (lmkDist(thumbTip, wrist) / scale) > 1.32 &&
      (lmkDist(thumbTip, palmCenter) / scale) > 1.04 &&
      (lmkDist(thumbTip, thumbMcp) / scale) > 0.48 &&
      lmkDist(thumbTip, wrist) > lmkDist(thumbIp, wrist) * 1.05;
    const thumbBelowPalm = thumbTip.y > palmCenter.y + 0.025;
    const thumbBelowFingers = thumbTip.y > (Math.max(...tips.map((idx) => hand[idx].y)) + 0.01);

    return thumbExtended && curledCount >= 3 && thumbBelowPalm && thumbBelowFingers;
  }

  function isDirectPinchPose(hand) {
    if (!hand) return false;
    const scale = palmScale(hand);
    const wrist = hand[0];
    const palmCenter = {
      x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
      y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
      z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
    };
    const thumbTip = hand[4];
    const indexTip = hand[8];
    const thumbIp = hand[3];
    const indexDip = hand[7];
    const pinchMid = midpointLandmark(thumbTip, indexTip);
    const pinchRatio = lmkDist(thumbTip, indexTip) / scale;
    const pinchFrontOfPalm = pinchMid ? (lmkDist(pinchMid, palmCenter) / scale) > 0.4 : false;
    const thumbLeading = lmkDist(thumbTip, wrist) >= lmkDist(thumbIp, wrist) * 0.98;
    const indexLeading = lmkDist(indexTip, wrist) >= lmkDist(indexDip, wrist) * 0.98;
    return pinchRatio < 0.28 && pinchFrontOfPalm && thumbLeading && indexLeading;
  }

  function isLinePointPinchPose(hand) {
    if (!hand) return false;
    const scale = palmScale(hand);
    const wrist = hand[0];
    const palmCenter = {
      x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
      y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
      z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
    };
    const thumbTip = hand[4];
    const indexTip = hand[8];
    const thumbIp = hand[3];
    const indexDip = hand[7];
    const pinchMid = midpointLandmark(thumbTip, indexTip);
    const pinchRatio = lmkDist(thumbTip, indexTip) / scale;
    const pinchFrontOfPalm = pinchMid ? (lmkDist(pinchMid, palmCenter) / scale) > 0.34 : false;
    const thumbReady = lmkDist(thumbTip, wrist) >= lmkDist(thumbIp, wrist) * 0.95;
    const indexReady = lmkDist(indexTip, wrist) >= lmkDist(indexDip, wrist) * 0.97;
    return pinchRatio < 0.34 && pinchFrontOfPalm && thumbReady && indexReady;
  }

  function isRotatePose(hand) {
    if (!hand) return false;
    const scale = palmScale(hand);
    const wrist = hand[0];
    const palmCenter = {
      x: (hand[0].x + hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 5,
      y: (hand[0].y + hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 5,
      z: (hand[0].z + hand[5].z + hand[9].z + hand[13].z + hand[17].z) / 5,
    };
    const indexTip = hand[8];
    const indexPip = hand[6];
    const indexMcp = hand[5];
    const middleTip = hand[12];
    const middlePip = hand[10];
    const middleMcp = hand[9];
    const ringTip = hand[16];
    const ringPip = hand[14];
    const ringMcp = hand[13];
    const pinkyTip = hand[20];
    const pinkyPip = hand[18];
    const pinkyMcp = hand[17];
    const thumbTip = hand[4];
    const thumbIp = hand[3];
    const thumbMcp = hand[2];
    const indexExtended =
      (lmkDist(indexTip, palmCenter) / scale) > 1.02 &&
      lmkDist(indexTip, wrist) > lmkDist(indexPip, wrist) * 1.08 &&
      lmkDist(indexTip, wrist) > lmkDist(indexMcp, wrist) * 1.18;
    const middleExtended =
      (lmkDist(middleTip, palmCenter) / scale) > 1.02 &&
      lmkDist(middleTip, wrist) > lmkDist(middlePip, wrist) * 1.08 &&
      lmkDist(middleTip, wrist) > lmkDist(middleMcp, wrist) * 1.18;
    const ringExtended =
      (lmkDist(ringTip, palmCenter) / scale) > 0.96 &&
      lmkDist(ringTip, wrist) > lmkDist(ringPip, wrist) * 1.05 &&
      lmkDist(ringTip, wrist) > lmkDist(ringMcp, wrist) * 1.12;
    const pinkyExtended =
      (lmkDist(pinkyTip, palmCenter) / scale) > 0.92 &&
      lmkDist(pinkyTip, wrist) > lmkDist(pinkyPip, wrist) * 1.04 &&
      lmkDist(pinkyTip, wrist) > lmkDist(pinkyMcp, wrist) * 1.08;
    const spreadDistances = [
      lmkDist(indexTip, middleTip) / scale,
      lmkDist(middleTip, ringTip) / scale,
      lmkDist(ringTip, pinkyTip) / scale,
    ];
    const spreadCount = spreadDistances.filter((distance) => distance > 0.2).length;
    const thumbOpen =
      (lmkDist(thumbTip, palmCenter) / scale) > 0.92 &&
      (lmkDist(thumbTip, thumbMcp) / scale) > 0.48 &&
      lmkDist(thumbTip, wrist) > lmkDist(thumbIp, wrist) * 1.04;
    const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;

    return indexExtended && middleExtended && extendedCount >= 3 && spreadCount >= 2 && thumbOpen;
  }

  function classifySignal(primary, interaction) {
    if (!primary || !interaction?.handsDetected) return null;
    if (interaction.mode === "spawn" && interaction.deleteCandidate && isFistPose(primary)) {
      return SIGNALS.FIST_DELETE;
    }
    return null;
  }

  function setStatus(msg, state = "ok") {
    statusEl.textContent = msg;
    statusEl.dataset.state = state;
  }

  function ensureMeshIdentity(mesh) {
    if (!mesh) return null;
    sceneRuntime.ensureMeshIdentity(mesh);
    if (!mesh.userData.shape) mesh.userData.shape = "cube";
    return mesh.userData.objectSerial;
  }

  function colorHex(mesh) {
    return mesh?.material?.color ? `#${mesh.material.color.getHexString()}` : "#7cf7e4";
  }

  function meshPositionAxisValue(mesh, axis = "x") {
    if (!mesh?.position) return 0;
    return mesh.position[axis] || 0;
  }

  function meshRotationAxisDegrees(mesh, axis = "y") {
    if (!mesh?.rotation) return 0;
    return THREE.MathUtils.radToDeg(mesh.rotation[axis] || 0);
  }

  function normalizeRotationDegrees(value) {
    let degrees = Number(value || 0);
    while (degrees > 180) degrees -= 360;
    while (degrees < -180) degrees += 360;
    return degrees;
  }

  function findMeshBySerial(objectSerial) {
    return placedMeshes.find((item) => Number(item.userData?.objectSerial) === Number(objectSerial)) || null;
  }

  function formatDimensionValue(value, decimals = 2) {
    return Number(value || 0).toFixed(decimals);
  }

  function buildDimensionField(key, label, value, options = {}) {
    const numericValue = Math.max(0.01, Number(value || 0));
    const step = Number(options.step ?? 0.05);
    const min = Math.max(0.01, Number(options.min ?? 0.1));
    const decimals = Number.isInteger(options.decimals)
      ? options.decimals
      : (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
    const dynamicMax = Math.max(
      numericValue,
      Number(options.defaultMax ?? 4),
      numericValue * Number(options.maxMultiplier ?? 2.4),
      min + step
    );

    return {
      key,
      label,
      value: numericValue,
      step,
      min,
      max: Number(dynamicMax.toFixed(decimals)),
      decimals,
    };
  }

  function dimensionFieldsForMesh(mesh) {
    const shape = mesh?.userData?.shape || "cube";
    const params = sceneParamsFromMesh(mesh);

    switch (shape) {
      case "cube":
        return [buildDimensionField("size", "Size", params.size, { min: 0.2, defaultMax: 5 })];
      case "cuboid":
        return [
          buildDimensionField("width", "Width", params.width, { min: 0.2, defaultMax: 5 }),
          buildDimensionField("height", "Height", params.height, { min: 0.2, defaultMax: 5 }),
          buildDimensionField("depth", "Depth", params.depth, { min: 0.2, defaultMax: 5 }),
        ];
      case "sphere":
        return [buildDimensionField("radius", "Radius", params.radius, { min: 0.1, defaultMax: 3.5 })];
      case "cylinder":
      case "cone":
        return [
          buildDimensionField("radius", "Radius", params.radius, { min: 0.1, defaultMax: 3.5 }),
          buildDimensionField("height", "Height", params.height, { min: 0.2, defaultMax: 6 }),
        ];
      case "pyramid":
        return [
          buildDimensionField("base", "Base", params.base, { min: 0.2, defaultMax: 5 }),
          buildDimensionField("height", "Height", params.height, { min: 0.2, defaultMax: 6 }),
        ];
      case "plane":
        return [
          buildDimensionField("width", "Width", params.width, { min: 0.4, defaultMax: 8, step: 0.1, decimals: 1 }),
          buildDimensionField("depth", "Depth", params.depth, { min: 0.4, defaultMax: 8, step: 0.1, decimals: 1 }),
        ];
      case "pointMarker":
        return [buildDimensionField("radius", "Radius", params.radius, { min: 0.05, defaultMax: 1.4, step: 0.02 })];
      case "line":
        return [
          buildDimensionField("length", "Length", distanceBetween(params.start, params.end), { min: 0.2, defaultMax: 10, step: 0.1, decimals: 1 }),
          buildDimensionField("thickness", "Thickness", params.thickness, { min: 0.02, defaultMax: 0.8, step: 0.02 }),
        ];
      default:
        return [];
    }
  }

  function updateMeshParamValue(objectSerial, key, rawValue) {
    const mesh = findMeshBySerial(objectSerial);
    if (!mesh) return null;

    const nextValue = Math.max(0.01, Number(rawValue || 0));
    const nextParams = sceneParamsFromMesh(mesh);

    if (mesh.userData?.shape === "line") {
      if (key === "thickness") {
        nextParams.thickness = nextValue;
      } else if (key === "length") {
        const start = new THREE.Vector3(...nextParams.start);
        const end = new THREE.Vector3(...nextParams.end);
        const midpoint = start.clone().lerp(end, 0.5);
        const direction = end.clone().sub(start);
        if (direction.lengthSq() <= 1e-6) {
          direction.set(1, 0, 0);
        }
        direction.normalize();
        const halfSpan = direction.multiplyScalar(nextValue * 0.5);
        nextParams.start = midpoint.clone().sub(halfSpan).toArray();
        nextParams.end = midpoint.clone().add(halfSpan).toArray();
      }
    } else {
      nextParams[key] = nextValue;
    }

    applySceneParamsUpdate(mesh, nextParams, "params");
    updateGeometryMetrics(mesh.userData.shape || shapeTypeEl.value, mesh.userData.baseSize, mesh);
    refreshDebug();
    return nextValue;
  }

  function translateLineByDelta(mesh, axis, nextValue) {
    const currentValue = mesh.position?.[axis] || 0;
    const delta = Number(nextValue) - currentValue;
    const start = Array.isArray(mesh.userData?.lineStart) ? new THREE.Vector3().fromArray(mesh.userData.lineStart) : null;
    const end = Array.isArray(mesh.userData?.lineEnd) ? new THREE.Vector3().fromArray(mesh.userData.lineEnd) : null;
    if (!start || !end) {
      mesh.position[axis] = Number(nextValue);
      return;
    }
    start[axis] += delta;
    end[axis] += delta;
    applyLineEndpoints(mesh, start, end, Number(mesh.userData.baseSize || sizeInputEl.value));
  }

  function updateMeshPositionAxisValue(objectSerial, axis, rawValue) {
    const mesh = findMeshBySerial(objectSerial);
    if (!mesh?.position) return null;
    const nextValue = Number(rawValue || 0);
    if (mesh.userData?.shape === "line") {
      translateLineByDelta(mesh, axis, nextValue);
    } else {
      mesh.position[axis] = nextValue;
    }
    updateMeshMetadata(mesh);
    sceneRuntime.notifySceneChanged("position", mesh);
    refreshDebug();
    return nextValue;
  }

  function updateMeshRotationAxisValue(objectSerial, axis, rawValue) {
    const mesh = findMeshBySerial(objectSerial);
    if (!mesh?.rotation) return null;
    const degrees = normalizeRotationDegrees(rawValue);
    mesh.rotation[axis] = THREE.MathUtils.degToRad(degrees);
    sceneRuntime.notifySceneChanged("rotation-axis", mesh);
    refreshDebug();
    return degrees;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;");
  }

  function normalizeColorValue(colorValue) {
    const normalized = new THREE.Color(colorValue);
    return `#${normalized.getHexString()}`;
  }

  function applyMeshAppearance(mesh, nextShape, nextColor) {
    if (!mesh) return false;

    const shape = SHAPE_OPTIONS.includes(nextShape) ? nextShape : (mesh.userData?.shape || "cube");
    let color;
    try {
      color = normalizeColorValue(nextColor || colorHex(mesh));
    } catch {
      color = colorHex(mesh);
    }

    const currentObject = sceneObjectFromMesh(mesh);
    const currentSize = paramsToBaseSize(currentObject.shape, currentObject.params);
    const lineEndpoints = lineEndpointsForMesh(mesh);
    const nextObject = normalizeSceneObject({
      ...currentObject,
      shape,
      color,
      params: shape === currentObject.shape
        ? currentObject.params
        : (
          shape === "line"
            ? {
              start: lineEndpoints.start.toArray(),
              end: lineEndpoints.end.toArray(),
              thickness: Math.max(0.08, currentSize * 0.08),
            }
            : baseSizeToParams(shape, currentSize)
        ),
    });

    applySceneObjectToMesh(world, mesh, nextObject);
    mesh.userData.baseEmissive = mesh.material.emissive.getHex();
    if (shape !== "line") {
      delete mesh.userData.lineStart;
      delete mesh.userData.lineEnd;
      alignMeshToGround(mesh);
    }
    updateMeshMetadata(mesh);
    updateGeometryMetrics(shape, mesh.userData.baseSize || currentSize, mesh);
    if (mesh === activeMesh && mesh.material?.emissive) {
      mesh.material.emissive.setHex(0xffc857);
    }
    sceneRuntime.notifySceneChanged("appearance", mesh);
    return true;
  }

  function alignMeshToGround(mesh) {
    if (mesh?.userData?.shape === "line" || mesh?.userData?.floorLocked === false) return;
    if (!mesh?.geometry) return;
    mesh.geometry.computeBoundingBox?.();
    const bbox = mesh.geometry.boundingBox;
    if (!bbox) return;
    const halfHeight = (bbox.max.y - bbox.min.y) * Math.abs(mesh.scale.y || 1) * 0.5;
    mesh.position.y = halfHeight;
  }

  function renderObjectList() {
    if (!objectListEl || !objectCountEl) return;

    objectCountEl.textContent = String(placedMeshes.length);
    if (!placedMeshes.length) {
      objectListEl.innerHTML = `<div class="object-empty">Place an object to open a compact transform inspector here.</div>`;
      return;
    }

    objectListEl.innerHTML = placedMeshes.map((mesh) => {
      ensureMeshIdentity(mesh);
      const label = mesh.userData.label;
      const shape = mesh.userData?.shape || "cube";
      const color = colorHex(mesh);
      const dimensions = dimensionFieldsForMesh(mesh);
      const posXValue = meshPositionAxisValue(mesh, "x").toFixed(2);
      const posYValue = meshPositionAxisValue(mesh, "y").toFixed(2);
      const posZValue = meshPositionAxisValue(mesh, "z").toFixed(2);
      const rotationXValue = normalizeRotationDegrees(meshRotationAxisDegrees(mesh, "x")).toFixed(0);
      const rotationYValue = normalizeRotationDegrees(meshRotationAxisDegrees(mesh, "y")).toFixed(0);
      const rotationZValue = normalizeRotationDegrees(meshRotationAxisDegrees(mesh, "z")).toFixed(0);
      const dimensionMarkup = dimensions.length
        ? `
          <div class="dimension-grid">
            ${dimensions.map((field) => `
              <label class="dimension-field-wrap">
                <span class="dimension-slider-head">
                  <span class="dimension-label">${escapeHtml(field.label)}</span>
                  <span class="dimension-value" data-param-value="${escapeHtml(field.key)}">${escapeHtml(formatDimensionValue(field.value, field.decimals))}</span>
                </span>
                <input
                  class="dimension-field dimension-slider"
                  type="range"
                  min="${escapeHtml(field.min.toString())}"
                  max="${escapeHtml(field.max.toString())}"
                  step="${escapeHtml(field.step.toString())}"
                  data-param="${escapeHtml(field.key)}"
                  data-object-serial="${mesh.userData.objectSerial}"
                  value="${escapeHtml(formatDimensionValue(field.value, field.decimals))}"
                />
              </label>
            `).join("")}
          </div>
        `
        : "";
      const inspector = mesh === activeMesh ? `
        <div class="transform-card">
          ${dimensionMarkup}
          <div class="transform-grid transform-grid-head">
            <span class="transform-spacer"></span>
            <span>X</span>
            <span>Y</span>
            <span>Z</span>
          </div>
          <div class="transform-grid">
            <span class="transform-label">Position</span>
            <input class="transform-field" type="number" step="0.01" data-transform="position" data-axis="x" data-object-serial="${mesh.userData.objectSerial}" value="${escapeHtml(posXValue)}" />
            <input class="transform-field" type="number" step="0.01" data-transform="position" data-axis="y" data-object-serial="${mesh.userData.objectSerial}" value="${escapeHtml(posYValue)}" />
            <input class="transform-field" type="number" step="0.01" data-transform="position" data-axis="z" data-object-serial="${mesh.userData.objectSerial}" value="${escapeHtml(posZValue)}" />
          </div>
          <div class="transform-grid">
            <span class="transform-label">Rotation</span>
            <input class="transform-field" type="number" step="1" data-transform="rotation" data-axis="x" data-object-serial="${mesh.userData.objectSerial}" value="${escapeHtml(rotationXValue)}" />
            <input class="transform-field" type="number" step="1" data-transform="rotation" data-axis="y" data-object-serial="${mesh.userData.objectSerial}" value="${escapeHtml(rotationYValue)}" />
            <input class="transform-field" type="number" step="1" data-transform="rotation" data-axis="z" data-object-serial="${mesh.userData.objectSerial}" value="${escapeHtml(rotationZValue)}" />
          </div>
        </div>
      ` : "";
      return `
        <article class="object-item${mesh === activeMesh ? " is-active" : ""}" data-object-serial="${mesh.userData.objectSerial}">
          <div class="object-item-head">
            <span class="object-swatch" style="--swatch:${escapeHtml(color)}"></span>
            <strong class="object-label">${escapeHtml(label)}</strong>
            <span class="object-state">${mesh === activeMesh ? "active" : shape}</span>
          </div>
          ${inspector}
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

  function drawDebug(hands, interaction, visualHands = null) {
    ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    if (!hands?.length) return;
    const renderedHands = visualHands || smoothHandsForOverlay(hands);

    // Minimal futuristic overlay with subtle contrast.
    for (const handState of renderedHands) {
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
    return;
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
      },
      shape: appState.shape,
      dimension: Number(appState.dimension.toFixed(3)),
      volume: Number(appState.volume.toFixed(3)),
      surfaceArea: Number(appState.surfaceArea.toFixed(3)),
      meshCount: placedMeshes.length,
    }, null, 2);
  }

  function geometryParamsForShape(shape, size, mesh = null) {
    if (mesh) {
      return sceneParamsFromMesh(mesh);
    }

    if (shape === "sphere") return { radius: size * 0.6 };
    if (shape === "cylinder") return { radius: size * 0.45, height: size * 1.4 };
    if (shape === "cone") return { radius: size * 0.5, height: size };
    if (shape === "cuboid") return { width: size * 1.6, height: size, depth: size * 0.9 };
    if (shape === "pyramid") return { base: size, height: size };
    if (shape === "plane") return { width: size * 2, depth: size * 2 };
    if (shape === "pointMarker") return { radius: Math.max(0.08, size * 0.08) };
    if (shape === "line") {
      const endpoints = mesh ? lineEndpointsForMesh(mesh) : null;
      return {
        start: endpoints ? endpoints.start.toArray() : [0, 0.03, 0],
        end: endpoints ? endpoints.end.toArray() : [size, 0.03, 0],
        thickness: Math.max(0.08, size * 0.08),
      };
    }
    if (shape === "cube") return { size };
    return { size };
  }

  function updateGeometryMetrics(shape, size, mesh = null) {
    const params = geometryParamsForShape(shape, size, mesh);
    const metrics = computeGeometry(shape, params);

    appState.shape = shape;
    appState.dimension = mesh ? paramsToBaseSize(shape, params) : size;
    appState.volume = metrics.volume;
    appState.surfaceArea = metrics.surfaceArea;
  }

  function groundAlignedY(mesh) {
    if (mesh?.userData?.shape === "line") return mesh?.position?.y ?? 0;
    if (!mesh?.geometry) return mesh?.position?.y ?? 0;
    mesh.geometry.computeBoundingBox?.();
    const bbox = mesh.geometry.boundingBox;
    if (!bbox) return mesh?.position?.y ?? 0;
    return (bbox.max.y - bbox.min.y) * Math.abs(mesh.scale.y || 1) * 0.5;
  }

  function removeMesh(mesh) {
    sceneRuntime.removeMesh(mesh);
  }

  function beginDragSession(mesh, clientX, clientY, pointerId = null) {
    if (!mesh) return false;
    world.camera.getWorldDirection(dragPlaneNormal);
    const dragPlane = Math.abs(dragPlaneNormal.y) > VIEW_DRAG_GROUND_LOCK_THRESHOLD
      ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -mesh.position.y)
      : new THREE.Plane().setFromNormalAndCoplanarPoint(dragPlaneNormal.clone().normalize(), mesh.position.clone());
    const intersection = world.projectClientToPlane(clientX, clientY, dragPlane);
    if (!intersection) return false;
    dragSession = {
      mesh,
      plane: dragPlane,
      pointerId,
      startPosition: mesh.position.clone(),
      pointerOffset: intersection.clone().sub(mesh.position),
      lineStart: Array.isArray(mesh.userData?.lineStart) ? new THREE.Vector3().fromArray(mesh.userData.lineStart) : null,
      lineEnd: Array.isArray(mesh.userData?.lineEnd) ? new THREE.Vector3().fromArray(mesh.userData.lineEnd) : null,
    };
    if (typeof world.setControlsEnabled === "function") {
      world.setControlsEnabled(false);
    }
    return true;
  }

  function updateDragSession(clientX, clientY) {
    if (!dragSession?.mesh) return false;
    const intersection = world.projectClientToPlane(clientX, clientY, dragSession.plane);
    if (!intersection) return false;
    const targetPosition = intersection.clone().sub(dragSession.pointerOffset);

    if (dragSession.mesh.userData?.shape === "line" && dragSession.lineStart && dragSession.lineEnd) {
      const delta = targetPosition.clone().sub(dragSession.startPosition);
      applyLineEndpoints(
        dragSession.mesh,
        dragSession.lineStart.clone().add(delta),
        dragSession.lineEnd.clone().add(delta),
        Number(dragSession.mesh.userData.baseSize || sizeInputEl.value)
      );
      dragSession.mesh.position.copy(targetPosition);
    } else {
      dragSession.mesh.position.copy(targetPosition);
      const groundedY = groundAlignedY(dragSession.mesh);
      const nearGround = Math.abs(dragSession.mesh.position.y - groundedY) <= 0.04;
      dragSession.mesh.userData.floorLocked = nearGround;
      if (nearGround) {
        alignMeshToGround(dragSession.mesh);
      }
    }

    updateMeshMetadata(dragSession.mesh);
    syncSelectionMarker(dragSession.mesh);
    refreshDebug();
    return true;
  }

  function endDragSession() {
    if (!dragSession) return;
    const draggedMesh = dragSession.mesh;
    dragSession = null;
    if (typeof world.setControlsEnabled === "function") {
      world.setControlsEnabled(true);
    }
    if (draggedMesh) {
      sceneRuntime.notifySceneChanged("drag-end", draggedMesh);
      setStatus(`Dragged ${draggedMesh.userData?.label || "object"}`, "ok");
      renderObjectList();
    }
  }

  function clearDragIntent() {
    dragIntent = null;
  }

  function enforceMeshBudget() {
    while (placedMeshes.length > MAX_MESHES) {
      const old = placedMeshes.shift();
      if (transformSession?.mesh === old) transformSession = null;
      if (rotationSession?.mesh === old) rotationSession = null;
      removeMesh(old);
      if (activeMesh === old) setActiveMesh(null);
    }
    renderObjectList();
  }

  function undo() {
    const mesh = placedMeshes.pop();
    if (!mesh) return;
    if (transformSession?.mesh === mesh) transformSession = null;
    if (rotationSession?.mesh === mesh) rotationSession = null;
    removeMesh(mesh);
    if (activeMesh === mesh) setActiveMesh(null);
    setStatus(`Undid one shape. Remaining ${placedMeshes.length}`, "ok");
    renderObjectList();
    refreshDebug();
  }

  function deleteNearestToHand(palmHit, pinchHit = null, indexHit = null) {
    if (!palmHit && !pinchHit && !indexHit) return false;
    const target = pickDeleteTargetFromHand(palmHit, pinchHit, indexHit);
    if (!target) return false;
    const idx = placedMeshes.indexOf(target);
    if (idx >= 0) placedMeshes.splice(idx, 1);
    if (transformSession?.mesh === target) transformSession = null;
    if (rotationSession?.mesh === target) rotationSession = null;
    if (target === activeMesh) setActiveMesh(null);
    removeMesh(target);
    setStatus("Deleted nearest object to palm", "ok");
    renderObjectList();
    return true;
  }

  function clearAll() {
    clearDragIntent();
    endDragSession();
    transformSession = null;
    rotationSession = null;
    disposePlacementPreview();
    sceneRuntime.clear("clear-all");
    setActiveMesh(null);
    setStatus("Cleared scene", "idle");
    renderObjectList();
    refreshDebug();
  }

  function serializeScene() {
    return sceneRuntime.exportLegacyScene();
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
    sceneRuntime.loadLegacyScene(data, "legacy-load");
    placedMeshes.forEach((mesh) => updateMeshMetadata(mesh));
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
      minHandDetectionConfidence: 0.42,
      minHandPresenceConfidence: 0.38,
      minTrackingConfidence: 0.38,
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
      const visualHands = smoothHandsForOverlay(hands);
      const primary = hands[0] || null;
      const secondary = hands[1] || null;
      const lineToolSelected = shapeTypeEl.value === "line";
      const primaryVisual = visualHands[0]?.landmarks || primary;
      const handCount = hands.length;
      const baseInteraction = pipeline.update(primary, secondary);
      const autoMode = handCount >= 2 ? "transform" : "spawn";
      const primaryPalm = primary ? palmCenterLandmark(primary) : null;
      const secondaryPalm = secondary ? palmCenterLandmark(secondary) : null;
      const primaryPalmHitRaw = primaryPalm ? world.projectToGround(primaryPalm) : null;
      const secondaryPalmHitRaw = secondaryPalm ? world.projectToGround(secondaryPalm) : null;
      const pinchContact = primaryVisual ? midpointLandmark(primaryVisual[4], primaryVisual[8]) : null;
      const primaryContactLandmark = pinchContact || primaryVisual?.[8] || null;
      const placementAnchor = placementPreview?.shape === "line"
        ? (placementPreview.lineStartHit || world.getViewTarget())
        : (placementPreview?.anchorHit || world.getViewTarget());
      const pinchPlacementRaw = primaryContactLandmark
        ? placementTargetFromLandmark(primaryContactLandmark, placementAnchor)
        : null;
      const pinchHitRaw = pinchPlacementRaw?.point || null;
      const primaryIndexHitRaw = primaryVisual?.[8] ? world.projectToGround(primaryVisual[8]) : null;

      smoothedPalm = smoothPoint(smoothedPalm, primaryPalmHitRaw, 0.24);
      smoothedSecondaryPalm = smoothPoint(smoothedSecondaryPalm, secondaryPalmHitRaw, 0.24);
      smoothedPinch = smoothPoint(smoothedPinch, pinchHitRaw, 0.3);
      smoothedPrimaryIndex = smoothPoint(smoothedPrimaryIndex, primaryIndexHitRaw, 0.22);

      const primaryPalmHit = primaryPalmHitRaw || smoothedPalm;
      const secondaryPalmHit = secondaryPalmHitRaw || smoothedSecondaryPalm;
      const pinchHit = pinchHitRaw || smoothedPinch;
      const pinchPlacementPoint = lineToolSelected ? (pinchHitRaw || smoothedPinch) : pinchHit;
      const pinchPlacement = pinchPlacementPoint
        ? {
          point: pinchPlacementPoint,
          floorLocked: pinchPlacementRaw?.floorLocked ?? (placementPreview?.floorLocked ?? true),
        }
        : null;
      const primaryIndexHit = primaryIndexHitRaw || smoothedPrimaryIndex;
      const deleteTarget = autoMode === "spawn"
        ? pickDeleteTargetFromHand(primaryPalmHit, pinchHit, primaryIndexHit)
        : null;
      const thumbsUpPose = autoMode === "spawn" && primary ? isThumbsUpPose(primary) : false;
      const thumbsDownPose = autoMode === "spawn" && primary ? isThumbsDownPose(primary) : false;
      const twoHandRotatePose = autoMode === "transform" && primary && secondary
        ? isRotatePose(primary) && isRotatePose(secondary)
        : false;
      const rawSignal = autoMode === "spawn" && primary
        ? classifySignal(primary, {
          ...baseInteraction,
          handsDetected: handCount > 0,
          mode: "spawn",
          pointPose: false,
          deleteCandidate: deleteTarget,
        })
        : (twoHandRotatePose ? SIGNALS.POINT_ROTATE : null);
      if (rawSignal === SIGNALS.FIST_DELETE) {
        if (fistHoldStartAt == null) fistHoldStartAt = now;
      } else {
        fistHoldStartAt = null;
      }

      const signal = rawSignal === SIGNALS.FIST_DELETE
        ? ((fistHoldStartAt != null && (now - fistHoldStartAt) >= FIST_HOLD_MS) ? SIGNALS.FIST_DELETE : null)
        : rawSignal;
      const transformDistance = handCount >= 2 && primaryPalmHit && secondaryPalmHit
        ? planarDistance(primaryPalmHit, secondaryPalmHit)
        : 0;
      const thumbsUpRelease = Boolean(transformSession || rotationSession) && [primary, secondary].some(
        (hand) => hand && isThumbsUpPose(hand)
      );
      let transformEndedThisFrame = false;
      let handReturnThisFrame = false;

      if (thumbsUpRelease && (transformSession || rotationSession)) {
        endTransformSession("Transform ended");
        pendingTransformCandidate = null;
        pendingTransformSince = null;
        transformMissingHandSince = null;
        transformEndedThisFrame = true;
      } else if (transformSession || rotationSession) {
        if (handCount < 2) {
          endTransformSession("Transform ended: hand lost");
          pendingTransformCandidate = null;
          pendingTransformSince = null;
          transformMissingHandSince = null;
          transformEndedThisFrame = true;
        } else {
          handReturnThisFrame = transformMissingHandSince != null;
          transformMissingHandSince = null;
        }
      }
      const interaction = {
        ...baseInteraction,
        handsDetected: handCount > 0,
        handCount,
        mode: autoMode,
        pointPose: twoHandRotatePose,
      };

      drawDebug(hands, interaction, visualHands);
      appState.interaction = {
        ...interaction,
        signal,
        transformDistance,
        thumbsUp: thumbsUpRelease,
        transformActive: Boolean(transformSession || rotationSession),
      };

      const dynamicAlpha = Math.max(0.16, Math.min(0.62, 0.55 - interaction.jitter * 2.2));
      pipeline.setAlpha(dynamicAlpha);
      const conjureCooldownActive = autoMode === "spawn" && !placementPreview && (now - lastSpawnAt) < SPAWN_COOLDOWN_MS;

      if (autoMode === "spawn" && primary && !transformEndedThisFrame) {
        const lineToolActive = shapeTypeEl.value === "line";
        const directPinchPose = isDirectPinchPose(primary);
        const linePointPinchPose = lineToolActive && isLinePointPinchPose(primary);
        const pinchActive =
          (((interaction.pinch && (interaction.pinchStrength || 0) >= (lineToolActive ? 0.24 : 0.4)) || directPinchPose || linePointPinchPose)) &&
          signal !== SIGNALS.FIST_DELETE;
        const pinchStart = pinchActive && !prevPinch;
        const pulseRadius = pinchPulseRadius(interaction.pinchStrength || 0);
        const placementPulseActive = pinchActive && pulseRadius >= PLACEMENT_PULSE_TRIGGER_RADIUS;
        const placementPulseTrigger = placementPulseActive && !prevPlacementPulseActive;
        const canSpawn = now - lastSpawnAt >= SPAWN_COOLDOWN_MS;
        const canOperate = now - lastOperationAt >= OPERATION_COOLDOWN_MS;
        const hadLineDraft = placementPreview?.shape === "line";

        if (lineToolActive) {
          if (lineUsesSuggestedPlacement()) {
            const shouldConjurePreview =
              !placementPreview &&
              canSpawn &&
              pinchPlacement &&
              (pinchStart || placementPulseTrigger);
            if (shouldConjurePreview) {
              ensurePlacementPreview(pinchPlacement, primaryContactLandmark);
              lastSpawnAt = now;
            } else if (placementPreview) {
              ensurePlacementPreview(pinchPlacement, primaryContactLandmark);
            }
          } else if (!hadLineDraft && canSpawn && pinchPlacement && primaryContactLandmark && pinchStart) {
            ensurePlacementPreview(pinchPlacement, primaryContactLandmark);
            setStatus("Line start placed. Move to the next point and pinch again to finish", "ok");
          } else if (hadLineDraft) {
            ensurePlacementPreview(pinchPlacement, primaryContactLandmark);
            if (pinchStart && placementPreview?.lineEndHit) {
              if (confirmPlacementPreview(now)) {
                lastSpawnAt = now;
              }
            }
          }
        } else {
          const shouldConjurePreview =
            !placementPreview &&
            canSpawn &&
            pinchPlacement &&
            (pinchStart || placementPulseTrigger);
          if (shouldConjurePreview) {
            ensurePlacementPreview(pinchPlacement);
            lastSpawnAt = now;
          } else if (placementPreview) {
            ensurePlacementPreview();
          }
        }

        if (placementPreview && thumbsDownPose) {
          disposePlacementPreview();
          setStatus("Placement cancelled", "idle");
        } else if (placementPreview && thumbsUpPose && canOperate) {
          confirmPlacementPreview(now);
        }

        const canDeleteWithFist =
          signal === SIGNALS.FIST_DELETE &&
          !placementPreview &&
          deleteTarget &&
          now - lastOperationAt >= OPERATION_COOLDOWN_MS &&
          now - lastFistDeleteAt >= FIST_DELETE_COOLDOWN_MS;
        if (canDeleteWithFist && deleteNearestToHand(primaryPalmHit, pinchHit, primaryIndexHit)) {
          lastFistDeleteAt = now;
          lastOperationAt = now;
        }

        rotationSession = null;
        pendingTransformCandidate = null;
        pendingTransformSince = null;

        prevPlacementPulseActive = placementPulseActive;
        prevPinch = pinchActive;
      } else if (autoMode === "transform" && !transformEndedThisFrame) {
        if (placementPreview) {
          disposePlacementPreview();
        }
        fistHoldStartAt = null;
        prevPlacementPulseActive = false;
        prevPinch = false;
        transformMissingHandSince = null;

        rotationSession = null;

        if (handCount >= 2 && primaryPalmHit && secondaryPalmHit && primary && secondary) {
          if (!transformSession) {
            const candidate = pickMeshForTransform(primaryPalmHit, secondaryPalmHit, primaryPalm, secondaryPalm);
            const canLock = updatePendingTransformCandidate(candidate, now);
            if (candidate && canLock) {
              beginTransformSession(candidate, primaryPalmHit, secondaryPalmHit, primary, secondary, now);
            }
          } else {
            pendingTransformCandidate = null;
            pendingTransformSince = null;
          }
        } else {
          pendingTransformCandidate = null;
          pendingTransformSince = null;
        }

        if (transformSession?.mesh && primary && secondary && primaryPalmHit && secondaryPalmHit) {
          if (handReturnThisFrame) {
            refreshTransformSessionAnchors(transformSession, primaryPalmHit, secondaryPalmHit, primary, secondary);
          }

          const currentSpan = Math.max(MIN_TRANSFORM_SPAN, planarDistance(primaryPalmHit, secondaryPalmHit));
          const leftWristAngle = computeWristAngle(primary);
          const rightWristAngle = computeWristAngle(secondary);
          const transformIntent = resolveTransformIntent(
            transformSession,
            currentSpan,
            leftWristAngle,
            rightWristAngle,
            twoHandRotatePose
          );

          if (transformIntent === "scale") {
            const spanRatio = clamp(
              currentSpan / Math.max(MIN_TRANSFORM_SPAN, transformSession.startSpan || MIN_TRANSFORM_SPAN),
              MIN_MESH_SCALE,
              MAX_MESH_SCALE
            );
            const shape = transformSession.mesh.userData?.shape || shapeTypeEl.value;
            const targetParams = scaleSceneParams(shape, transformSession.startParams, spanRatio);
            const smoothedParams = interpolateSceneParams(
              shape,
              sceneParamsFromMesh(transformSession.mesh),
              targetParams,
              TRANSFORM_SCALE_SMOOTHING
            );
            applySceneObjectToMesh(world, transformSession.mesh, buildSceneObjectForMesh(transformSession.mesh, { params: smoothedParams }));
            if (transformSession.mesh.userData?.shape !== "line" && transformSession.mesh.userData?.floorLocked !== false) {
              alignMeshToGround(transformSession.mesh);
            }
          } else if (transformIntent === "rotate") {
            if (leftWristAngle != null && transformSession.startLeftWristAngle != null) {
              const deltaY = shortestAngleDelta(transformSession.startLeftWristAngle, leftWristAngle);
              const targetRotationY = snapRotation(transformSession.startRotationY + (deltaY * 2));
              transformSession.mesh.rotation.y = THREE.MathUtils.lerp(
                transformSession.mesh.rotation.y,
                targetRotationY,
                TRANSFORM_ROTATION_SMOOTHING
              );
            }
            if (rightWristAngle != null && transformSession.startRightWristAngle != null) {
              const deltaX = shortestAngleDelta(transformSession.startRightWristAngle, rightWristAngle);
              const targetRotationX = snapRotation(transformSession.startRotationX + (deltaX * 2));
              transformSession.mesh.rotation.x = THREE.MathUtils.lerp(
                transformSession.mesh.rotation.x,
                targetRotationX,
                TRANSFORM_ROTATION_SMOOTHING
              );
            }
          }

          updateMeshMetadata(transformSession.mesh);
          updateGeometryMetrics(
            transformSession.mesh.userData.shape || shapeTypeEl.value,
            transformSession.mesh.userData.baseSize || sizeInputEl.value,
            transformSession.mesh
          );

          syncSelectionMarker(transformSession.mesh);
        }

      } else if (transformSession || rotationSession) {
        fistHoldStartAt = null;
        prevPlacementPulseActive = false;
        prevPinch = false;
      }

      if (!interaction.handsDetected) {
        if (placementPreview && placementPreview.shape !== "line") {
          disposePlacementPreview();
        }
        setIntent("waiting for hands", "idle");
      } else if (transformEndedThisFrame && thumbsUpRelease) {
        setIntent("ending transform", "ok");
      } else if (autoMode === "spawn") {
        if (placementPreview?.shape === "line" && thumbsDownPose) {
          setIntent("thumbs down to cancel the line", "idle");
        } else if (placementPreview?.shape === "line" && !lineUsesSuggestedPlacement()) {
          setIntent("move to the second point and pinch again to place the line", "idle");
        } else if (placementPreview && thumbsUpPose) {
          setIntent("thumbs up to place", "ok");
        } else if (placementPreview && thumbsDownPose) {
          setIntent("thumbs down to cancel", "idle");
        } else if (placementPreview) {
          setIntent("preview active: thumbs up to place, thumbs down to cancel", "idle");
        } else if (interaction.pinch && conjureCooldownActive) {
          setIntent("wait 2 seconds before conjuring another shape", "idle");
        } else if (signal === SIGNALS.FIST_DELETE) {
          setIntent("fist delete", "ok");
        } else if (primary && isFistPose(primary) && !deleteTarget) {
          setIntent("move closer to an object to delete", "idle");
        } else if (interaction.pinch) {
          setIntent(shapeTypeEl.value === "line" && !lineUsesSuggestedPlacement() ? "pinch to pick a line point" : "pinch to position preview", "ok");
        } else if (shapeTypeEl.value === "line") {
          setIntent(lineUsesSuggestedPlacement() ? "pinch to preview the guided line" : "pinch one point to start a line", "idle");
        } else {
          setIntent("ready to place", "idle");
        }
      } else if (transformSession && handCount >= 2) {
        if (transformSession.intent === "scale") {
          setIntent("resize locked", "ok");
        } else if (transformSession.intent === "rotate") {
          setIntent("rotation locked", "ok");
        } else {
          setIntent("resize normally or show the rotate pose", "ok");
        }
      } else if (transformSession) {
        setIntent("transform locked", "ok");
      } else if (handCount >= 2) {
        setIntent("frame an object with both hands to transform it", "idle");
      } else {
        setIntent("ready to place", "idle");
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
        smoothedPrimaryIndex = null;
        smoothedSecondaryPalm = null;
        transformMissingHandSince = null;
        overlayHandStates = [];
        pendingTransformCandidate = null;
        pendingTransformSince = null;
        if (placementPreview?.shape !== "line") {
          disposePlacementPreview();
        }
        if (!transformSession) rotationSession = null;
      } else if (!secondary) {
        smoothedSecondaryPalm = null;
        pendingTransformCandidate = null;
        pendingTransformSince = null;
      }

      appState.interaction.transformActive = Boolean(transformSession || rotationSession);
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
    clearDragIntent();
    endDragSession();
    transformSession = null;
    rotationSession = null;
    setActiveMesh(null);
    prevPinch = false;
    prevPlacementPulseActive = false;
    fistHoldStartAt = null;
    smoothedPalm = null;
    smoothedPinch = null;
    smoothedPrimaryIndex = null;
    smoothedSecondaryPalm = null;
    transformMissingHandSince = null;
    overlayHandStates = [];
    disposePlacementPreview();
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

  function applySidebarShapeColorToSelection() {
    if (placementPreview) {
      if (placementPreview.shape === "line" && shapeTypeEl.value !== "line") {
        disposePlacementPreview();
      } else {
        ensurePlacementPreview();
      }
    }
    if (!activeMesh) {
      refreshDebug();
      return;
    }
    applyMeshAppearance(activeMesh, shapeTypeEl.value, colorInputEl.value);
    renderObjectList();
    refreshDebug();
    setStatus(`Updated ${activeMesh.userData.label}`, "ok");
  }

  shapeTypeEl?.addEventListener("change", applySidebarShapeColorToSelection);
  colorInputEl?.addEventListener("input", applySidebarShapeColorToSelection);
  colorInputEl?.addEventListener("change", applySidebarShapeColorToSelection);

  objectListEl?.addEventListener("click", (event) => {
    if (event.target.closest("input")) return;
    const row = event.target.closest(".object-item[data-object-serial]");
    if (!row) return;
    const mesh = placedMeshes.find((item) => Number(item.userData?.objectSerial) === Number(row.dataset.objectSerial));
    if (!mesh) return;
    if (
      (transformSession?.mesh && transformSession.mesh !== mesh) ||
      (rotationSession?.mesh && rotationSession.mesh !== mesh)
    ) {
      transformSession = null;
      rotationSession = null;
      pendingTransformCandidate = null;
      pendingTransformSince = null;
      transformMissingHandSince = null;
    }
    setActiveMesh(mesh);
  });

  function syncObjectTransformInputs(target, objectSerial) {
    const row = target.closest(".object-item[data-object-serial]");
    if (!row) return;
    const mesh = findMeshBySerial(objectSerial);
    if (!mesh) return;
    row.querySelector('.transform-field[data-transform="position"][data-axis="x"]')?.setAttribute("value", meshPositionAxisValue(mesh, "x").toFixed(2));
    row.querySelector('.transform-field[data-transform="position"][data-axis="y"]')?.setAttribute("value", meshPositionAxisValue(mesh, "y").toFixed(2));
    row.querySelector('.transform-field[data-transform="position"][data-axis="z"]')?.setAttribute("value", meshPositionAxisValue(mesh, "z").toFixed(2));
    row.querySelector('.transform-field[data-transform="rotation"][data-axis="x"]')?.setAttribute("value", normalizeRotationDegrees(meshRotationAxisDegrees(mesh, "x")).toFixed(0));
    row.querySelector('.transform-field[data-transform="rotation"][data-axis="y"]')?.setAttribute("value", normalizeRotationDegrees(meshRotationAxisDegrees(mesh, "y")).toFixed(0));
    row.querySelector('.transform-field[data-transform="rotation"][data-axis="z"]')?.setAttribute("value", normalizeRotationDegrees(meshRotationAxisDegrees(mesh, "z")).toFixed(0));
    row.querySelectorAll(".transform-field").forEach((input) => {
      const transform = input.dataset.transform;
      const axis = input.dataset.axis;
      if (transform === "position") input.value = meshPositionAxisValue(mesh, axis).toFixed(2);
      if (transform === "rotation") input.value = normalizeRotationDegrees(meshRotationAxisDegrees(mesh, axis)).toFixed(0);
    });
    const dimensions = dimensionFieldsForMesh(mesh);
    row.querySelectorAll(".dimension-field").forEach((input) => {
      const field = dimensions.find((candidate) => candidate.key === input.dataset.param);
      if (field) {
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = String(field.step);
        input.value = formatDimensionValue(field.value, field.decimals);
        row.querySelector(`.dimension-value[data-param-value="${field.key}"]`)?.replaceChildren(
          document.createTextNode(formatDimensionValue(field.value, field.decimals))
        );
      }
    });
  }

  objectListEl?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const objectSerial = target.dataset.objectSerial;
    if (!objectSerial) return;

    if (target.classList.contains("dimension-field")) {
      if (updateMeshParamValue(objectSerial, target.dataset.param || "", target.value) == null) return;
      syncObjectTransformInputs(target, objectSerial);
      return;
    }

    if (!target.classList.contains("transform-field")) return;
    const transform = target.dataset.transform;
    const axis = target.dataset.axis || "x";

    if (transform === "position") {
      if (updateMeshPositionAxisValue(objectSerial, axis, target.value) == null) return;
      syncObjectTransformInputs(target, objectSerial);
      return;
    }

    if (transform === "rotation") {
      if (updateMeshRotationAxisValue(objectSerial, axis, target.value) == null) return;
      syncObjectTransformInputs(target, objectSerial);
      return;
    }

  });

  objectListEl?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const objectSerial = target.dataset.objectSerial;
    if (!objectSerial) return;
    const mesh = findMeshBySerial(objectSerial);
    if (!mesh) return;
    setStatus(`Updated ${mesh.userData.label}`, "ok");
  });

  const stageCanvas = world.renderer?.domElement;

  stageCanvas?.addEventListener("pointerdown", (event) => {
    if (event.button === 2) {
      secondaryClickIntent = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      return;
    }
    if (event.button !== 0 || placementPreview) return;
    closeMousePlaceMenu();
    const hit = world.pickObject(event.clientX, event.clientY, placedMeshes);
    const mesh = hit?.object || null;
    if (!mesh) return;
    event.preventDefault();
    setActiveMesh(mesh);
    selectionRing.userData.pulseStartAt = performance.now();
    clearDragIntent();
    dragIntent = {
      mesh,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    stageCanvas.setPointerCapture?.(event.pointerId);
  });

  stageCanvas?.addEventListener("pointermove", (event) => {
    if (secondaryClickIntent && event.pointerId === secondaryClickIntent.pointerId) {
      const moved = Math.hypot(event.clientX - secondaryClickIntent.startX, event.clientY - secondaryClickIntent.startY);
      if (moved >= 6) {
        secondaryClickIntent.moved = true;
      }
    }
    if (dragIntent && !dragSession && event.pointerId === dragIntent.pointerId) {
      const moved = Math.hypot(event.clientX - dragIntent.startX, event.clientY - dragIntent.startY);
      if (moved >= 5) {
        beginDragSession(dragIntent.mesh, event.clientX, event.clientY, event.pointerId);
      }
    }
    if (!dragSession || (dragSession.pointerId != null && event.pointerId !== dragSession.pointerId)) return;
    event.preventDefault();
    updateDragSession(event.clientX, event.clientY);
  });

  const finishPointerDrag = (event) => {
    if (dragIntent && event?.pointerId === dragIntent.pointerId) {
      clearDragIntent();
    }
    if (
      secondaryClickIntent &&
      event?.pointerId === secondaryClickIntent.pointerId &&
      (event.type === "pointercancel" || event.button !== 2)
    ) {
      secondaryClickIntent = null;
    }
    if (!dragSession || (event?.pointerId != null && dragSession.pointerId != null && event.pointerId !== dragSession.pointerId)) {
      if (event?.pointerId != null) stageCanvas?.releasePointerCapture?.(event.pointerId);
      return;
    }
    stageCanvas?.releasePointerCapture?.(dragSession.pointerId);
    endDragSession();
  };

  stageCanvas?.addEventListener("pointerup", finishPointerDrag);
  stageCanvas?.addEventListener("pointercancel", finishPointerDrag);

  // Mouse wheel scaling with Alt+scroll
  stageCanvas?.addEventListener("wheel", (event) => {
    if (!event.altKey || !activeMesh || !placedMeshes.includes(activeMesh)) return;
    event.preventDefault();

    const scaleFactor = event.deltaY > 0 ? 0.95 : 1.05; // Zoom out shrinks, zoom in grows
    scaleMeshSceneObject(activeMesh, scaleFactor, "wheel-scale");

    syncSelectionMarker(activeMesh);
    updateMeshMetadata(activeMesh);
    updateGeometryMetrics(activeMesh.userData.shape || shapeTypeEl.value, activeMesh.userData.baseSize || 1, activeMesh);
    setStatus(`Scaled to ${(activeMesh.userData.baseSize || 1).toFixed(2)}`, "ok");
  });
  stageCanvas?.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const stationaryClick = Boolean(
      secondaryClickIntent &&
      !secondaryClickIntent.moved &&
      (event.pointerId == null || secondaryClickIntent.pointerId === event.pointerId)
    );
    secondaryClickIntent = null;
    if (!stationaryClick) {
      closeMousePlaceMenu();
      return;
    }
    const hit = world.pickObject(event.clientX, event.clientY, placedMeshes);
    if (hit?.object) {
      closeMousePlaceMenu();
      setActiveMesh(hit.object);
      sceneEventTarget.dispatchEvent(new CustomEvent("object-contextmenu", {
        detail: {
          objectId: hit.object.userData?.sceneObjectId || null,
          mesh: hit.object,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      }));
      return;
    }
    openMousePlaceMenu(event.clientX, event.clientY);
  });

  mousePlaceActionEl?.addEventListener("click", () => {
    if (!mousePlaceContext) return;
    placeShapeFromMouse(mousePlaceContext.clientX, mousePlaceContext.clientY);
    closeMousePlaceMenu();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!mousePlaceContext) return;
    if (mousePlaceMenuEl?.contains(event.target)) return;
    closeMousePlaceMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMousePlaceMenu();
      // Deselect current object
      if (activeMesh) {
        setActiveMesh(null);
      }
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      // Delete selected object
      if (activeMesh && placedMeshes.includes(activeMesh)) {
        event.preventDefault();
        removeMesh(activeMesh);
        setActiveMesh(null);
        setStatus("Object deleted", "ok");
        renderObjectList();
      }
    }
  });

  transformSnapModeEl.addEventListener("change", refreshDebug);
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

  sceneRuntime.on("objects", () => {
    refreshContainedObjectVisibility();
    renderObjectList();
    updateTutorFocusVisuals();
    refreshDebug();
  });

  refreshDebug();
  renderObjectList();
  setStatus("Ready. Start camera to begin.", "idle");
  setIntent("ready", "idle");

  const sceneApi = {
    snapshot: () => sceneRuntime.snapshot(),
    loadSnapshot: (snapshot, reason = "snapshot-load") => {
      disposeGuidedScenePreview();
      sceneRuntime.loadSnapshot(snapshot, reason);
      renderObjectList();
      updateTutorFocusVisuals();
      refreshDebug();
      return sceneRuntime.snapshot();
    },
    clearScene: () => {
      disposeGuidedScenePreview();
      clearTutorFocus();
      return clearAll();
    },
    addObject: (objectSpec, options = {}) => {
      const mesh = sceneRuntime.addObject(objectSpec, options);
      updateMeshMetadata(mesh);
      renderObjectList();
      updateTutorFocusVisuals();
      refreshDebug();
      return mesh;
    },
    addObjects: (objectSpecs, options = {}) => {
      const meshes = sceneRuntime.addObjects(objectSpecs, options);
      meshes.forEach((mesh) => updateMeshMetadata(mesh));
      renderObjectList();
      updateTutorFocusVisuals();
      refreshDebug();
      return meshes;
    },
    removeObject: (target) => {
      const mesh = sceneRuntime.getMesh(target);
      if (!mesh) return false;
      if (mesh === activeMesh) setActiveMesh(null);
      removeMesh(mesh);
      renderObjectList();
      updateTutorFocusVisuals();
      refreshDebug();
      return true;
    },
    selectObject: (target) => {
      const mesh = sceneRuntime.getMesh(target);
      setActiveMesh(mesh || null);
      return mesh;
    },
    getObject: (target) => sceneRuntime.getObject(target),
    getMesh: (target) => sceneRuntime.getMesh(target),
    getSelection: () => sceneRuntime.getSelection(),
    previewAction: (action) => previewSceneAction(action),
    confirmPreviewAction: () => confirmGuidedScenePreview(),
    cancelPreviewAction: () => cancelGuidedScenePreview(),
    focusObjects: (targetIds, options = {}) => focusSceneObjects(targetIds, options),
    clearFocus: () => clearTutorFocus(),
    resetView: onResetView,
    onSceneChange: (handler) => sceneRuntime.on("change", () => handler(sceneRuntime.snapshot())),
    onSceneEvent: (handler) => sceneRuntime.on("change", handler),
    onSelectionChange: (handler) => {
      const listener = (event) => handler(event.detail);
      sceneEventTarget.addEventListener("selection", listener);
      return () => sceneEventTarget.removeEventListener("selection", listener);
    },
    onObjectContextMenu: (handler) => {
      const listener = (event) => handler(event.detail);
      sceneEventTarget.addEventListener("object-contextmenu", listener);
      return () => sceneEventTarget.removeEventListener("object-contextmenu", listener);
    },
  };

  return { world, sceneRuntime, sceneApi };
}
