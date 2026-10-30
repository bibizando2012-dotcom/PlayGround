/*
 * Builds the hare hero as a real GLB asset.
 * Everything (geometry, materials, hierarchy, fur metadata) is authored here,
 * then exported with the official three.js GLTFExporter.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const OUT = resolve('public/models/hare.glb')

// Minimal FileReader polyfill for GLTFExporter in node.
globalThis.FileReader = class FileReader {
  constructor() { this.result = null; this.onloadend = null; this.onload = null }
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b
      this.onload?.({ target: this })
      this.onloadend?.({ target: this })
    })
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`
      this.onload?.({ target: this })
      this.onloadend?.({ target: this })
    })
  }
}

const TAU = Math.PI * 2
const sideNames = ['L', 'R']

function material(name, color, roughness = 0.82, metalness = 0) {
  const m = new THREE.MeshStandardMaterial({ name, color, roughness, metalness })
  m.userData.assetRole = name
  return m
}

const furBody = {
  root: '#5d3d27',
  tip: '#c49362',
  length: 0.052,
  density: 0.94,
  shells: 32,
  roughness: 0.74,
}
const furHead = {
  root: '#62412b',
  tip: '#c99b6b',
  length: 0.04,
  density: 0.96,
  shells: 30,
  roughness: 0.75,
}
const furCream = {
  root: '#bda98f',
  tip: '#fff8e8',
  length: 0.038,
  density: 0.9,
  shells: 26,
  roughness: 0.88,
}
const furTail = {
  root: '#d8c8b1',
  tip: '#fffdf4',
  length: 0.075,
  density: 0.9,
  shells: 34,
  roughness: 0.95,
}
const furEar = {
  root: '#735036',
  tip: '#27201a',
  length: 0.038,
  density: 0.94,
  shells: 28,
  roughness: 0.78,
}
const furHaunch = {
  root: '#5b3a25',
  tip: '#bb8a5a',
  length: 0.046,
  density: 0.95,
  shells: 26,
  roughness: 0.76,
}

function ellipsoidGeometry(sx, sy, sz, widthSegments = 32, heightSegments = 22) {
  const g = new THREE.SphereGeometry(1, widthSegments, heightSegments)
  g.scale(sx, sy, sz)
  g.computeVertexNormals()
  return g
}

function furMesh(name, geometry, position, fur, seed = 0, baseColor = fur.tip) {
  const m = new THREE.Mesh(
    geometry,
    material(`${name}_undercoat`, new THREE.Color(baseColor), fur.roughness),
  )
  m.name = name
  m.position.set(...position)
  m.userData.fur = {
    ...fur,
    seed,
    quality: fur.shells >= 30 ? 'high' : 'standard',
  }
  return m
}

function addEar(side, headPivot) {
  const s = side === 'L' ? 1 : -1
  const pivot = new THREE.Group()
  pivot.name = `Ear${side}Pivot`
  pivot.position.set(0.073 * s, 0.145, 0.005)
  pivot.rotation.z = -0.115 * s
  pivot.rotation.x = -0.06
  headPivot.add(pivot)

  const along = 22
  const around = 12
  const positions = []
  const uvs = []
  const indices = []
  const centers = []

  for (let i = 0; i <= along; i++) {
    const t = i / along
    // Broad, spoon-shaped upright ear with a soft backward curve.
    const cx = s * (0.012 + 0.108 * t + 0.028 * Math.sin(Math.PI * t))
    const cy = 0.455 * t
    const cz = 0.018 * Math.sin(Math.PI * t) - 0.012 * t * t
    const profile = Math.pow(Math.sin(Math.PI * (0.16 + 0.79 * t)), 0.58)
    const width = 0.084 * profile * (0.84 + 0.25 * Math.sin(Math.PI * t))
    const thick = 0.019 * (1.0 - 0.48 * t) * (0.88 + 0.18 * Math.sin(Math.PI * t))
    centers.push([cx, cy, cz])

    for (let j = 0; j <= around; j++) {
      const v = j / around
      const a = v * TAU
      // Cup the front face inward a little.
      const cup = -0.012 * Math.max(0, -Math.cos(a)) * Math.sin(Math.PI * t)
      const px = cx + Math.cos(a) * width
      const py = cy + Math.sin(a) * 0.004
      const pz = cz + Math.sin(a) * thick + cup
      positions.push(px, py, pz)
      uvs.push(v, t)
    }
  }

  for (let i = 0; i < along; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j
      const b = a + around + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()

  const outer = furMesh(`Fur_Ear${side}`, g, [0, 0, 0], furEar, side === 'L' ? 1 : 2, '#8b6548')
  pivot.add(outer)

  // Soft pink inner ear, inset toward the face.
  const innerPositions = []
  const innerIndices = []
  const innerAcross = 12
  for (let i = 0; i <= along; i++) {
    const t = i / along
    const [cx, cy, cz] = centers[i]
    const profile = Math.pow(Math.sin(Math.PI * (0.16 + 0.79 * t)), 0.58)
    const width = 0.061 * profile * (0.9 + 0.2 * Math.sin(Math.PI * t))
    for (let j = 0; j <= innerAcross; j++) {
      const u = (j / innerAcross) * 2 - 1
      // A soft, concave ribbon lying just in front of the ear's front face.
      innerPositions.push(
        cx + u * width,
        cy + 0.002,
        cz - 0.0215 - 0.0055 * (1 - u * u),
      )
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < innerAcross; j++) {
      const a = i * (innerAcross + 1) + j
      const b = a + innerAcross + 1
      innerIndices.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const innerGeo = new THREE.BufferGeometry()
  innerGeo.setAttribute('position', new THREE.Float32BufferAttribute(innerPositions, 3))
  innerGeo.setIndex(innerIndices)
  innerGeo.computeVertexNormals()
  const inner = new THREE.Mesh(
    innerGeo,
    new THREE.MeshStandardMaterial({
      name: `Ear${side}_inner`,
      color: '#c9827d',
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  )
  inner.name = `InnerEar${side}`
  inner.userData.assetRole = 'innerEar'
  pivot.add(inner)

  return pivot
}

function addWhiskers(headPivot) {
  const whiskerMat = new THREE.MeshStandardMaterial({
    name: 'Whisker',
    color: '#f6eee1',
    roughness: 0.35,
    metalness: 0,
  })
  const s = 1
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = 0.008 - i * 0.021
      const start = new THREE.Vector3(side * 0.105, y, -0.205)
      const mid = new THREE.Vector3(side * (0.23 + i * 0.008), y - 0.005 - i * 0.012, -0.22 - i * 0.004)
      const end = new THREE.Vector3(side * (0.35 + i * 0.014), y - 0.035 - i * 0.017, -0.19 + i * 0.018)
      const curve = new THREE.CatmullRomCurve3([start, mid, end])
      const g = new THREE.TubeGeometry(curve, 9, 0.0018, 4, false)
      const w = new THREE.Mesh(g, whiskerMat)
      w.name = `Whisker_${side > 0 ? 'L' : 'R'}_${i}`
      w.userData.assetRole = 'whisker'
      headPivot.add(w)
    }
  }
}

function addEyes(headPivot) {
  const eyeMat = new THREE.MeshPhysicalMaterial({
    name: 'Eye',
    color: '#180c08',
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.3,
  })
  const irisMat = new THREE.MeshStandardMaterial({
    name: 'Iris',
    color: '#4d2a12',
    roughness: 0.2,
    metalness: 0.05,
  })
  const glintMat = new THREE.MeshBasicMaterial({ name: 'EyeGlint', color: '#fffbe9' })

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), eyeMat)
    eye.name = `Eye${side > 0 ? 'L' : 'R'}`
    eye.scale.set(0.034, 0.042, 0.027)
    eye.position.set(side * 0.101, 0.055, -0.191)
    eye.userData.assetRole = 'eye'
    headPivot.add(eye)

    const iris = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), irisMat)
    iris.name = `Iris${side > 0 ? 'L' : 'R'}`
    iris.scale.set(0.028, 0.034, 0.008)
    iris.position.set(side * 0.106, 0.052, -0.216)
    iris.userData.assetRole = 'iris'
    headPivot.add(iris)

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), eyeMat)
    pupil.name = `Pupil${side > 0 ? 'L' : 'R'}`
    pupil.scale.set(0.015, 0.027, 0.006)
    pupil.position.set(side * 0.107, 0.052, -0.223)
    pupil.userData.assetRole = 'pupil'
    headPivot.add(pupil)

    const glint = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), glintMat)
    glint.name = `Glint${side > 0 ? 'L' : 'R'}`
    glint.scale.setScalar(0.0065)
    glint.position.set(side * 0.117, 0.069, -0.226)
    glint.userData.assetRole = 'glint'
    headPivot.add(glint)
  }
}

function build() {
  const root = new THREE.Group()
  root.name = 'HareRoot'

  const bodyPivot = new THREE.Group()
  bodyPivot.name = 'BodyPivot'
  bodyPivot.position.y = 0.48
  root.add(bodyPivot)

  const torso = furMesh(
    'Fur_Torso',
    ellipsoidGeometry(0.272, 0.335, 0.39, 30, 20),
    [0, 0, 0.035],
    furBody,
    10,
  )
  torso.rotation.x = -0.055
  bodyPivot.add(torso)

  const chest = furMesh(
    'Fur_Chest',
    ellipsoidGeometry(0.227, 0.27, 0.23, 26, 18),
    [0, 0.02, -0.205],
    furBody,
    11,
  )
  bodyPivot.add(chest)

  for (const s of [-1, 1]) {
    const haunch = furMesh(
      `Fur_Haunch${s > 0 ? 'L' : 'R'}`,
      ellipsoidGeometry(0.13, 0.205, 0.21, 24, 16),
      [s * 0.155, -0.062, 0.205],
      furHaunch,
      20 + s,
    )
    haunch.rotation.z = s * 0.1
    bodyPivot.add(haunch)
  }

  const belly = furMesh(
    'Fur_Belly',
    ellipsoidGeometry(0.182, 0.225, 0.235, 24, 16),
    [0, -0.105, -0.16],
    furCream,
    30,
  )
  belly.scale.set(1, 1, 0.92)
  bodyPivot.add(belly)

  // Feet / toes
  const toeMat = material('Paw', '#d3bb9b', 0.9)
  for (const s of [-1, 1]) {
    const footPivot = new THREE.Group()
    footPivot.name = `Foot${s > 0 ? 'L' : 'R'}Pivot`
    footPivot.position.set(s * 0.183, -0.37, -0.036)
    bodyPivot.add(footPivot)

    const foot = furMesh(
      `Fur_Foot${s > 0 ? 'L' : 'R'}`,
      ellipsoidGeometry(0.068, 0.052, 0.185, 20, 14),
      [0, 0.012, -0.075],
      furCream,
      40 + s,
    )
    footPivot.add(foot)

    for (let t = -1; t <= 1; t++) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), toeMat)
      toe.name = `Toe${s > 0 ? 'L' : 'R'}_${t + 2}`
      toe.scale.set(0.018, 0.018, 0.038)
      toe.position.set(s * 0.007 + t * 0.028, 0.012, -0.235)
      toe.userData.assetRole = 'toe'
      footPivot.add(toe)
    }
  }

  // Front paws tucked under the chest
  for (const s of [-1, 1]) {
    const legPivot = new THREE.Group()
    legPivot.name = `FrontLeg${s > 0 ? 'L' : 'R'}Pivot`
    legPivot.position.set(s * 0.148, -0.055, -0.255)
    legPivot.rotation.x = 0.12
    bodyPivot.add(legPivot)

    const leg = furMesh(
      `Fur_FrontLeg${s > 0 ? 'L' : 'R'}`,
      ellipsoidGeometry(0.05, 0.145, 0.057, 16, 12),
      [0, -0.11, -0.02],
      furCream,
      50 + s,
    )
    leg.rotation.x = -0.1
    legPivot.add(leg)
  }

  // Fluffy cotton tail
  const tailPivot = new THREE.Group()
  tailPivot.name = 'TailPivot'
  tailPivot.position.set(0, 0.075, 0.415)
  bodyPivot.add(tailPivot)
  const tail = furMesh(
    'Fur_Tail',
    new THREE.IcosahedronGeometry(0.112, 3),
    [0, 0, 0.015],
    furTail,
    60,
  )
  tailPivot.add(tail)

  // Neck + head
  const headPivot = new THREE.Group()
  headPivot.name = 'HeadPivot'
  headPivot.position.set(0, 0.26, -0.265)
  headPivot.rotation.x = -0.045
  bodyPivot.add(headPivot)

  const head = furMesh(
    'Fur_Head',
    ellipsoidGeometry(0.17, 0.19, 0.205, 30, 20),
    [0, 0.015, -0.035],
    furHead,
    70,
  )
  head.rotation.x = -0.06
  headPivot.add(head)

  // Cheeks and muzzle give the face a soft heart shape.
  for (const s of [-1, 1]) {
    const cheek = furMesh(
      `Fur_Cheek${s > 0 ? 'L' : 'R'}`,
      ellipsoidGeometry(0.085, 0.074, 0.075, 20, 14),
      [s * 0.064, -0.033, -0.185],
      furCream,
      80 + s,
    )
    headPivot.add(cheek)
  }

  const bridge = furMesh(
    'Fur_Bridge',
    ellipsoidGeometry(0.061, 0.086, 0.078, 20, 14),
    [0, 0.003, -0.185],
    furCream,
    82,
  )
  headPivot.add(bridge)

  addEyes(headPivot)
  addWhiskers(headPivot)

  // Nose and mouth
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshPhysicalMaterial({
      name: 'Nose',
      color: '#9d5853',
      roughness: 0.32,
      clearcoat: 0.65,
      clearcoatRoughness: 0.25,
    }),
  )
  nose.name = 'Nose'
  nose.scale.set(0.034, 0.026, 0.021)
  nose.position.set(0, -0.012, -0.238)
  nose.userData.assetRole = 'nose'
  headPivot.add(nose)

  const mouthMat = new THREE.MeshBasicMaterial({ name: 'Mouth', color: '#3b2119' })
  for (const s of [-1, 1]) {
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.0025, 4, 12, 1.3), mouthMat)
    mouth.name = `Mouth${s > 0 ? 'L' : 'R'}`
    mouth.position.set(s * 0.021, -0.048, -0.224)
    mouth.rotation.z = s > 0 ? -0.6 : Math.PI + 0.6
    mouth.rotation.y = s * 0.15
    mouth.userData.assetRole = 'mouth'
    headPivot.add(mouth)
  }

  // Tiny incisors, just visible below the muzzle.
  for (const s of [-1, 1]) {
    const tooth = new THREE.Mesh(
      new THREE.BoxGeometry(0.017, 0.027, 0.008, 4, 4, 2),
      new THREE.MeshStandardMaterial({ name: 'Tooth', color: '#f4e6cb', roughness: 0.38 }),
    )
    tooth.name = `Tooth${s > 0 ? 'L' : 'R'}`
    tooth.position.set(s * 0.009, -0.068, -0.216)
    tooth.rotation.x = -0.08
    tooth.userData.assetRole = 'tooth'
    headPivot.add(tooth)
  }

  // Brow tufts
  for (const s of [-1, 1]) {
    const brow = furMesh(
      `Fur_Brow${s > 0 ? 'L' : 'R'}`,
      ellipsoidGeometry(0.048, 0.024, 0.036, 14, 10),
      [s * 0.099, 0.108, -0.17],
      furCream,
      90 + s,
    )
    brow.rotation.z = s * 0.18
    headPivot.add(brow)
  }

  for (const side of sideNames) addEar(side, headPivot)

  // Tilt the whole head slightly, giving it an inquisitive silhouette.
  headPivot.rotation.z = 0.025

  root.userData.asset = {
    name: 'Thistledown Hare',
    author: 'Procedural meadow studio',
    license: 'CC0',
    generated: new Date().toISOString(),
  }

  return root
}

const scene = new THREE.Scene()
scene.name = 'HareScene'
scene.add(build())

const exporter = new GLTFExporter()
const glb = await exporter.parseAsync(scene, {
  binary: true,
  onlyVisible: false,
  truncateDrawRange: false,
  maxTextureSize: 2048,
})

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.from(glb))
console.log(`wrote ${OUT} (${(glb.byteLength / 1024).toFixed(1)} KiB)`)
