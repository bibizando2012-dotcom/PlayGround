import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  createFurTexture,
  createUndercoatTexture,
  createSkinTexture,
  createGuardHairTexture
} from './textures.js'
import { clamp, lerp, smoothstep, fbm2, hash2 } from './rng.js'

const TAU = Math.PI * 2
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function deformSphere(wSeg, hSeg, deform) {
  const geo = new THREE.SphereGeometry(1, wSeg, hSeg)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    deform(v, uv.getX(i), uv.getY(i))
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

function paintGeometry(geo, colorFn) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const uv = geo.attributes.uv
  const colors = new Float32Array(pos.count * 4)
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    n.fromBufferAttribute(nor, i)
    const c = colorFn(v, n, uv.getX(i), uv.getY(i))
    colors[i * 4] = c.r
    colors[i * 4 + 1] = c.g
    colors[i * 4 + 2] = c.b
    colors[i * 4 + 3] = c.a ?? 1
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  return geo
}

/* ------------------------------------------------------------------ */
/*  Shell fur                                                           */
/* ------------------------------------------------------------------ */

/**
 * Builds real, renderable fur shells: `layers` offset copies of a surface,
 * merged into a single indexed mesh. Per-vertex RGBA encodes root-to-tip
 * shading and strand thinning, so the whole coat is one draw call and
 * survives a GLB round-trip with no custom shaders.
 */
function buildFurShells(baseGeometry, { layers, surface, seed = 1, tStart = 0, lengthScale = 1, alphaScale = 1, fade = true }) {
  const parts = []
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const baseNor = baseGeometry.attributes.normal
  const basePos = baseGeometry.attributes.position
  const baseUv = baseGeometry.attributes.uv
  if (!baseUv) throw new Error('fur surface needs UVs')

  // Pre-sample length + tint once per vertex.
  const count = basePos.count
  const lens = new Float32Array(count)
  const cols = new Array(count)
  const aos = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(basePos, i)
    n.fromBufferAttribute(baseNor, i)
    const info = surface(p, n, baseUv.getX(i), baseUv.getY(i))
    lens[i] = info.length
    cols[i] = info.color
    aos[i] = info.ao ?? 1
  }

  for (let l = 0; l < layers; l++) {
    const g = baseGeometry.clone()
    const pos = g.attributes.position
    const nor = g.attributes.normal
    const uv = g.attributes.uv
    const colors = new Float32Array(count * 4)
    // Each shell samples a different patch of the atlas so alpha gaps never
    // line up into a hole through the whole coat.
    const uvOffU = (hash2(l * 1.73 + seed, 11.2) * 2 - 1) * 0.41
    const uvOffV = (hash2(l * 2.31 + seed, 4.7) * 2 - 1) * 0.41

    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(pos, i)
      n.fromBufferAttribute(nor, i)
      const u = uv.getX(i)
      const vv = uv.getY(i)
      uv.setXY(i, u + uvOffU, vv + uvOffV)
      const h = hash2(i * 0.731 + seed, l * 1.917)
      const localT = clamp((l + 0.35 + h * 0.55) / layers, 0, 1)
      const t = tStart + (1 - tStart) * localT
      const dist = lens[i] * lengthScale * Math.pow(t, 0.92)

      // constant per-vertex lean gives coherent clumps instead of fuzz noise
      const clumpX = Math.sin(p.x * 31.1 + p.z * 17.7 + p.y * 11.3) * 0.22
      const clumpZ = Math.cos(p.x * 17.3 - p.z * 29.7 + p.y * 15.9) * 0.22
      const droop = t * dist * (0.14 + 0.18 * smoothstep(0.2, 0.9, 1 - Math.abs(n.y)))

      pos.setXYZ(
        i,
        p.x + n.x * dist + clumpX * dist * 0.7,
        p.y + n.y * dist - droop,
        p.z + n.z * dist + clumpZ * dist * 0.7
      )

      const c = cols[i]
      // Keep the roots from going muddy: depth comes from a gentle gradient
      // plus sparse tips, not from painting dark bands into the coat.
      const shade = 0.64 + 0.46 * t
      const alpha =
        (fade ? clamp(1.06 - smoothstep(0.42, 1.0, t) * 0.9, 0, 1) : 1) *
        alphaScale *
        (0.92 + 0.12 * h) *
        (0.96 + 0.07 * Math.sin(i * 0.37 + l))

      colors[i * 4] = clamp(c.r * shade, 0, 1.15)
      colors[i * 4 + 1] = clamp(c.g * shade, 0, 1.15)
      colors[i * 4 + 2] = clamp(c.b * shade, 0, 1.15)
      colors[i * 4 + 3] = clamp(alpha, 0, 1)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
    parts.push(g)
  }

  const merged = mergeGeometries(parts, false)
  merged.computeBoundingSphere()
  for (const g of parts) g.dispose()
  return merged
}

/* ------------------------------------------------------------------ */
/*  Body / head / ear shapes                                            */
/* ------------------------------------------------------------------ */

function makeBodyGeometry() {
  return deformSphere(58, 42, (v) => {
    const nx = v.x
    const ny = v.y
    const nz = v.z

    let rx = 0.168
    rx += 0.05 * Math.exp(-Math.pow((nz + 0.6) / 0.4, 2)) // haunches
    rx += 0.016 * Math.exp(-Math.pow((nz - 0.5) / 0.42, 2)) // chest
    rx -= 0.018 * Math.exp(-Math.pow((nz + 0.0) / 0.3, 2)) // waist

    let ry = 0.148
    ry += 0.042 * Math.exp(-Math.pow((nz + 0.52) / 0.48, 2))
    ry += 0.018 * Math.exp(-Math.pow((nz - 0.52) / 0.4, 2))

    const belly = Math.max(0, -ny)
    const back = Math.max(0, ny)

    let x = nx * rx
    let y = ny * ry
    let z = nz * 0.355

    // flatter tummy, slightly arched back
    if (ny < 0) y *= 0.93
    y += back * back * 0.014
    y -= belly * smoothstep(0.0, 0.85, nz) * 0.008

    // hind-quarter lift and a soft chest roll
    y += Math.exp(-Math.pow((nz + 0.45) / 0.42, 2)) * Math.max(0, ny) * 0.02
    y += smoothstep(0.35, 0.95, nz) * smoothstep(-0.4, 0.75, ny) * 0.03

    // organic wobble
    const wob = (fbm2(nx * 2.1 + 11, nz * 2.3 + 4, 2) - 0.5) * 0.016
    x += nx * wob
    y += ny * wob
    z += nz * wob * 0.8

    v.set(x, 0.336 + y, z + 0.012)
  })
}

function makeHeadGeometry() {
  return deformSphere(56, 42, (v) => {
    const nx = v.x
    const ny = v.y
    const nz = v.z

    const front = Math.max(0, nz)
    const muzzleW = Math.exp(-Math.pow((ny + 0.03) / 0.42, 2))
    const cheekW =
      Math.exp(-Math.pow((ny + 0.16) / 0.3, 2)) *
      Math.exp(-Math.pow((nz - 0.01) / 0.75, 2))

    let x = nx * 0.13
    let y = ny * 0.126
    let z = nz * 0.155

    // The snout pushes forward around the nose; the forehead stays round.
    z += front * front * (0.028 + 0.062 * muzzleW)
    x *= 1 - 0.52 * front * front * muzzleW
    x *= 1 - smoothstep(0.1, -0.9, ny) * front * 0.12
    x *= 1 + cheekW * 0.17

    y += Math.max(0, ny) * front * 0.014
    y -= Math.max(0, -ny) * front * 0.014
    y -= front * front * muzzleW * 0.008

    // forehead dome + soft chin
    y += backDome(ny) * 0.011
    y -= smoothstep(0.35, 0.95, front) * smoothstep(-0.25, -0.85, ny) * 0.008
    z -= Math.max(0, -nz) * 0.012

    const wob = (fbm2(nx * 3.3 + 2, nz * 3.1 + 8, 2) - 0.5) * 0.006
    x += nx * wob
    y += ny * wob

    v.set(x, y, z)
  })
}

function backDome(ny) {
  return Math.exp(-Math.pow((ny - 0.62) / 0.34, 2))
}

function earProfile(t) {
  const w =
    (0.034 * (1 - t) + 0.023 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.012) *
    (1 + 0.16 * (1 - t))
  const th = 0.0055 + 0.0115 * Math.pow(1 - t, 1.2)
  const cz = -0.055 * t * t + 0.008 * Math.sin(Math.PI * t)
  const cx = 0.008 * Math.sin(Math.PI * t)
  return { w, th, cz, cx }
}

function makeEarGeometry(length = 0.29, radial = 16, height = 28) {
  const positions = []
  const uvs = []
  const indices = []
  for (let i = 0; i <= height; i++) {
    const t = i / height
    const { w, th, cz, cx } = earProfile(t)
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU
      positions.push(cx + Math.cos(a) * w, t * length, cz + Math.sin(a) * th)
      uvs.push(j / radial, t)
    }
  }
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j
      const b = a + radial + 1
      const c = b + 1
      const d = a + 1
      indices.push(a, b, d, b, c, d)
    }
  }
  // rounded tip
  const tipIndex = positions.length / 3
  const { cz } = earProfile(1)
  positions.push(0, length, cz)
  uvs.push(0.5, 1)
  const base = height * (radial + 1)
  for (let j = 0; j < radial; j++) indices.push(base + j, tipIndex, base + j + 1)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function makeInnerEarGeometry(length = 0.29, uSeg = 14, vSeg = 26) {
  const positions = []
  const uvs = []
  const colors = []
  const indices = []
  const deep = new THREE.Color('#d3a09a')
  const soft = new THREE.Color('#f0c9c0')
  const pale = new THREE.Color('#f8ddd3')
  for (let i = 0; i <= vSeg; i++) {
    const t = 0.03 + (i / vSeg) * 0.93
    const { w, th, cz } = earProfile(t)
    for (let j = 0; j <= uSeg; j++) {
      const u = (j / uSeg) * 2 - 1
      const cup = (1 - u * u) * 0.0035
      positions.push(u * w * 0.63, t * length, cz + th * 1.12 + 0.0025 - cup)
      uvs.push(j / uSeg, t)
      const edge = smoothstep(0.55, 1.0, Math.abs(u))
      const root = smoothstep(0.06, 0.3, t) * (1 - smoothstep(0.82, 0.99, t))
      const canal = Math.exp(-Math.pow(u / 0.17, 2)) * (1 - smoothstep(0.55, 0.9, t))
      const c = soft
        .clone()
        .lerp(pale, (1 - edge) * 0.5)
        .lerp(deep, edge * 0.46 + (1 - root) * 0.2 + canal * 0.34)
      colors.push(c.r, c.g, c.b, 1)
    }
  }
  for (let i = 0; i < vSeg; i++) {
    for (let j = 0; j < uSeg; j++) {
      const a = i * (uSeg + 1) + j
      const b = a + uSeg + 1
      const c = b + 1
      const d = a + 1
      indices.push(a, d, b, b, d, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function makeSphere(radius, seg = 24) {
  const geo = new THREE.SphereGeometry(radius, seg, Math.max(12, seg * 0.66))
  return geo
}

function makeCapsule(radius, length) {
  return new THREE.CapsuleGeometry(radius, length, 6, 14)
}

function makeFootGeometry() {
  return deformSphere(28, 20, (v) => {
    const nx = v.x
    const ny = v.y
    const nz = v.z
    let x = nx * 0.05
    let y = ny * 0.034
    let z = nz * 0.095
    const front = smoothstep(0.05, 0.95, nz)
    // heel narrows, toes spread
    x *= 0.8 + front * 0.28
    // three soft toe lobes at the front
    const lobe = Math.cos(nx * Math.PI * 2.6)
    x *= 1 + lobe * front * 0.055
    z += lobe * front * 0.006
    if (nz > 0.3 && ny < 0) y -= (nz - 0.3) * 0.014
    if (ny > 0.45) y -= (ny - 0.45) * 0.012 * front
    v.set(x, y, z)
  })
}

function ellipsoid(rx, ry, rz, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(10, Math.round(seg * 0.66)))
  g.scale(rx, ry, rz)
  return g
}

/** One continuous front limb: shoulder, slim shank, ankle, forward foot. */
function makeFrontLegGeometry() {
  const shank = makeCapsule(0.032, 0.085).translate(0, -0.075, 0.002)
  const ankle = ellipsoid(0.034, 0.028, 0.038).translate(0, -0.148, 0.018)
  const foot = makeFootGeometry().scale(0.88, 0.85, 0.9).translate(0, -0.174, 0.06)
  return mergeGeometries([shank, ankle, foot], false)
}

/** Haunch, shank and the long hind foot, fused so no seam can show. */
function makeBackLegGeometry() {
  const haunch = ellipsoid(0.084, 0.108, 0.118, 22).translate(0, -0.035, -0.012)
  const shank = makeCapsule(0.035, 0.07).translate(0, -0.145, 0.022)
  const hock = ellipsoid(0.038, 0.034, 0.045).translate(0, -0.212, 0.025)
  const foot = makeFootGeometry().scale(1.0, 0.95, 1.05).translate(0, -0.24, 0.09)
  return mergeGeometries([haunch, shank, hock, foot], false)
}

function makeWhiskers() {
  const positions = []
  const sample = 7
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 4; k++) {
      const start = new THREE.Vector3(side * 0.02, -0.026 + k * 0.006, 0.236)
      const end = new THREE.Vector3(
        side * (0.132 + k * 0.005),
        -0.01 - k * 0.018,
        0.126 - k * 0.005
      )
      const mid = new THREE.Vector3(
        side * (0.072 + k * 0.003),
        0.004 - k * 0.004,
        0.205 - k * 0.01
      )
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
      let prev = curve.getPoint(0)
      for (let i = 1; i <= sample; i++) {
        const pt = curve.getPoint(i / sample)
        positions.push(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z)
        prev = pt
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}

/* ------------------------------------------------------------------ */
/*  Palette + surface descriptions                                      */
/* ------------------------------------------------------------------ */

const TAN = new THREE.Color('#a37e58')
const TAN_LIGHT = new THREE.Color('#c5a172')
const CREAM = new THREE.Color('#ecd9be')
const DARK_BROWN = new THREE.Color('#5b402b')
const WHITE = new THREE.Color('#f4ead9')

function bodySurface(p, n) {
  const belly = smoothstep(0.1, -0.92, n.y)
  const back = smoothstep(0.05, 0.9, n.y)
  const c = TAN.clone().lerp(CREAM, belly * 0.95)
  c.lerp(TAN_LIGHT, back * 0.18)
  c.lerp(DARK_BROWN, back * 0.18 + smoothstep(0.62, 1.0, Math.abs(n.x)) * 0.06)
  // A darker line over the spine.
  c.lerp(DARK_BROWN, Math.exp(-Math.pow(p.x / 0.035, 2)) * back * 0.16)
  const m = fbm2(p.x * 13 + 5, p.z * 13 + 2, 2)
  c.multiplyScalar(0.95 + m * 0.08)
  const length =
    0.028 *
    (0.86 + m * 0.28) *
    (1 + belly * 0.1 + smoothstep(0.45, 1, n.z) * 0.07)
  return { color: c, length }
}

function headSurface(p, n) {
  const front = smoothstep(0.15, 0.9, n.z)
  const down = smoothstep(0.2, -0.9, n.y)
  const c = TAN.clone()
  c.lerp(CREAM, clamp(front * 0.6 + down * 0.5, 0, 0.9))
  c.lerp(TAN_LIGHT, smoothstep(0.3, 0.95, n.y) * 0.12)
  c.lerp(DARK_BROWN, smoothstep(0.45, 0.95, n.y) * 0.1)
  // Pale rings around the eyes, then a soft socket shadow.
  for (const sx of [-1, 1]) {
    const d = Math.hypot(p.x - sx * 0.096, p.y - 0.038, (p.z - 0.112) * 0.9)
    c.lerp(CREAM, smoothstep(0.062, 0.036, d) * 0.42)
    c.lerp(DARK_BROWN, smoothstep(0.038, 0.022, d) * 0.4)
  }
  // Cream muzzle and chin.
  c.lerp(CREAM, smoothstep(0.12, 0.72, n.z) * smoothstep(0.18, -0.5, n.y) * 0.4)
  const m = fbm2(p.x * 20 + 3, p.y * 20 + 9, 2)
  c.multiplyScalar(0.96 + m * 0.07)
  let length = 0.013 * (0.85 + m * 0.24)
  length += smoothstep(0.1, 0.9, Math.abs(n.x)) * down * 0.011 // cheek ruff
  length += smoothstep(0.72, 0.98, n.y) * 0.004 // brow tuft
  length *= 1 - front * smoothstep(0.2, -0.35, n.y) * 0.45 // short muzzle
  return { color: c, length }
}

function earSurface(p, n, u, v) {
  const t = clamp(p.y / 0.29, 0, 1)
  const c = TAN.clone().lerp(CREAM, smoothstep(0.25, 0.85, n.z) * 0.3)
  c.lerp(DARK_BROWN, smoothstep(0.62, 1.0, t) * 0.55)
  c.multiplyScalar(0.94 + fbm2(p.x * 30, t * 9, 2) * 0.12)
  const frontFace = smoothstep(0.25, 0.8, n.z)
  let length = 0.0075 * (1 - frontFace * 0.92)
  length += smoothstep(0.5, 0.95, t) * 0.0012
  length *= 1 + Math.sin(Math.PI * t) * 0.18
  return { color: c, length }
}

function neckSurface(p, n) {
  const front = smoothstep(0.15, 0.92, n.z)
  const down = smoothstep(0.25, -0.9, n.y)
  const c = TAN.clone().lerp(CREAM, clamp(front * 0.45 + down * 0.4, 0, 0.8))
  c.multiplyScalar(0.95 + fbm2(p.x * 22, p.y * 22, 2) * 0.08)
  return { color: c, length: 0.014 * (0.9 + fbm2(p.x * 18, p.z * 18, 2) * 0.2) }
}

function tailSurface(p, n) {
  const c = WHITE.clone().lerp(TAN_LIGHT, smoothstep(0.15, 0.9, n.y) * 0.6)
  c.multiplyScalar(0.96 + fbm2(p.x * 30, p.y * 30, 2) * 0.1)
  return { color: c, length: 0.035 * (0.88 + fbm2(p.x * 22, p.y * 22, 2) * 0.24) }
}

function pawSurface(p, n) {
  const sole = smoothstep(0.3, -0.9, n.y)
  const c = TAN.clone().lerp(CREAM, sole * 0.45)
  // toe creases read as a slightly darker fan at the front
  const crease = Math.abs(Math.sin(Math.atan2(p.x, 0.055) * 3.2))
  c.lerp(DARK_BROWN, smoothstep(0.35, 0.95, n.z) * crease * 0.12)
  c.multiplyScalar(0.95 + fbm2(p.x * 40, p.z * 40, 2) * 0.08)
  return { color: c, length: 0.0062 }
}

function legSurface(p, n) {
  const c = TAN.clone().lerp(CREAM, smoothstep(0.16, -0.9, n.y) * 0.34)
  c.multiplyScalar(0.95 + fbm2(p.x * 30, p.y * 20, 2) * 0.09)
  return { color: c, length: 0.01 }
}

/** Legs hand over to the paw shader near the ankle. */
function limbSurface(p, n, u, v) {
  return p.y < -0.135 ? pawSurface(p, n, u, v) : legSurface(p, n, u, v)
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                            */
/* ------------------------------------------------------------------ */

export async function createRabbit({ quality = 'high', maxAnisotropy = 8, onProgress = () => {} } = {}) {
  const t0 = performance.now()
  const mark = (label) => console.log(`[clover] ${label}: ${Math.round(performance.now() - t0)}ms`)
  const layers = quality === 'high' ? 21 : quality === 'medium' ? 16 : 12
  const FUR_LENGTH_LAYERS = layers
  const report = (phase, pct, detail) => onProgress({ phase, pct, detail })

  report('undercoat', 0.04, 'combing the undercoat')
  const furTexture = createFurTexture(1024, 20261030)
  const undercoatTexture = createUndercoatTexture(512, 91)
  const skinTexture = createSkinTexture(256, 303)
  const guardTexture = createGuardHairTexture(1024, 777)
  furTexture.repeat.set(2.2, 2.2)
  undercoatTexture.repeat.set(2.2, 2.2)
  skinTexture.repeat.set(1.4, 1.4)
  guardTexture.repeat.set(2.2, 2.2)
  furTexture.anisotropy = maxAnisotropy
  undercoatTexture.anisotropy = maxAnisotropy
  skinTexture.anisotropy = maxAnisotropy
  guardTexture.anisotropy = maxAnisotropy
  mark('textures')
  await nextFrame()

  const furMat = new THREE.MeshStandardMaterial({
    name: 'FurShells',
    map: furTexture,
    vertexColors: true,
    alphaTest: 0.24,
    transparent: false,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.65,
    side: THREE.FrontSide
  })
  const guardMat = new THREE.MeshStandardMaterial({
    name: 'FurGuard',
    map: guardTexture,
    vertexColors: true,
    alphaTest: 0.32,
    transparent: false,
    roughness: 0.94,
    metalness: 0,
    side: THREE.FrontSide
  })
  const coatMat = new THREE.MeshStandardMaterial({
    name: 'Undercoat',
    map: undercoatTexture,
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    side: THREE.FrontSide
  })
  const pinkMat = new THREE.MeshStandardMaterial({
    name: 'EarSkin',
    map: skinTexture,
    vertexColors: true,
    roughness: 0.68,
    metalness: 0,
    side: THREE.DoubleSide
  })

  const root = new THREE.Group()
  root.name = 'Rabbit'

  const addFurPart = (parent, name, baseGeo, surface, layerCount = FUR_LENGTH_LAYERS, withGuard = true) => {
    const coatGeo = paintGeometry(baseGeo.clone(), (p, n, u, v) => {
      const s = surface(p, n, u, v)
      return s.color.clone().multiplyScalar(0.9)
    })
    const coat = new THREE.Mesh(coatGeo, coatMat)
    coat.name = `${name}_coat`
    coat.receiveShadow = true
    parent.add(coat)

    const shells = buildFurShells(baseGeo, { layers: layerCount, surface, seed: name.length * 13 + 7 })
    const fur = new THREE.Mesh(shells, furMat)
    fur.name = `${name}_fur`
    fur.receiveShadow = true
    parent.add(fur)

    let triangles = shells.index.count / 3
    if (withGuard && layerCount >= 8) {
      const guardLayers = Math.max(2, Math.round(layerCount * 0.16))
      const guardGeo = buildFurShells(baseGeo, {
        layers: guardLayers,
        surface,
        seed: name.length * 31 + 29,
        tStart: 0.58,
        lengthScale: 1.18,
        fade: false
      })
      const guard = new THREE.Mesh(guardGeo, guardMat)
      guard.name = `${name}_guard`
      guard.receiveShadow = true
      parent.add(guard)
      triangles += guardGeo.index.count / 3
    }
    return { coat, fur, triangles }
  }

  /* body ------------------------------------------------------------ */
  report('body', 0.12, 'shaping a rabbit from clover and code')
  const bodyGeo = makeBodyGeometry()
  const body = new THREE.Group()
  body.name = 'body'
  root.add(body)
  let triCount = addFurPart(body, 'body', bodyGeo, bodySurface).triangles
  mark('body shells')

  // A short, full neck hides the head/body junction without a visible collar.
  const neck = new THREE.Group()
  neck.name = 'neck'
  neck.position.set(0, 0.452, 0.238)
  const neckGeo = deformSphere(30, 22, (v) => {
    const front = smoothstep(-0.2, 0.9, v.z)
    v.set(v.x * (0.096 + front * 0.008), v.y * 0.102, v.z * 0.106)
  })
  triCount += addFurPart(neck, 'neck', neckGeo, neckSurface, Math.max(8, Math.round(layers * 0.55))).triangles
  root.add(neck)
  await nextFrame()

  /* head ------------------------------------------------------------ */
  report('head', 0.3, 'sculpting cheeks, muzzle and brow')
  const headPivot = new THREE.Group()
  headPivot.name = 'headPivot'
  headPivot.position.set(0, 0.538, 0.316)
  root.add(headPivot)

  const headGeo = makeHeadGeometry()
  triCount += addFurPart(headPivot, 'head', headGeo, headSurface).triangles
  mark('head shells')
  await nextFrame()

  /* ears ------------------------------------------------------------ */
  report('ears', 0.46, 'standing two ears to attention')
  const earGeo = makeEarGeometry(0.29, 18, 30)
  const innerEarGeo = makeInnerEarGeometry(0.29, 12, 24)
  const ears = {}
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R'
    const pivot = new THREE.Group()
    pivot.name = `ear${key}`
    pivot.position.set(side * 0.06, 0.105, -0.01)
    pivot.rotation.z = side * 0.15
    pivot.rotation.x = -0.09
    headPivot.add(pivot)

    const outer = addFurPart(pivot, `ear${key}`, earGeo, earSurface, Math.max(8, Math.round(layers * 0.62)), false)
    triCount += outer.triangles

    const inner = new THREE.Mesh(innerEarGeo, pinkMat)
    inner.name = `ear${key}_inner`
    inner.renderOrder = 2
    pivot.add(inner)

    // a few soft hairs along the ear rim
    const rim = new THREE.Mesh(
      buildFurShells(earGeo, {
        layers: Math.max(4, Math.round(layers * 0.26)),
        surface: (p, n, u, v) => {
          const t = clamp(p.y / 0.29, 0, 1)
          const c = TAN.clone().lerp(CREAM, 0.35).lerp(DARK_BROWN, smoothstep(0.62, 1, t) * 0.36)
          return { color: c, length: 0.007 * smoothstep(0.15, 0.85, Math.abs(n.x)) }
        },
        seed: side * 71 + 3
      }),
      furMat
    )
    rim.name = `ear${key}_rim`
    pivot.add(rim)
    ears[key] = pivot
  }
  mark('ears')
  await nextFrame()

  /* face details ---------------------------------------------------- */
  report('face', 0.58, 'setting eyes, nose and whiskers')
  const eyeMat = new THREE.MeshPhysicalMaterial({
    name: 'Eye',
    color: 0x24130b,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.3
  })
  const shineMat = new THREE.MeshStandardMaterial({
    name: 'Catchlight',
    color: 0x000000,
    emissive: 0xfff6e8,
    emissiveIntensity: 2.2,
    roughness: 1
  })
  const eyeGeo = makeSphere(1, 28)
  const shineGeo = makeSphere(1, 10)
  const socketMat = new THREE.MeshStandardMaterial({
    name: 'EyeSocket',
    color: 0x5c432e,
    roughness: 0.95,
    metalness: 0
  })
  for (const side of [-1, 1]) {
    const socket = new THREE.Mesh(eyeGeo, socketMat)
    socket.name = `socket${side < 0 ? 'L' : 'R'}`
    socket.position.set(side * 0.094, 0.037, 0.098)
    socket.scale.set(0.0225, 0.0255, 0.0235)
    headPivot.add(socket)

    const eye = new THREE.Mesh(eyeGeo, eyeMat)
    eye.name = side < 0 ? 'eyeL' : 'eyeR'
    eye.position.set(side * 0.1, 0.039, 0.107)
    eye.scale.set(0.0175, 0.0205, 0.019)
    headPivot.add(eye)

    const shine = new THREE.Mesh(shineGeo, shineMat)
    shine.name = `catchlight${side < 0 ? 'L' : 'R'}`
    shine.position.set(side * 0.1085, 0.0485, 0.1195)
    shine.scale.setScalar(0.0026)
    headPivot.add(shine)
  }

  const noseMat = new THREE.MeshStandardMaterial({
    name: 'Nose',
    map: skinTexture,
    color: 0xc08d86,
    roughness: 0.66,
    metalness: 0
  })
  const nose = new THREE.Mesh(makeSphere(1, 24), noseMat)
  nose.name = 'nose'
  nose.position.set(0, -0.03, 0.244)
  nose.scale.set(0.013, 0.0095, 0.008)
  nose.rotation.x = 0.22
  headPivot.add(nose)

  const mouthMat = new THREE.MeshStandardMaterial({ name: 'Mouth', color: 0x7b5a47, roughness: 0.94 })
  const mouthCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, -0.04, 0.242),
    new THREE.Vector3(-0.008, -0.051, 0.236),
    new THREE.Vector3(-0.013, -0.055, 0.228)
  )
  const mouth = new THREE.Mesh(new THREE.TubeGeometry(mouthCurve, 10, 0.0009, 4, false), mouthMat)
  mouth.name = 'mouthL'
  headPivot.add(mouth)
  const mouth2 = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, -0.04, 0.242),
        new THREE.Vector3(0.008, -0.051, 0.236),
        new THREE.Vector3(0.013, -0.055, 0.228)
      ),
      10,
      0.0009,
      4,
      false
    ),
    mouthMat
  )
  mouth2.name = 'mouthR'
  headPivot.add(mouth2)
  // philtrum
  const philtrum = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0011, 0.009, 5), mouthMat)
  philtrum.name = 'philtrum'
  philtrum.position.set(0, -0.035, 0.243)
  headPivot.add(philtrum)

  const whiskerMat = new THREE.LineBasicMaterial({
    name: 'Whiskers',
    color: 0xfff6e4,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  })
  const whiskers = new THREE.LineSegments(makeWhiskers(), whiskerMat)
  whiskers.name = 'whiskers'
  headPivot.add(whiskers)

  /* legs + feet ----------------------------------------------------- */
  report('feet', 0.68, 'fluffing four lucky feet')
  const frontLegGeo = makeFrontLegGeometry()
  const backLegGeo = makeBackLegGeometry()
  const legs = {}
  for (const side of [-1, 1]) {
    const front = new THREE.Group()
    front.name = `legF${side < 0 ? 'L' : 'R'}`
    front.position.set(side * 0.085, 0.205, 0.238)
    const fur = addFurPart(front, `legF${side < 0 ? 'L' : 'R'}`, frontLegGeo, limbSurface, Math.max(5, Math.round(layers * 0.36)), false)
    triCount += fur.triangles
    root.add(front)
    legs[`F${side < 0 ? 'L' : 'R'}`] = front

    const back = new THREE.Group()
    back.name = `legB${side < 0 ? 'L' : 'R'}`
    back.position.set(side * 0.132, 0.275, -0.085)
    const hf = addFurPart(back, `legB${side < 0 ? 'L' : 'R'}`, backLegGeo, limbSurface, Math.max(6, Math.round(layers * 0.46)), false)
    triCount += hf.triangles
    root.add(back)
    legs[`B${side < 0 ? 'L' : 'R'}`] = back
  }
  mark('face + feet')
  await nextFrame()

  /* tail ------------------------------------------------------------ */
  report('tail', 0.76, 'pinning on the cotton tail')
  const tailPivot = new THREE.Group()
  tailPivot.name = 'tailPivot'
  tailPivot.position.set(0, 0.372, -0.335)
  root.add(tailPivot)
  const tailGeo = makeSphere(0.062, 30)
  tailGeo.scale(1, 0.95, 1)
  triCount += addFurPart(tailPivot, 'tail', tailGeo, tailSurface, Math.max(7, Math.round(layers * 0.55))).triangles

  /* round-trip through a real binary glTF --------------------------- */
  report('baking', 0.84, 'baking rabbit.glb')
  await nextFrame()
  const exporter = new GLTFExporter()
  const glb = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: true,
    maxTextureSize: 1024
  })
  if (!(glb instanceof ArrayBuffer)) throw new Error('GLB export did not return binary data')
  mark('glb export')

  report('loading', 0.92, 'grooming the finished GLB')
  await nextFrame()
  const loader = new GLTFLoader()
  const gltf = await loader.parseAsync(glb, '')
  mark('glb parse')
  const scene = gltf.scene
  scene.name = 'RabbitGLB'

  let furMeshes = 0
  scene.traverse((obj) => {
    if (!obj.isMesh) return
    if (
      obj.material?.name === 'FurShells' ||
      obj.material?.name === 'FurGuard' ||
      obj.name.endsWith('_fur') ||
      obj.name.endsWith('_guard') ||
      obj.name.endsWith('_rim')
    ) {
      furMeshes++
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        m.alphaToCoverage = true
        m.alphaTest = m.name === 'FurGuard' ? 0.32 : 0.24
        m.transparent = false
        m.depthWrite = true
        m.envMapIntensity = 0.65
        m.map && (m.map.anisotropy = maxAnisotropy)
      }
    }
    if (obj.material?.map) obj.material.map.anisotropy = maxAnisotropy
    obj.frustumCulled = true
  })

  const part = (name) => scene.getObjectByName(name)
  const stats = {
    bytes: glb.byteLength,
    triangles: Math.round(triCount),
    layers,
    furMeshes,
    meshes: (() => {
      let n = 0
      scene.traverse((o) => { if (o.isMesh) n++ })
      return n
    })()
  }
  report('ready', 1, 'rabbit ready')

  return {
    scene,
    glb,
    stats,
    nodes: {
      headPivot: part('headPivot'),
      earL: part('earL'),
      earR: part('earR'),
      tailPivot: part('tailPivot'),
      body: part('body'),
      legFL: part('legFL'),
      legFR: part('legFR'),
      legBL: part('legBL'),
      legBR: part('legBR')
    }
  }
}
