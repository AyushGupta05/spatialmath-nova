/**
 * SceneBuilder: Converts a validated SceneSpec into Three.js meshes
 * and adds them to the world scene.
 *
 * Reuses the existing world.buildMesh() and world.buildLineMesh() APIs.
 */

import * as THREE from "three";
import { validateSceneSpec, sceneParamsToMeshSize } from "./schemas.js";

/**
 * Build and add all objects from a SceneSpec to the Three.js scene.
 *
 * @param {object} sceneSpec - A SceneSpec object (will be validated)
 * @param {object} world - The world object from createWorld()
 * @param {object} options
 * @param {function} options.onMeshCreated - Called for each mesh: (mesh, objectSpec) => void
 * @param {boolean} options.clearFirst - Whether to clear existing scene objects first
 * @returns {{ meshes: Map<string, THREE.Mesh>, spec: object }}
 */
export function buildSceneFromSpec(sceneSpec, world, options = {}) {
  const spec = validateSceneSpec(sceneSpec);
  const meshes = new Map();

  for (const obj of spec.objects) {
    const mesh = createMeshFromObjectSpec(obj, world);
    if (mesh) {
      world.scene.add(mesh);
      meshes.set(obj.id, mesh);
      if (options.onMeshCreated) {
        options.onMeshCreated(mesh, obj);
      }
    }
  }

  return { meshes, spec };
}

/**
 * Create a single Three.js mesh from a SceneSpec object definition.
 */
function createMeshFromObjectSpec(obj, world) {
  const { shape, params, position, rotation, color, highlight, id } = obj;

  let mesh;

  if (shape === "line") {
    const start = new THREE.Vector3(...(params.start || [0, 0, 0]));
    const end = new THREE.Vector3(...(params.end || [1, 0, 0]));
    mesh = world.buildLineMesh(start, end, 1, color);
    mesh.userData.lineStart = params.start;
    mesh.userData.lineEnd = params.end;
  } else if (shape === "cone") {
    // Cone isn't in the original world.buildMesh, create directly
    const r = params.radius || 1;
    const h = params.height || 2;
    const geometry = new THREE.ConeGeometry(r, h, 24);
    const tone = new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.24,
      metalness: 0.08,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.9,
    });
    mesh = new THREE.Mesh(geometry, material);
    // Position so bottom touches ground if position.y not specified
    mesh.position.set(position[0], position[1] || h / 2, position[2]);
  } else if (shape === "cuboid" && params.width && params.height && params.depth) {
    // For cuboid with exact dimensions, build geometry directly
    // instead of using world.buildMesh which applies scaling factors
    const geometry = new THREE.BoxGeometry(params.width, params.height, params.depth);
    const tone = new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.24,
      metalness: 0.08,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.9,
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1] || params.height / 2, position[2]);
  } else if (shape === "sphere" && params.radius) {
    // Build sphere with exact radius
    const geometry = new THREE.SphereGeometry(params.radius, 28, 20);
    const tone = new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.24,
      metalness: 0.08,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.9,
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1] || params.radius, position[2]);
  } else if (shape === "cylinder" && params.radius && params.height) {
    // Build cylinder with exact dimensions
    const geometry = new THREE.CylinderGeometry(params.radius, params.radius, params.height, 24);
    const tone = new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.24,
      metalness: 0.08,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.9,
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1] || params.height / 2, position[2]);
  } else if (shape === "pyramid" && params.base && params.height) {
    // Build square pyramid with exact dimensions
    const geometry = new THREE.ConeGeometry(params.base / Math.sqrt(2), params.height, 4);
    const tone = new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.24,
      metalness: 0.08,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.9,
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1] || params.height / 2, position[2]);
  } else if (shape === "plane" && params.width && params.depth) {
    // Build plane with exact dimensions
    const geometry = new THREE.PlaneGeometry(params.width, params.depth);
    const tone = new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.24,
      metalness: 0.08,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    mesh.position.set(position[0], position[1] || 0, position[2]);
  } else {
    // Use the standard buildMesh for cube and fallback
    const size = sceneParamsToMeshSize(shape, params);
    mesh = world.buildMesh(shape === "cone" ? "cylinder" : shape, size, color);
    mesh.position.set(position[0], position[1], position[2]);
  }

  // Apply rotation
  if (rotation) {
    mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  }

  // Store metadata
  mesh.userData.sceneObjectId = id;
  mesh.userData.shape = shape;
  mesh.userData.label = id;
  mesh.userData.baseSize = getBaseSize(shape, params);
  mesh.userData.floorLocked = true;
  mesh.userData.fromSceneSpec = true;

  // Compute bounding info
  const bbox = new THREE.Box3().setFromObject(mesh);
  mesh.userData.selectionRadius = Math.max(
    (bbox.max.x - bbox.min.x) / 2,
    (bbox.max.z - bbox.min.z) / 2,
    0.3
  );

  // Highlight effect
  if (highlight) {
    mesh.material.emissive = new THREE.Color(0x2ccbd3);
    mesh.material.emissiveIntensity = 0.6;
  }

  return mesh;
}

/**
 * Get a reasonable base size for display purposes.
 */
function getBaseSize(shape, params) {
  switch (shape) {
    case "cube": return params.size || 1;
    case "sphere": return (params.radius || 1) * 2;
    case "cylinder": return Math.max(params.radius || 1, (params.height || 2) / 2);
    case "cone": return Math.max(params.radius || 1, (params.height || 2) / 2);
    case "cuboid": return Math.max(params.width || 1, params.height || 1, params.depth || 1);
    default: return params.size || 1;
  }
}

/**
 * Remove all scene-spec-generated meshes from the scene.
 */
export function clearSceneSpecMeshes(world, meshes) {
  if (!meshes) return;
  for (const [, mesh] of meshes) {
    world.scene.remove(mesh);
    mesh.geometry?.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  }
  meshes.clear();
}

/**
 * Highlight specific objects in the scene by their IDs.
 * @param {Map<string, THREE.Mesh>} meshes - All scene meshes
 * @param {string[]} objectIds - IDs to highlight
 */
export function highlightObjects(meshes, objectIds) {
  for (const [id, mesh] of meshes) {
    if (objectIds.includes(id)) {
      mesh.userData.baseEmissive = mesh.material.emissive.getHex();
      mesh.material.emissive.setHex(0x2ccbd3);
      mesh.material.emissiveIntensity = 0.7;
      mesh.material.opacity = 1.0;
    } else {
      if (mesh.userData.baseEmissive !== undefined) {
        mesh.material.emissive.setHex(mesh.userData.baseEmissive);
      }
      mesh.material.emissiveIntensity = 0.38;
      mesh.material.opacity = 0.6;
    }
  }
}

/**
 * Reset all meshes to default appearance.
 */
export function resetHighlights(meshes) {
  for (const [, mesh] of meshes) {
    if (mesh.userData.baseEmissive !== undefined) {
      mesh.material.emissive.setHex(mesh.userData.baseEmissive);
    }
    mesh.material.emissiveIntensity = 0.38;
    mesh.material.opacity = 0.9;
  }
}
