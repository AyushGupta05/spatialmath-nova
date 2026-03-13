import * as THREE from "three";
import {
  defaultPositionForShape,
  distanceBetween,
  normalizeSceneObject,
  paramsToBaseSize,
} from "./schema.js";

function buildMaterial(color, opacity = 0.9) {
  const tone = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    color: tone,
    roughness: 0.24,
    metalness: 0.08,
    emissive: tone.clone().multiplyScalar(0.12),
    emissiveIntensity: 0.38,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
  });
}

function lineRadius(thickness = 0.08) {
  return Math.max(0.025, Number(thickness || 0.08) * 0.5);
}

function buildLineMesh(world, params, color) {
  const start = new THREE.Vector3(...params.start);
  const end = new THREE.Vector3(...params.end);
  if (typeof world?.buildLineMesh === "function") {
    return world.buildLineMesh(start, end, Math.max(params.thickness || 0.08, distanceBetween(params.start, params.end)), color);
  }
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(lineRadius(params.thickness), lineRadius(params.thickness), 0.02, 18),
    buildMaterial(color)
  );
  applyLineGeometry(world, mesh, params);
  return mesh;
}

function applyLineGeometry(world, mesh, params) {
  const start = new THREE.Vector3(...params.start);
  const end = new THREE.Vector3(...params.end);
  const thickness = params.thickness || 0.08;
  if (typeof world?.updateLineMesh === "function") {
    world.updateLineMesh(mesh, start, end, Math.max(thickness, distanceBetween(params.start, params.end)));
    return;
  }
  const delta = end.clone().sub(start);
  const length = Math.max(0.02, delta.length());
  const radius = lineRadius(thickness);
  const midpoint = start.clone().lerp(end, 0.5);
  const direction = delta.normalize();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 18);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  mesh.geometry?.dispose?.();
  mesh.geometry = geometry;
  mesh.position.copy(midpoint);
  mesh.quaternion.copy(quaternion);
}

export function buildMeshFromSceneObject(world, objectSpec) {
  const spec = normalizeSceneObject(objectSpec);
  const mesh = createMeshForShape(world, spec);
  applySceneObjectToMesh(world, mesh, spec);
  return mesh;
}

function createMeshForShape(world, spec) {
  switch (spec.shape) {
    case "cube":
      return new THREE.Mesh(new THREE.BoxGeometry(spec.params.size, spec.params.size, spec.params.size), buildMaterial(spec.color));
    case "cuboid":
      return new THREE.Mesh(new THREE.BoxGeometry(spec.params.width, spec.params.height, spec.params.depth), buildMaterial(spec.color));
    case "sphere":
      return new THREE.Mesh(new THREE.SphereGeometry(spec.params.radius, 28, 20), buildMaterial(spec.color));
    case "cylinder":
      return new THREE.Mesh(new THREE.CylinderGeometry(spec.params.radius, spec.params.radius, spec.params.height, 32), buildMaterial(spec.color));
    case "cone":
      return new THREE.Mesh(new THREE.ConeGeometry(spec.params.radius, spec.params.height, 32), buildMaterial(spec.color));
    case "pyramid":
      return new THREE.Mesh(new THREE.ConeGeometry(spec.params.base / Math.sqrt(2), spec.params.height, 4), buildMaterial(spec.color));
    case "plane":
      return new THREE.Mesh(new THREE.PlaneGeometry(spec.params.width, spec.params.depth), buildMaterial(spec.color, 0.72));
    case "pointMarker":
      return new THREE.Mesh(new THREE.SphereGeometry(spec.params.radius, 16, 12), buildMaterial(spec.color));
    case "line":
      return buildLineMesh(world, spec.params, spec.color);
    default:
      return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), buildMaterial(spec.color));
  }
}

export function applySceneObjectToMesh(world, mesh, objectSpec) {
  const spec = normalizeSceneObject(objectSpec);

  if (spec.shape === "line") {
    applyLineGeometry(world, mesh, spec.params);
  } else {
    const next = createMeshForShape(world, spec);
    const oldGeometry = mesh.geometry;
    const oldMaterial = mesh.material;
    mesh.geometry = next.geometry;
    mesh.material = next.material;
    oldGeometry?.dispose?.();
    oldMaterial?.dispose?.();
  }

  if (spec.shape !== "line") {
    const position = spec.position || defaultPositionForShape(spec.shape, spec.params);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
    mesh.scale.set(1, 1, 1);

    if (spec.shape === "plane") {
      mesh.rotation.x = -Math.PI / 2 + spec.rotation[0];
    }
  } else {
    mesh.scale.set(1, 1, 1);
  }

  mesh.userData.sceneObjectId = spec.id || mesh.userData.sceneObjectId || null;
  mesh.userData.label = spec.label || mesh.userData.label || null;
  mesh.userData.shape = spec.shape;
  mesh.userData.sceneParams = structuredClone(spec.params);
  mesh.userData.sceneMetadata = { ...spec.metadata };
  mesh.userData.baseSize = paramsToBaseSize(spec.shape, spec.params);
  mesh.userData.floorLocked = spec.shape !== "line" && spec.shape !== "plane";
  if (spec.shape === "line") {
    mesh.userData.lineStart = [...spec.params.start];
    mesh.userData.lineEnd = [...spec.params.end];
  }

  mesh.geometry.computeBoundingBox?.();
  const bbox = new THREE.Box3().setFromObject(mesh);
  mesh.userData.selectionRadius = Math.max(
    (bbox.max.x - bbox.min.x) * 0.5,
    (bbox.max.z - bbox.min.z) * 0.5,
    0.3
  );

  return mesh;
}

function rotationFromMesh(mesh) {
  if (mesh?.userData?.shape === "plane") {
    return [mesh.rotation.x + Math.PI / 2, mesh.rotation.y, mesh.rotation.z];
  }
  return [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
}

function paramsFromBounds(shape, mesh) {
  const bbox = new THREE.Box3().setFromObject(mesh);
  const width = Math.max(0.001, bbox.max.x - bbox.min.x);
  const height = Math.max(0.001, bbox.max.y - bbox.min.y);
  const depth = Math.max(0.001, bbox.max.z - bbox.min.z);

  switch (shape) {
    case "cube":
      return { size: Math.max(width, height, depth) };
    case "cuboid":
      return { width, height, depth };
    case "sphere":
      return { radius: Math.max(width, height, depth) * 0.5 };
    case "cylinder":
      return { radius: Math.max(width, depth) * 0.5, height };
    case "cone":
      return { radius: Math.max(width, depth) * 0.5, height };
    case "pyramid":
      return { base: Math.max(width, depth), height };
    case "plane":
      return { width, depth };
    case "pointMarker":
      return { radius: Math.max(width, height, depth) * 0.5 };
    default:
      return mesh.userData.sceneParams ? structuredClone(mesh.userData.sceneParams) : {};
  }
}

export function sceneParamsFromMesh(mesh) {
  const shape = mesh?.userData?.shape || "cube";
  const storedParams = mesh?.userData?.sceneParams;
  if (storedParams && typeof storedParams === "object") {
    if (shape === "line") {
      return {
        ...structuredClone(storedParams),
        start: Array.isArray(mesh.userData?.lineStart) ? [...mesh.userData.lineStart] : [...storedParams.start],
        end: Array.isArray(mesh.userData?.lineEnd) ? [...mesh.userData.lineEnd] : [...storedParams.end],
      };
    }
    return structuredClone(storedParams);
  }

  const bounds = new THREE.Box3().setFromObject(mesh);
  const inferredThickness = Math.max(
    0.05,
    Math.min(
      Math.max(0.001, bounds.max.x - bounds.min.x),
      Math.max(0.001, bounds.max.z - bounds.min.z)
    )
  );

  if (shape === "line") {
    return {
      start: Array.isArray(mesh.userData?.lineStart) ? [...mesh.userData.lineStart] : [0, 0.03, 0],
      end: Array.isArray(mesh.userData?.lineEnd) ? [...mesh.userData.lineEnd] : [1, 0.03, 0],
      thickness: inferredThickness,
    };
  }

  return paramsFromBounds(shape, mesh);
}

export function sceneObjectFromMesh(mesh) {
  const shape = mesh?.userData?.shape || "cube";
  const params = sceneParamsFromMesh(mesh);

  return normalizeSceneObject({
    id: mesh?.userData?.sceneObjectId || null,
    label: mesh?.userData?.label || null,
    shape,
    color: mesh?.material?.color ? `#${mesh.material.color.getHexString()}` : "#7cf7e4",
    position: mesh?.position?.toArray?.() || defaultPositionForShape(shape, params),
    rotation: rotationFromMesh(mesh),
    params,
    metadata: mesh?.userData?.sceneMetadata || {},
  });
}

export function disposeSceneMesh(world, mesh) {
  if (!mesh) return;
  world?.scene?.remove?.(mesh);
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material?.dispose?.());
  } else {
    mesh.material?.dispose?.();
  }
}
