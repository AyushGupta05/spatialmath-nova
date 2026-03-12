import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createWorld(container) {
  const DEFAULT_CAMERA_POS = new THREE.Vector3(16, 10.5, -16);
  const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020815);
  // Keep distant grid readable while zooming far out.
  scene.fog = null;

  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 1000000);
  // Start at bottom-right quadrant view.
  camera.position.copy(DEFAULT_CAMERA_POS);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x020815, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.9;
  controls.rotateSpeed = 0.8;
  controls.minDistance = 2;
  // effectively unbounded zoom-out
  controls.maxDistance = 1e12;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI - 0.08;
  controls.zoomSpeed = 1.0;
  controls.target.copy(DEFAULT_TARGET);
  controls.maxTargetRadius = 1e12;
  controls.update();

  function setNavigationMode(mode = "blender") {
    // OrbitControls with Blender-style mouse bindings.
    if (mode === "blender") {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      return;
    }

    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
  }

  // default to blender-like navigation
  setNavigationMode("blender");

  scene.add(new THREE.HemisphereLight(0xf1ffff, 0x071320, 1.2));

  const keyLight = new THREE.DirectionalLight(0x90fff2, 1.15);
  keyLight.position.set(7, 12, 9);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x4da5ff, 0.42);
  fillLight.position.set(-8, 8, -5);
  scene.add(fillLight);

  const rimLight = new THREE.PointLight(0x7cf7e4, 0.55, 36, 2);
  rimLight.position.set(0, 7, 0);
  scene.add(rimLight);

  const fineGrid = new THREE.GridHelper(720, 288, 0x2b4d79, 0x2b4d79);
  fineGrid.position.y = 0.001;
  const fineMaterials = Array.isArray(fineGrid.material) ? fineGrid.material : [fineGrid.material];
  fineMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.17;
  });
  scene.add(fineGrid);

  const majorGrid = new THREE.GridHelper(720, 72, 0x92d8ff, 0x4b8fff);
  majorGrid.position.y = 0.002;
  const majorMaterials = Array.isArray(majorGrid.material) ? majorGrid.material : [majorGrid.material];
  majorMaterials.forEach((material, index) => {
    material.transparent = true;
    material.opacity = index === 0 ? 0.42 : 0.28;
  });
  scene.add(majorGrid);

  // Far-distance grid layers so zooming out reveals more lines instead of fading out.
  const farGridA = new THREE.GridHelper(2400, 240, 0x5a9fd6, 0x376391);
  farGridA.position.y = 0.0005;
  const farGridAMaterials = Array.isArray(farGridA.material) ? farGridA.material : [farGridA.material];
  farGridAMaterials.forEach((material, index) => {
    material.transparent = true;
    material.opacity = index === 0 ? 0.42 : 0.24;
  });
  scene.add(farGridA);

  const farGridB = new THREE.GridHelper(12000, 480, 0x4f88bf, 0x2a4c74);
  farGridB.position.y = 0.0002;
  const farGridBMaterials = Array.isArray(farGridB.material) ? farGridB.material : [farGridB.material];
  farGridBMaterials.forEach((material, index) => {
    material.transparent = true;
    material.opacity = index === 0 ? 0.36 : 0.2;
  });
  scene.add(farGridB);

  const stagePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshBasicMaterial({
      color: 0x06111f,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
    })
  );
  stagePlane.rotation.x = -Math.PI / 2;
  stagePlane.position.y = -0.006;
  stagePlane.renderOrder = -1;
  stagePlane.material.depthWrite = false;
  scene.add(stagePlane);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const placementPlane = new THREE.Plane();
  const lineUp = new THREE.Vector3(0, 1, 0);
  const cameraForward = new THREE.Vector3();

  function buildMaterial(color) {
    const tone = new THREE.Color(color);
    return new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.24,
      metalness: 0.08,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.9,
    });
  }

  function lineRadius(size = 1) {
    return Math.max(0.035, Number(size || 1) * 0.09);
  }

  function normalizeLineEndpoints(start, end) {
    const from = start.clone();
    const to = end.clone();
    if (from.distanceTo(to) < 0.02) {
      to.x += 0.02;
    }
    return { from, to };
  }

  function applyLineTransform(mesh, start, end, size = 1) {
    const { from, to } = normalizeLineEndpoints(start, end);
    const delta = to.clone().sub(from);
    const length = Math.max(0.02, delta.length());
    const radius = lineRadius(size);
    const nextGeometry = new THREE.CylinderGeometry(radius, radius, length, 18);
    const midpoint = from.clone().lerp(to, 0.5);
    const direction = delta.normalize();
    const nextQuaternion = new THREE.Quaternion().setFromUnitVectors(lineUp, direction);

    mesh.geometry?.dispose?.();
    mesh.geometry = nextGeometry;
    mesh.position.copy(midpoint);
    mesh.quaternion.copy(nextQuaternion);
    mesh.userData.selectionRadius = Math.max(length * 0.5, radius * 5);
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function projectToGround(landmark) {
    ndc.set((1 - landmark.x) * 2 - 1, -(landmark.y * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    const ok = raycaster.ray.intersectPlane(groundPlane, hit);
    return ok ? hit : null;
  }

  function getViewTarget() {
    return controls.target.clone();
  }

  function projectToPlacement(landmark, anchorPoint = null) {
    ndc.set((1 - landmark.x) * 2 - 1, -(landmark.y * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    camera.getWorldDirection(cameraForward);

    if (Math.abs(cameraForward.y) > 0.72) {
      const hit = new THREE.Vector3();
      const ok = raycaster.ray.intersectPlane(groundPlane, hit);
      return ok ? { point: hit, floorLocked: true } : null;
    }

    const coplanarPoint = anchorPoint?.clone?.() || controls.target.clone();
    placementPlane.setFromNormalAndCoplanarPoint(cameraForward.clone().normalize(), coplanarPoint);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(placementPlane, hit)) {
      return { point: hit, floorLocked: false };
    }

    const fallback = new THREE.Vector3();
    const ok = raycaster.ray.intersectPlane(groundPlane, fallback);
    return ok ? { point: fallback, floorLocked: true } : null;
  }

  function pickObjectFromLandmark(landmark, objects = []) {
    ndc.set((1 - landmark.x) * 2 - 1, -(landmark.y * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const intersections = raycaster.intersectObjects(objects, false);
    return intersections[0] || null;
  }

  function setRayFromClient(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }

  function projectClientToPlane(clientX, clientY, plane) {
    const nextPlane = plane || groundPlane;
    setRayFromClient(clientX, clientY);
    const hit = new THREE.Vector3();
    const ok = raycaster.ray.intersectPlane(nextPlane, hit);
    return ok ? hit : null;
  }

  function projectClientToPlacement(clientX, clientY, anchorPoint = null) {
    setRayFromClient(clientX, clientY);
    camera.getWorldDirection(cameraForward);

    if (Math.abs(cameraForward.y) > 0.72) {
      const hit = new THREE.Vector3();
      const ok = raycaster.ray.intersectPlane(groundPlane, hit);
      return ok ? { point: hit, floorLocked: true } : null;
    }

    const coplanarPoint = anchorPoint?.clone?.() || controls.target.clone();
    placementPlane.setFromNormalAndCoplanarPoint(cameraForward.clone().normalize(), coplanarPoint);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(placementPlane, hit)) {
      return { point: hit, floorLocked: false };
    }

    const fallback = new THREE.Vector3();
    const ok = raycaster.ray.intersectPlane(groundPlane, fallback);
    return ok ? { point: fallback, floorLocked: true } : null;
  }

  function pickObject(clientX, clientY, objects = []) {
    setRayFromClient(clientX, clientY);
    const intersections = raycaster.intersectObjects(objects, false);
    return intersections[0] || null;
  }

  function setControlsEnabled(enabled) {
    controls.enabled = Boolean(enabled);
  }

  function buildMesh(type, size, color) {
    let geometry;
    switch (type) {
      case "line": geometry = new THREE.CylinderGeometry(lineRadius(size), lineRadius(size), Math.max(0.02, size), 18); break;
      case "cuboid": geometry = new THREE.BoxGeometry(size * 1.6, size, size * 0.9); break;
      case "sphere": geometry = new THREE.SphereGeometry(size * 0.6, 28, 20); break;
      case "cylinder": geometry = new THREE.CylinderGeometry(size * 0.45, size * 0.45, size * 1.4, 24); break;
      case "cone": geometry = new THREE.ConeGeometry(size * 0.5, size * 1.2, 32); break;
      case "pyramid": geometry = new THREE.ConeGeometry(size * 0.71, size, 4); break; // square pyramid
      case "plane": geometry = new THREE.PlaneGeometry(size * 2, size * 2); break;
      default: geometry = new THREE.BoxGeometry(size, size, size);
    }

    const material = buildMaterial(color);
    const mesh = new THREE.Mesh(geometry, material);
    const bbox = new THREE.Box3().setFromObject(mesh);
    const halfHeight = (bbox.max.y - bbox.min.y) / 2;
    mesh.position.y = halfHeight;
    return mesh;
  }

  function buildLineMesh(start, end, size, color) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(lineRadius(size), lineRadius(size), 0.02, 18),
      buildMaterial(color)
    );
    applyLineTransform(mesh, start, end, size);
    return mesh;
  }

  function updateLineMesh(mesh, start, end, size) {
    applyLineTransform(mesh, start, end, size);
    return mesh;
  }

  function createSelectionRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.34, 48),
      new THREE.MeshBasicMaterial({
        color: 0x7cf7e4,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
    );
    ring.renderOrder = 12;
    ring.visible = false;
    return ring;
  }

  function createRotationGuide() {
    const dir = new THREE.Vector3(1, 0, 0);
    const origin = new THREE.Vector3(0, 0, 0);
    const arrow = new THREE.ArrowHelper(dir, origin, 0.9, 0xffde72, 0.18, 0.11);
    arrow.visible = false;
    return arrow;
  }

  function createPalmProxy() {
    const group = new THREE.Group();

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.03, 24),
      new THREE.MeshStandardMaterial({ color: 0x3ac4ff, transparent: true, opacity: 0.82 })
    );
    disc.position.y = 0.03;

    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.3, 18),
      new THREE.MeshStandardMaterial({ color: 0x087dff, transparent: true, opacity: 0.92 })
    );
    pointer.rotation.x = Math.PI;
    pointer.position.set(0, 0.18, 0.2);

    group.add(disc, pointer);
    group.visible = false;
    return group;
  }

  function resetView() {
    camera.position.copy(DEFAULT_CAMERA_POS);
    controls.target.copy(DEFAULT_TARGET);
    camera.lookAt(DEFAULT_TARGET);
    controls.update();
  }

  function animate() {
    const dist = camera.position.distanceTo(controls.target);
    // Progressive grid density visibility by zoom distance.
    fineGrid.visible = dist < 280;
    majorGrid.visible = dist < 1400;
    farGridA.visible = dist > 120;
    farGridB.visible = dist > 700;

    // When camera goes below world, hide the stage plate so object components remain visible.
    stagePlane.visible = camera.position.y >= stagePlane.position.y;

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  window.addEventListener("resize", resize);
  resize();
  animate();

  return {
    scene,
    camera,
    controls,
    renderer,
    projectToGround,
    projectToPlacement,
    pickObjectFromLandmark,
    getViewTarget,
    projectClientToPlane,
    projectClientToPlacement,
    pickObject,
    buildMesh,
    buildLineMesh,
    updateLineMesh,
    createSelectionRing,
    createRotationGuide,
    createPalmProxy,
    setControlsEnabled,
    setNavigationMode,
    resetView,
  };
}
