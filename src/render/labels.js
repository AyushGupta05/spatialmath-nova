/**
 * Labels: 3D text labels and dimension lines for the scene.
 * Uses CSS2DRenderer from Three.js for crisp, always-facing text.
 */

import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

let labelRenderer = null;
const labelObjects = [];
const dimensionGroups = [];

/**
 * Initialize the CSS2D label renderer.
 * Must be called after world creation, passing the same container.
 */
export function initLabelRenderer(container) {
  if (labelRenderer) return labelRenderer;

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  labelRenderer.domElement.classList.add("label-renderer");
  container.appendChild(labelRenderer.domElement);

  // Handle resize
  const observer = new ResizeObserver(() => {
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
  });
  observer.observe(container);

  return labelRenderer;
}

/**
 * Render labels (call this in the animation loop).
 */
export function renderLabels(scene, camera) {
  if (labelRenderer) {
    labelRenderer.render(scene, camera);
  }
}

/**
 * Add a text label to the scene at a given position.
 * @param {THREE.Scene} scene
 * @param {string} text
 * @param {number[]} position - [x, y, z]
 * @param {string} style - "dimension" | "name" | "formula" | "annotation"
 * @returns {CSS2DObject}
 */
export function addLabel(scene, text, position, style = "dimension") {
  const div = document.createElement("div");
  div.className = `scene-label scene-label--${style}`;
  div.textContent = text;

  const label = new CSS2DObject(div);
  label.position.set(position[0], position[1], position[2]);
  label.userData.isLabel = true;
  scene.add(label);
  labelObjects.push(label);
  return label;
}

/**
 * Add labels from a SceneSpec to the scene.
 * @param {THREE.Scene} scene
 * @param {object} sceneSpec - validated SceneSpec
 * @param {Map<string, THREE.Mesh>} meshes - object ID -> mesh map
 */
export function addLabelsFromSpec(scene, sceneSpec, meshes) {
  // Add object labels
  for (const labelDef of sceneSpec.labels || []) {
    const parentMesh = meshes.get(labelDef.attachTo);
    if (!parentMesh) continue;

    const worldPos = new THREE.Vector3();
    parentMesh.getWorldPosition(worldPos);

    const pos = [
      worldPos.x + labelDef.offset[0],
      worldPos.y + labelDef.offset[1],
      worldPos.z + labelDef.offset[2],
    ];

    addLabel(scene, labelDef.text, pos, labelDef.style);
  }

  // Add dimension lines
  for (const dim of sceneSpec.dimensions || []) {
    addDimensionLine(scene, dim.from, dim.to, dim.label, dim.color);
  }
}

/**
 * Add a dimension line with a midpoint label.
 */
export function addDimensionLine(scene, from, to, text, color = "#ffffff") {
  const group = new THREE.Group();
  group.userData.isDimensionGroup = true;

  // Line geometry
  const points = [
    new THREE.Vector3(from[0], from[1], from[2]),
    new THREE.Vector3(to[0], to[1], to[2]),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 10;
  group.add(line);

  // End markers (small spheres)
  const markerGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const markerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), depthTest: false });
  const startMarker = new THREE.Mesh(markerGeo, markerMat);
  startMarker.position.copy(points[0]);
  startMarker.renderOrder = 11;
  group.add(startMarker);

  const endMarker = new THREE.Mesh(markerGeo.clone(), markerMat.clone());
  endMarker.position.copy(points[1]);
  endMarker.renderOrder = 11;
  group.add(endMarker);

  // Midpoint label
  const midpoint = points[0].clone().lerp(points[1], 0.5);
  // Offset label slightly above the line
  midpoint.y += 0.3;

  const div = document.createElement("div");
  div.className = "scene-label scene-label--dimension";
  div.textContent = text;

  const labelObj = new CSS2DObject(div);
  labelObj.position.copy(midpoint);
  labelObj.userData.isLabel = true;
  group.add(labelObj);

  scene.add(group);
  dimensionGroups.push(group);
  labelObjects.push(labelObj);

  return group;
}

/**
 * Remove all labels and dimension lines from the scene.
 */
export function clearLabels(scene) {
  for (const label of labelObjects) {
    if (label.parent) label.parent.remove(label);
    if (label.element) label.element.remove();
  }
  labelObjects.length = 0;

  for (const group of dimensionGroups) {
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
      if (child.element) child.element.remove();
    });
    scene.remove(group);
  }
  dimensionGroups.length = 0;
}

/**
 * Get the label renderer (for external resize handling).
 */
export function getLabelRenderer() {
  return labelRenderer;
}
