#!/usr/bin/env node
/* Builds the star of the meadow: a hand-authored, animation-ready rabbit GLB.
 * Geometry is generated procedurally here so the download stays tiny and every
 * vertex is ours. Materials are intentionally simple; the game adds a
 * procedural fur shader on top of the named fur meshes. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../assets/harebell-rabbit.glb')

const V = {
  fur: [0.53, 0.35, 0.21, 1],
  furLight: [0.72, 0.54, 0.35, 1],
  cream: [0.87, 0.77, 0.60, 1],
  pink: [0.72, 0.39, 0.34, 1],
  eye: [0.025, 0.015, 0.01, 1],
  highlight: [1, 0.93, 0.77, 1],
  claw: [0.22, 0.16, 0.12, 1],
}
const M = {
  fur: { name: 'Fur_Warm', base: V.fur, rough: 0.92, spec: 0.22 },
  furLight: { name: 'Fur_Sunlit', base: V.furLight, rough: 0.9, spec: 0.2 },
  cream: { name: 'Fur_Cream', base: V.cream, rough: 0.94, spec: 0.18 },
  pink: { name: 'Skin_Pink', base: V.pink, rough: 0.68, spec: 0.3 },
  eye: { name: 'Eye_Obsidian', base: V.eye, rough: 0.08, spec: 1 },
  highlight: { name: 'Eye_Starlight', base: V.highlight, rough: 0.1, spec: 1, emissive: [0.7, 0.6, 0.45] },
  claw: { name: 'Claw_Horn', base: V.claw, rough: 0.5, spec: 0.5 },
}

function vertex(x, y, z) { return [x, y, z] }

function ellipsoid({
  center = [0, 0, 0], radius = [0.1, 0.1, 0.1], segments = 40, rings = 26,
  squash = null, wave = null,
}) {
  const positions = [], normals = [], uvs = [], indices = []
  const [cx, cy, cz] = center, [rx, ry, rz] = radius
  for (let j = 0; j <= rings; j++) {
    const v = j / rings, phi = v * Math.PI
    const sy = Math.cos(phi), sr = Math.sin(phi)
    for (let i = 0; i <= segments; i++) {
      const u = i / segments, theta = u * Math.PI * 2
      let x = Math.cos(theta) * sr, y = sy, z = Math.sin(theta) * sr
      let px = cx + x * rx, py = cy + y * ry, pz = cz + z * rz
      if (squash) {
        const sq = squash(x, y, z)
        px *= sq.x || 1; py *= sq.y || 1; pz *= sq.z || 1
      }
      if (wave) {
        const d = wave(x, y, z, u, v)
        px += x * d; py += y * d; pz += z * d
      }
      positions.push(px, py, pz)
      // smooth ellipsoid normal; the mild waves are shading details.
      normals.push(x / rx, y / ry, z / rz)
      uvs.push(u, 1 - v)
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + segments + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const n = normals.length / 3
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1
    normals[i * 3] /= l; normals[i * 3 + 1] /= l; normals[i * 3 + 2] /= l
  }
  return { positions, normals, uvs, indices }
}

function ear({ side = 1, height = 0.43 }) {
  const ringCount = 34, sides = 18
  const positions = [], normals = [], uvs = [], indices = []
  const widthAt = t => {
    if (t < 0.08) return 0.061 + t * 0.55
    if (t < 0.5) return 0.105 + Math.sin((t - 0.08) / 0.42 * Math.PI) * 0.042
    return 0.105 * Math.pow(1 - (t - 0.5) / 0.5, 0.62) + 0.007
  }
  const depthAt = t => (0.028 + Math.sin(Math.min(1, t / 0.72) * Math.PI) * 0.027) * (1 - t * 0.35)
  const bend = t => 0.024 * Math.sin(t * Math.PI * 0.9) - 0.045 * t * t
  for (let j = 0; j <= ringCount; j++) {
    const t = j / ringCount
    const w = widthAt(t), d = depthAt(t), z0 = bend(t)
    const y = t * height
    for (let i = 0; i <= sides; i++) {
      const a = i / sides * Math.PI * 2
      const ca = Math.cos(a), sa = Math.sin(a)
      const x = ca * w * side
      const z = z0 + sa * d
      positions.push(x, y, z)
      // The cross section is an ellipse in x/z and we add no enormous slope.
      normals.push(ca / w, 0, sa / d)
      uvs.push(i / sides, t)
    }
  }
  for (let j = 0; j < ringCount; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * (sides + 1) + i, b = a + sides + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const n = normals.length / 3
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1
    normals[i * 3] /= l; normals[i * 3 + 1] /= l; normals[i * 3 + 2] /= l
  }
  return { positions, normals, uvs, indices }
}

function earInner({ side = 1, height = 0.43 }) {
  const rows = 22, cols = 8
  const positions = [], normals = [], uvs = [], indices = []
  const widthAt = t => {
    if (t < 0.08) return 0.061 + t * 0.55
    if (t < 0.5) return 0.105 + Math.sin((t - 0.08) / 0.42 * Math.PI) * 0.042
    return 0.105 * Math.pow(1 - (t - 0.5) / 0.5, 0.62) + 0.007
  }
  const depthAt = t => (0.028 + Math.sin(Math.min(1, t / 0.72) * Math.PI) * 0.027) * (1 - t * 0.35)
  const bend = t => 0.024 * Math.sin(t * Math.PI * 0.9) - 0.045 * t * t
  for (let j = 0; j <= rows; j++) {
    const t = 0.09 + j / rows * 0.78
    const w = widthAt(t) * 0.68, d = depthAt(t), z0 = bend(t)
    for (let i = 0; i <= cols; i++) {
      const u = i / cols * 2 - 1
      const y = t * height
      const x = u * w * side
      const z = z0 + d * (0.83 + 0.17 * (1 - u * u)) + 0.0008
      positions.push(x, y, z)
      normals.push(0, 0.08, 1)
      uvs.push(i / cols, (t - 0.09) / 0.78)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + cols + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  return { positions, normals, uvs, indices }
}

const parts = []
function add(name, geometry, material, translation = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], extra = {}) {
  parts.push({ name, geometry, material, translation, rotation, scale, ...extra })
}

// Body mass: chest and rump lobes give that pear-shaped hare silhouette.
add('Body', ellipsoid({
  center: [0, 0.455, -0.015], radius: [0.295, 0.305, 0.44], segments: 52, rings: 34,
  wave: (x, y, z, u, v) => 0.0045 * Math.sin(v * Math.PI * 7) * Math.sin(u * Math.PI * 5),
}), 'fur', [0, 0, 0])
add('Haunch_L', ellipsoid({ center: [-0.208, 0.315, -0.205], radius: [0.165, 0.215, 0.235], segments: 34, rings: 22 }), 'fur', [0, 0, 0], [-0.1, 0, 0.1])
add('Haunch_R', ellipsoid({ center: [0.208, 0.315, -0.205], radius: [0.165, 0.215, 0.235], segments: 34, rings: 22 }), 'fur', [0, 0, 0], [-0.1, 0, -0.1])
add('Chest', ellipsoid({ center: [0, 0.39, 0.295], radius: [0.16, 0.205, 0.135], segments: 34, rings: 22 }), 'cream', [0, 0, 0])
add('Belly', ellipsoid({ center: [0, 0.225, 0.035], radius: [0.185, 0.115, 0.32], segments: 32, rings: 22 }), 'cream', [0, 0, 0])
add('Neck', ellipsoid({ center: [0, 0.60, 0.245], radius: [0.158, 0.185, 0.175], segments: 30, rings: 20 }), 'fur', [0, 0, 0])

// Head group: everything below is parented under Head in the GLB.
add('Head', ellipsoid({
  center: [0, 0.75, 0.40], radius: [0.171, 0.181, 0.226], segments: 44, rings: 30,
  wave: (x, y, z, u, v) => 0.0025 * Math.sin(u * Math.PI * 6) * Math.sin(v * Math.PI * 4),
}), 'fur')
add('Cheek_L', ellipsoid({ center: [-0.091, 0.700, 0.527], radius: [0.101, 0.099, 0.121], segments: 28, rings: 18 }), 'cream')
add('Cheek_R', ellipsoid({ center: [0.091, 0.700, 0.527], radius: [0.101, 0.099, 0.121], segments: 28, rings: 18 }), 'cream')
add('Muzzle_L', ellipsoid({ center: [-0.041, 0.681, 0.592], radius: [0.073, 0.068, 0.098], segments: 26, rings: 18 }), 'cream')
add('Muzzle_R', ellipsoid({ center: [0.041, 0.681, 0.592], radius: [0.073, 0.068, 0.098], segments: 26, rings: 18 }), 'cream')
add('Nose', ellipsoid({ center: [0, 0.707, 0.673], radius: [0.035, 0.026, 0.023], segments: 24, rings: 14 }), 'pink')
add('Eye_L', ellipsoid({ center: [-0.111, 0.786, 0.553], radius: [0.029, 0.036, 0.029], segments: 28, rings: 20 }), 'eye')
add('Eye_R', ellipsoid({ center: [0.111, 0.786, 0.553], radius: [0.029, 0.036, 0.029], segments: 28, rings: 20 }), 'eye')
add('Glint_L', ellipsoid({ center: [-0.119, 0.798, 0.575], radius: [0.0042, 0.0052, 0.0025], segments: 10, rings: 6 }), 'highlight')
add('Glint_R', ellipsoid({ center: [0.102, 0.798, 0.575], radius: [0.0042, 0.0052, 0.0025], segments: 10, rings: 6 }), 'highlight')

// Ears are individual nodes so the game can bounce and swivel them.
add('Ear_L', ear({ side: -1 }), 'fur', [-0.085, 0.87, 0.355], [0.13, -0.12, 0.20])
add('Ear_R', ear({ side: 1 }), 'fur', [0.085, 0.87, 0.355], [0.13, 0.12, -0.20])
add('EarInner_L', earInner({ side: -1 }), 'pink', [-0.085, 0.87, 0.355], [0.13, -0.12, 0.20])
add('EarInner_R', earInner({ side: 1 }), 'pink', [0.085, 0.87, 0.355], [0.13, 0.12, -0.20])

// Legs. Fronts tuck close to the chest; the big hind feet sell the rabbit read.
add('FrontLeg_L', ellipsoid({ center: [-0.185, 0.235, 0.245], radius: [0.054, 0.175, 0.062], segments: 22, rings: 16 }), 'fur')
add('FrontLeg_R', ellipsoid({ center: [0.185, 0.235, 0.245], radius: [0.054, 0.175, 0.062], segments: 22, rings: 16 }), 'fur')
add('FrontPaw_L', ellipsoid({ center: [-0.185, 0.075, 0.315], radius: [0.072, 0.052, 0.125], segments: 24, rings: 16 }), 'cream')
add('FrontPaw_R', ellipsoid({ center: [0.185, 0.075, 0.315], radius: [0.072, 0.052, 0.125], segments: 24, rings: 16 }), 'cream')
add('HindFoot_L', ellipsoid({ center: [-0.202, 0.072, -0.145], radius: [0.083, 0.064, 0.235], segments: 28, rings: 18 }), 'furLight', [0, 0, 0], [0, -0.06, 0])
add('HindFoot_R', ellipsoid({ center: [0.202, 0.072, -0.145], radius: [0.083, 0.064, 0.235], segments: 28, rings: 18 }), 'furLight', [0, 0, 0], [0, 0.06, 0])
add('Toe_L', ellipsoid({ center: [-0.202, 0.07, 0.085], radius: [0.074, 0.052, 0.09], segments: 22, rings: 14 }), 'cream')
add('Toe_R', ellipsoid({ center: [0.202, 0.07, 0.085], radius: [0.074, 0.052, 0.09], segments: 22, rings: 14 }), 'cream')

// The pom-pom. Cream, and just a little oversized.
add('Tail', ellipsoid({ center: [0, 0.555, -0.455], radius: [0.097, 0.102, 0.09], segments: 28, rings: 18 }), 'cream')
add('TailTuft1', ellipsoid({ center: [-0.052, 0.59, -0.50], radius: [0.055, 0.065, 0.052], segments: 18, rings: 12 }), 'furLight')
add('TailTuft2', ellipsoid({ center: [0.056, 0.525, -0.49], radius: [0.05, 0.056, 0.047], segments: 18, rings: 12 }), 'furLight')

// All parts stay at rest-pose world coordinates. The game assembles pivots at
// runtime, which keeps the GLB straightforward to inspect and retarget.
const headNames = new Set(['Head', 'Cheek_L', 'Cheek_R', 'Muzzle_L', 'Muzzle_R', 'Nose', 'Eye_L', 'Eye_R', 'Glint_L', 'Glint_R', 'Ear_L', 'Ear_R', 'EarInner_L', 'EarInner_R'])

// glTF binary assembly -------------------------------------------------------
const binChunks = []
let binLength = 0
function align(n, a = 4) { return (n + a - 1) & ~(a - 1) }
function appendBuffer(buffer) {
  const pad = align(buffer.length)
  binChunks.push(buffer)
  if (pad !== buffer.length) binChunks.push(Buffer.alloc(pad - buffer.length))
  binLength += pad
  return binLength - pad
}
function accessorForFloats(values) {
  const data = Buffer.alloc(values.length * 4)
  values.forEach((v, i) => data.writeFloatLE(v, i * 4))
  return { bufferView: appendBuffer(data), componentType: 5126, count: values.length / 3, type: 'VEC3' }
}
function accessorForUVs(values) {
  const data = Buffer.alloc(values.length * 4)
  values.forEach((v, i) => data.writeFloatLE(v, i * 4))
  return { bufferView: appendBuffer(data), componentType: 5126, count: values.length / 2, type: 'VEC2' }
}
function accessorForIndices(values) {
  const big = values.length > 65535
  const data = Buffer.alloc(values.length * (big ? 4 : 2))
  values.forEach((v, i) => big ? data.writeUInt32LE(v, i * 4) : data.writeUInt16LE(v, i * 2))
  return { bufferView: appendBuffer(data), componentType: big ? 5125 : 5123, count: values.length, type: 'SCALAR' }
}

const bufferViews = []
const accessors = []
function addAccessor(fn, values) {
  // appendBuffer returns byte offset; we need the view offset at creation time.
  const offset = binLength
  const acc = fn(values)
  acc.bufferView = bufferViews.length
  const view = { buffer: 0, byteOffset: offset, byteLength: align(acc.count * (acc.type === 'SCALAR' ? (acc.componentType === 5125 ? 4 : 2) : (acc.type === 'VEC2' ? 8 : 12))) }
  bufferViews.push(view)
  accessors.push(acc)
  return accessors.length - 1
}

const materials = Object.entries(M).map(([key, m]) => ({
  name: m.name,
  pbrMetallicRoughness: {
    baseColorFactor: m.base,
    metallicFactor: 0,
    roughnessFactor: m.rough,
  },
  emissiveFactor: m.emissive || [0, 0, 0],
  doubleSided: key === 'pink' || key === 'highlight',
  extras: { fur: key === 'fur' || key === 'furLight' || key === 'cream', part: key },
}))

const meshes = []
const nodes = []
const headChildren = []
for (const part of parts) {
  const g = part.geometry
  const position = addAccessor(accessorForFloats, g.positions)
  const normal = addAccessor(accessorForFloats, g.normals)
  const uv = addAccessor(accessorForUVs, g.uvs)
  const index = addAccessor(accessorForIndices, g.indices)
  const attributes = { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }
  meshes.push({ name: part.name + '_mesh', primitives: [{ attributes, indices: index, material: Object.keys(M).indexOf(part.material) }] })
  const node = {
    name: part.name,
    mesh: meshes.length - 1,
    translation: part.translation,
    rotation: [Math.sin(part.rotation[0] / 2), Math.sin(part.rotation[1] / 2), Math.sin(part.rotation[2] / 2), Math.cos(part.rotation[0] / 2)],
    scale: part.scale,
  }
  // Rotation above is only cheap for single-axis; build the real quaternion.
  node.rotation = eulerQuat(part.rotation)
  nodes.push(node)
}

function eulerQuat(e) {
  const [x, y, z] = e.map(v => v / 2)
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z)
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]
}

const rootChildren = nodes.map((_, i) => i)
const scene = { name: 'Harebell', nodes: rootChildren }

const json = {
  asset: { version: '2.0', generator: 'Harebell meadow rabbit builder' },
  scene: 0,
  scenes: [scene],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: binLength }],
  extras: {
    attribution: 'Harebell rabbit — procedural original geometry, generated for this project.',
    forward: '+Z',
    height: 1.3,
    furMeshes: ['Body', 'Haunch_L', 'Haunch_R', 'Chest', 'Belly', 'Neck', 'Head', 'Cheek_L', 'Cheek_R', 'Muzzle_L', 'Muzzle_R', 'Ear_L', 'Ear_R', 'FrontLeg_L', 'FrontLeg_R', 'FrontPaw_L', 'FrontPaw_R', 'HindFoot_L', 'HindFoot_R', 'Tail'],
  },
}

const bin = Buffer.concat(binChunks)
const jsonText = JSON.stringify(json)
const jsonPad = Buffer.alloc(align(Buffer.byteLength(jsonText)) - Buffer.byteLength(jsonText), 0x20)
const jsonChunk = Buffer.concat([Buffer.from(jsonText), jsonPad])
const header = Buffer.alloc(12)
const jsonHeader = Buffer.alloc(8)
const binHeader = Buffer.alloc(8)
const total = 12 + 8 + jsonChunk.length + 8 + bin.length
header.writeUInt32LE(0x46546C67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(total, 8)
jsonHeader.writeUInt32LE(jsonChunk.length, 0)
jsonHeader.writeUInt32LE(0x4E4F534A, 4)
binHeader.writeUInt32LE(bin.length, 0)
binHeader.writeUInt32LE(0x004E4942, 4)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]))
console.log(`Wrote ${out} (${(total / 1024).toFixed(0)} kB, ${nodes.length} nodes, ${meshes.length} meshes)`)
