import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FUR_TEXTURE_FALLBACK = (() => {
  // Tiny procedural fallback; the GLB embeds a 512px fur density map.
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = 0.55 + 0.25 * Math.sin(x * 1.7 + Math.sin(y * 0.31) * 3) + 0.2 * Math.sin(y * 2.3);
      const v = Math.max(0, Math.min(255, n * 255));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
})();

const FUR_VERT_PARS = /* glsl */`
attribute float aFurLen;
attribute vec2 aFurUv;
uniform float uShell;
varying vec2 vFurUv;
varying float vShellFrac;
`;

const FUR_VERT_MAIN = /* glsl */`
vFurUv = aFurUv;
vShellFrac = max(uShell, 0.0);
`;

const FUR_VERT_OFFSET = /* glsl */`
{
  vec3 furNormal = normalize(objectNormal);
  float shellT = max(uShell, 0.0);
  float len = aFurLen * shellT;
  vec3 comb = vec3(0.0, -0.22, -0.46);
  transformed += furNormal * 0.0035;
  transformed += (furNormal + comb * shellT) * len;
}
`;

const FUR_FRAG_PARS = /* glsl */`
uniform sampler2D uFurMap;
uniform float uShell;
uniform float uWet;
varying vec2 vFurUv;
varying float vShellFrac;
`;

const FUR_FRAG_DENSITY = /* glsl */`
vec2 furUv = vFurUv * vec2(6.0, 4.4);
float furNoiseA = texture2D(uFurMap, furUv).r;
float furNoiseB = texture2D(uFurMap, vFurUv * vec2(17.0, 12.0) + vec2(0.31, 0.77)).r;
float furMask = furNoiseA * 0.36 + furNoiseB * 0.64;
float furHash = fract(sin(dot(vFurUv * 131.7, vec2(12.9898, 78.233)) + vShellFrac * 47.13) * 43758.5453);
float shellThreshold = mix(0.34, 0.66, vShellFrac) + (furHash - 0.5) * 0.13;
if (uShell > 0.001 && furMask < shellThreshold) discard;
`;

const FUR_FRAG_TINT = /* glsl */`
float furLayer = clamp(vShellFrac, 0.0, 1.0);
float furSheenTex = furNoiseA;
float furIsCoat = step(uShell, 0.0);
vec3 shellColor = diffuseColor.rgb * mix(0.90, 1.18, furLayer);
shellColor = mix(shellColor, shellColor * vec3(1.16, 1.08, 0.92) + vec3(0.028, 0.020, 0.006), furLayer * 0.7);
vec3 coatColor = diffuseColor.rgb * (0.42 + furMask * 0.10);
diffuseColor.rgb = mix(shellColor, coatColor, furIsCoat);
diffuseColor.rgb *= (1.0 - uWet * 0.55);
`;

const FUR_FRAG_SHEEN = /* glsl */`
float furFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
float furTip = mix(0.22, smoothstep(0.35, 1.0, vShellFrac), 1.0 - furIsCoat);
totalEmissiveRadiance += vec3(0.62, 0.48, 0.32) * furFresnel * furTip * (0.34 + 0.3 * furSheenTex) * (1.0 - uWet);
`;

export class FurFactory {
  constructor(texture) {
    this.texture = texture || FUR_TEXTURE_FALLBACK;
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    this.texture.anisotropy = 8;
    this.materials = [];
  }

  make({ shell = -1 } = {}) {
    const isBase = shell < 0;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: isBase ? 0.84 : 0.95,
      metalness: 0,
      sheen: isBase ? 1 : 0,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(0x9a7a52),
      envMapIntensity: 0.3,
      side: THREE.FrontSide,
    });
    mat.userData.fur = { shell };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFurMap = { value: this.texture };
      shader.uniforms.uShell = { value: shell };
      shader.uniforms.uWet = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FUR_VERT_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FUR_VERT_MAIN}`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${FUR_VERT_OFFSET}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FUR_FRAG_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FUR_FRAG_DENSITY}\n${FUR_FRAG_TINT}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FUR_FRAG_SHEEN}`);
      mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = () => 'clover-fur-v2';
    this.materials.push(mat);
    return mat;
  }

  setWet(v) {
    for (const m of this.materials) if (m.userData.shader) m.userData.shader.uniforms.uWet.value = v;
  }
}

export class Rabbit {
  constructor(gltf, { furTexture, quality = 12 } = {}) {
    this.root = gltf.scene;
    this.coat = this.root.getObjectByName('RabbitCoat');
    this.shellSource = this.root.getObjectByName('RabbitFurShells');
    if (!this.coat || !this.shellSource) throw new Error('Rabbit meshes missing from GLB');

    this.furFactory = new FurFactory(furTexture || this.coat.material.map);
    this.quality = quality;
    this.shells = [];
    this.shellGeo = this.shellSource.geometry;

    this.#prepareGeometry(this.coat.geometry);
    this.#prepareGeometry(this.shellGeo);
    this.shellSource.visible = false;
    this.coat.material = this.furFactory.make();
    this.coat.castShadow = true;
    this.coat.receiveShadow = true;
    this.coat.frustumCulled = false;

    this.#buildShells(quality);
    this.#collectBones();
    this.#tuneEyesAndDetails();

    this.earSpring = [
      { a: 0, v: 0, target: 0, flick: 0 },
      { a: 0, v: 0, target: 0, flick: 0 },
    ];
    this.headSpring = { x: 0, y: 0, vx: 0, vy: 0 };
    this.blink = 0;
    this.nextBlink = 2.5 + Math.random() * 4;
    this.squash = 1;
    this.squashV = 0;
    this.landImpulse = 0;
    this.time = 0;
    this.digPhase = 0;
    this.chew = 0;
  }

  #prepareGeometry(geo) {
    const fur = geo.getAttribute('_FURLEN') || geo.getAttribute('FURLEN') || geo.getAttribute('_furlen') || geo.getAttribute('furlen');
    if (fur) {
      const arr = new Float32Array(fur.count);
      const scale = 0.085;
      const raw = fur.array;
      const stride = fur.itemSize || 1;
      const byteNormalized = fur.normalized && raw instanceof Uint8Array;
      for (let i = 0; i < fur.count; i++) {
        const v = raw[i * stride];
        arr[i] = (byteNormalized ? v / 255 : v) * scale;
      }
      geo.setAttribute('aFurLen', new THREE.BufferAttribute(arr, 1));
      geo.deleteAttribute('_FURLEN');
      geo.deleteAttribute('FURLEN');
      geo.deleteAttribute('_furlen');
      geo.deleteAttribute('furlen');
    } else {
      geo.setAttribute('aFurLen', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(0.03), 1));
    }
    const uv = geo.getAttribute('uv');
    if (uv) {
      geo.setAttribute('aFurUv', uv.clone());
      geo.deleteAttribute('uv');
    }
  }

  #buildShells(count) {
    const src = this.shellSource;
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const mat = this.furFactory.make({ shell: t });
      const mesh = new THREE.SkinnedMesh(src.geometry, mat);
      mesh.bind(this.coat.skeleton, this.coat.bindMatrix);
      mesh.bindMode = this.coat.bindMode;
      mesh.position.copy(src.position);
      mesh.quaternion.copy(src.quaternion);
      mesh.scale.copy(src.scale);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = i;
      mesh.name = `RabbitFurLayer${i}`;
      src.parent.add(mesh);
      this.shells.push(mesh);
    }
  }

  setQuality(count) {
    count = Math.max(0, Math.round(count));
    while (this.shells.length > count) this.shells.pop().removeFromParent();
    if (count > this.shells.length) {
      const src = this.shellSource;
      for (let i = this.shells.length + 1; i <= count; i++) {
        const t = i / count;
        const mat = this.furFactory.make({ shell: t });
        const mesh = new THREE.SkinnedMesh(src.geometry, mat);
        mesh.bind(this.coat.skeleton, this.coat.bindMatrix);
        mesh.bindMode = this.coat.bindMode;
        mesh.position.copy(src.position);
        mesh.quaternion.copy(src.quaternion);
        mesh.scale.copy(src.scale);
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = i;
        src.parent.add(mesh);
        this.shells.push(mesh);
      }
    }
    // remap shell uniforms so density tapers over active count
    this.shells.forEach((mesh, idx) => {
      const shader = mesh.material.userData.shader;
      if (shader) shader.uniforms.uShell.value = (idx + 1) / this.shells.length;
    });
  }

  #collectBones() {
    const b = (n) => this.root.getObjectByName(n);
    this.bones = {
      hips: b('hips'),
      spine: b('spine'),
      chest: b('chest'),
      neck: b('neck'),
      head: b('head'),
      tail: b('tail'),
      earL: [b('earL0'), b('earL1'), b('earL2'), b('earL3')],
      earR: [b('earR0'), b('earR1'), b('earR2'), b('earR3')],
      thighL: b('thighL'), thighR: b('thighR'),
      footL: b('footL'), footR: b('footR'),
      armL: b('armL'), armR: b('armR'),
      pawL: b('pawL'), pawR: b('pawR'),
    };
    for (const key of Object.keys(this.bones)) {
      const v = this.bones[key];
      const list = Array.isArray(v) ? v : [v];
      for (const bone of list) if (bone) bone.userData.rest = bone.quaternion.clone();
    }
    this.eyeMeshes = [this.root.getObjectByName('EyeL'), this.root.getObjectByName('EyeR')].filter(Boolean);
    this.eyeScaleY = this.eyeMeshes.map((m) => m.scale.y);
  }

  #tuneEyesAndDetails() {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material?.name === 'RabbitEye') {
        o.material.envMapIntensity = 2.2;
        o.material.roughness = 0.06;
        o.castShadow = false;
      }
      if (o.material?.name === 'RabbitNose') {
        o.material.envMapIntensity = 0.8;
        o.castShadow = false;
      }
      if (o.name.startsWith('Whisker')) {
        o.castShadow = false;
        o.material.roughness = 0.4;
      }
    });
  }

  // State comes from the game controller each frame.
  update(dt, state) {
    this.time += dt;
    const {
      speed = 0, vertical = 0, grounded = true, turnRate = 0,
      sitting = false, digging = false, eating = false, wet = 0,
    } = state;
    const t = this.time;
    const bones = this.bones;

    this.furFactory.setWet(wet);

    // --- springy squash and stretch
    const targetSquash = grounded ? (sitting ? 0.96 : 1.0) : 1 + Math.min(0.09, Math.abs(vertical) * 0.012);
    this.squashV += (targetSquash - this.squash) * 60 * dt;
    this.squashV *= Math.exp(-9 * dt);
    this.squash += this.squashV * dt;
    this.squash = THREE.MathUtils.clamp(this.squash, 0.9, 1.1);
    const sq = this.squash;
    this.root.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    // landing impulse decays
    this.landImpulse *= Math.exp(-7 * dt);

    // --- breathing
    const breath = Math.sin(t * 2.1) * 0.012;
    if (bones.spine) bones.spine.scale.setScalar(1 + breath);

    // --- hips / pose
    const sitT = sitting ? 1 : 0;
    this._sit = THREE.MathUtils.damp(this._sit || 0, sitT, 7, dt);
    this._run = THREE.MathUtils.damp(this._run || 0, Math.min(1, speed / 3), 7, dt);
    const sit = this._sit;
    if (bones.hips) {
      bones.hips.rotation.x = -0.28 * sit + Math.sin(t * 8) * 0.012 * this._run;
      bones.hips.position.y = 0.40 * 1 + sit * 0.02;
    }
    if (bones.chest) {
      bones.chest.rotation.x = 0.22 * sit + Math.sin(t * 2.1 + 0.8) * 0.012;
      bones.chest.rotation.z = -turnRate * 0.06;
    }
    if (bones.neck) bones.neck.rotation.x = 0.28 * sit + Math.sin(t * 2.1 + 1.6) * 0.008;

    // --- head: keeps level, curious idle glances, eating/digging poses
    const hs = this.headSpring;
    const lookX = eating ? 0.55 : digging ? 0.45 : 0;
    const idleY = Math.sin(t * 0.47) * 0.12 + Math.sin(t * 0.23 + 2.1) * 0.09;
    const tx = lookX + (grounded ? 0 : -vertical * 0.035) + Math.sin(t * 7.3) * 0.006 * this._run;
    const ty = idleY * (1 - this._run * 0.8);
    hs.vx += (tx - hs.x) * 55 * dt;
    hs.vx *= Math.exp(-10 * dt);
    hs.x += hs.vx * dt;
    hs.vy += (ty - hs.y) * 45 * dt;
    hs.vy *= Math.exp(-9 * dt);
    hs.y += hs.vy * dt;
    if (bones.head) {
      bones.head.rotation.x = -0.28 * sit + hs.x;
      bones.head.rotation.y = hs.y + turnRate * 0.12;
      bones.head.rotation.z = -turnRate * 0.05;
    }

    // --- ears: erect with springy inertia and occasional flicks
    const airBend = THREE.MathUtils.clamp(vertical * 0.13, -0.4, 0.4);
    for (let s = 0; s < 2; s++) {
      const sp = this.earSpring[s];
      if (Math.random() < dt * 0.09) sp.flick = (Math.random() - 0.5) * 0.5;
      sp.flick *= Math.exp(-4 * dt);
      const side = s === 0 ? 1 : -1;
      const target = 0.03 + Math.sin(t * 1.3 + s * 2.2) * 0.035 - airBend * 0.8 - sit * 0.1
        + turnRate * side * -0.05 + sp.flick;
      sp.v += (target - sp.a) * 55 * dt;
      sp.v *= Math.exp(-6.5 * dt);
      sp.a += sp.v * dt;
      const chain = s === 0 ? bones.earL : bones.earR;
      if (chain[0]) {
        chain[0].rotation.x = sp.a;
        chain[0].rotation.z = side * (0.04 + this.earSpring[s].flick * 0.5);
      }
      if (chain[1]) chain[1].rotation.x = sp.a * 0.55;
      if (chain[2]) chain[2].rotation.x = Math.sin(t * 1.3 + s * 2.2 + 0.7) * 0.03 + sp.a * 0.18;
      if (chain[3]) chain[3].rotation.x = sp.a * 0.08;
    }

    // --- limbs
    const run = this._run;
    const hopT = (t * 8.4) % (Math.PI * 2); // visual cadence while moving
    const swing = Math.sin(hopT) * 0.5 * run;
    if (bones.armL) bones.armL.rotation.x = swing * 0.55 - airBend * 0.5 - sit * 0.5;
    if (bones.armR) bones.armR.rotation.x = -swing * 0.55 - airBend * 0.5 - sit * 0.5;
    if (bones.pawL) bones.pawL.rotation.x = -0.25 * run + sit * 0.75;
    if (bones.pawR) bones.pawR.rotation.x = -0.25 * run + sit * 0.75;
    const thighSwing = Math.sin(hopT + 0.6) * 0.35 * run;
    if (bones.thighL) bones.thighL.rotation.x = thighSwing - airBend * 0.5;
    if (bones.thighR) bones.thighR.rotation.x = -thighSwing - airBend * 0.5;
    if (bones.footL) bones.footL.rotation.x = -thighSwing * 0.6 + 0.1 * run;
    if (bones.footR) bones.footR.rotation.x = thighSwing * 0.6 + 0.1 * run;

    // dig / chew
    if (digging) {
      this.digPhase += dt * 16;
      const d = Math.sin(this.digPhase);
      if (bones.armL) bones.armL.rotation.x = 0.55 + d * 0.6;
      if (bones.armR) bones.armR.rotation.x = 0.55 - d * 0.6;
      if (bones.head) bones.head.rotation.x = 0.35 + d * 0.08;
    }
    if (eating) {
      this.chew += dt * 13;
      if (bones.head) bones.head.rotation.x = 0.62 + Math.sin(this.chew) * 0.06;
      if (bones.neck) bones.neck.rotation.x = 0.4;
    }

    // --- tail
    if (bones.tail) bones.tail.rotation.x = Math.sin(t * 5.2) * 0.06 + Math.sin(t * 1.7) * 0.05;

    // --- blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = 2.4 + Math.random() * 4.5;
    }
    this.blink = Math.max(0, this.blink - dt * 7.5);
    const lid = 1 - Math.sin(this.blink * Math.PI) * 0.92;
    this.eyeMeshes.forEach((eye, i) => { eye.scale.y = this.eyeScaleY[i] * lid; });

    // --- wetness: ears droop a touch, fur darkens (handled in shader)
    if (wet > 0.01) {
      for (const chain of [bones.earL, bones.earR]) {
        if (chain[0]) chain[0].rotation.x += wet * 0.08;
      }
    }
  }

  onLand(strength = 1) {
    this.squash = THREE.MathUtils.clamp(1 - 0.09 * strength, 0.9, 1);
    this.squashV = -0.6 * strength;
    this.landImpulse = strength;
  }
}
