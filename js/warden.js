import * as THREE from '../vendor/three.module.js';
import { mulberry32 } from './textures.js';
import { terrainHeight, WORLD_RADIUS } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);

function limbGeometry(length, topRadius, bottomRadius, segments = 6) {
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, length, segments, 1);
  geo.translate(0, -length / 2, 0);
  return geo;
}

function segment(parent, from, to, radiusA, radiusB, material) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radiusB, radiusA, len, 4, 1);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  parent.add(mesh);
  return mesh;
}

export class Warden {
  constructor(scene, textures, callbacks = {}) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.root = new THREE.Group();
    this.root.visible = false;
    this.scene.add(this.root);
    this.textures = textures;

    this.active = false;
    this.distance = Infinity;
    this.visibleToPlayer = false;
    this.stare = 0;
    this.repelTimer = 0;
    this.respawnTimer = 0;
    this.fear = 0;
    this.walkPhase = 0;
    this.yaw = 0;
    this.speedNow = 0;
    this.dead = false;
    this.lastVanish = -100;
    this.time = 0;
    this.rng = mulberry32(50539);

    this._build();
  }

  _build() {
    const rng = this.rng;
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0x090b0b,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const ragMat = new THREE.MeshStandardMaterial({
      color: 0x0c0e0d,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x9d927c,
      roughness: 0.86,
      metalness: 0.02,
    });
    const skullMat = new THREE.MeshStandardMaterial({
      color: 0xb3a98f,
      roughness: 0.88,
      metalness: 0,
      emissive: 0x0b0903,
      emissiveIntensity: 0.4,
    });
    const socketMat = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 1 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false });

    const visual = new THREE.Group();
    this.visual = visual;
    this.root.add(visual);

    // Legs.
    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.3, 1.72, 0);
      const leg = new THREE.Mesh(limbGeometry(1.72, 0.09, 0.13, 5), clothMat);
      leg.position.z = 0.02;
      pivot.add(leg);
      const shin = new THREE.Mesh(limbGeometry(0.7, 0.075, 0.05, 5), clothMat);
      shin.position.set(0, -1.02, 0);
      pivot.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.44), clothMat);
      foot.position.set(0, -1.73, -0.12);
      pivot.add(foot);
      visual.add(pivot);
      this.legs.push(pivot);
    }

    // Torso.
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.52, 2.15, 7), clothMat);
    torso.position.y = 2.72;
    torso.scale.z = 0.66;
    visual.add(torso);
    this.torso = torso;

    // Ribs, barely catching the light.
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.018, 4, 10), boneMat);
      rib.rotation.x = Math.PI / 2;
      rib.position.set(0, 2.3 + i * 0.27, 0.03);
      rib.scale.z = 0.6;
      visual.add(rib);
    }

    // Tattered robe.
    const robeGeo = new THREE.CylinderGeometry(0.34, 1.06, 3.7, 9, 1, true);
    const robePos = robeGeo.attributes.position;
    for (let i = 0; i < robePos.count; i++) {
      if (robePos.getY(i) < -1.7) {
        robePos.setY(i, robePos.getY(i) - rng() * 0.55);
        robePos.setX(i, robePos.getX(i) * (0.9 + rng() * 0.18));
        robePos.setZ(i, robePos.getZ(i) * (0.9 + rng() * 0.18));
      }
    }
    robeGeo.computeVertexNormals();
    const robe = new THREE.Mesh(robeGeo, ragMat);
    robe.position.y = 2.26;
    robe.scale.z = 0.8;
    visual.add(robe);

    // Hanging strips.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.13 + rng() * 0.09, 0.8 + rng() * 0.9), ragMat);
      strip.position.set(Math.cos(a) * 0.62, 1.55, Math.sin(a) * 0.52);
      strip.rotation.y = -a + Math.PI / 2;
      strip.rotation.z = (rng() - 0.5) * 0.18;
      visual.add(strip);
    }

    // Arms.
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.6, 3.6, 0);
      const arm = new THREE.Mesh(limbGeometry(2.65, 0.055, 0.105, 5), clothMat);
      arm.position.z = -0.02;
      pivot.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), boneMat);
      hand.position.y = -2.6;
      hand.scale.set(0.8, 1.5, 0.7);
      pivot.add(hand);
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.34, 4), boneMat);
        finger.position.set((f - 1.5) * 0.035, -2.83, 0.02);
        finger.rotation.x = Math.PI;
        finger.rotation.z = (f - 1.5) * 0.08;
        pivot.add(finger);
      }
      pivot.rotation.z = side * -0.1;
      visual.add(pivot);
      this.arms.push(pivot);
    }

    // Neck and skull.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.36, 5), boneMat);
    neck.position.y = 3.93;
    visual.add(neck);

    const head = new THREE.Group();
    head.position.y = 4.26;
    visual.add(head);
    this.head = head;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.29, 11, 9), skullMat);
    skull.scale.set(0.82, 1.18, 0.8);
    head.add(skull);

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.17), skullMat);
    jaw.position.set(0, -0.29, 0.13);
    jaw.rotation.x = 0.27;
    head.add(jaw);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.12), new THREE.MeshBasicMaterial({ color: 0x020202 }));
    mouth.position.set(0, -0.19, 0.225);
    mouth.rotation.x = 0.15;
    head.add(mouth);

    // Black sockets and two pinhole lights.
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 6), socketMat);
      socket.position.set(side * 0.105, 0.035, 0.195);
      socket.scale.set(1, 1.18, 0.52);
      head.add(socket);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), eyeMat);
      eye.position.set(side * 0.105, 0.03, 0.24);
      head.add(eye);
    }

    const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.textures.glow,
      color: 0xffcf95,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    eyeGlow.position.set(0, 0.03, 0.26);
    eyeGlow.scale.set(0.34, 0.2, 1);
    head.add(eyeGlow);
    this.eyeGlow = eyeGlow;

    // Antlers.
    const antlers = new THREE.Group();
    head.add(antlers);
    const branches = [
      [[-0.12, 0.23, 0.01], [-0.34, 0.62, -0.02], [-0.52, 0.98, -0.08], [-0.62, 1.36, -0.13]],
      [[-0.31, 0.56, -0.02], [-0.56, 0.75, 0.01], [-0.72, 0.94, -0.04]],
      [[-0.47, 0.88, -0.06], [-0.39, 1.12, -0.13], [-0.38, 1.34, -0.2]],
    ];
    for (const side of [-1, 1]) {
      for (const chain of branches) {
        for (let i = 0; i < chain.length - 1; i++) {
          const from = new THREE.Vector3(chain[i][0] * side, chain[i][1], chain[i][2]);
          const to = new THREE.Vector3(chain[i + 1][0] * side, chain[i + 1][1], chain[i + 1][2]);
          segment(antlers, from, to, 0.032 - i * 0.006, 0.022 - i * 0.005, boneMat);
        }
      }
    }

    // A little bell at the waist.
    const bellBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.11, 0.2, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x66502f, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide })
    );
    bellBody.position.set(0.46, 1.7, 0.18);
    visual.add(bellBody);
    const bellString = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 3), clothMat);
    bellString.position.set(0.46, 1.95, 0.18);
    visual.add(bellString);

    // Grounding shadow.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.035;
    shadow.scale.set(1.1, 1.6, 1);
    this.root.add(shadow);
  }

  reset() {
    this.active = false;
    this.dead = false;
    this.root.visible = false;
    this.root.position.set(0, terrainHeight(0, 20), 20);
    this.distance = Infinity;
    this.visibleToPlayer = false;
    this.stare = 0;
    this.repelTimer = 0;
    this.respawnTimer = 0;
    this.fear = 0;
    this.speedNow = 0;
    this.walkPhase = 0;
    this.eyeGlow.material.opacity = 0.75;
    this.visual.position.y = 0;
    this.legs[0].rotation.x = 0;
    this.legs[1].rotation.x = 0;
    this.arms[0].rotation.x = 0;
    this.arms[1].rotation.x = 0;
    this.arms[0].rotation.z = -0.1;
    this.arms[1].rotation.z = 0.1;
    this.head.rotation.set(0, 0, 0);
  }

  activate(playerPos, camera, behind = false) {
    if (this.active) return;
    this.active = true;
    this.dead = false;
    this.stare = 0;
    this.respawnTimer = 0;
    this._spawn(playerPos, camera, behind ? 22 : 26, behind);
    this.root.visible = true;
    this.callbacks.onAwake?.();
  }

  _spawn(playerPos, camera, distance, behind) {
    let forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();

    let angle;
    if (behind) {
      const base = Math.atan2(forward.x, forward.z);
      angle = base + Math.PI + (this.rng() - 0.5) * 1.1;
    } else {
      const base = Math.atan2(forward.x, forward.z);
      angle = base + (this.rng() - 0.5) * 1.5;
    }

    let x = playerPos.x + Math.sin(angle) * distance;
    let z = playerPos.z + Math.cos(angle) * distance;
    const rad = Math.hypot(x, z);
    if (rad > WORLD_RADIUS - 3) {
      const k = (WORLD_RADIUS - 3) / rad;
      x *= k;
      z *= k;
    }
    this.root.position.set(x, terrainHeight(x, z) + 0.02, z);
    this.yaw = Math.atan2(playerPos.x - x, playerPos.z - z);
    this.root.rotation.y = this.yaw;
    this.root.visible = true;
    this.dead = false;
  }

  repel(seconds = 5) {
    if (!this.active) return;
    this.repelTimer = seconds;
    this.root.visible = false;
    this.stare = 0;
    this.visibleToPlayer = false;
    this.fear = 0;
    this.respawnTimer = 0;
    this.callbacks.onVanish?.(true);
  }

  vanish(seconds = 4) {
    this.root.visible = false;
    this.stare = 0;
    this.visibleToPlayer = false;
    this.respawnTimer = seconds;
    this.callbacks.onVanish?.(false);
  }

  _angleLerp(current, target, t) {
    let diff = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return current + diff * t;
  }

  update(dt, time, playerPos, camera, relicCount, lanternOn) {
    this.time = time;
    if (!this.active || this.dead) return;

    if (this.repelTimer > 0) {
      this.repelTimer -= dt;
      this.root.visible = false;
      this.fear = Math.max(0, this.fear - dt * 1.5);
      if (this.repelTimer <= 0) {
        this.respawnTimer = 0.5;
        this.root.visible = false;
      }
      return;
    }

    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      this.fear = Math.max(0, this.fear - dt * 0.9);
      if (this.respawnTimer <= 0) {
        this._spawn(playerPos, camera, 24 + this.rng() * 8, true);
        this.root.visible = true;
        this.callbacks.onReturn?.();
      }
      return;
    }

    const dx = playerPos.x - this.root.position.x;
    const dz = playerPos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz);
    this.distance = dist;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    const toWarden = new THREE.Vector3(-dx, 0, -dz).normalize();
    const facing = camDir.dot(toWarden);
    const occluded = this.scene.userData.isOccluded
      ? this.scene.userData.isOccluded(playerPos.x, playerPos.z, this.root.position.x, this.root.position.z)
      : false;

    const visible = dist < 55 && facing > 0.45 && !occluded;
    this.visibleToPlayer = visible;

    if (visible) this.stare += dt;
    else this.stare = Math.max(0, this.stare - dt * 2.4);

    if (visible && this.stare > 2.6 && dist > 7.2) {
      this.vanish(2.6 + this.rng() * 3.8);
      return;
    }

    let moving = false;
    let speed = 0;

    if (visible) {
      if (dist < 7.2) {
        speed = dist < 3.6 ? 3.5 : 1.25;
        moving = true;
      }
    } else {
      const base = 2.15 + relicCount * 0.26 + (lanternOn ? 0.18 : 0);
      speed = dist < 4.8 ? 3.65 : base;
      moving = true;
    }

    // It does not care for the edge of the world.
    if (moving) {
      const k = Math.min(1, dt * speed / Math.max(0.001, dist));
      this.root.position.x += dx * k;
      this.root.position.z += dz * k;
      this.speedNow = speed;
    } else {
      this.speedNow = 0;
    }

    this.root.position.y = terrainHeight(this.root.position.x, this.root.position.z) + 0.02;

    const targetYaw = Math.atan2(dx, dz);
    this.yaw = this._angleLerp(this.yaw, targetYaw, Math.min(1, dt * (moving ? 7 : 2.4)));
    this.root.rotation.y = this.yaw;

    // Looming walk.
    const stride = moving ? (dist < 6 ? 7.5 : 4.2) : 1.1;
    this.walkPhase += dt * stride;
    const swing = moving ? Math.min(1, 0.35 + speed * 0.12) : 0.08;
    this.legs[0].rotation.x = Math.sin(this.walkPhase) * 0.56 * swing;
    this.legs[1].rotation.x = -Math.sin(this.walkPhase) * 0.56 * swing;
    this.arms[0].rotation.x = -Math.sin(this.walkPhase) * 0.42 * swing;
    this.arms[1].rotation.x = Math.sin(this.walkPhase) * 0.42 * swing;
    this.arms[0].rotation.z = -0.1 + Math.sin(this.walkPhase * 0.5) * 0.03;
    this.arms[1].rotation.z = 0.1 - Math.sin(this.walkPhase * 0.5) * 0.03;
    this.visual.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.035 * swing;

    // Head tilts as though listening.
    this.head.rotation.z = Math.sin(time * 0.7) * 0.05 + Math.sin(time * 3.1) * 0.012;
    this.head.rotation.x = Math.sin(time * 0.43) * 0.04;
    this.head.rotation.y = Math.sin(time * 0.37) * 0.12;
    this.eyeGlow.material.opacity = 0.55 + Math.sin(time * 2.4) * 0.16 + (visible ? 0.18 : 0);

    const proximity = Math.max(0, Math.min(1, (30 - dist) / 30));
    const targetFear = this.visibleToPlayer
      ? Math.min(1, proximity * 1.2 + 0.1)
      : Math.min(0.85, proximity * 0.72);
    this.fear += (targetFear - this.fear) * Math.min(1, dt * 2.2);

    if (dist < 1.9) {
      this.dead = true;
      this.root.visible = true;
      this.callbacks.onCatch?.();
    }
  }
}
