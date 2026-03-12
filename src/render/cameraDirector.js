/**
 * CameraDirector: smooth camera animations for guided tutoring.
 * Operates on the Three.js camera and OrbitControls from world.js.
 */

import * as THREE from "three";

export class CameraDirector {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this._animating = false;
    this._animationId = null;
  }

  /**
   * Smoothly animate camera to a new position and target.
   * @param {number[]} position - [x, y, z] target camera position
   * @param {number[]} target - [x, y, z] look-at target
   * @param {number} durationMs - Animation duration in milliseconds
   * @returns {Promise} Resolves when animation completes
   */
  animateTo(position, target, durationMs = 1200) {
    return new Promise((resolve) => {
      // Cancel any ongoing animation
      this.cancel();

      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();
      const endPos = new THREE.Vector3(...position);
      const endTarget = new THREE.Vector3(...target);

      const startTime = performance.now();
      this._animating = true;

      const tick = (now) => {
        if (!this._animating) {
          resolve();
          return;
        }

        const elapsed = now - startTime;
        const rawT = Math.min(elapsed / durationMs, 1);
        // Ease-in-out cubic
        const t = rawT < 0.5
          ? 4 * rawT * rawT * rawT
          : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

        this.camera.position.lerpVectors(startPos, endPos, t);
        this.controls.target.lerpVectors(startTarget, endTarget, t);
        this.controls.update();

        if (rawT >= 1) {
          this._animating = false;
          resolve();
        } else {
          this._animationId = requestAnimationFrame(tick);
        }
      };

      this._animationId = requestAnimationFrame(tick);
    });
  }

  /**
   * Focus camera on a specific mesh with appropriate framing.
   * @param {THREE.Mesh} mesh - The mesh to focus on
   * @param {number} padding - Distance multiplier for framing
   */
  async focusOnObject(mesh, padding = 2.5) {
    const bbox = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * padding;

    // Position camera at 45-degree angle above and to the side
    const cameraPos = [
      center.x + dist * 0.7,
      center.y + dist * 0.5,
      center.z + dist * 0.7,
    ];

    await this.animateTo(cameraPos, [center.x, center.y, center.z]);
  }

  /**
   * Frame all objects in view.
   * @param {THREE.Mesh[]} meshes - Array of meshes to frame
   */
  async frameAll(meshes, padding = 2.0) {
    if (!meshes || meshes.length === 0) return;

    const bbox = new THREE.Box3();
    for (const mesh of meshes) {
      bbox.expandByObject(mesh);
    }

    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * padding;

    const cameraPos = [
      center.x + dist * 0.6,
      center.y + dist * 0.5,
      center.z + dist * 0.6,
    ];

    await this.animateTo(cameraPos, [center.x, center.y, center.z]);
  }

  /** Cancel any ongoing animation */
  cancel() {
    this._animating = false;
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
  }

  /** Whether an animation is currently running */
  get isAnimating() {
    return this._animating;
  }
}
