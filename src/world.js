import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  clamp,
  fbm,
  hash2,
  lerp,
  makeRng,
  mulberry32,
  smoothstep,
  terrainHeight,
} from './utils.js';

const TAU = Math.PI * 2;

const TREE_SPOTS = [
  { x: -12.8, z: 13.2, h: 5.8, r: 3.3 },
  { x: 10.8, z: -9.2, h: 5.1, r: 2.9 },
  { x: -14.2, z: -8.5, h: 6.4, r: 3.3 },
  { x: 17.5, z: 13.8, h: 5.4, r: 2.9 },
  { x: 3.2, z: 18.5, h: 5.0, r: 2.6 },
  { x: -21.5, z: 2.8, h: 6.0, r: 3.1 },
  { x: 23.5, z: -18.5, h: 6.8, r: 3.6 },
  { x: -26.0, z: 18.0, h: 6.2, r: 3.4 },
  { x: 28.5, z: 4.0, h: 5.4, r: 3.0 },
  { x: -4.5, z: -23.0, h: 7.0, r: 3.7 },
  { x: 32.0, z: 21.0, h: 7.2, r: 3.8 },
  { x: -34.0, z: -8.0, h: 6.6, r: 3.4 },
  { x: 37.0, z: -9.0, h: 7.0, r: 3.6 },
  { x: 8.0, z: 31.0, h: 6.0, r: 3.2 },
  { x: -18.0, z: 32.0, h: 6.4, r: 3.4 },
  { x: 30.0, z: 34.0, h: 7.4, r: 4.0 },
];

function colorGeo(geometry, hex, { intensity = 1 } = {}) {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    values[i * 3] = color.r * intensity;
    values[i * 3 + 1] = color.g * intensity;
    values[i * 3 + 2] = color.b * intensity;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geometry;
}

function transformed(geometry, matrix) {
  geometry.applyMatrix4(matrix);
  return geometry;
}

function compose(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  return matrix;
}

function createGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const random = mulberry32(9931);

  // A mottled carpet of greens and dry straw, rather than one flat colour.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const grain = random();
      const fleck = fbm(x * 0.045, y * 0.045, 4);
      const patch = fbm(x * 0.014 + 8, y * 0.014 - 3, 3);
      const tone = 0.52 + fleck * 0.34 + patch * 0.2;
      const dry = smoothstep(0.64, 0.94, patch) * 0.26;
      const value = 0.66 + grain * 0.14 + fleck * 0.1;
      img.data[i] = (108 + dry * 62) * value;
      img.data[i + 1] = (132 + dry * 24) * value;
      img.data[i + 2] = (72 - dry * 10) * value;
      img.data[i + 3] = 255;
      if (tone < 0.2) {
        // Damp, dark hollows between the tussocks.
        img.data[i] *= 0.82;
        img.data[i + 1] *= 0.82;
        img.data[i + 2] *= 0.82;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // Fine grass strokes and clover leaves break up the repeat.
  for (let i = 0; i < 5200; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = 1.6 + random() * 5;
    const lean = (random() - 0.5) * 3.4;
    const light = random();
    ctx.strokeStyle = light > 0.78
      ? `rgba(168, 160, 92, ${0.18 + random() * 0.16})`
      : `rgba(${44 + light * 38}, ${64 + light * 42}, ${32 + light * 22}, ${0.2 + random() * 0.2})`;
    ctx.lineWidth = 0.5 + random() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * 0.4, y - length * 0.6, x + lean, y - length);
    ctx.stroke();
  }

  for (let i = 0; i < 320; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 1 + random() * 2.4;
    ctx.fillStyle = random() > 0.55 ? 'rgba(96, 124, 58, .5)' : 'rgba(118, 144, 72, .42)';
    ctx.beginPath();
    for (let leaf = 0; leaf < 3; leaf += 1) {
      const a = leaf * (TAU / 3) + random() * 0.3;
      ctx.ellipse(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.55, r * 0.34, a, 0, TAU);
    }
    ctx.fill();
  }

  for (let i = 0; i < 90; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 1.6 + random() * 4;
    ctx.fillStyle = `rgba(104, 88, 60, ${0.14 + random() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, random() * TAU, 0, TAU);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(30, 30);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createEnvironment(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#4d7397');
  sky.addColorStop(0.28, '#8fa6a8');
  sky.addColorStop(0.44, '#dfc39a');
  sky.addColorStop(0.55, '#f6c27c');
  sky.addColorStop(0.64, '#8e8b53');
  sky.addColorStop(1, '#2f4027');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 512);

  // Low, warm sun in the equirectangular environment.
  const sunX = 700;
  const sunY = 250;
  const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 190);
  glow.addColorStop(0, 'rgba(255, 252, 226, 1)');
  glow.addColorStop(0.035, 'rgba(255, 238, 176, .95)');
  glow.addColorStop(0.18, 'rgba(255, 200, 122, .4)');
  glow.addColorStop(1, 'rgba(255, 184, 108, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 512);

  // Long, soft sunset clouds.
  const cloudRandom = mulberry32(4412);
  for (let i = 0; i < 26; i += 1) {
    const y = 118 + cloudRandom() * 150;
    const w = 90 + cloudRandom() * 320;
    const h = 8 + cloudRandom() * 26;
    ctx.globalAlpha = 0.05 + cloudRandom() * 0.1;
    ctx.fillStyle = i % 3 === 0 ? '#ffd9ae' : '#fff1dc';
    ctx.beginPath();
    ctx.ellipse(cloudRandom() * 1024, y, w, h, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const equirect = new THREE.CanvasTexture(canvas);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(equirect).texture;
  equirect.dispose();
  pmrem.dispose();
  return env;
}

function createTerrain() {
  const geometry = new THREE.PlaneGeometry(112, 112, 128, 128);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const groundTexture = createGroundTexture();

  const lower = new THREE.Color('#5a7040');
  const middle = new THREE.Color('#77894d');
  const dry = new THREE.Color('#a1925a');
  const dark = new THREE.Color('#4c6438');
  const soil = new THREE.Color('#6f5f43');
  const base = new THREE.Color('#667c45');

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = terrainHeight(x, z);
    position.setY(i, y);

    const patch = fbm(x * 0.16 + 22, z * 0.16 + 18, 4);
    const micro = fbm(x * 0.8 + 2, z * 0.8 + 5, 2);
    const tone = clamp(patch * 0.8 + micro * 0.18 + 0.09, 0, 1);
    const c = new THREE.Color();
    if (tone < 0.46) c.copy(dark).lerp(lower, smoothstep(0.2, 0.46, tone));
    else c.copy(lower).lerp(middle, smoothstep(0.46, 0.68, tone));
    c.lerp(dry, smoothstep(0.68, 0.95, tone) * 0.24);

    // A little worn earth at the edges of the glade.
    const bare = smoothstep(0.76, 0.96, fbm(x * 0.28 + 12, z * 0.28 + 3, 3));
    c.lerp(soil, bare * 0.22);
    // Keep the ground close to a meadow green even in its shaded hollows.
    c.lerp(base, 0.2);

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: groundTexture,
    bumpMap: groundTexture,
    bumpScale: 0.35,
    roughness: 0.99,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.name = 'Meadow floor';
  return mesh;
}

function createGrassGeometry({ blades = 5, width = 0.017, bend = 0.3, seed = 6512, segments = 3 } = {}) {
  const positions = [];
  const colors = [];
  const indices = [];
  const random = mulberry32(seed);

  for (let blade = 0; blade < blades; blade += 1) {
    const angle = random() * TAU;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const offset = 0.008 + random() * 0.026;
    const bladeWidth = width * (0.7 + random() * 0.65);
    const bladeBend = bend * (0.55 + random() * 1.0);
    const lean = (random() - 0.5) * 0.12;
    const base = positions.length / 3;

    for (let s = 0; s <= segments; s += 1) {
      const t = s / segments;
      // Narrow, tapering blades that arc over at the tip.
      const w = bladeWidth * Math.pow(1 - t, 0.72) * (1 - t * 0.12);
      const sway = bladeBend * t * t * (1.7 - t * 0.7);
      const cx = dirX * (offset + sway) + sideX * lean * t;
      const cz = dirZ * (offset + sway) + sideZ * lean * t;
      const px = cx + sideX * w;
      const pz = cz + sideZ * w;
      const px2 = cx - sideX * w;
      const pz2 = cz - sideZ * w;
      const shade = 0.48 + t * 0.58;
      // Straw-warm tips, deep green roots. Instance colour tints the whole blade.
      const tip = t * t;

      positions.push(px, t, pz, px2, t, pz2);
      colors.push(
        shade * (1 + tip * 0.08), shade * (1 - tip * 0.01), shade * (1 - tip * 0.19),
        shade * (1 + tip * 0.08), shade * (1 - tip * 0.01), shade * (1 - tip * 0.19)
      );

      if (s < segments) {
        const i = base + s * 2;
        indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addWind(material, timeUniform, amount = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uWind = { value: amount };
    shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
        #include <begin_vertex>
        float windHeight = clamp(transformed.y, 0.0, 1.0);
        float windPhase = instanceMatrix[3].x * 0.62 + instanceMatrix[3].z * 0.43;
        float windSway = (
          sin(uTime * 1.15 + windPhase) * 0.105 +
          sin(uTime * 2.37 + windPhase * 1.83) * 0.035 +
          sin(uTime * 0.46 + windPhase * 0.37) * 0.08
        ) * uWind;
        transformed.x += windSway * windHeight * windHeight;
        transformed.z += windSway * 0.32 * windHeight * windHeight;
      `
    );
  };
  material.customProgramCacheKey = () => `wind-${amount}`;
}

function createGrassLayer({
  count,
  seed,
  geometry,
  heightMin,
  heightMax,
  innerRadius,
  outerRadius,
  farShare = 0,
  farInner = 22,
  farOuter = 46,
  timeUniform,
  name,
  grassScale = 1,
  sway = 1,
}) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.4,
  });
  addWind(material, timeUniform, sway);

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = name;
  mesh.frustumCulled = false;

  const random = makeRng(seed);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = ['#6f8a45', '#81994f', '#5e793d', '#93a05c', '#55703a', '#a39a5f'];

  for (let i = 0; i < count; i += 1) {
    const far = random.chance(farShare);
    let x;
    let z;
    if (far) {
      const radius = farInner + Math.sqrt(random.random()) * (farOuter - farInner);
      const angle = random.random() * TAU;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    } else {
      const radius = innerRadius + Math.pow(random.random(), 1.35) * (outerRadius - innerRadius);
      const angle = random.random() * TAU;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    }
    const height = random.range(heightMin, heightMax) * (far ? 1.12 : 1) * grassScale;
    dummy.position.set(x, terrainHeight(x, z) - 0.014, z);
    dummy.rotation.set(random.range(-0.055, 0.055), random.random() * TAU, random.range(-0.045, 0.045));
    dummy.scale.set(random.range(0.72, 1.18), height, random.range(0.72, 1.18));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    color.set(random.pick(palette));
    color.offsetHSL(random.range(-0.018, 0.018), random.range(-0.06, 0.05), random.range(-0.055, 0.055));
    mesh.setColorAt(i, color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function createGrass(quality, timeUniform) {
  const group = new THREE.Group();
  group.name = 'Meadow grass';

  // A dense carpet of short blades close to the camera...
  const turf = createGrassLayer({
    count: Math.round((quality.grass ?? 14000) * 1.45),
    seed: 2077,
    geometry: createGrassGeometry({ blades: 4, width: 0.0115, bend: 0.24, seed: 881, segments: 2 }),
    heightMin: 0.055,
    heightMax: 0.145,
    innerRadius: 0.8,
    outerRadius: 19,
    timeUniform,
    name: 'Turf',
    grassScale: quality.grassScale ?? 1,
    sway: 0.55,
  });

  // ...and taller tussocks that give the field its shaggy silhouette.
  const tall = createGrassLayer({
    count: Math.round((quality.grass ?? 14000) * 0.55),
    seed: 3055,
    geometry: createGrassGeometry({ blades: 6, width: 0.016, bend: 0.36, seed: 219 }),
    heightMin: 0.15,
    heightMax: 0.33,
    innerRadius: 1.2,
    outerRadius: 25,
    farShare: 0.4,
    farInner: 24,
    farOuter: 47,
    timeUniform,
    name: 'Long grass',
    grassScale: quality.grassScale ?? 1,
    sway: 1,
  });

  group.add(turf, tall);
  group.userData.layers = [turf, tall];
  group.userData.reduce = () => {
    for (const layer of group.userData.layers) {
      layer.count = Math.floor(layer.count * 0.62);
    }
  };
  return group;
}

function addSway(material, timeUniform, amount = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uSway = { value: amount };
    shader.vertexShader = 'uniform float uTime;\nuniform float uSway;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
        #include <begin_vertex>
        float swayH = clamp(transformed.y, 0.0, 1.0);
        float swayP = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;
        float sway = sin(uTime * 1.25 + swayP) * 0.035 + sin(uTime * 2.1 + swayP * 1.4) * 0.012;
        transformed.x += sway * swayH * swayH * uSway;
        transformed.z += sway * 0.4 * swayH * swayH * uSway;
      `
    );
  };
  material.customProgramCacheKey = () => `sway-${amount}`;
}

function addPetal(geos, { angle, offset, length, width, tilt, color, y, roll = 0 }) {
  const petal = colorGeo(new THREE.CircleGeometry(1, 8), color);
  petal.scale(length, width, 1);
  petal.rotateX(-Math.PI / 2);
  petal.rotateZ(tilt);
  petal.rotateY(roll);
  petal.translate(offset + length * 0.42, y, 0);

  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  const basis = new THREE.Matrix4().makeBasis(radial, new THREE.Vector3(0, 1, 0), tangent);
  petal.applyMatrix4(basis);
  geos.push(petal);
}

function makeDaisyGeometry() {
  const geos = [];
  geos.push(
    transformed(colorGeo(new THREE.CylinderGeometry(0.0055, 0.011, 1, 5), '#587238'), compose(0, 0.5, 0))
  );

  // Three narrow, softly curved leaves along the stem.
  for (let i = 0; i < 3; i += 1) {
    const leaf = colorGeo(new THREE.CircleGeometry(1, 7), i === 1 ? '#4f6a35' : '#5d783e');
    leaf.scale(0.055, 0.015, 1);
    leaf.rotateX(-Math.PI / 2 + 0.5);
    leaf.rotateY(0.25);
    const a = i * 2.1 + 0.6;
    transformed(leaf, compose(Math.cos(a) * 0.042, 0.25 + i * 0.1, Math.sin(a) * 0.042, 0, -a, 0));
    geos.push(leaf);
  }

  const sepals = colorGeo(new THREE.SphereGeometry(0.026, 7, 4), '#55703a');
  sepals.scale(1, 0.62, 1);
  transformed(sepals, compose(0, 0.975, 0));
  geos.push(sepals);

  // Two staggered rings of cupped petals read as a flower, not a disc.
  for (let ring = 0; ring < 2; ring += 1) {
    const count = ring === 0 ? 9 : 7;
    const radius = ring === 0 ? 0.026 : 0.018;
    const tilt = ring === 0 ? 0.14 : 0.42;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU + ring * 0.34;
      addPetal(geos, {
        angle: a,
        offset: radius,
        length: ring === 0 ? 0.034 : 0.027,
        width: ring === 0 ? 0.0105 : 0.009,
        tilt,
        color: ring === 0 ? '#efe7d4' : '#fbf5e6',
        y: 0.985 + ring * 0.004,
        roll: (Math.sin(i * 4.3) * 0.05),
      });
    }
  }

  const center = colorGeo(new THREE.SphereGeometry(0.021, 10, 6), '#d9a43c');
  center.scale(1, 0.6, 1);
  transformed(center, compose(0, 1.0, 0));
  geos.push(center);

  const pollen = colorGeo(new THREE.SphereGeometry(0.013, 8, 5), '#f0c65c');
  pollen.scale(1, 0.4, 1);
  transformed(pollen, compose(0.008, 1.012, -0.004));
  geos.push(pollen);

  return mergeGeometries(geos, false);
}

function makeDandelionGeometry() {
  const geos = [];
  geos.push(
    transformed(colorGeo(new THREE.CylinderGeometry(0.005, 0.01, 0.94, 5), '#627b3e'), compose(0, 0.47, 0))
  );
  const head = colorGeo(new THREE.SphereGeometry(0.076, 10, 8), '#f0e7d1');
  transformed(head, compose(0, 0.96, 0));
  geos.push(head);

  const random = mulberry32(81);
  for (let i = 0; i < 15; i += 1) {
    const seed = colorGeo(new THREE.SphereGeometry(0.009, 4, 3), '#fff7e4');
    const theta = random() * TAU;
    const phi = Math.acos(1 - random() * 1.25);
    const r = 0.078;
    const x = Math.sin(phi) * Math.cos(theta) * r;
    const y = 0.96 + Math.cos(phi) * r;
    const z = Math.sin(phi) * Math.sin(theta) * r;
    transformed(seed, compose(x, y, z));
    geos.push(seed);
  }
  return mergeGeometries(geos, false);
}

function makePoppyGeometry() {
  const geos = [];
  geos.push(
    transformed(colorGeo(new THREE.CylinderGeometry(0.006, 0.012, 0.82, 5), '#526b3a'), compose(0, 0.41, 0))
  );

  for (let i = 0; i < 2; i += 1) {
    const leaf = colorGeo(new THREE.CircleGeometry(1, 6), '#5a743f');
    leaf.scale(0.06, 0.016, 1);
    leaf.rotateX(-Math.PI / 2 + 0.62);
    const a = 2.6 + i * 2.4;
    transformed(leaf, compose(Math.cos(a) * 0.035, 0.34 + i * 0.14, Math.sin(a) * 0.035, 0, -a, 0));
    geos.push(leaf);
  }

  const sepals = colorGeo(new THREE.SphereGeometry(0.026, 8, 5), '#4f6837');
  sepals.scale(1.1, 0.55, 1.1);
  transformed(sepals, compose(0, 0.795, 0));
  geos.push(sepals);

  // Broad, cupped, slightly crumpled petals around a dark seed head.
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * TAU + 0.22;
    addPetal(geos, {
      angle: a,
      offset: 0.012,
      length: 0.058,
      width: 0.045,
      tilt: 0.48,
      color: i === 0 ? '#f07a58' : i === 2 ? '#e96b49' : '#e25f41',
      y: 0.815 + (i % 2) * 0.004,
      roll: (i % 2 === 0 ? 0.08 : -0.06),
    });
  }

  const center = colorGeo(new THREE.SphereGeometry(0.022, 8, 6), '#2c2118');
  center.scale(1, 0.7, 1);
  transformed(center, compose(0, 0.832, 0));
  geos.push(center);

  const random = mulberry32(551);
  for (let i = 0; i < 9; i += 1) {
    const stamen = colorGeo(new THREE.SphereGeometry(0.0045, 4, 3), '#4a3826');
    const a = (i / 9) * TAU + random() * 0.3;
    const r = 0.023 + random() * 0.006;
    transformed(stamen, compose(Math.cos(a) * r, 0.834 + random() * 0.006, Math.sin(a) * r));
    geos.push(stamen);
  }

  return mergeGeometries(geos, false);
}

function makeLavenderGeometry() {
  const geos = [];
  geos.push(
    transformed(colorGeo(new THREE.CylinderGeometry(0.004, 0.008, 1, 4), '#566e3d'), compose(0, 0.5, 0))
  );
  const random = mulberry32(413);
  for (let i = 0; i < 12; i += 1) {
    const flower = colorGeo(new THREE.SphereGeometry(0.022, 5, 4), i % 3 === 0 ? '#9277b2' : '#7c679f');
    const y = 0.56 + (i / 11) * 0.42;
    const r = 0.034 * (1 - i / 18);
    const a = i * 2.4 + random() * 0.4;
    transformed(flower, compose(Math.cos(a) * r, y, Math.sin(a) * r));
    geos.push(flower);
  }
  return mergeGeometries(geos, false);
}

function makeCloverGeometry() {
  const geos = [];
  geos.push(
    transformed(colorGeo(new THREE.CylinderGeometry(0.006, 0.009, 0.19, 4), '#4f7138'), compose(0, 0.095, 0))
  );
  for (let i = 0; i < 3; i += 1) {
    const leaf = colorGeo(new THREE.CircleGeometry(0.055, 7), i === 1 ? '#4f7837' : '#5b843e');
    leaf.scale(1, 0.8, 1);
    leaf.rotateX(-Math.PI / 2);
    const a = (i / 3) * TAU;
    transformed(leaf, compose(Math.cos(a) * 0.045, 0.18, Math.sin(a) * 0.045, 0, -a, 0));
    geos.push(leaf);
  }
  return mergeGeometries(geos, false);
}

function scatterInstances({ geometry, material, count, seed, minRadius, maxRadius, scaleMin, scaleMax, palette, timeUniform, sway = 1, yOffset = 0, name }) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  addSway(material, timeUniform, sway);

  const random = makeRng(seed);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    const angle = random.random() * TAU;
    const radius = minRadius + Math.pow(random.random(), 1.4) * (maxRadius - minRadius);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const s = random.range(scaleMin, scaleMax);
    dummy.position.set(x, terrainHeight(x, z) + yOffset, z);
    dummy.rotation.set(random.range(-0.04, 0.04), random.random() * TAU, random.range(-0.035, 0.035));
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.set(random.pick(palette));
    color.offsetHSL(random.range(-0.02, 0.02), random.range(-0.06, 0.06), random.range(-0.05, 0.06));
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function addFlowers(scene, timeUniform, quality) {
  const flowerMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0,
  });

  const types = [
    {
      geometry: makeDaisyGeometry(),
      count: Math.round(260 * quality.flowerScale),
      seed: 771,
      minRadius: 2.2,
      maxRadius: 23,
      scaleMin: 0.18,
      scaleMax: 0.31,
      palette: ['#fffaf0', '#f4edda', '#fffdf6', '#efe5d0'],
      name: 'Daisies',
    },
    {
      geometry: makeDandelionGeometry(),
      count: Math.round(80 * quality.flowerScale),
      seed: 972,
      minRadius: 1.8,
      maxRadius: 26,
      scaleMin: 0.2,
      scaleMax: 0.33,
      palette: ['#f8f1dd', '#fff9e9', '#ebe1c9', '#f5ead1'],
      name: 'Dandelion clocks',
    },
    {
      geometry: makePoppyGeometry(),
      count: Math.round(78 * quality.flowerScale),
      seed: 316,
      minRadius: 3.5,
      maxRadius: 25,
      scaleMin: 0.2,
      scaleMax: 0.36,
      palette: ['#e46f4f', '#d95c42', '#ec7b56', '#cf5039'],
      name: 'Poppies',
    },
    {
      geometry: makeLavenderGeometry(),
      count: Math.round(110 * quality.flowerScale),
      seed: 620,
      minRadius: 2.8,
      maxRadius: 22,
      scaleMin: 0.2,
      scaleMax: 0.34,
      palette: ['#9479b4', '#856ba6', '#a288c2', '#796092'],
      name: 'Lavender',
    },
    {
      geometry: makeCloverGeometry(),
      count: Math.round(900 * quality.flowerScale),
      seed: 410,
      minRadius: 1.0,
      maxRadius: 27,
      scaleMin: 0.42,
      scaleMax: 0.82,
      palette: ['#4e7238', '#5d803f', '#436630', '#6a8b49'],
      name: 'Clover',
      sway: 0.35,
    },
  ];

  for (const type of types) {
    scene.add(
      scatterInstances({
        ...type,
        material: flowerMaterial,
        timeUniform,
        sway: type.sway ?? 1,
      })
    );
  }

  return flowerMaterial;
}

function createMushroomGeometry() {
  const geos = [];
  geos.push(
    transformed(colorGeo(new THREE.CylinderGeometry(0.03, 0.045, 0.44, 7), '#e4d6b8'), compose(0, 0.22, 0))
  );
  const cap = colorGeo(new THREE.SphereGeometry(0.16, 10, 6, 0, TAU, 0, Math.PI / 2), '#a94e3a');
  cap.scale(1, 0.68, 1);
  transformed(cap, compose(0, 0.43, 0));
  geos.push(cap);

  const random = mulberry32(919);
  for (let i = 0; i < 6; i += 1) {
    const spot = colorGeo(new THREE.SphereGeometry(0.018, 5, 4), '#f2e5c9');
    const angle = random() * TAU;
    const radius = 0.04 + random() * 0.08;
    transformed(spot, compose(Math.cos(angle) * radius, 0.49 + random() * 0.025, Math.sin(angle) * radius, 0, 0, 0, 1, 0.35, 1));
    geos.push(spot);
  }
  return mergeGeometries(geos, false);
}

function addMushrooms(scene, timeUniform, quality) {
  const geometry = createMushroomGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = scatterInstances({
    geometry,
    material,
    count: Math.round(32 * quality.flowerScale),
    seed: 606,
    minRadius: 3.2,
    maxRadius: 24,
    scaleMin: 0.22,
    scaleMax: 0.5,
    palette: ['#b2503a', '#9e4834', '#bd5b42', '#8f4131'],
    timeUniform,
    sway: 0.22,
    name: 'Mushrooms',
  });
  mesh.castShadow = true;
  scene.add(mesh);
}

function createTreeGeometry() {
  const geos = [];
  const trunk = colorGeo(new THREE.CylinderGeometry(0.23, 0.42, 1, 7, 4), '#554634');
  transformed(trunk, compose(0, 0.5, 0));
  geos.push(trunk);

  const branches = [
    { x: 0.18, y: 0.66, z: 0.02, rx: 0.1, rz: -0.55, s: 0.55 },
    { x: -0.16, y: 0.7, z: 0.06, rx: -0.2, rz: 0.52, s: 0.5 },
    { x: 0.05, y: 0.76, z: -0.12, rx: 0.55, rz: 0.1, s: 0.46 },
  ];
  for (const b of branches) {
    const branch = colorGeo(new THREE.CylinderGeometry(0.06, 0.12, 1, 5), '#4b3d2e');
    transformed(branch, compose(b.x, b.y, b.z, b.rx, 0, b.rz, 1, b.s, 1));
    geos.push(branch);
  }
  return mergeGeometries(geos, false);
}

function createBarkTexture() {
  const width = 128;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const random = mulberry32(7712);
  ctx.fillStyle = '#e3d7c0';
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 90; i += 1) {
    const x = random() * width;
    const w = 1 + random() * 3.5;
    const shade = 120 + random() * 45;
    ctx.strokeStyle = `rgba(${shade - 20}, ${shade - 34}, ${shade - 52}, ${0.28 + random() * 0.38})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    let cx = x;
    for (let y = 0; y <= height; y += 16) {
      cx += (random() - 0.5) * 5;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 26; i += 1) {
    const x = random() * width;
    const y = random() * height;
    ctx.fillStyle = `rgba(82, 62, 44, ${0.25 + random() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + random() * 5, 4 + random() * 10, random() * 0.5, 0, TAU);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 2.6);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function addTrees(scene, timeUniform, quality) {
  const trunkMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: createBarkTexture(),
    roughness: 0.98,
    metalness: 0,
  });
  const trunkGeometry = createTreeGeometry();
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, TREE_SPOTS.length);
  trunkMesh.name = 'Tree trunks';
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  trunkMesh.frustumCulled = false;

  const foliageGeometry = new THREE.IcosahedronGeometry(1, 1);
  // Break up each leaf cluster so the crown reads as dappled foliage.
  const position = foliageGeometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const n = 0.82 + hash2(x * 5.1 + 7, y * 4.7 + z * 6.3) * 0.34;
    position.setXYZ(i, x * n, y * n * 0.9, z * n);
  }
  foliageGeometry.computeVertexNormals();

  const foliageMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.96,
    metalness: 0,
    flatShading: false,
  });
  addWind(foliageMaterial, timeUniform, 0.5);

  const clustersPerTree = Math.max(36, Math.round(112 * quality.treeScale));
  const clusterCount = TREE_SPOTS.length * clustersPerTree;
  const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, clusterCount);
  foliageMesh.name = 'Tree crowns';
  foliageMesh.castShadow = true;
  foliageMesh.receiveShadow = true;
  foliageMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = ['#4c6336', '#5d7340', '#3f562e', '#6a7d46', '#36502a', '#78864e'];
  const random = makeRng(1515);
  let index = 0;

  TREE_SPOTS.forEach((tree, t) => {
    const ground = terrainHeight(tree.x, tree.z);
    const trunkScale = tree.h / 7;
    dummy.position.set(tree.x, ground, tree.z);
    dummy.rotation.set(0, random.random() * TAU, 0);
    dummy.scale.set(trunkScale * 1.3, tree.h, trunkScale * 1.3);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(t, dummy.matrix);

    for (let c = 0; c < clustersPerTree; c += 1) {
      if (index >= clusterCount) break;
      const u = random.random();
      const yFrac = 0.4 + u * 0.62;
      const envelope = Math.sin(Math.PI * Math.min(0.98, 0.15 + u * 0.86));
      const a = random.random() * TAU;
      const r = Math.pow(random.random(), 0.55) * tree.r * (0.4 + envelope * 0.62);
      const y = ground + tree.h * yFrac + Math.cos(a) * 0.22;
      dummy.position.set(tree.x + Math.cos(a) * r, y, tree.z + Math.sin(a) * r);
      dummy.rotation.set(random.range(-0.55, 0.55), random.random() * TAU, random.range(-0.55, 0.55));
      const s = random.range(0.18, 0.36) * trunkScale * (0.85 + envelope * 0.5);
      dummy.scale.set(s, s * random.range(0.7, 1.05), s);
      dummy.updateMatrix();
      foliageMesh.setMatrixAt(index, dummy.matrix);
      color.set(random.pick(palette));
      color.offsetHSL(random.range(-0.02, 0.02), random.range(-0.06, 0.05), random.range(-0.06, 0.05) + (yFrac - 0.55) * 0.05);
      foliageMesh.setColorAt(index, color);
      index += 1;
    }
  });

  trunkMesh.instanceMatrix.needsUpdate = true;
  foliageMesh.instanceMatrix.needsUpdate = true;
  if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
  scene.add(trunkMesh, foliageMesh);

  return {
    colliders: TREE_SPOTS.map((t) => ({ x: t.x, z: t.z, radius: 0.82 * (t.h / 7) })),
  };
}

function addRocks(scene, quality) {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.96,
    metalness: 0,
  });
  const count = Math.round(38 * quality.rockScale);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'Stones';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const random = makeRng(933);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = ['#7c7968', '#69695c', '#898674', '#5c6153', '#807d6c'];
  const colliders = [];

  for (let i = 0; i < count; i += 1) {
    const nearTree = random.chance(0.45);
    let x;
    let z;
    if (nearTree) {
      const tree = random.pick(TREE_SPOTS);
      const a = random.random() * TAU;
      const r = random.range(1.4, 3.2);
      x = tree.x + Math.cos(a) * r;
      z = tree.z + Math.sin(a) * r;
    } else {
      const a = random.random() * TAU;
      const r = random.range(5, 28);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    const s = random.range(0.12, 0.5);
    dummy.position.set(x, terrainHeight(x, z) + s * 0.18, z);
    dummy.rotation.set(random.range(-0.3, 0.3), random.random() * TAU, random.range(-0.3, 0.3));
    dummy.scale.set(s * random.range(0.8, 1.45), s * random.range(0.55, 0.9), s * random.range(0.8, 1.3));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.set(random.pick(palette));
    color.offsetHSL(random.range(-0.02, 0.02), random.range(-0.06, 0.04), random.range(-0.05, 0.05));
    mesh.setColorAt(i, color);
    if (s > 0.28) colliders.push({ x, z, radius: s * 0.9 });
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return colliders;
}

function addBurrow(scene) {
  const x = 7.7;
  const z = 8.8;
  const y = terrainHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = -0.5;

  const moundGeo = new THREE.SphereGeometry(1.25, 20, 10, 0, TAU, 0, Math.PI / 2);
  moundGeo.scale(1, 0.28, 0.82);
  const moundMat = new THREE.MeshStandardMaterial({ color: '#66573e', roughness: 1 });
  const mound = new THREE.Mesh(moundGeo, moundMat);
  mound.position.y = -0.01;
  mound.receiveShadow = true;
  mound.castShadow = true;

  const holeGeo = new THREE.CircleGeometry(0.64, 28);
  holeGeo.rotateX(-Math.PI / 2);
  holeGeo.scale(1, 1, 0.66);
  const holeMat = new THREE.MeshBasicMaterial({ color: '#17130f' });
  const hole = new THREE.Mesh(holeGeo, holeMat);
  hole.position.set(0, 0.16, 0.48);

  const rimGeo = new THREE.TorusGeometry(0.62, 0.09, 5, 20);
  rimGeo.rotateX(-Math.PI / 2);
  rimGeo.scale(1, 1, 0.64);
  const rimMat = new THREE.MeshStandardMaterial({ color: '#746044', roughness: 1 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.copy(hole.position);
  rim.position.y += 0.02;
  rim.receiveShadow = true;

  group.add(mound, hole, rim);
  scene.add(group);
}

function createLogEndTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const random = mulberry32(317);
  ctx.fillStyle = '#b08a5b';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);

  for (let r = size * 0.5; r > 4; r -= 3 + random() * 4) {
    ctx.strokeStyle = random() > 0.5 ? 'rgba(104, 77, 48, .38)' : 'rgba(212, 177, 126, .32)';
    ctx.lineWidth = 1 + random() * 1.6;
    ctx.beginPath();
    for (let a = 0; a <= TAU + 0.1; a += 0.18) {
      const rr = r + Math.sin(a * 3.1 + r) * 1.2;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 9; i += 1) {
    const a = random() * TAU;
    ctx.strokeStyle = 'rgba(80, 58, 36, .35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    ctx.lineTo(Math.cos(a + 0.2) * 54, Math.sin(a + 0.2) * 54);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addFallenLog(scene) {
  const x = -2.8;
  const z = 12.8;
  const y = terrainHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = 0.7;

  const bark = new THREE.MeshStandardMaterial({
    map: createBarkTexture(),
    color: '#9d8363',
    roughness: 1,
  });
  const end = new THREE.MeshStandardMaterial({
    map: createLogEndTexture(),
    roughness: 0.9,
  });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.41, 4.4, 9, 4), bark);
  trunk.rotation.z = Math.PI / 2;
  trunk.position.y = 0.34;
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  const cutA = new THREE.Mesh(new THREE.CircleGeometry(0.34, 12), end);
  cutA.position.set(2.2, 0.34, 0);
  cutA.rotation.y = Math.PI / 2;
  const cutB = cutA.clone();
  cutB.position.x = -2.2;
  cutB.rotation.y = -Math.PI / 2;

  const moss = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 5), new THREE.MeshStandardMaterial({ color: '#61753d', roughness: 1 }));
  moss.scale.set(2.1, 0.12, 0.55);
  moss.position.set(-0.5, 0.72, 0);
  moss.castShadow = true;

  group.add(trunk, cutA, cutB, moss);
  scene.add(group);
}

function addPollen(scene) {
  const count = 520;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const random = makeRng(8821);

  for (let i = 0; i < count; i += 1) {
    const a = random.random() * TAU;
    const r = Math.sqrt(random.random()) * 24;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    positions[i * 3] = x;
    positions[i * 3 + 1] = terrainHeight(x, z) + random.range(0.15, 3.2);
    positions[i * 3 + 2] = z;
    phases[i] = random.random() * TAU;
    sizes[i] = random.range(0.45, 1.6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.16 + aPhase) * 0.52 + sin(uTime * 0.43 + aPhase * 2.1) * 0.09;
        p.z += cos(uTime * 0.13 + aPhase * 1.3) * 0.44;
        p.y += sin(uTime * 0.22 + aPhase * 1.7) * 0.14;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio * (42.0 / max(0.6, -mvPosition.z));
        vAlpha = 0.28 + 0.3 * (0.5 + 0.5 * sin(uTime * 0.6 + aPhase));
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.06, d) * vAlpha;
        gl_FragColor = vec4(1.0, 0.92, 0.68, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'Pollen';
  points.frustumCulled = false;
  scene.add(points);
  return material;
}

function createButterflies(scene) {
  const palette = ['#f4e5c6', '#e6aa6b', '#d27f5d', '#d4d5c0', '#e0bd68'];
  const random = makeRng(4112);
  const butterflies = [];

  for (let i = 0; i < 11; i += 1) {
    const group = new THREE.Group();
    const color = new THREE.Color(palette[i % palette.length]);
    const wingMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wingGeo = new THREE.CircleGeometry(0.078, 10);
    wingGeo.scale(1.35, 0.92, 1);
    const leftPivot = new THREE.Group();
    const rightPivot = new THREE.Group();
    const left = new THREE.Mesh(wingGeo, wingMat);
    const right = new THREE.Mesh(wingGeo, wingMat);
    left.position.x = -0.065;
    left.rotation.y = 0.18;
    right.position.x = 0.065;
    right.rotation.y = -0.18;
    leftPivot.add(left);
    rightPivot.add(right);
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.012, 0.09, 3, 4),
      new THREE.MeshBasicMaterial({ color: '#403728' })
    );
    body.rotation.x = Math.PI / 2;
    group.add(leftPivot, rightPivot, body);
    const a = random.random() * TAU;
    const r = random.range(4, 18);
    group.position.set(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + random.range(0.35, 1.2), Math.sin(a) * r);
    group.scale.setScalar(random.range(0.55, 0.95));
    group.rotation.y = random.random() * TAU;
    scene.add(group);

    butterflies.push({
      group,
      leftPivot,
      rightPivot,
      home: group.position.clone(),
      phase: random.random() * TAU,
      speed: random.range(0.35, 0.7),
      radius: random.range(0.35, 1.0),
      flapOffset: random.random() * TAU,
    });
  }

  return butterflies;
}

function addDistantHills(scene) {
  const geometry = new THREE.SphereGeometry(22, 20, 10, 0, TAU, 0, Math.PI / 2);
  geometry.scale(1, 0.13, 1);
  const material = new THREE.MeshStandardMaterial({
    color: '#6f7e55',
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const positions = [
    [-48, -38, 1.1],
    [0, -62, 1.4],
    [54, -33, 1.0],
    [-60, 20, 1.2],
    [65, 25, 1.3],
    [10, 67, 1.2],
  ];
  for (const [x, z, s] of positions) {
    const hill = new THREE.Mesh(geometry, material);
    hill.position.set(x, -2.2, z);
    hill.scale.setScalar(s);
    hill.rotation.y = (x + z) * 0.02;
    scene.add(hill);
  }
}


function createSkyDome(sunPosition) {
  const geometry = new THREE.SphereGeometry(160, 32, 20);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color('#37628c') },
      uMid: { value: new THREE.Color('#aebfc2') },
      uHorizon: { value: new THREE.Color('#ffc27c') },
      uSunColor: { value: new THREE.Color('#ffe5a8') },
      uSunDir: { value: sunPosition.clone().normalize() },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      varying vec3 vDirection;
      void main() {
        vec3 dir = normalize(vDirection);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
        col = mix(col, uTop, smoothstep(0.14, 0.8, h));
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(sunDot, 1400.0) * 8.0;
        col += uSunColor * pow(sunDot, 120.0) * 0.5;
        col += uSunColor * pow(sunDot, 7.0) * 0.16;
        col += uHorizon * smoothstep(0.3, 0.0, h) * 0.12;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Sky dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function makeCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d');
  const random = mulberry32(2077);
  ctx.clearRect(0, 0, size, size / 2);

  for (let i = 0; i < 22; i += 1) {
    const x = 28 + random() * (size - 56);
    const y = size * 0.14 + random() * size * 0.22;
    const r = 12 + random() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 244, 226, .5)');
    g.addColorStop(0.55, 'rgba(255, 231, 202, .22)');
    g.addColorStop(1, 'rgba(255, 220, 186, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addClouds(scene) {
  const texture = makeCloudTexture();
  const random = makeRng(1942);
  const group = new THREE.Group();
  group.name = 'Sunset clouds';
  const palette = ['#ffe7c6', '#ffd9b0', '#f8d3ba', '#ffe3bd'];

  for (let i = 0; i < 16; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: random.pick(palette),
      transparent: true,
      opacity: random.range(0.2, 0.5),
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    const angle = random.random() * TAU;
    const radius = random.range(108, 142);
    sprite.position.set(
      Math.cos(angle) * radius,
      random.range(28, 82),
      Math.sin(angle) * radius
    );
    const width = random.range(62, 118);
    sprite.scale.set(width, width * random.range(0.24, 0.4), 1);
    group.add(sprite);
  }

  scene.add(group);
  return group;
}

function addSunGlow(scene, sunPosition) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 245, 1)');
  gradient.addColorStop(0.025, 'rgba(255, 249, 218, 1)');
  gradient.addColorStop(0.08, 'rgba(255, 228, 168, .85)');
  gradient.addColorStop(0.2, 'rgba(255, 198, 128, .34)');
  gradient.addColorStop(0.5, 'rgba(255, 172, 102, .09)');
  gradient.addColorStop(1, 'rgba(255, 160, 92, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffe4b8,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(sunPosition).multiplyScalar(145);
  sprite.scale.setScalar(42);
  sprite.name = 'Low sun';
  scene.add(sprite);
  return sprite;
}

export function createWorld({ scene, renderer, quality }) {
  const timeUniform = { value: 0 };
  const group = new THREE.Group();
  group.name = 'Clover Hollow';
  scene.add(group);

  const environment = createEnvironment(renderer);
  scene.environment = environment;

  const sunPosition = new THREE.Vector3();
  const elevation = 16;
  const azimuth = 222;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunPosition.setFromSphericalCoords(1, phi, theta);

  const sky = createSkyDome(sunPosition);
  scene.add(sky);

  scene.fog = new THREE.FogExp2(0xd9c197, 0.0078);

  const hemisphere = new THREE.HemisphereLight(0xb9d0e2, 0x4b5a34, 1.8);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffc389, 4.6);
  sun.position.copy(sunPosition).multiplyScalar(45);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const shadowSize = quality.shadowSize ?? 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -15;
  sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 1.1;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0x9fbccc, 0.75);
  fill.position.set(-12, 8, 10);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd3a1, 1.35);
  rim.position.set(15, 5, -18);
  scene.add(rim);

  addSunGlow(scene, sunPosition);
  addClouds(scene);

  const terrain = createTerrain();
  scene.add(terrain);

  const grass = createGrass(quality, timeUniform);
  scene.add(grass);

  addFlowers(scene, timeUniform, quality);
  const { colliders: treeColliders } = addTrees(scene, timeUniform, quality);
  const rockColliders = addRocks(scene, quality);
  addMushrooms(scene, timeUniform, quality);
  addBurrow(scene);
  addFallenLog(scene);
  addDistantHills(scene);

  const pollenMaterial = addPollen(scene);
  const butterflies = createButterflies(scene);

  const colliders = [
    ...treeColliders,
    ...rockColliders,
    { x: 7.7, z: 8.8, radius: 1.15 },
    { x: -2.8, z: 12.8, radius: 1.7 },
  ];

  function update(dt, elapsed, rabbitPosition) {
    timeUniform.value = elapsed;
    pollenMaterial.uniforms.uTime.value = elapsed;
    if (rabbitPosition) sky.position.set(rabbitPosition.x, 0, rabbitPosition.z);

    for (const b of butterflies) {
      const t = elapsed * b.speed + b.phase;
      const x = b.home.x + Math.cos(t) * b.radius + Math.sin(t * 1.9) * 0.25;
      const z = b.home.z + Math.sin(t * 0.9) * b.radius + Math.cos(t * 2.3) * 0.25;
      const y = b.home.y + Math.sin(t * 1.7) * 0.2;
      b.group.position.set(x, y, z);
      b.group.rotation.y = -t + Math.PI / 2;
      const flap = 0.42 + Math.sin(elapsed * 15 + b.flapOffset) * 0.52;
      b.leftPivot.rotation.z = flap;
      b.rightPivot.rotation.z = -flap;
      if (rabbitPosition) {
        const d = Math.hypot(x - rabbitPosition.x, z - rabbitPosition.z);
        if (d < 1.4) {
          b.group.position.x += (x - rabbitPosition.x) * 0.45;
          b.group.position.z += (z - rabbitPosition.z) * 0.45;
          b.group.position.y += 0.3;
        }
      }
    }
  }

  return {
    group,
    update,
    colliders,
    sun,
    sky,
    terrain,
    grass,
    environment,
    timeUniform,
  };
}
