import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createWorld(container) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
  camera.position.set(10.5, 9.5, 10.5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0xffffff, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableRotate = true;
  controls.enablePan = false;
  controls.rotateSpeed = 0.8;
  controls.minDistance = 7;
  controls.maxDistance = 26;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.35;
  controls.zoomSpeed = 0.9;
  controls.target.set(0, 0, 0);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6ecff, 1.55));

  const keyLight = new THREE.DirectionalLight(0x8ed7ff, 1.05);
  keyLight.position.set(7, 12, 9);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
  fillLight.position.set(-8, 8, -5);
  scene.add(fillLight);

  const rimLight = new THREE.PointLight(0x72d9ff, 0.45, 30, 2);
  rimLight.position.set(0, 6, 0);
  scene.add(rimLight);

  const grid = new THREE.GridHelper(30, 12, 0x25bfff, 0x86ceff);
  grid.position.y = 0.001;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material, index) => {
    material.transparent = true;
    material.opacity = index === 0 ? 0.2 : 0.08;
  });
  scene.add(grid);

  const stageDisc = new THREE.Mesh(
    new THREE.CircleGeometry(10.5, 72),
    new THREE.MeshBasicMaterial({
      color: 0xb9e8ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    })
  );
  stageDisc.rotation.x = -Math.PI / 2;
  stageDisc.position.y = -0.002;
  scene.add(stageDisc);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

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

  function buildMesh(type, size, color) {
    let geometry;
    switch (type) {
      case "cuboid": geometry = new THREE.BoxGeometry(size * 1.6, size, size * 0.9); break;
      case "sphere": geometry = new THREE.SphereGeometry(size * 0.6, 28, 20); break;
      case "cylinder": geometry = new THREE.CylinderGeometry(size * 0.45, size * 0.45, size * 1.4, 24); break;
      default: geometry = new THREE.BoxGeometry(size, size, size);
    }

    const tone = new THREE.Color(color);
    const material = new THREE.MeshStandardMaterial({
      color: tone,
      roughness: 0.18,
      metalness: 0.12,
      emissive: tone.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.52,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const bbox = new THREE.Box3().setFromObject(mesh);
    const halfHeight = (bbox.max.y - bbox.min.y) / 2;
    mesh.position.y = halfHeight;
    return mesh;
  }

  function createSelectionRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.34, 48),
      new THREE.MeshBasicMaterial({ color: 0x10b7ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    return ring;
  }

  function createRotationGuide() {
    const dir = new THREE.Vector3(1, 0, 0);
    const origin = new THREE.Vector3(0, 0.05, 0);
    const arrow = new THREE.ArrowHelper(dir, origin, 0.9, 0x08a9ff, 0.18, 0.11);
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

  function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  window.addEventListener("resize", resize);
  resize();
  animate();

  return { scene, camera, renderer, projectToGround, buildMesh, createSelectionRing, createRotationGuide, createPalmProxy };
}
