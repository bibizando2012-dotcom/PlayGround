import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const TAU = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)

export const POND = { x: -5.4, z: -4.2, radius: 2.5 }
export const PLAY_RADIUS = 15.2

function mulberry32(a) {
  return function random() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function smoothNoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function fbm(x, y) {
  let value = 0
  let amp = 0.5
  for (let i = 0; i < 4; i++) {
    value += amp * smoothNoise(x, y)
    x = x * 2.03 + 11.7
    y = y * 2.01 + 5.3
    amp *= 0.5
  }
  return value
}

function trailDistance(x) {
  return 0.12 * x + 1.05 * Math.sin(0.42 * x + 0.7) + 0.9
}

function groundHeight(x, z) {
  const r = Math.hypot(x, z)
  const close = THREE.MathUtils.smoothstep(r, 18, 34)
  const far = THREE.MathUtils.smoothstep(r, 26, 54)
  return close * (0.18 + fbm(x * 0.095 + 2.1, z * 0.095 - 4.2) * 1.35) +
    far * (1.8 + fbm(x * 0.035 - 3.8, z * 0.035 + 9.4) * 8.5)
}

function canvasTexture(w, h, paint) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  paint(canvas.getContext('2d'), w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createWorld(scene, renderer, quality = 1) {
  const rand = mulberry32(82417)
  const mobile = quality < 0.9
  const uTime = { value: 0 }
  const windUniform = { value: 1 }
  const updaters = []
  const nightObjects = []
  const dayObjects = []
  const palette = {
    skyTop: new THREE.Color('#5f96bd'),
    skyHorizon: new THREE.Color('#ffd9a2'),
    sun: new THREE.Color('#ffc887'),
    fog: new THREE.Color('#d9cfae'),
    hemiSky: new THREE.Color('#b7d6e2'),
    hemiGround: new THREE.Color('#6a5f37'),
    sunDir: new THREE.Vector3(-0.62, 0.38, -0.5).normalize(),
  }

  // ---------------------------------------------------------------- lighting
  const hemi = new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, 1.2)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(palette.sun, 2.75)
  sun.position.copy(palette.sunDir).multiplyScalar(22)
  sun.castShadow = true
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
  sun.shadow.camera.left = -16
  sun.shadow.camera.right = 16
  sun.shadow.camera.top = 16
  sun.shadow.camera.bottom = -16
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 55
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.035
  scene.add(sun)
  scene.add(sun.target)

  const fill = new THREE.DirectionalLight('#9fc4df', 0.38)
  fill.position.set(8, 6, 9)
  scene.add(fill)

  scene.fog = new THREE.FogExp2(palette.fog.clone(), 0.017)
  renderer.setClearColor(palette.fog)

  // --------------------------------------------------------------------- sky
  const skyUniforms = {
    uTop: { value: palette.skyTop.clone() },
    uHorizon: { value: palette.skyHorizon.clone() },
    uSunColor: { value: palette.sun.clone() },
    uSunDir: { value: palette.sunDir.clone() },
    uNight: { value: 0 },
    uTime,
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(86, 40, 24),
    new THREE.ShaderMaterial({
      name: 'MeadowSky',
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uNight;
        uniform float uTime;
        varying vec3 vDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
                     mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p = p * 2.02 + 7.3;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.56));

          // Thin, high cirrus.
          vec2 cuv = d.xz / (d.y + 0.35) * 0.55;
          cuv += vec2(uTime * 0.0035, uTime * 0.0013);
          float clouds = smoothstep(0.55, 0.82, fbm(cuv * 1.5 + 2.0));
          clouds *= smoothstep(0.02, 0.22, d.y) * (1.0 - smoothstep(0.55, 0.9, d.y));
          vec3 cloudColor = mix(uHorizon, vec3(1.0, 0.91, 0.78), 0.38);
          col = mix(col, cloudColor, clouds * 0.24);

          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(sd, 760.0) * 4.0 + pow(sd, 24.0) * 0.30 + pow(sd, 4.0) * 0.11);

          float horizonGlow = pow(1.0 - h, 7.0);
          col += uSunColor * horizonGlow * 0.14;
          col = mix(col, uHorizon, smoothstep(0.0, -0.10, d.y));

          float grain = hash21(gl_FragCoord.xy + uTime) - 0.5;
          col += grain * 0.012;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  )
  sky.frustumCulled = false
  sky.renderOrder = -100
  scene.add(sky)

  // Stars, faded in at night.
  const starGeo = new THREE.BufferGeometry()
  const starPositions = []
  for (let i = 0; i < 620; i++) {
    const theta = rand() * TAU
    const y = 0.08 + rand() * 0.9
    const r = Math.sqrt(1 - y * y)
    starPositions.push(Math.cos(theta) * r * 70, y * 70, Math.sin(theta) * r * 70)
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
  const starMat = new THREE.PointsMaterial({
    color: '#dbe8ff',
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const stars = new THREE.Points(starGeo, starMat)
  stars.frustumCulled = false
  scene.add(stars)

  // ----------------------------------------------------------------- terrain
  const terrainGeo = new THREE.PlaneGeometry(100, 100, mobile ? 88 : 128, mobile ? 88 : 128)
  terrainGeo.rotateX(-Math.PI / 2)
  const tp = terrainGeo.attributes.position
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i)
    const z = tp.getZ(i)
    tp.setY(i, groundHeight(x, z))
  }
  terrainGeo.computeVertexNormals()

  const groundMat = new THREE.MeshStandardMaterial({
    name: 'MeadowFloor',
    color: '#64783d',
    roughness: 1,
    metalness: 0,
  })
  groundMat.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vFloorPos;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vFloorPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    )
    shader.fragmentShader = /* glsl */ `
      varying vec3 vFloorPos;
      float fhash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float fnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(fhash(i), fhash(i + vec2(1,0)), f.x),
          mix(fhash(i + vec2(0,1)), fhash(i + vec2(1,1)), f.x), f.y);
      }
      float ffbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * fnoise(p); p = p * 2.02 + 4.7; a *= 0.5; }
        return v;
      }
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
        vec3 P = vFloorPos;
        float coarse = ffbm(P.xz * 0.19);
        float fine = ffbm(P.xz * 1.35 + 3.7);
        vec3 forest = vec3(0.20, 0.27, 0.12);
        vec3 moss = vec3(0.39, 0.45, 0.20);
        vec3 dry = vec3(0.56, 0.51, 0.29);
        vec3 floorCol = mix(forest, moss, smoothstep(0.28, 0.72, coarse));
        floorCol = mix(floorCol, dry, smoothstep(0.65, 0.9, fine) * 0.2);
        floorCol *= 0.9 + fine * 0.22;

        float pathZ = 0.12 * P.x + 1.05 * sin(0.42 * P.x + 0.7) + 0.9;
        float trail = 1.0 - smoothstep(0.34, 0.92, abs(P.z - pathZ));
        vec3 path = mix(vec3(0.37, 0.30, 0.18), vec3(0.64, 0.55, 0.35), fine * 0.7);
        floorCol = mix(floorCol, path, trail * 0.7);

        float pondD = length(P.xz - vec2(-5.4, -4.2));
        floorCol = mix(floorCol, vec3(0.24, 0.28, 0.19), (1.0 - smoothstep(2.0, 3.3, pondD)) * 0.5);

        // Speckled clover and leaf litter.
        float grain = fhash(floor(P.xz * 9.0));
        floorCol *= 0.9 + grain * 0.2;
        diffuseColor.rgb = floorCol;
      `,
    )
  }
  groundMat.customProgramCacheKey = () => 'meadow-floor-v1'
  const ground = new THREE.Mesh(terrainGeo, groundMat)
  ground.receiveShadow = true
  ground.name = 'MeadowFloor'
  scene.add(ground)

  // --------------------------------------------------------------- pond water
  const waterUniforms = {
    uTime,
    uSky: { value: new THREE.Color('#9ec4c4') },
    uDeep: { value: new THREE.Color('#263c3b') },
    uSun: { value: palette.sun.clone() },
    uSunDir: { value: palette.sunDir.clone() },
    uFog: { value: palette.fog.clone() },
    uNight: { value: 0 },
  }
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(POND.radius, 72),
    new THREE.ShaderMaterial({
      name: 'PondWater',
      uniforms: waterUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSky;
        uniform vec3 uDeep;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        uniform vec3 uFog;
        uniform float uNight;
        varying vec3 vWorld;
        varying vec2 vUv;
        void main() {
          vec2 p = vWorld.xz;
          float r = length(p - vec2(-5.4, -4.2));
          vec2 ripple = vec2(
            sin(p.x * 5.2 + uTime * 1.25 + sin(p.y * 4.1)) + sin(p.y * 8.3 - uTime * 0.9),
            cos(p.y * 4.7 + uTime * 1.1 + sin(p.x * 3.8)) + sin(p.x * 7.1 - uTime * 0.7)
          ) * 0.035;
          vec3 N = normalize(vec3(ripple.x, 1.0, ripple.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
          vec3 col = mix(uDeep, uSky, 0.34 + fres * 0.66);
          vec3 L = normalize(uSunDir);
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 220.0);
          col += uSun * spec * (1.4 - uNight * 0.3);
          col += uSun * pow(max(dot(N, H), 0.0), 18.0) * 0.08;
          float edge = smoothstep(0.0, 0.12, 1.0 - r / 2.5);
          float alpha = mix(0.72, 0.92, fres) * edge;
          float fog = 1.0 - exp(-0.0012 * distance(cameraPosition, vWorld));
          col = mix(col, uFog, fog * 0.6);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.set(POND.x, 0.045, POND.z)
  water.renderOrder = 2
  scene.add(water)

  // --------------------------------------------------------------- grass tufts
  // Grass is drawn as dense alpha-cut cards rather than individual blades.
  // It reads softer, runs far faster, and lets the wind move whole tufts.
  const grassTexture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    for (let i = 0; i < 46; i++) {
      const baseX = 14 + rand() * (w - 28)
      const tipX = baseX + (rand() - 0.5) * 82
      const height = h * (0.34 + rand() * 0.6)
      const width = 2.4 + rand() * 5.6
      const topY = h - height
      const grad = ctx.createLinearGradient(0, h, 0, topY)
      const gold = rand() > 0.58
      grad.addColorStop(0, 'rgba(49, 68, 27, 1)')
      grad.addColorStop(0.46, 'rgba(83, 106, 43, 1)')
      grad.addColorStop(0.8, gold ? 'rgba(169, 161, 79, 1)' : 'rgba(127, 149, 60, 1)')
      grad.addColorStop(1, gold ? 'rgba(219, 197, 118, 1)' : 'rgba(161, 177, 84, 1)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(baseX - width, h)
      ctx.bezierCurveTo(baseX - width * 0.7, h - height * 0.42, tipX - width * 0.22, topY + height * 0.28, tipX, topY)
      ctx.bezierCurveTo(tipX + width * 0.28, topY + height * 0.32, baseX + width * 0.85, h - height * 0.38, baseX + width, h)
      ctx.closePath()
      ctx.fill()
      if (rand() > 0.78) {
        ctx.strokeStyle = 'rgba(220, 201, 133, 0.75)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(tipX, topY + 2)
        ctx.lineTo(tipX + (rand() - 0.5) * 9, topY - 7 - rand() * 8)
        ctx.stroke()
      }
    }
  })

  function makeTuftGeometry() {
    const a = new THREE.PlaneGeometry(1, 1, 1, 1)
    a.translate(0, 0.5, 0)
    const b = a.clone()
    b.rotateY(Math.PI / 2)
    const g = mergeGeometries([a, b], false)
    g.computeVertexNormals()
    const n = g.attributes.normal
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0)
    return g
  }

  const grassGeo = makeTuftGeometry()
  const grassMat = new THREE.MeshStandardMaterial({
    name: 'MeadowGrassCards',
    map: grassTexture,
    alphaTest: 0.36,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.uniforms.uWind = windUniform
    shader.vertexShader = `
      uniform float uTime;
      uniform float uWind;
      varying float vBladeViewZ;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
        float bladeH = uv.y;
        vec4 iw = instanceMatrix * vec4(transformed, 1.0);
        float phase = iw.x * 0.92 + iw.z * 0.77;
        float gust = 0.72 + 0.28 * sin(uTime * 0.35 + iw.x * 0.12);
        transformed.x += sin(uTime * 1.65 + phase) * 0.12 * bladeH * bladeH * uWind * gust;
        transformed.z += cos(uTime * 1.32 + phase * 1.31) * 0.08 * bladeH * bladeH * uWind * gust;
        vBladeViewZ = -(modelViewMatrix * instanceMatrix * vec4(transformed, 1.0)).z;
      `,
    )
    shader.fragmentShader = `
      varying float vBladeViewZ;
      ${shader.fragmentShader}
    `.replace(
      '#include <normal_fragment_begin>',
      'vec3 normal = normalize(vNormal);\n      vec3 nonPerturbedNormal = normal;',
    ).replace(
      '#include <dithering_fragment>',
      /* glsl */ `#include <dithering_fragment>
        if (vBladeViewZ < 0.78) discard;
      `,
    )
  }
  grassMat.customProgramCacheKey = () => 'meadow-grass-cards-v1'

  const grassCount = quality < 0.35 ? 5200 : mobile ? 7800 : 12000
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount)
  grass.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const dummy = new THREE.Object3D()
  const tempColor = new THREE.Color()
  let placed = 0
  let guard = 0
  while (placed < grassCount && guard < grassCount * 8) {
    guard++
    const a = rand() * TAU
    const r = 0.8 + Math.sqrt(rand()) * 30
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.abs(z - trailDistance(x)) < 0.85) continue
    if (Math.hypot(x - POND.x, z - POND.z) < POND.radius + 0.55) continue
    if (r > 15 && rand() < 0.45) continue
    const near = 1 - THREE.MathUtils.clamp(r / 22, 0, 1)
    const height = (0.26 + rand() * 0.26) * (0.92 + near * 0.45)
    dummy.position.set(x, 0.005, z)
    dummy.rotation.set(0, rand() * TAU, (rand() - 0.5) * 0.06)
    dummy.scale.set(0.48 + rand() * 0.36, height, 0.48 + rand() * 0.36)
    dummy.updateMatrix()
    grass.setMatrixAt(placed, dummy.matrix)
    const warm = rand()
    tempColor.setRGB(0.9 + warm * 0.18, 0.94 + rand() * 0.12, 0.7 + rand() * 0.15)
    grass.setColorAt(placed, tempColor)
    placed++
  }
  grass.count = placed
  grass.instanceMatrix.needsUpdate = true
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true
  grass.receiveShadow = false
  grass.name = 'MeadowGrass'
  scene.add(grass)

  // Taller grass around the pond.
  const reedGeo = makeTuftGeometry()
  const reeds = new THREE.InstancedMesh(reedGeo, grassMat, 140)
  let rp = 0
  for (let i = 0; i < 210 && rp < 140; i++) {
    const a = rand() * TAU
    const r = POND.radius + 0.22 + rand() * 0.32
    const x = POND.x + Math.cos(a) * r
    const z = POND.z + Math.sin(a) * r
    dummy.position.set(x, 0.01, z)
    dummy.rotation.set(0, rand() * TAU, (rand() - 0.5) * 0.15)
    dummy.scale.set(0.3 + rand() * 0.14, 0.95 + rand() * 0.55, 0.3 + rand() * 0.14)
    dummy.updateMatrix()
    reeds.setMatrixAt(rp, dummy.matrix)
    tempColor.setRGB(0.9 + rand() * 0.14, 0.95 + rand() * 0.1, 0.72 + rand() * 0.12)
    reeds.setColorAt(rp, tempColor)
    rp++
  }
  reeds.count = rp
  reeds.instanceMatrix.needsUpdate = true
  if (reeds.instanceColor) reeds.instanceColor.needsUpdate = true
  scene.add(reeds)

  // ------------------------------------------------------------------ flowers
  function makeFlowerGeometry() {
    const parts = []
    const stem = new THREE.CylinderGeometry(0.009, 0.014, 1, 5)
    stem.translate(0, 0.5, 0)
    const stemColors = []
    for (let i = 0; i < stem.attributes.position.count; i++) stemColors.push(0.16, 0.31, 0.10)
    stem.setAttribute('color', new THREE.Float32BufferAttribute(stemColors, 3))
    parts.push(stem)

    for (let i = 0; i < 2; i++) {
      const leaf = new THREE.CircleGeometry(0.09, 6)
      leaf.scale(0.55, 1.7, 1)
      leaf.rotateX(-Math.PI / 2)
      leaf.rotateY(i * 2.3 + 0.8)
      leaf.translate(0, 0.24 + i * 0.17, 0)
      const lc = []
      for (let j = 0; j < leaf.attributes.position.count; j++) lc.push(0.18, 0.35, 0.11)
      leaf.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3))
      parts.push(leaf)
    }

    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU
      const petal = new THREE.CircleGeometry(0.105, 7)
      petal.scale(0.58, 1, 1)
      petal.rotateX(-Math.PI / 2)
      petal.rotateY(a)
      petal.translate(Math.cos(a) * 0.105, 1.0, Math.sin(a) * 0.105)
      const pc = []
      for (let j = 0; j < petal.attributes.position.count; j++) pc.push(1, 0.95, 0.78)
      petal.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3))
      parts.push(petal)
    }

    const core = new THREE.SphereGeometry(0.05, 8, 5)
    core.translate(0, 1.0, 0)
    const cc = []
    for (let j = 0; j < core.attributes.position.count; j++) cc.push(0.93, 0.61, 0.11)
    core.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3))
    parts.push(core)

    return mergeGeometries(parts, false)
  }

  const flowerGeo = makeFlowerGeometry()
  const flowerMat = new THREE.MeshStandardMaterial({
    name: 'Wildflowers',
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
  })
  flowerMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.uniforms.uWind = windUniform
    shader.vertexShader = `
      uniform float uTime;
      uniform float uWind;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
        vec4 fw = instanceMatrix * vec4(transformed, 1.0);
        float fphase = fw.x * 0.7 + fw.z * 0.9;
        float bendAmount = clamp(transformed.y, 0.0, 1.0);
        transformed.x += sin(uTime * 1.25 + fphase) * 0.055 * bendAmount * uWind;
        transformed.z += cos(uTime * 1.05 + fphase) * 0.035 * bendAmount * uWind;
      `,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      'vec3 normal = normalize(vNormal);\n      vec3 nonPerturbedNormal = normal;',
    )
  }
  flowerMat.customProgramCacheKey = () => 'wildflower-v1'

  const flowerCount = quality < 0.35 ? 240 : mobile ? 300 : 440
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount)
  let fp = 0
  guard = 0
  while (fp < flowerCount && guard < flowerCount * 12) {
    guard++
    const a = rand() * TAU
    const r = 2.5 + Math.sqrt(rand()) * 22
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.abs(z - trailDistance(x)) < 1.2) continue
    if (Math.hypot(x - POND.x, z - POND.z) < POND.radius + 0.4) continue
    const scale = 0.3 + rand() * 0.22
    dummy.position.set(x, 0, z)
    dummy.rotation.set(0, rand() * TAU, (rand() - 0.5) * 0.07)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    flowers.setMatrixAt(fp, dummy.matrix)
    const tint = rand()
    if (tint > 0.83) tempColor.setStyle('#f0b3b1')
    else if (tint > 0.65) tempColor.setStyle('#f8e8b5')
    else tempColor.setStyle('#fff8e9')
    flowers.setColorAt(fp, tempColor)
    fp++
  }
  flowers.count = fp
  flowers.instanceMatrix.needsUpdate = true
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true
  flowers.name = 'Wildflowers'
  scene.add(flowers)

  // Clover patches (little rounded leaves, no goal, just snacks).
  const cloverGeo = new THREE.CircleGeometry(0.09, 8)
  cloverGeo.rotateX(-Math.PI / 2)
  const cloverMat = new THREE.MeshStandardMaterial({
    color: '#5d7c39',
    roughness: 0.85,
    side: THREE.DoubleSide,
  })
  const clovers = new THREE.InstancedMesh(cloverGeo, cloverMat, 520)
  for (let i = 0; i < 520; i++) {
    const a = rand() * TAU
    const r = 1.0 + Math.sqrt(rand()) * 12
    dummy.position.set(Math.cos(a) * r, 0.012, Math.sin(a) * r)
    dummy.rotation.set(0, rand() * TAU, 0)
    dummy.scale.setScalar(0.4 + rand() * 0.8)
    dummy.updateMatrix()
    clovers.setMatrixAt(i, dummy.matrix)
  }
  clovers.instanceMatrix.needsUpdate = true
  scene.add(clovers)

  // -------------------------------------------------------------------- trees
  const barkMat = new THREE.MeshStandardMaterial({
    name: 'BirchBark',
    color: '#d6d1ba',
    roughness: 0.96,
  })
  barkMat.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vBark;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vBark = position;`,
    )
    shader.fragmentShader = `varying vec3 vBark;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
        float bands = sin(vBark.y * 17.0 + sin(vBark.x * 13.0) * 1.7);
        float dark = smoothstep(0.52, 0.88, bands) * 0.72;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.085, 0.06), dark);
      `,
    )
  }
  barkMat.customProgramCacheKey = () => 'birch-bark-v1'

  const treeCount = quality < 0.35 ? 18 : mobile ? 22 : 30
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.17, 1, 6, 1)
  trunkGeo.translate(0, 0.5, 0)
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, treeCount)
  const canopyGeo = new THREE.IcosahedronGeometry(1, 2)
  const canopyMat = new THREE.MeshStandardMaterial({
    name: 'AspenLeaves',
    color: '#ffffff',
    roughness: 0.88,
    emissive: '#101607',
    emissiveIntensity: 0.18,
  })
  canopyMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.vertexShader = `uniform float uTime;\nvarying vec3 vCanopy;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
        vec3 cn = normalize(position);
        float wob = sin(position.x * 4.3 + uTime * 0.22) *
          sin(position.y * 3.7 + 1.3) * sin(position.z * 4.1 - 0.7);
        transformed += cn * wob * 0.26;
        vCanopy = position;`,
    )
    shader.fragmentShader = `varying vec3 vCanopy;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
        float leafDapple = sin(vCanopy.x * 9.0 + vCanopy.y * 7.0) *
          sin(vCanopy.z * 8.0 - vCanopy.y * 5.0);
        diffuseColor.rgb *= 0.86 + leafDapple * 0.14;`,
    )
  }
  canopyMat.customProgramCacheKey = () => 'aspen-canopy-v1'
  const canopyCount = treeCount * 7
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, canopyCount)

  // A few hand-placed trees frame the meadow and keep the near view from
  // feeling like an empty disc; the rest form a loose ring on the hills.
  const treePositions = []
  let ti = 0
  let ci = 0
  guard = 0
  while (treePositions.length < treeCount && guard < 260) {
    guard++
    const a = rand() * TAU
    const r = 15.5 + rand() * 17
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.hypot(x - POND.x, z - POND.z) < 4.0) continue
    if (Math.abs(z - trailDistance(x)) < 1.4) continue
    if (z > 3 && x > -6.6 && x < 1.8) continue // keep the view behind the hare open
    if (treePositions.some((p) => Math.hypot(p.x - x, p.z - z) < 3.1)) continue
    treePositions.push({ x, z, h: 4.8 + rand() * 3.7, lean: (rand() - 0.5) * 0.06 })
  }

  for (const t of treePositions) {
    const { x, z, h } = t
    const baseY = groundHeight(x, z)
    dummy.position.set(x, baseY - 0.1, z)
    dummy.rotation.set(0, rand() * TAU, t.lean)
    dummy.scale.set(0.85 + rand() * 0.35, h, 0.85 + rand() * 0.35)
    dummy.updateMatrix()
    trunks.setMatrixAt(ti, dummy.matrix)
    ti++

    const top = baseY + h * 0.8
    for (let c = 0; c < 7; c++) {
      const ca = rand() * TAU
      const cr = c === 0 ? 0 : 0.35 + rand() * 1.15
      const s = c === 0 ? 0.6 + rand() * 0.2 : 0.26 + rand() * 0.42
      dummy.position.set(x + Math.cos(ca) * cr, top + (rand() - 0.5) * 1.7, z + Math.sin(ca) * cr)
      dummy.rotation.set(rand() * 0.5, rand() * TAU, rand() * 0.5)
      dummy.scale.set(s * (0.9 + rand() * 0.45), s * (0.75 + rand() * 0.4), s * (0.9 + rand() * 0.45))
      dummy.updateMatrix()
      canopies.setMatrixAt(ci, dummy.matrix)
      tempColor.setHSL(0.2 + rand() * 0.07, 0.36 + rand() * 0.16, 0.24 + rand() * 0.14)
      canopies.setColorAt(ci, tempColor)
      ci++
    }
  }
  trunks.count = ti
  canopies.count = ci
  trunks.instanceMatrix.needsUpdate = true
  canopies.instanceMatrix.needsUpdate = true
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true
  trunks.castShadow = true
  trunks.receiveShadow = true
  canopies.castShadow = true
  trunks.name = 'Birches'
  canopies.name = 'AspenCanopy'
  scene.add(trunks, canopies)

  // A soft blue-green treeline on the far hills, mostly read through the haze.
  const farTreeCount = mobile ? 60 : 90
  const farTrees = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }),
    farTreeCount,
  )
  for (let i = 0; i < farTreeCount; i++) {
    const a = rand() * TAU
    const r = 39 + rand() * 16
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const sx = 1.1 + rand() * 1.5
    dummy.position.set(x, groundHeight(x, z) + 0.7 + rand() * 0.7, z)
    dummy.rotation.set(rand() * 0.25, rand() * TAU, rand() * 0.25)
    dummy.scale.set(sx, 1.1 + rand() * 1.9, sx * (0.8 + rand() * 0.5))
    dummy.updateMatrix()
    farTrees.setMatrixAt(i, dummy.matrix)
    tempColor.setHSL(0.31 + rand() * 0.05, 0.2 + rand() * 0.08, 0.17 + rand() * 0.07)
    farTrees.setColorAt(i, tempColor)
  }
  farTrees.instanceMatrix.needsUpdate = true
  if (farTrees.instanceColor) farTrees.instanceColor.needsUpdate = true
  farTrees.name = 'FarTreeline'
  scene.add(farTrees)

  // Low bushes for depth: clusters of small leafy crowns, not boulders.
  const bushGeo = new THREE.IcosahedronGeometry(1, 1)
  const bushMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, flatShading: true })
  const bushClusters = mobile ? 16 : 24
  const bushBlobs = bushClusters * 3
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushBlobs)
  let bi = 0
  for (let i = 0; i < bushClusters; i++) {
    const a = rand() * TAU
    const r = 14 + rand() * 19
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const s = 0.34 + rand() * 0.5
    for (let c = 0; c < 3; c++) {
      const ca = rand() * TAU
      const cr = c === 0 ? 0 : s * (0.7 + rand() * 0.7)
      dummy.position.set(x + Math.cos(ca) * cr, groundHeight(x, z) + s * 0.55 + (c ? s * 0.12 : 0), z + Math.sin(ca) * cr)
      dummy.rotation.set(rand(), rand() * TAU, rand() * 0.4)
      const cs = c === 0 ? s : s * (0.55 + rand() * 0.35)
      dummy.scale.set(cs * 1.3, cs, cs * 1.2)
      dummy.updateMatrix()
      bushes.setMatrixAt(bi, dummy.matrix)
      tempColor.setHSL(0.22 + rand() * 0.05, 0.3 + rand() * 0.1, 0.24 + rand() * 0.09)
      bushes.setColorAt(bi, tempColor)
      bi++
    }
  }
  bushes.count = bi
  bushes.instanceMatrix.needsUpdate = true
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true
  bushes.castShadow = true
  bushes.receiveShadow = true
  scene.add(bushes)

  // -------------------------------------------------------------------- rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 1)
  const rockMat = new THREE.MeshStandardMaterial({
    name: 'MossyStone',
    color: '#ffffff',
    roughness: 0.98,
    flatShading: true,
  })
  const rockCount = mobile ? 9 : 14
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount)
  const rockData = [
    { x: 3.1, z: 2.2, s: 1.1, moss: 0.9 },
    { x: -3.6, z: 3.7, s: 0.7, moss: 0.4 },
    { x: 6.2, z: -1.2, s: 0.55, moss: 0.2 },
    { x: -7.6, z: -0.7, s: 0.9, moss: 0.8 },
    { x: 2.4, z: -6.5, s: 0.62, moss: 0.15 },
    { x: 9.4, z: 4.3, s: 1.2, moss: 0.5 },
    { x: -10.8, z: 8.0, s: 1.5, moss: 0.7 },
    { x: 12.8, z: -7.2, s: 1.1, moss: 0.35 },
    { x: -2.2, z: 10.4, s: 0.85, moss: 0.65 },
    { x: 7.1, z: 9.3, s: 0.75, moss: 0.2 },
    { x: -12.2, z: -9.1, s: 1.4, moss: 0.4 },
    { x: 13.2, z: 10.4, s: 1.5, moss: 0.6 },
    { x: -4.2, z: -11.0, s: 0.9, moss: 0.3 },
    { x: 10.1, z: -12.4, s: 1.1, moss: 0.5 },
  ]
  for (let i = 0; i < rockCount; i++) {
    const r = rockData[i]
    dummy.position.set(r.x, groundHeight(r.x, r.z) + r.s * 0.23, r.z)
    dummy.rotation.set(rand() * 0.4, rand() * TAU, rand() * 0.3)
    dummy.scale.set(r.s * (0.9 + rand() * 0.5), r.s * (0.36 + rand() * 0.18), r.s * (0.8 + rand() * 0.5))
    dummy.updateMatrix()
    rocks.setMatrixAt(i, dummy.matrix)
    tempColor.setRGB(0.13 + r.moss * 0.05, 0.14 + r.moss * 0.04, 0.11 + r.moss * 0.02)
    rocks.setColorAt(i, tempColor)
  }
  rocks.instanceMatrix.needsUpdate = true
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true
  rocks.castShadow = true
  rocks.receiveShadow = true
  scene.add(rocks)

  // A flat sunning stone, a nice place to sit in the imagination.
  const sunningStone = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.2, 0.28, 9),
    new THREE.MeshStandardMaterial({ color: '#8b8771', roughness: 0.95, flatShading: true }),
  )
  sunningStone.position.set(4.5, 0.13, 4.0)
  sunningStone.rotation.y = 0.6
  sunningStone.scale.set(1, 0.7, 0.8)
  sunningStone.castShadow = true
  sunningStone.receiveShadow = true
  scene.add(sunningStone)

  // ------------------------------------------------------------------ lily pads
  const lilyMat = new THREE.MeshStandardMaterial({
    color: '#476b43',
    roughness: 0.8,
    side: THREE.DoubleSide,
  })
  for (let i = 0; i < 6; i++) {
    const a = rand() * TAU
    const r = rand() * 1.5
    const lily = new THREE.Mesh(new THREE.CircleGeometry(0.16 + rand() * 0.15, 14), lilyMat)
    lily.rotation.x = -Math.PI / 2
    lily.rotation.z = rand() * TAU
    lily.position.set(POND.x + Math.cos(a) * r, 0.06, POND.z + Math.sin(a) * r)
    scene.add(lily)
  }

  // --------------------------------------------------------------- butterflies
  function makeButterfly(color) {
    const group = new THREE.Group()
    const wingShape = new THREE.Shape()
    wingShape.moveTo(0, 0)
    wingShape.bezierCurveTo(0.03, 0.10, 0.18, 0.22, 0.25, 0.10)
    wingShape.bezierCurveTo(0.31, 0.0, 0.21, -0.08, 0.10, -0.10)
    wingShape.bezierCurveTo(0.04, -0.10, 0.01, -0.04, 0, 0)
    const wingGeo = new THREE.ShapeGeometry(wingShape, 7)
    wingGeo.rotateX(-Math.PI / 2)
    const wingMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.65,
      side: THREE.DoubleSide,
      emissive: color,
      emissiveIntensity: 0.08,
    })
    const wings = []
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.scale.x = s
      const wing = new THREE.Mesh(wingGeo, wingMat)
      pivot.add(wing)
      group.add(pivot)
      wings.push(pivot)
    }
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.012, 0.07, 3, 6),
      new THREE.MeshStandardMaterial({ color: '#312419', roughness: 0.9 }),
    )
    body.rotation.z = Math.PI / 2
    group.add(body)
    group.userData.wings = wings
    return group
  }

  const butterflyColors = ['#eaa54a', '#f3d37a', '#d97852', '#f0e4c0']
  const butterflies = []
  for (let i = 0; i < 6; i++) {
    const b = makeButterfly(butterflyColors[i % butterflyColors.length])
    const angle = rand() * TAU
    b.position.set(Math.cos(angle) * (2 + rand() * 7), 0.65 + rand() * 0.85, Math.sin(angle) * (2 + rand() * 7))
    b.scale.setScalar(0.75 + rand() * 0.45)
    b.userData = {
      ...b.userData,
      center: b.position.clone(),
      radius: 0.5 + rand() * 1.8,
      speed: 0.22 + rand() * 0.32,
      phase: rand() * TAU,
      heightPhase: rand() * TAU,
      flap: 7 + rand() * 4,
    }
    scene.add(b)
    butterflies.push(b)
  }

  // -------------------------------------------------------- ambient particles
  const seedTexture = canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,249,225,1)')
    g.addColorStop(0.2, 'rgba(255,243,204,0.95)')
    g.addColorStop(0.6, 'rgba(255,232,175,0.18)')
    g.addColorStop(1, 'rgba(255,228,160,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(255,248,225,0.65)'
    ctx.lineWidth = 1
    for (let i = 0; i < 7; i++) {
      const a = rand() * TAU
      ctx.beginPath()
      ctx.moveTo(w / 2, h / 2)
      ctx.lineTo(w / 2 + Math.cos(a) * 26, h / 2 + Math.sin(a) * 26)
      ctx.stroke()
    }
  })

  const seedCount = mobile ? 75 : 120
  const seedGeo = new THREE.BufferGeometry()
  const seedPos = new Float32Array(seedCount * 3)
  const seedPhase = new Float32Array(seedCount)
  for (let i = 0; i < seedCount; i++) {
    seedPos[i * 3] = (rand() - 0.5) * 26
    seedPos[i * 3 + 1] = 0.3 + rand() * 4.8
    seedPos[i * 3 + 2] = (rand() - 0.5) * 26
    seedPhase[i] = rand() * TAU
  }
  seedGeo.setAttribute('position', new THREE.BufferAttribute(seedPos, 3))
  seedGeo.setAttribute('aPhase', new THREE.BufferAttribute(seedPhase, 1))
  const seedMat = new THREE.ShaderMaterial({
    name: 'DandelionSeeds',
    uniforms: { uTime, uMap: { value: seedTexture }, uOpacity: { value: 0.85 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.23 + aPhase) * 1.6;
        p.z += cos(uTime * 0.19 + aPhase * 1.4) * 1.4;
        p.y += sin(uTime * 0.15 + aPhase * 0.7) * 0.32;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(0.45, -mv.z);
        float size = 0.065 * (0.7 + 0.3 * sin(aPhase * 7.0));
        gl_PointSize = clamp(size * (300.0 / dist), 1.0, 13.0);
        gl_Position = projectionMatrix * mv;
        vTwinkle = (0.55 + 0.45 * sin(uTime * 0.9 + aPhase * 4.0)) * smoothstep(0.45, 1.5, dist);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying float vTwinkle;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(t.rgb, t.a * uOpacity * vTwinkle);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const seeds = new THREE.Points(seedGeo, seedMat)
  seeds.frustumCulled = false
  scene.add(seeds)

  // Golden motes near the rabbit, giving the air some body.
  const moteCount = mobile ? 90 : 150
  const moteGeo = new THREE.BufferGeometry()
  const motePos = new Float32Array(moteCount * 3)
  const motePhase = new Float32Array(moteCount)
  for (let i = 0; i < moteCount; i++) {
    const a = rand() * TAU
    const r = Math.sqrt(rand()) * 10
    motePos[i * 3] = Math.cos(a) * r
    motePos[i * 3 + 1] = 0.15 + rand() * 2.4
    motePos[i * 3 + 2] = Math.sin(a) * r
    motePhase[i] = rand() * TAU
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3))
  moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(motePhase, 1))
  const moteMat = new THREE.ShaderMaterial({
    name: 'Pollen',
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.18 + aPhase) * 0.7;
        p.y += sin(uTime * 0.33 + aPhase * 1.9) * 0.25;
        p.z += cos(uTime * 0.21 + aPhase * 1.3) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(0.5, -mv.z);
        gl_PointSize = clamp(2.6 * (1.0 + sin(aPhase * 5.0) * 0.3) * (220.0 / dist), 0.7, 7.0);
        gl_Position = projectionMatrix * mv;
        vA = (0.35 + 0.65 * pow(max(sin(uTime * 0.7 + aPhase * 3.0), 0.0), 3.0)) * smoothstep(0.5, 1.6, dist);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(1.0, 0.78, 0.33, a * vA * 0.5);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const motes = new THREE.Points(moteGeo, moteMat)
  motes.frustumCulled = false
  scene.add(motes)

  // Fireflies at dusk.
  const fireflyCount = mobile ? 46 : 80
  const fireflyGeo = new THREE.BufferGeometry()
  const fireflyPos = new Float32Array(fireflyCount * 3)
  const fireflyPhase = new Float32Array(fireflyCount)
  for (let i = 0; i < fireflyCount; i++) {
    const a = rand() * TAU
    const r = 2 + Math.sqrt(rand()) * 15
    fireflyPos[i * 3] = Math.cos(a) * r
    fireflyPos[i * 3 + 1] = 0.3 + rand() * 1.4
    fireflyPos[i * 3 + 2] = Math.sin(a) * r
    fireflyPhase[i] = rand() * TAU
  }
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3))
  fireflyGeo.setAttribute('aPhase', new THREE.BufferAttribute(fireflyPhase, 1))
  const fireflyMat = new THREE.ShaderMaterial({
    name: 'Fireflies',
    uniforms: { uTime, uNight: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uNight;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.28 + aPhase) * 0.55;
        p.y += sin(uTime * 0.42 + aPhase * 2.1) * 0.25;
        p.z += cos(uTime * 0.24 + aPhase * 1.6) * 0.55;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(0.5, -mv.z);
        gl_PointSize = clamp((5.0 + 3.0 * sin(aPhase * 4.0)) * (220.0 / dist), 1.4, 10.0);
        gl_Position = projectionMatrix * mv;
        vA = pow(max(sin(uTime * 0.9 + aPhase * 5.0), 0.0), 5.0) * uNight * smoothstep(0.5, 1.6, dist);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(1.0, 0.78, 0.27, a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const fireflies = new THREE.Points(fireflyGeo, fireflyMat)
  fireflies.frustumCulled = false
  scene.add(fireflies)

  // ---------------------------------------------------------- contact shadow
  const shadowTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(20,17,9,0.5)')
    g.addColorStop(0.45, 'rgba(20,17,9,0.28)')
    g.addColorStop(1, 'rgba(20,17,9,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.8),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
      toneMapped: false,
    }),
  )
  contactShadow.rotation.x = -Math.PI / 2
  contactShadow.position.y = 0.02
  contactShadow.renderOrder = 3
  scene.add(contactShadow)

  // Day / evening palette. Everything is eased together.
  const day = {
    skyTop: new THREE.Color('#5f96bd'),
    skyHorizon: new THREE.Color('#ffd9a2'),
    sun: new THREE.Color('#ffc887'),
    fog: new THREE.Color('#d9cfae'),
    hemiSky: new THREE.Color('#b7d6e2'),
    hemiGround: new THREE.Color('#6a5f37'),
    sunIntensity: 2.75,
    hemiIntensity: 1.2,
    fillIntensity: 0.38,
    sunDir: new THREE.Vector3(-0.62, 0.38, -0.5).normalize(),
    exposure: 1.08,
    night: 0,
  }
  const evening = {
    skyTop: new THREE.Color('#14243e'),
    skyHorizon: new THREE.Color('#b47e74'),
    sun: new THREE.Color('#aebfe8'),
    fog: new THREE.Color('#2c3850'),
    hemiSky: new THREE.Color('#566a92'),
    hemiGround: new THREE.Color('#26291f'),
    sunIntensity: 0.8,
    hemiIntensity: 0.62,
    fillIntensity: 0.24,
    sunDir: new THREE.Vector3(0.48, 0.58, -0.42).normalize(),
    exposure: 0.96,
    night: 1,
  }
  const current = {
    skyTop: day.skyTop.clone(),
    skyHorizon: day.skyHorizon.clone(),
    sun: day.sun.clone(),
    fog: day.fog.clone(),
    hemiSky: day.hemiSky.clone(),
    hemiGround: day.hemiGround.clone(),
    sunIntensity: day.sunIntensity,
    hemiIntensity: day.hemiIntensity,
    fillIntensity: day.fillIntensity,
    sunDir: day.sunDir.clone(),
    exposure: day.exposure,
    night: 0,
  }
  let timeMode = 'day'
  let timeBlend = 0
  let targetBlend = 0
  let timeImmediate = false

  function setTimeMode(mode, immediate = false) {
    timeMode = mode
    targetBlend = mode === 'night' ? 1 : 0
    timeImmediate = immediate
    if (immediate) {
      timeBlend = targetBlend
      applyLighting()
    }
  }

  function applyLighting() {
    const t = timeBlend
    const target = t > 0.5 ? evening : day
    current.skyTop.copy(day.skyTop).lerp(evening.skyTop, t)
    current.skyHorizon.copy(day.skyHorizon).lerp(evening.skyHorizon, t)
    current.sun.copy(day.sun).lerp(evening.sun, t)
    current.fog.copy(day.fog).lerp(evening.fog, t)
    current.hemiSky.copy(day.hemiSky).lerp(evening.hemiSky, t)
    current.hemiGround.copy(day.hemiGround).lerp(evening.hemiGround, t)
    current.sunIntensity = THREE.MathUtils.lerp(day.sunIntensity, evening.sunIntensity, t)
    current.hemiIntensity = THREE.MathUtils.lerp(day.hemiIntensity, evening.hemiIntensity, t)
    current.fillIntensity = THREE.MathUtils.lerp(day.fillIntensity, evening.fillIntensity, t)
    current.sunDir.copy(day.sunDir).lerp(evening.sunDir, t).normalize()
    current.exposure = THREE.MathUtils.lerp(day.exposure, evening.exposure, t)
    current.night = t

    skyUniforms.uTop.value.copy(current.skyTop)
    skyUniforms.uHorizon.value.copy(current.skyHorizon)
    skyUniforms.uSunColor.value.copy(current.sun)
    skyUniforms.uSunDir.value.copy(current.sunDir)
    skyUniforms.uNight.value = t
    starMat.opacity = t * 0.95
    fireflyMat.uniforms.uNight.value = t

    hemi.color.copy(current.hemiSky)
    hemi.groundColor.copy(current.hemiGround)
    hemi.intensity = current.hemiIntensity
    sun.color.copy(current.sun)
    sun.intensity = current.sunIntensity
    sun.position.copy(current.sunDir).multiplyScalar(22)
    fill.intensity = current.fillIntensity
    scene.fog.color.copy(current.fog)
    renderer.setClearColor(current.fog)
    waterUniforms.uSky.value.copy(current.skyHorizon).lerp(current.skyTop, 0.35)
    waterUniforms.uSun.value.copy(current.sun)
    waterUniforms.uSunDir.value.copy(current.sunDir)
    waterUniforms.uFog.value.copy(current.fog)
    waterUniforms.uNight.value = t
    renderer.toneMappingExposure = current.exposure
    void target
  }

  applyLighting()

  // --------------------------------------------------------------- frame loop
  const butterflyWing = new THREE.Vector3()
  function update(dt, time, rabbitPosition, rabbitGrounded = true, jumpHeight = 0) {
    uTime.value = time
    windUniform.value = 0.72 + 0.22 * Math.sin(time * 0.27) + 0.1 * Math.sin(time * 0.91)

    // ease the time of day
    if (Math.abs(timeBlend - targetBlend) > 0.0005) {
      const speed = timeImmediate ? 20 : 1.35
      timeBlend = THREE.MathUtils.damp(timeBlend, targetBlend, speed, dt)
      if (Math.abs(timeBlend - targetBlend) < 0.0005) timeBlend = targetBlend
      applyLighting()
    }

    // butterfly flight
    for (const b of butterflies) {
      const d = b.userData
      const t = time * d.speed + d.phase
      const x = d.center.x + Math.sin(t) * d.radius + Math.sin(t * 2.3) * 0.22
      const z = d.center.z + Math.cos(t * 0.83) * d.radius
      const y = d.center.y + Math.sin(time * 0.7 + d.heightPhase) * 0.28
      b.position.set(x, y, z)
      const heading = Math.atan2(
        Math.cos(t) * d.radius + Math.cos(t * 2.3) * 0.22 * 2.3,
        -Math.sin(t * 0.83) * d.radius * 0.83,
      )
      b.rotation.y = heading + Math.PI / 2
      b.rotation.z = Math.sin(time * 0.8 + d.heightPhase) * 0.15
      const flap = Math.sin(time * d.flap) * 0.85
      for (let i = 0; i < 2; i++) b.userData.wings[i].rotation.z = (i === 0 ? 1 : -1) * (0.25 + flap * 0.5)
      // drift away when the hare gets close
      const dist = Math.hypot(x - rabbitPosition.x, z - rabbitPosition.z)
      if (dist < 1.6) {
        b.position.x += (x - rabbitPosition.x) * 0.3
        b.position.z += (z - rabbitPosition.z) * 0.3
        b.position.y += 0.2
      }
      butterflyWing.set(0, 0, 0)
    }

    // contact shadow hugs the ground and softens as the hare jumps
    const h = Math.max(0, jumpHeight)
    const targetScale = 1 + h * 0.28
    contactShadow.position.set(rabbitPosition.x, 0.022, rabbitPosition.z)
    contactShadow.scale.set(targetScale, targetScale, 1)
    contactShadow.material.opacity = rabbitGrounded ? 0.8 : 0.8 * THREE.MathUtils.clamp(1 - h * 0.3, 0.25, 1)

    stars.rotation.y = time * 0.003
    seeds.rotation.y = Math.sin(time * 0.02) * 0.05
  }

  return {
    update,
    setTimeMode,
    getTimeMode: () => timeMode,
    getPalette: () => current,
    sun,
    hemi,
    fireflies,
    butterflies,
    pond: POND,
    playRadius: PLAY_RADIUS,
    contactShadow,
    worldTime: uTime,
  }
}
