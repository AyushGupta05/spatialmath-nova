import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createWorld(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a12);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 4.5, 8.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1.2, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dir = new THREE.DirectionalLight(0xffffff, 0.95);
  dir.position.set(5, 7, 3);
  scene.add(dir);

  scene.add(new THREE.GridHelper(18, 18, 0x335566, 0x223344));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshStandardMaterial({ color: 0x0b1320, metalness: 0.05, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

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

    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.46, metalness: 0.2 });
    const mesh = new THREE.Mesh(geometry, material);
    const bbox = new THREE.Box3().setFromObject(mesh);
    const halfHeight = (bbox.max.y - bbox.min.y) / 2;
    mesh.position.y = halfHeight;
    return mesh;
  }

  function createSelectionRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.34, 48),
      new THREE.MeshBasicMaterial({ color: 0x7df9d8, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    return ring;
  }

  function createRotationGuide() {
    const dir = new THREE.Vector3(1, 0, 0);
    const origin = new THREE.Vector3(0, 0.05, 0);
    const arrow = new THREE.ArrowHelper(dir, origin, 0.9, 0xffd166, 0.18, 0.11);
    arrow.visible = false;
    return arrow;
  }

  function createPalmProxy() {
    const group = new THREE.Group();

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.03, 24),
      new THREE.MeshStandardMaterial({ color: 0x7cc9ff, transparent: true, opacity: 0.8 })
    );
    disc.position.y = 0.03;

    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.3, 18),
      new THREE.MeshStandardMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 })
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
