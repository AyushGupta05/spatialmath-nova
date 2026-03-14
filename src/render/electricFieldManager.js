import * as THREE from "three";

const GOLD = new THREE.Color("#ffd966");
const CYAN = new THREE.Color("#48c9ff");
const MINT = new THREE.Color("#7cf7e4");

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function midpointForLine(objectSpec) {
  const start = objectSpec.params?.start || [0, 0, 0];
  const end = objectSpec.params?.end || [0, 0, 0];
  return [
    (Number(start[0]) + Number(end[0])) * 0.5,
    (Number(start[1]) + Number(end[1])) * 0.5,
    (Number(start[2]) + Number(end[2])) * 0.5,
  ];
}

function objectAnchor(objectSpec) {
  if (objectSpec.shape === "line") {
    return midpointForLine(objectSpec);
  }
  return objectSpec.position || [0, 0, 0];
}

export class ElectricFieldManager {
  constructor(world, sceneApi) {
    this.world = world;
    this.sceneApi = sceneApi;
    this.group = new THREE.Group();
    this.group.name = "electric-field-manager";
    this.world.scene.add(this.group);
    this.lastSignature = "";
    this.lastTime = performance.now();
    this.arrowLines = null;
    this.fluxLines = null;
    this.particles = null;
    this.particleStates = [];
  }

  collectPhysicsObjects() {
    const snapshot = this.sceneApi?.snapshot?.() || { objects: [] };
    const charges = [];
    const fluxSurfaces = [];

    for (const objectSpec of snapshot.objects || []) {
      const physics = objectSpec.metadata?.physics || null;
      if (!physics || typeof physics !== "object") continue;
      if (Number.isFinite(Number(physics.charge)) && Math.abs(Number(physics.charge)) > 0.01) {
        charges.push({
          id: objectSpec.id,
          position: new THREE.Vector3(...objectAnchor(objectSpec)),
          charge: Number(physics.charge),
          strength: Math.abs(Number(physics.strength || physics.charge || 1)),
          radius: Number(objectSpec.params?.radius || 0.42),
        });
      }
      if (physics.kind === "flux_surface") {
        fluxSurfaces.push({
          id: objectSpec.id,
          shape: objectSpec.shape,
          position: new THREE.Vector3(...objectAnchor(objectSpec)),
          radius: Number(physics.sampleRadius || objectSpec.params?.radius || 1.5),
        });
      }
    }

    return { charges, fluxSurfaces };
  }

  fieldAt(point, charges = []) {
    const total = new THREE.Vector3();
    for (const charge of charges) {
      const offset = point.clone().sub(charge.position);
      const distanceSq = Math.max(0.18, offset.lengthSq());
      if (distanceSq <= 0.18) continue;
      total.add(offset.normalize().multiplyScalar(charge.charge / distanceSq));
    }
    return total;
  }

  sceneBounds(charges = []) {
    if (!charges.length) {
      return { minX: -4, maxX: 4, minZ: -4, maxZ: 4, centerY: 1.1 };
    }
    const xs = charges.map((charge) => charge.position.x);
    const ys = charges.map((charge) => charge.position.y);
    const zs = charges.map((charge) => charge.position.z);
    return {
      minX: Math.min(...xs) - 3.8,
      maxX: Math.max(...xs) + 3.8,
      minZ: Math.min(...zs) - 3.8,
      maxZ: Math.max(...zs) + 3.8,
      centerY: ys.reduce((sum, value) => sum + value, 0) / Math.max(1, ys.length),
    };
  }

  rebuildArrowField(charges = []) {
    this.arrowLines?.geometry?.dispose?.();
    this.arrowLines?.material?.dispose?.();
    this.group.remove(this.arrowLines);
    this.arrowLines = null;

    if (!charges.length) return;

    const bounds = this.sceneBounds(charges);
    const positions = [];
    const colors = [];
    const sampleCount = 13;

    for (let xIndex = 0; xIndex < sampleCount; xIndex += 1) {
      for (let zIndex = 0; zIndex < sampleCount; zIndex += 1) {
        const x = THREE.MathUtils.lerp(bounds.minX, bounds.maxX, xIndex / (sampleCount - 1));
        const z = THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, zIndex / (sampleCount - 1));
        const origin = new THREE.Vector3(x, bounds.centerY, z);
        if (charges.some((charge) => charge.position.distanceTo(origin) < charge.radius + 0.45)) {
          continue;
        }

        const field = this.fieldAt(origin, charges);
        const magnitude = field.length();
        if (magnitude < 0.02) continue;
        const direction = field.normalize();
        const length = THREE.MathUtils.clamp(0.18 + (magnitude * 0.72), 0.2, 0.92);
        const tip = origin.clone().addScaledVector(direction, length);
        const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize().multiplyScalar(0.08);
        const backstep = direction.clone().multiplyScalar(0.18);
        const wingA = tip.clone().sub(backstep).add(side);
        const wingB = tip.clone().sub(backstep).sub(side);
        const color = GOLD.clone().lerp(MINT, THREE.MathUtils.clamp(magnitude * 0.18, 0, 0.75));

        positions.push(
          origin.x, origin.y, origin.z,
          tip.x, tip.y, tip.z,
          tip.x, tip.y, tip.z,
          wingA.x, wingA.y, wingA.z,
          tip.x, tip.y, tip.z,
          wingB.x, wingB.y, wingB.z,
        );
        for (let index = 0; index < 6; index += 1) {
          colors.push(color.r, color.g, color.b);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.86,
      vertexColors: true,
      depthWrite: false,
    });
    this.arrowLines = new THREE.LineSegments(geometry, material);
    this.arrowLines.renderOrder = 9;
    this.group.add(this.arrowLines);
  }

  rebuildFluxLines(charges = [], fluxSurfaces = []) {
    this.fluxLines?.geometry?.dispose?.();
    this.fluxLines?.material?.dispose?.();
    this.group.remove(this.fluxLines);
    this.fluxLines = null;

    if (!charges.length || !fluxSurfaces.length) return;

    const positions = [];
    const colors = [];

    fluxSurfaces.forEach((surface) => {
      if (surface.shape !== "sphere") return;
      const rings = 6;
      const segments = 10;
      for (let ring = 0; ring <= rings; ring += 1) {
        const v = ring / Math.max(1, rings);
        const phi = v * Math.PI;
        for (let segment = 0; segment < segments; segment += 1) {
          const u = segment / segments;
          const theta = u * Math.PI * 2;
          const normal = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.cos(phi),
            Math.sin(phi) * Math.sin(theta),
          ).normalize();
          const anchor = surface.position.clone().addScaledVector(normal, surface.radius);
          const field = this.fieldAt(anchor, charges);
          const strength = field.length();
          if (strength < 0.02) continue;
          const flow = field.clone().normalize().multiplyScalar(0.36 + Math.min(0.28, strength * 0.12));
          const start = anchor.clone().sub(flow.clone().multiplyScalar(0.3));
          const end = anchor.clone().add(flow);
          const color = field.dot(normal) >= 0 ? GOLD : CYAN;
          positions.push(
            start.x, start.y, start.z,
            end.x, end.y, end.z,
          );
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
    });

    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.72,
      vertexColors: true,
      depthWrite: false,
    });
    this.fluxLines = new THREE.LineSegments(geometry, material);
    this.fluxLines.renderOrder = 10;
    this.group.add(this.fluxLines);
  }

  respawnParticle(state, charges = [], bounds = this.sceneBounds(charges)) {
    const charge = charges[Math.floor(Math.random() * charges.length)] || null;
    if (!charge) {
      state.position.set(0, bounds.centerY, 0);
      state.life = 0;
      return;
    }

    const direction = new THREE.Vector3(
      (Math.random() * 2) - 1,
      (Math.random() * 2) - 1,
      (Math.random() * 2) - 1,
    ).normalize();
    const radius = charge.radius + 0.75 + (Math.random() * 1.6);
    state.position.copy(charge.position).addScaledVector(direction, radius);
    state.life = 0.8 + (Math.random() * 2.4);
  }

  rebuildParticles(charges = []) {
    this.particles?.geometry?.dispose?.();
    this.particles?.material?.dispose?.();
    this.group.remove(this.particles);
    this.particles = null;
    this.particleStates = [];

    if (!charges.length) return;

    const count = Math.min(72, Math.max(24, charges.length * 28));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const bounds = this.sceneBounds(charges);

    for (let index = 0; index < count; index += 1) {
      const state = {
        position: new THREE.Vector3(),
        life: 0,
      };
      this.respawnParticle(state, charges, bounds);
      positions[(index * 3) + 0] = state.position.x;
      positions[(index * 3) + 1] = state.position.y;
      positions[(index * 3) + 2] = state.position.z;
      colors[(index * 3) + 0] = CYAN.r;
      colors[(index * 3) + 1] = CYAN.g;
      colors[(index * 3) + 2] = CYAN.b;
      this.particleStates.push(state);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.12,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geometry, material);
    this.particles.renderOrder = 11;
    this.group.add(this.particles);
  }

  rebuildVisuals(charges = [], fluxSurfaces = []) {
    this.rebuildArrowField(charges);
    this.rebuildFluxLines(charges, fluxSurfaces);
    this.rebuildParticles(charges);
  }

  updateParticles(dt, charges = []) {
    if (!this.particles || !this.particleStates.length || !charges.length) return;
    const bounds = this.sceneBounds(charges);
    const positions = this.particles.geometry.attributes.position.array;

    this.particleStates.forEach((state, index) => {
      state.life -= dt;
      const field = this.fieldAt(state.position, charges);
      const tooFar = (
        state.position.x < bounds.minX - 1
        || state.position.x > bounds.maxX + 1
        || state.position.z < bounds.minZ - 1
        || state.position.z > bounds.maxZ + 1
      );

      if (state.life <= 0 || tooFar || field.lengthSq() < 0.0004) {
        this.respawnParticle(state, charges, bounds);
      } else {
        const electronDrift = field.normalize().multiplyScalar(-dt * 1.35);
        state.position.add(electronDrift);
      }

      positions[(index * 3) + 0] = state.position.x;
      positions[(index * 3) + 1] = state.position.y;
      positions[(index * 3) + 2] = state.position.z;
    });

    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  update(now = performance.now()) {
    const { charges, fluxSurfaces } = this.collectPhysicsObjects();
    const signature = [
      ...charges.map((charge) => `${charge.id}:${rounded(charge.position.x)}:${rounded(charge.position.y)}:${rounded(charge.position.z)}:${rounded(charge.charge)}`),
      ...fluxSurfaces.map((surface) => `${surface.id}:${rounded(surface.position.x)}:${rounded(surface.position.y)}:${rounded(surface.position.z)}:${rounded(surface.radius)}`),
    ].join("|");

    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.rebuildVisuals(charges, fluxSurfaces);
    }

    this.group.visible = charges.length > 0;
    const dt = Math.min(0.05, Math.max(0.008, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.updateParticles(dt, charges);

    if (this.fluxLines?.material) {
      this.fluxLines.material.opacity = 0.58 + (Math.sin(now / 240) * 0.12);
    }
  }
}
