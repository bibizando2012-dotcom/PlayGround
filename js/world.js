import * as THREE from '../vendor/three.module.js';
import {
  mulberry32,
  makeGroundTexture,
  makePathTexture,
  makeStoneTexture,
  makeBarkTexture,
  makeGrassTexture,
  makeGlowTexture,
  makeFlameTexture,
  makeFogTexture,
  makeRuneTexture,
} from './textures.js';

export const WORLD_RADIUS = 67;
export const GATE_POSITION = new THREE.Vector3(0, 0, 46);

export function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.055) * 1.12 +
    Math.cos(z * 0.047) * 0.88 +
    Math.sin((x + z) * 0.028) * 1.46 +
    Math.cos((x - z) * 0.061) * 0.48 +
    Math.sin(x * 0.171 + z * 0.137) * 0.15
  );
}

const SHRINE_DATA = [
  { x: -21, z: 11, name: 'THE ROOT CHAPEL', whisper: 'The roots are warm. Something is breathing beneath them.' },
  { x: 22, z: -7, name: 'THE DROWNED STONE', whisper: 'The water remembers a face. It is almost yours.' },
  { x: -2, z: -31, name: 'THE BONE ORCHARD', whisper: 'Every tree here grew from a name. Do not read them.' },
];

function buildSky(scene) {
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += vnoise(p) * a;
          p *= 2.03;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        vec3 zenith = vec3(0.012, 0.022, 0.033);
        vec3 horizon = vec3(0.032, 0.052, 0.054);
        vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.72, h));

        // Slow cloud veil.
        vec2 cuv = vec2(atan(d.z, d.x) * 1.6 + uTime * 0.0018, d.y * 3.2);
        float cloud = smoothstep(0.46, 0.86, fbm(cuv * 2.1));
        col = mix(col, vec3(0.055, 0.073, 0.078), cloud * smoothstep(0.02, 0.55, h) * 0.55);

        // Stars, thinned by the cloud veil.
        vec2 suv = vec2(atan(d.z, d.x) / 6.28318, asin(clamp(d.y, -1.0, 1.0)) / 3.14159);
        vec2 cell = suv * vec2(240.0, 130.0);
        vec2 id = floor(cell);
        vec2 f = fract(cell) - 0.5;
        float hsh = hash21(id);
        float star = step(0.9865, hsh) * smoothstep(0.19, 0.0, length(f));
        star *= (0.55 + 0.45 * sin(uTime * (0.8 + hsh * 2.0) + hsh * 40.0));
        star *= smoothstep(-0.03, 0.28, h) * (1.0 - cloud * 0.75);
        col += vec3(0.72, 0.79, 0.9) * star * 1.15;

        // A hung, bloated moon.
        vec3 moonDir = normalize(vec3(0.3, 0.37, -0.88));
        float md = max(dot(d, moonDir), 0.0);
        float disc = smoothstep(0.99938, 0.99968, md);
        float halo = pow(md, 34.0) * 0.32 + pow(md, 7.0) * 0.045;
        float moonVein = 0.78 + 0.22 * vnoise(d.xy * 90.0);
        col += vec3(0.86, 0.85, 0.76) * disc * 1.1 * moonVein;
        col += vec3(0.38, 0.47, 0.52) * halo;

        // Horizon rot.
        float rot = smoothstep(0.16, -0.08, h);
        col = mix(col, vec3(0.02, 0.031, 0.03), rot * 0.72);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 20), material);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);
  return { sky, uniforms };
}

function makeInstanced(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  return mesh;
}

function buildPaths(scene, material, trailMaterial) {
  const curves = SHRINE_DATA.map((s, i) => {
    const start = new THREE.Vector3(i === 1 ? 4 : -1.5, 0, 44);
    const end = new THREE.Vector3(s.x, 0, s.z);
    const mid1 = new THREE.Vector3(
      start.x + (end.x - start.x) * 0.28 + Math.sin(i * 9.1) * 7,
      0,
      start.z + (end.z - start.z) * 0.3
    );
    const mid2 = new THREE.Vector3(
      start.x + (end.x - start.x) * 0.68 + Math.cos(i * 4.7) * 8,
      0,
      start.z + (end.z - start.z) * 0.68
    );
    return { curve: new THREE.CatmullRomCurve3([start, mid1, mid2, end], false, 'catmullrom', 0.3), end };
  });

  // A shared approach trail from the gate, so the player always starts on trodden ground.
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 45),
    new THREE.Vector3(0.6, 0, 39),
    new THREE.Vector3(-0.5, 0, 34),
    new THREE.Vector3(0.4, 0, 29.5),
    new THREE.Vector3(-0.3, 0, 25),
  ], false, 'catmullrom', 0.35);
  curves.unshift({ curve: spine, end: new THREE.Vector3(-0.3, 0, 25) });

  // Worn earth under the stepping stones so the trail reads at a glance.
  for (let ci = 0; ci < curves.length; ci++) {
    const { curve } = curves[ci];
    const length = curve.getLength();
    const steps = Math.max(8, Math.ceil(length / 0.85));
    const positions = [];
    const colors = [];
    const uvs = [];
    const indices = [];
    const baseColor = new THREE.Color(0xf0e6d2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const nx = -tangent.z;
      const nz = tangent.x;
      const halfWidth = 0.82 + Math.sin(t * 17.3 + ci) * 0.16 + Math.sin(t * 41.7) * 0.06;
      for (const side of [-1, 1]) {
        const x = p.x + nx * halfWidth * side;
        const z = p.z + nz * halfWidth * side;
        positions.push(x, terrainHeight(x, z) + 0.12, z);
        const shade = 0.82 + Math.sin(x * 1.7 + z * 0.9) * 0.1 + Math.cos(z * 2.3 - x * 0.4) * 0.08;
        colors.push(baseColor.r * shade, baseColor.g * shade, baseColor.b * shade);
        uvs.push(side < 0 ? 0 : 1, t * length * 0.28);
      }
      if (i < steps) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const ribbon = new THREE.Mesh(geo, trailMaterial);
    ribbon.receiveShadow = false;
    scene.add(ribbon);
  }

  const stoneGeo = new THREE.CylinderGeometry(0.38, 0.46, 0.1, 6);
  stoneGeo.translate(0, 0.05, 0);
  const stones = [];
  for (let ci = 0; ci < curves.length; ci++) {
    const { curve } = curves[ci];
    const length = curve.getLength();
    const steps = Math.ceil(length / 1.35);
    for (let i = 0; i < steps; i++) {
      if (i % 7 === 0) continue;
      const t = i / steps;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const side = Math.sin(i * 7.3 + ci) * 0.24;
      p.x += -tangent.z * side;
      p.z += tangent.x * side;
      p.y = terrainHeight(p.x, p.z) + 0.16;
      stones.push({ p, r: Math.sin(i * 13.7 + ci) * 0.9, s: 0.58 + ((i * 37) % 13) / 27 });
    }
  }

  const mesh = makeInstanced(stoneGeo, material, stones.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < stones.length; i++) {
    const { p, r, s } = stones[i];
    dummy.position.copy(p);
    dummy.rotation.set(0, r, 0);
    dummy.scale.set(s, 1, s * 0.86);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.14, 0.025, 0.46 + ((i * 17) % 9) / 70);
    mesh.setColorAt(i, color);
  }
  mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return curves;
}

function buildTerrain(scene, textures) {
  const size = 176;
  const segments = 128;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const shade = 0.72 + Math.sin(x * 0.31 + z * 0.17) * 0.09 + Math.cos(z * 0.23) * 0.06;
    color.setRGB(shade * 0.94, shade, shade * 0.9);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: textures.ground,
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    color: 0xe8ead7,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}

function buildForest(scene, textures, colliders, pathCurves) {
  const rng = mulberry32(19371);
  const pathSamples = [];
  for (const { curve } of pathCurves) {
    for (let i = 0; i <= 30; i++) pathSamples.push(curve.getPointAt(i / 30));
  }

  const trees = [];
  let guard = 0;
  while (trees.length < 174 && guard < 5000) {
    guard++;
    const angle = rng() * Math.PI * 2;
    const radius = 7 + Math.sqrt(rng()) * 58;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (Math.hypot(x, z - 46) < 11) continue;
    if (Math.hypot(x, z - 34) < 11) continue;
    // Keep the first steps into the vale clear: a corridor, not a wall of bark.
    if (z < 33.5 && z > 10 && Math.abs(x) < 5.4) continue;
    let nearShrine = false;
    for (const s of SHRINE_DATA) if (Math.hypot(x - s.x, z - s.z) < 7) nearShrine = true;
    if (nearShrine) continue;
    let nearPath = false;
    for (const p of pathSamples) {
      if (Math.hypot(x - p.x, z - p.z) < 2.1) { nearPath = true; break; }
    }
    if (nearPath && rng() > 0.16) continue;
    const height = 5.5 + rng() * 7.5;
    const width = 0.66 + rng() * 0.8;
    trees.push({ x, z, height, width, rot: rng() * Math.PI * 2, lean: (rng() - 0.5) * 0.09 });
  }

  // Two threshold trees frame the first steps into the vale.
  trees.push({ x: -8.4, z: 28.2, height: 11.5, width: 1.35, rot: 0.4, lean: 0.05 });
  trees.push({ x: 8.9, z: 25.5, height: 10.2, width: 1.2, rot: 2.1, lean: -0.06 });

  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.5, 1, 7, 4, true);
  trunkGeo.translate(0, 0.5, 0);
  const branchGeo = new THREE.CylinderGeometry(0.025, 0.13, 1, 4, 1, true);
  branchGeo.translate(0, 0.5, 0);

  const barkMat = new THREE.MeshStandardMaterial({
    map: textures.bark,
    color: 0xb8a88d,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const branchList = [];
  const rngB = mulberry32(5511);
  const up = new THREE.Vector3(0, 1, 0);
  for (const t of trees) {
    const branchCount = 3 + (rngB() * 3 | 0);
    for (let b = 0; b < branchCount; b++) {
      const y = t.height * (0.4 + rngB() * 0.48);
      const yaw = rngB() * Math.PI * 2;
      const tilt = 0.55 + rngB() * 0.78;
      const dir = new THREE.Vector3(
        Math.cos(yaw) * Math.sin(tilt),
        Math.cos(tilt) * (rngB() > 0.18 ? 1 : -0.8),
        Math.sin(yaw) * Math.sin(tilt)
      ).normalize();
      const len = (1.8 + rngB() * 3.6) * (0.7 + t.width * 0.4);
      branchList.push({
        x: t.x + Math.cos(yaw) * t.width * 0.2,
        y,
        z: t.z + Math.sin(yaw) * t.width * 0.2,
        dir,
        len,
        thick: 0.65 + rngB() * 0.6,
      });
    }
    colliders.push({ x: t.x, z: t.z, r: 0.48 * t.width + 0.12, type: 'tree' });
  }

  const trunks = makeInstanced(trunkGeo, barkMat, trees.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    dummy.position.set(t.x, terrainHeight(t.x, t.z) - 0.12, t.z);
    dummy.rotation.set(t.lean, t.rot, t.lean * 0.7);
    dummy.scale.set(t.width, t.height, t.width);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.09, 0.08 + (i % 5) * 0.012, 0.64 + (i % 7) * 0.025);
    trunks.setColorAt(i, col);
  }
  trunks.instanceColor.needsUpdate = true;
  scene.add(trunks);

  const branches = makeInstanced(branchGeo, barkMat, branchList.length);
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < branchList.length; i++) {
    const b = branchList[i];
    pos.set(b.x, terrainHeight(b.x, b.z) + b.y, b.z);
    quat.setFromUnitVectors(up, b.dir);
    scale.set(b.thick, b.len, b.thick);
    matrix.compose(pos, quat, scale);
    branches.setMatrixAt(i, matrix);
    col.setHSL(0.08, 0.07, 0.58 + (i % 6) * 0.03);
    branches.setColorAt(i, col);
  }
  branches.instanceColor.needsUpdate = true;
  scene.add(branches);

  return { trunks, branches, trees };
}

function buildRocks(scene, textures, colliders) {
  const rng = mulberry32(80442);
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({
    map: textures.stone,
    color: 0x8f9284,
    roughness: 0.97,
    metalness: 0,
  });
  const count = 84;
  const mesh = makeInstanced(geo, mat, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 8 + Math.sqrt(rng()) * 58;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    let close = false;
    for (const s of SHRINE_DATA) if (Math.hypot(x - s.x, z - s.z) < 5) close = true;
    if (close) { i--; continue; }
    const sx = 0.5 + rng() * 1.7;
    const sy = 0.35 + rng() * 0.9;
    const sz = 0.5 + rng() * 1.5;
    dummy.position.set(x, terrainHeight(x, z) + sy * 0.15, z);
    dummy.rotation.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.4);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.12, 0.03, 0.55 + (i % 7) * 0.025);
    mesh.setColorAt(i, col);
    if (sx * sy > 0.8) colliders.push({ x, z, r: Math.max(sx, sz) * 0.62, type: 'rock' });
  }
  mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

function buildWaymarks(scene, textures, pathCurves) {
  const rng = mulberry32(7411);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x171814, roughness: 0.9, metalness: 0.25 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0x6d522c, roughness: 0.5, metalness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffc17a,
    emissive: 0xff8d3a,
    emissiveIntensity: 2.8,
    roughness: 0.4,
    transparent: true,
    opacity: 0.9,
  });
  const poolMat = new THREE.MeshBasicMaterial({
    map: textures.glow,
    color: 0xff9d51,
    transparent: true,
    opacity: 0.105,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const lamps = [];
  const ts = [0.3, 0.56];
  for (let ci = 0; ci < pathCurves.length; ci++) {
    for (let ti = 0; ti < ts.length; ti++) {
      const t = ts[ti];
      const curve = pathCurves[ci].curve;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const side = (ti % 2 === 0 ? 1 : -1) * (1.15 + rng() * 0.3);
      p.x += -tangent.z * side;
      p.z += tangent.x * side;
      p.y = terrainHeight(p.x, p.z);

      const group = new THREE.Group();
      group.position.copy(p);
      group.rotation.y = Math.atan2(-tangent.z, tangent.x) + 0.25;
      scene.add(group);

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 1.65, 5), postMat);
      post.position.y = 0.82;
      post.rotation.z = 0.035;
      group.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.12, 6), postMat);
      foot.position.y = 0.06;
      group.add(foot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.045, 0.045), postMat);
      arm.position.set(0.25, 1.62, 0);
      arm.rotation.z = -0.035;
      group.add(arm);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 8, Math.PI), brassMat);
      hook.position.set(0.5, 1.55, 0);
      group.add(hook);

      const cage = new THREE.Group();
      cage.position.set(0.5, 1.38, 0);
      group.add(cage);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.05, 6), brassMat);
      cap.position.y = 0.1;
      cage.add(cap);
      const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.035, 6), brassMat);
      bottom.position.y = -0.11;
      cage.add(bottom);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.18, 0.11), glassMat);
      cage.add(glass);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 3), brassMat);
          bar.position.set(sx * 0.058, 0, sz * 0.058);
          cage.add(bar);
        }
      }

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textures.glow,
        color: 0xffad66,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
      }));
      glow.position.set(0.5, 1.38, 0);
      glow.scale.set(1.25, 1.25, 1);
      group.add(glow);

      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textures.flame,
        color: 0xffb267,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }));
      flame.position.set(0.5, 1.4, 0);
      flame.scale.set(0.15, 0.3, 1);
      group.add(flame);

      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), poolMat.clone());
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.035;
      group.add(pool);

      lamps.push({ group, glow, flame, glass, phase: rng() * Math.PI * 2 });
    }
  }
  return lamps;
}

function buildGrass(scene, textures) {
  const rng = mulberry32(3911);
  const geo = new THREE.PlaneGeometry(0.85, 0.78);
  geo.translate(0, 0.36, 0);
  const mat = new THREE.MeshStandardMaterial({
    map: textures.grass,
    color: 0x8f946c,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const count = 820;
  const mesh = makeInstanced(geo, mat, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + Math.sqrt(rng()) * 61;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = terrainHeight(x, z);
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    const s = 0.55 + rng() * 1.2;
    dummy.scale.set(s, s * (0.7 + rng() * 0.8), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  scene.add(mesh);
  return mesh;
}

function buildGravestones(scene, textures, colliders) {
  const rng = mulberry32(6711);
  const geo = new THREE.BoxGeometry(0.62, 1.12, 0.16);
  geo.translate(0, 0.56, 0);
  const mat = new THREE.MeshStandardMaterial({
    map: textures.stone,
    color: 0xa6a590,
    roughness: 0.98,
    metalness: 0,
  });
  const count = 42;
  const mesh = makeInstanced(geo, mat, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const sites = [...SHRINE_DATA, { x: 3, z: 43 }];
  for (let i = 0; i < count; i++) {
    const site = sites[i % sites.length];
    const a = rng() * Math.PI * 2;
    const rr = 3.2 + rng() * 5.2;
    const x = site.x + Math.cos(a) * rr;
    const z = site.z + Math.sin(a) * rr;
    if (Math.hypot(x, z - 34) < 3) { i--; continue; }
    const s = 0.68 + rng() * 0.65;
    dummy.position.set(x, terrainHeight(x, z) - 0.04, z);
    dummy.rotation.set((rng() - 0.5) * 0.22, rng() * Math.PI * 2, (rng() - 0.5) * 0.18);
    dummy.scale.set(s, s * (0.8 + rng() * 0.55), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.1, 0.05, 0.5 + rng() * 0.18);
    mesh.setColorAt(i, col);
  }
  mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

function buildMist(scene, fogTexture) {
  const rng = mulberry32(8181);
  const count = 30;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 10 + Math.sqrt(rng()) * 54;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = 0.8 + rng() * 3.4;
    positions[i * 3 + 2] = Math.sin(a) * r;
    sizes[i] = 18 + rng() * 30;
    phases[i] = rng() * 10;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: fogTexture },
      uColor: { value: new THREE.Color(0x9dafac) },
    },
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.045 + aPhase) * 4.2;
        p.z += cos(uTime * 0.038 + aPhase * 1.7) * 4.6;
        p.y += sin(uTime * 0.13 + aPhase) * 0.22;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
        float dist = length(mv.xyz);
        vAlpha = smoothstep(90.0, 16.0, dist) * smoothstep(2.0, 9.0, dist);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        float a = tex.a * vAlpha * 0.13;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return { points, mat };
}

function buildMotes(scene, glowTexture) {
  const rng = mulberry32(5119);
  const count = 230;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 4 + Math.sqrt(rng()) * 62;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = 0.4 + rng() * 4.2;
    positions[i * 3 + 2] = Math.sin(a) * r;
    phases[i] = rng() * 20;
    sizes[i] = 0.7 + rng() * 2.0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: glowTexture },
      uColor: { value: new THREE.Color(0xffc07a) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.21 + aPhase) * 1.5;
        p.y += sin(uTime * 0.37 + aPhase * 2.0) * 0.5;
        p.z += cos(uTime * 0.17 + aPhase) * 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * (200.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
        float d = length(mv.xyz);
        vAlpha = smoothstep(64.0, 6.0, d) * (0.35 + 0.65 * sin(uTime * 1.4 + aPhase) * 0.5 + 0.5);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        float a = tex.a * vAlpha * 0.8;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * (0.8 + tex.a * 0.5), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return { points, mat };
}

function buildShrines(scene, textures) {
  const stoneMat = new THREE.MeshStandardMaterial({
    map: textures.stone,
    color: 0xbab9a8,
    roughness: 0.96,
    metalness: 0,
  });
  const darkStoneMat = new THREE.MeshStandardMaterial({
    map: textures.stone,
    color: 0x8c8b7c,
    roughness: 1,
    metalness: 0,
  });
  const relicMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a3,
    emissive: 0xff9b47,
    emissiveIntensity: 2.4,
    roughness: 0.28,
    metalness: 0.1,
  });
  const runeMat = new THREE.MeshBasicMaterial({
    color: 0xffb968,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const shrines = [];
  const rng = mulberry32(27731);
  for (let si = 0; si < SHRINE_DATA.length; si++) {
    const data = SHRINE_DATA[si];
    const y = terrainHeight(data.x, data.z);
    const group = new THREE.Group();
    group.position.set(data.x, y, data.z);
    scene.add(group);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffa556,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.45, 2.52, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.055;
    group.add(ring);
    const innerRing = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.58, 48), ringMat.clone());
    innerRing.material.opacity = 0.1;
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.06;
    group.add(innerRing);

    const stones = [];
    const stoneCount = 5;
    for (let i = 0; i < stoneCount; i++) {
      const a = (i / stoneCount) * Math.PI * 2 + si * 0.4;
      const rr = 2.7 + rng() * 0.5;
      const h = 1.9 + rng() * 2.2;
      const sx = 0.5 + rng() * 0.32;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, h, 0.42), i === 0 ? darkStoneMat : stoneMat);
      mesh.position.set(Math.cos(a) * rr, h / 2 - 0.08, Math.sin(a) * rr);
      mesh.rotation.y = -a + Math.PI / 2;
      mesh.rotation.z = (rng() - 0.5) * 0.09;
      group.add(mesh);
      stones.push(mesh);

      if (i % 2 === 0) {
        const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.075, h * 0.46), runeMat);
        rune.position.set(Math.cos(a) * (rr - 0.235), h * 0.5, Math.sin(a) * (rr - 0.235));
        rune.rotation.y = -a - Math.PI / 2;
        group.add(rune);
      }
    }

    // Tall marker stone, visible before the ring emerges from the fog.
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.78, 4.6, 0.56), darkStoneMat);
    marker.position.set(0, 2.25, -3.4);
    marker.rotation.set(0.03, si * 1.7, -0.04);
    group.add(marker);
    const markerRune = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 2.6), runeMat.clone());
    markerRune.material.opacity = 0.3;
    markerRune.position.set(0, 2.35, -3.1);
    markerRune.rotation.y = si * 1.7;
    group.add(markerRune);

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.78, 0.48, 7), stoneMat);
    pedestal.position.y = 0.24;
    group.add(pedestal);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.3, 0.16, 9), darkStoneMat);
    bowl.position.y = 0.55;
    group.add(bowl);

    const relic = new THREE.Group();
    const shard = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), relicMat);
    shard.scale.set(1, 1.55, 0.8);
    relic.add(shard);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textures.glow,
      color: 0xffb76d,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    halo.scale.set(1.6, 1.6, 1);
    relic.add(halo);
    relic.position.y = 1.45;
    group.add(relic);

    const light = new THREE.PointLight(0xffa555, 5.5, 10, 2);
    light.position.y = 1.35;
    group.add(light);

    const flames = [];
    const candleCount = 5;
    for (let i = 0; i < candleCount; i++) {
      const a = (i / candleCount) * Math.PI * 2 + 0.7;
      const rr = 1.75 + rng() * 0.38;
      const cx = Math.cos(a) * rr;
      const cz = Math.sin(a) * rr;
      const ch = 0.15 + rng() * 0.12;
      const candle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.045, ch, 5),
        new THREE.MeshStandardMaterial({ color: 0xcfc4a4, roughness: 0.9 })
      );
      candle.position.set(cx, ch / 2, cz);
      group.add(candle);
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textures.flame,
        color: 0xffb86e,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }));
      flame.position.set(cx, ch + 0.13, cz);
      flame.scale.set(0.19, 0.34, 1);
      group.add(flame);
      flames.push({ sprite: flame, phase: rng() * Math.PI * 2, baseY: ch + 0.13 });
    }

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb264,
      transparent: true,
      opacity: 0.028,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.5, 14, 10, 1, true), beamMat);
    beam.position.y = 7;
    group.add(beam);

    shrines.push({
      data,
      group,
      position: new THREE.Vector3(data.x, y, data.z),
      relic,
      shard,
      halo,
      light,
      flames,
      beams: [beam, markerRune],
      ringMat,
      taken: false,
      pickup: 0,
      index: si,
    });
  }
  return shrines;
}

function buildEmbers(scene, textures, shrines) {
  const count = 108;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const rng = mulberry32(9917);
  for (let i = 0; i < count; i++) {
    const s = shrines[i % shrines.length];
    const a = rng() * Math.PI * 2;
    const r = rng() * 2.4;
    positions[i * 3] = s.position.x + Math.cos(a) * r;
    positions[i * 3 + 1] = s.position.y + rng() * 2.2;
    positions[i * 3 + 2] = s.position.z + Math.sin(a) * r;
    phases[i] = rng() * 20;
    speeds[i] = 0.18 + rng() * 0.35;
    sizes[i] = 0.6 + rng() * 1.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: textures.glow },
      uColor: { value: new THREE.Color(0xffa75c) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float rise = mod(uTime * aSpeed + aPhase, 7.0);
        p.y += rise;
        p.x += sin(uTime * 0.7 + aPhase) * 0.35;
        p.z += cos(uTime * 0.5 + aPhase * 1.4) * 0.35;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * (150.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
        vAlpha = (1.0 - rise / 7.0) * 0.7;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        float a = tex.a * vAlpha * 0.7;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return { points, mat };
}

function buildGate(scene, textures, colliders) {
  const y = terrainHeight(0, 46);
  const group = new THREE.Group();
  group.position.set(0, y, 46);
  scene.add(group);

  const stoneMat = new THREE.MeshStandardMaterial({
    map: textures.stone,
    color: 0xa9a897,
    roughness: 0.97,
    metalness: 0,
  });
  const darkStoneMat = new THREE.MeshStandardMaterial({
    map: textures.stone,
    color: 0x7c7c70,
    roughness: 1,
    metalness: 0,
  });

  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(14 - i * 1.9, 0.18, 2.5 - i * 0.35), i === 2 ? darkStoneMat : stoneMat);
    step.position.set(0, 0.09 + i * 0.17, -i * 0.12);
    step.rotation.y = 0;
    group.add(step);
  }

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.75, 8.6, 1.95), stoneMat);
    pillar.position.set(side * 4.65, 4.35, 0);
    group.add(pillar);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.55, 2.5), darkStoneMat);
    base.position.set(side * 4.65, 0.32, 0);
    group.add(base);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.42, 2.35), darkStoneMat);
    cap.position.set(side * 4.65, 8.55, 0);
    group.add(cap);
    colliders.push({ x: side * 4.65, z: 46, r: 1.1, type: 'gate' });
  }

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(11.9, 1.15, 2.1), stoneMat);
  lintel.position.y = 9.2;
  group.add(lintel);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.55, 1.8), darkStoneMat);
  crown.position.y = 10.0;
  group.add(crown);

  // Iron spikes along the crown.
  for (let i = 0; i < 7; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.7, 5), new THREE.MeshStandardMaterial({ color: 0x1b1d1b, roughness: 0.7, metalness: 0.5 }));
    spike.position.set(-3.9 + i * 1.3, 10.55, 0);
    group.add(spike);
  }

  const runeTex = makeRuneTexture();
  const runeMat = new THREE.MeshBasicMaterial({
    map: runeTex,
    color: 0xffb76a,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const runeBand = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 0.72), runeMat);
  runeBand.position.set(0, 9.2, -1.07);
  group.add(runeBand);

  const voidUniforms = {
    uTime: { value: 0 },
    uOpen: { value: 0 },
  };
  const voidMat = new THREE.ShaderMaterial({
    uniforms: voidUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpen;
      varying vec2 vUv;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 uv = vUv;
        float n = noise(uv * vec2(4.0, 7.0) + vec2(0.0, uTime * 0.03));
        n += noise(uv * vec2(9.0, 15.0) - vec2(uTime * 0.05, 0.0)) * 0.5;
        float edge = smoothstep(0.0, 0.2, uv.x) * smoothstep(1.0, 0.8, uv.x) * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);
        vec3 dark = mix(vec3(0.005, 0.009, 0.01), vec3(0.035, 0.06, 0.058), n);
        vec3 pale = mix(vec3(0.35, 0.31, 0.22), vec3(0.95, 0.87, 0.68), n);
        vec3 col = mix(dark, pale, uOpen);
        float alpha = edge * mix(0.97, 0.82, uOpen);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
  });
  const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(8.3, 8.5), voidMat);
  voidPlane.position.set(0, 4.5, 0);
  group.add(voidPlane);

  // Three bell sockets.
  const sockets = [];
  const socketMatBase = {
    color: 0x171a17,
    roughness: 0.45,
    metalness: 0.65,
    emissive: 0x000000,
    emissiveIntensity: 0,
  };
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 2.55;
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12), new THREE.MeshStandardMaterial({ ...socketMatBase }));
    socket.rotation.x = Math.PI / 2;
    socket.position.set(x, 8.66, -1.1);
    group.add(socket);

    const bell = new THREE.Group();
    const bellBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.32, 0.5, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6d5a35, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide })
    );
    bellBody.position.y = -0.25;
    bell.add(bellBody);
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshStandardMaterial({ color: 0x2b2317, roughness: 0.5, metalness: 0.5 }));
    clapper.position.y = -0.52;
    bell.add(clapper);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4), new THREE.MeshStandardMaterial({ color: 0x24231f, roughness: 0.85, metalness: 0.3 }));
    chain.position.y = 0.55;
    bell.add(chain);
    bell.position.set(x, 7.8, -0.25);
    group.add(bell);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textures.glow,
      color: 0xffc177,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }));
    glow.scale.set(1.5, 1.5, 1);
    glow.position.set(x, 8.66, -1.2);
    group.add(glow);

    sockets.push({ socket, bell, bellBody, glow, lit: false });
  }

  const gateLight = new THREE.PointLight(0xffb26a, 0.8, 15, 2);
  gateLight.position.set(0, 6, -2);
  group.add(gateLight);

  // Brazier flames at the threshold.
  const flames = [];
  for (const side of [-1, 1]) {
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.24, 0.3, 8), darkStoneMat);
    bowl.position.set(side * 2.9, 0.55, -2.1);
    group.add(bowl);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textures.flame,
      color: 0xffa85f,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }));
    flame.position.set(side * 2.9, 1.0, -2.1);
    flame.scale.set(0.35, 0.7, 1);
    group.add(flame);
    flames.push({ sprite: flame, phase: Math.random() * 10 });
  }

  const blocker = { x: 0, z: 46, r: 4.5, type: 'gate' };
  colliders.push(blocker);

  return {
    group,
    position: new THREE.Vector3(0, y, 46),
    runeMat,
    runeBand,
    voidMat,
    voidUniforms,
    sockets,
    gateLight,
    flames,
    blocker,
    openValue: 0,
    relicCount: 0,
    isOpen: false,
  };
}

export function createWorld(scene) {
  const rng = mulberry32(48);
  const textures = {
    ground: makeGroundTexture(),
    path: makePathTexture(),
    stone: makeStoneTexture(),
    bark: makeBarkTexture(),
    grass: makeGrassTexture(),
    glow: makeGlowTexture(),
    flame: makeFlameTexture(),
    fog: makeFogTexture(),
  };

  const colliders = [];
  const sky = buildSky(scene);
  const terrain = buildTerrain(scene, textures);

  const hemisphere = new THREE.HemisphereLight(0x728a9c, 0x090c08, 1.15);
  scene.add(hemisphere);
  const moonLight = new THREE.DirectionalLight(0xaec4d6, 1.45);
  moonLight.position.set(-26, 42, -32);
  scene.add(moonLight);
  const ambient = new THREE.AmbientLight(0x2a3834, 0.44);
  scene.add(ambient);

  const paths = buildPaths(
    scene,
    new THREE.MeshStandardMaterial({
      map: textures.stone,
      color: 0xa8a89a,
      roughness: 0.96,
      metalness: 0,
    }),
    new THREE.MeshStandardMaterial({
      map: textures.path,
      color: 0x9f9a8c,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  const waymarks = buildWaymarks(scene, textures, paths);
  const forest = buildForest(scene, textures, colliders, paths);
  const rocks = buildRocks(scene, textures, colliders);
  const grass = buildGrass(scene, textures);
  const graves = buildGravestones(scene, textures, colliders);
  const mist = buildMist(scene, textures.fog);
  const motes = buildMotes(scene, textures.glow);
  const shrines = buildShrines(scene, textures);
  const embers = buildEmbers(scene, textures, shrines);
  const gate = buildGate(scene, textures, colliders);

  const colliderSnapshot = colliders.map((c) => ({ ...c }));
  const rngAnim = mulberry32(6104);

  const world = {
    scene,
    textures,
    sky: sky.sky,
    skyUniforms: sky.uniforms,
    terrain,
    hemisphere,
    moonLight,
    ambient,
    forest,
    rocks,
    grass,
    graves,
    mist,
    motes,
    shrines,
    embers,
    gate,
    waymarks,
    colliders,
    paths,
    heightAt: terrainHeight,

    isOccluded(ax, az, bx, bz) {
      const dx = bx - ax;
      const dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 0.001) return false;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (c.type !== 'tree' && c.type !== 'rock' && c.type !== 'gate') continue;
        const t = ((c.x - ax) * dx + (c.z - az) * dz) / lenSq;
        if (t < 0.05 || t > 0.96) continue;
        const px = ax + dx * t;
        const pz = az + dz * t;
        const rr = c.type === 'tree' ? c.r + 0.18 : c.r * 0.7;
        if (Math.hypot(px - c.x, pz - c.z) < rr) return true;
      }
      return false;
    },

    nearestShrine(position, maxDist = 3.1) {
      let nearest = null;
      let best = maxDist;
      for (const shrine of shrines) {
        if (shrine.taken) continue;
        const d = Math.hypot(position.x - shrine.position.x, position.z - shrine.position.z);
        if (d < best) { best = d; nearest = shrine; }
      }
      return nearest;
    },

    shrineDistance(position) {
      let best = Infinity;
      for (const shrine of shrines) {
        if (shrine.taken) continue;
        best = Math.min(best, Math.hypot(position.x - shrine.position.x, position.z - shrine.position.z));
      }
      return best;
    },

    takeShrine(shrine) {
      if (!shrine || shrine.taken) return;
      shrine.taken = true;
      shrine.pickup = 0.0001;
      shrine.beams.forEach((b) => { if (b.material) b.material.opacity = 0; });
      shrine.ringMat.opacity = 0.07;
      shrine.light.intensity = 1.0;
      shrine.flames.forEach((f) => { f.sprite.material.opacity = 0.35; });
    },

    setGateCount(n) {
      gate.relicCount = n;
      for (let i = 0; i < gate.sockets.length; i++) {
        const s = gate.sockets[i];
        const lit = i < n;
        s.lit = lit;
        s.socket.material.emissive.setHex(lit ? 0xff9b4a : 0x000000);
        s.socket.material.emissiveIntensity = lit ? 2.2 : 0;
        s.glow.material.opacity = lit ? 0.8 : 0;
        s.bellBody.material.emissive = new THREE.Color(lit ? 0x1b0f04 : 0x000000);
        s.bellBody.material.emissiveIntensity = lit ? 0.6 : 0;
      }
      gate.runeMat.opacity = 0.3 + n * 0.18;
      gate.gateLight.intensity = 0.7 + n * 0.8;
    },

    openGate() {
      gate.isOpen = true;
      const blockerIndex = colliders.indexOf(gate.blocker);
      if (blockerIndex >= 0) colliders.splice(blockerIndex, 1);
    },

    reset() {
      for (const shrine of shrines) {
        shrine.taken = false;
        shrine.pickup = 0;
        shrine.relic.visible = true;
        shrine.relic.position.y = 1.45;
        shrine.relic.scale.setScalar(1);
        shrine.halo.material.opacity = 0.85;
        shrine.light.intensity = 5.5;
        shrine.beams[0].material.opacity = 0.028;
        shrine.beams[1].material.opacity = 0.3;
        shrine.ringMat.opacity = 0.18;
        shrine.flames.forEach((f) => { f.sprite.material.opacity = 1; });
      }
      gate.isOpen = false;
      gate.openValue = 0;
      gate.relicCount = 0;
      gate.voidUniforms.uOpen.value = 0;
      gate.runeMat.opacity = 0.34;
      gate.gateLight.intensity = 0.8;
      for (const s of gate.sockets) {
        s.lit = false;
        s.socket.material.emissive.setHex(0x000000);
        s.socket.material.emissiveIntensity = 0;
        s.glow.material.opacity = 0;
        s.bellBody.material.emissive.setHex(0x000000);
      }
      if (!colliders.includes(gate.blocker)) colliders.push(gate.blocker);
    },

    update(dt, time) {
      sky.uniforms.uTime.value = time;
      mist.mat.uniforms.uTime.value = time;
      motes.mat.uniforms.uTime.value = time;
      embers.mat.uniforms.uTime.value = time;
      gate.voidUniforms.uTime.value = time;

      for (let i = 0; i < shrines.length; i++) {
        const s = shrines[i];
        if (!s.taken) {
          s.relic.rotation.y += dt * 0.8;
          s.shard.rotation.x += dt * 0.35;
          const bob = Math.sin(time * 1.3 + i * 2.1) * 0.07;
          s.relic.position.y = 1.45 + bob;
          s.halo.material.opacity = 0.68 + Math.sin(time * 2.4 + i) * 0.16;
          s.light.intensity = 5.2 + Math.sin(time * 5.1 + i * 2.7) * 0.7 + Math.sin(time * 13.2 + i) * 0.18;
          s.ringMat.opacity = 0.15 + Math.sin(time * 0.9 + i) * 0.035;
        } else if (s.pickup > 0 && s.pickup < 1) {
          s.pickup = Math.min(1, s.pickup + dt * 0.55);
          const t = s.pickup;
          s.relic.position.y = 1.45 + t * 2.4;
          s.relic.scale.setScalar(Math.max(0.001, 1 - t));
          s.relic.rotation.y += dt * (1.5 + t * 8);
          s.halo.material.opacity = 0.85 * (1 - t);
          s.light.intensity = 5.5 * (1 - t) + 1.0;
          if (t >= 1) s.relic.visible = false;
        }
        for (const f of s.flames) {
          const flicker = 0.82 + Math.sin(time * 11 + f.phase) * 0.12 + Math.sin(time * 23 + f.phase * 3) * 0.06;
          f.sprite.scale.set(0.19 * flicker, 0.34 * flicker, 1);
          f.sprite.position.y = f.baseY + Math.sin(time * 4 + f.phase) * 0.008;
        }
      }

      for (const f of gate.flames) {
        const flicker = 0.85 + Math.sin(time * 9 + f.phase) * 0.12;
        f.sprite.scale.set(0.35 * flicker, 0.7 * flicker, 1);
      }

      for (const lamp of waymarks) {
        const flicker = 0.82 + Math.sin(time * 8.7 + lamp.phase) * 0.13 + Math.sin(time * 19.3 + lamp.phase * 2) * 0.06;
        lamp.flame.scale.set(0.15 * flicker, 0.3 * flicker, 1);
        lamp.glow.material.opacity = 0.5 + flicker * 0.16;
        lamp.glass.emissiveIntensity = 2.2 + flicker * 0.9;
      }

      gate.runeMat.opacity = (0.3 + gate.relicCount * 0.14) * (0.86 + Math.sin(time * 1.7) * 0.14);
      gate.voidUniforms.uOpen.value += ((gate.isOpen ? 1 : 0) - gate.voidUniforms.uOpen.value) * Math.min(1, dt * 1.4);
      if (gate.isOpen) {
        gate.openValue = Math.min(1, gate.openValue + dt * 0.5);
        gate.gateLight.intensity = 5 + Math.sin(time * 2) * 1.2;
        gate.voidMat.opacity = 1;
      }

      // Faint idle sway on the shrine rings.
      for (let i = 0; i < shrines.length; i++) {
        const s = shrines[i];
        s.group.rotation.y = Math.sin(time * 0.02 + i) * 0.003;
      }
    },
  };

  // Keep a stable collider set for resets.
  world.__initialColliders = colliderSnapshot;
  world.__resetColliders = () => {
    colliders.length = 0;
    for (const c of colliderSnapshot) colliders.push({ ...c });
  };

  return world;
}
