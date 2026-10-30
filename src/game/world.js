import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  createGroundTexture,
  createGrainTexture,
  createWaterNormalTexture,
  createSoftSpriteTexture,
  createCloudTexture
} from './textures.js'
import { mulberry32, fbm2, smoothstep, clamp, lerp } from './rng.js'

const TAU = Math.PI * 2
const POND = { x: -8.4, z: -6.6, r: 4.35, level: -0.15 }
const WORLD_RADIUS = 33

function pathX(z) {
  return Math.sin(z * 0.105) * 3.3 + Math.sin(z * 0.036 + 1.3) * 2.4 - 1.2
}

function pathDistance(x, z) {
  return Math.abs(x - pathX(z))
}

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z)
  let h =
    Math.sin(x * 0.23) * Math.cos(z * 0.19) * 0.09 +
    Math.sin((x + z) * 0.061 + 1.2) * 0.14 +
    Math.sin(x * 0.41 - z * 0.33) * 0.025
  h += smoothstep(24, 54, r) * (2.1 + Math.sin(x * 0.14 + 0.4) * Math.cos(z * 0.11) * 1.1)
  h += smoothstep(46, 64, r) * 3.4
  const d = Math.hypot(x - POND.x, z - POND.z)
  h -= 0.62 * (1 - smoothstep(0, 4.5, d))
  h += smoothstep(4.5, 6.0, d) * (1 - smoothstep(6.0, 8.0, d)) * 0.05
  return h
}

export function isWater(x, z) {
  const d = Math.hypot(x - POND.x, z - POND.z)
  return d < POND.r + 0.4 && terrainHeight(x, z) < POND.level
}

export function createWorld({ renderer, scene, isMobile = false, maxAnisotropy = 8 }) {
  const quality = isMobile ? 0.72 : 1
  const rnd = mulberry32(424242)
  const group = new THREE.Group()
  group.name = 'Meadow'
  scene.add(group)

  /* ---------------------------------------------------------------- */
  /*  Sky + environment                                               */
  /* ---------------------------------------------------------------- */
  const skyUniforms = {
    uTop: { value: new THREE.Color('#7fb3df') },
    uMid: { value: new THREE.Color('#cfe4ea') },
    uHorizon: { value: new THREE.Color('#f2dcb8') },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.4).normalize() },
    uSunColor: { value: new THREE.Color('#ffe9c2') },
    uNight: { value: 0 }
  }

  const skyMat = new THREE.ShaderMaterial({
    name: 'Sky',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uHorizon, uSunColor, uSunDir;
      uniform float uNight;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
        col = mix(col, uTop, smoothstep(0.18, 0.85, h));
        float sunDot = max(dot(d, uSunDir), 0.0);
        col += uSunColor * pow(sunDot, 6.0) * 0.22;
        col += uSunColor * pow(sunDot, 220.0) * 0.9;
        col += uSunColor * smoothstep(0.9995, 0.99985, sunDot) * 2.4;
        col = mix(col, uHorizon * 0.35, smoothstep(0.02, -0.25, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 40, 24), skyMat)
  sky.name = 'Sky'
  sky.frustumCulled = false
  group.add(sky)

  // A small equirectangular sky used for image-based lighting.
  function makeEnvTexture() {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 512
    const ctx = c.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#6fa4d2')
    g.addColorStop(0.42, '#cfe0df')
    g.addColorStop(0.52, '#f4dfbc')
    g.addColorStop(0.56, '#9aa878')
    g.addColorStop(1, '#4c5d36')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1024, 512)
    const sun = ctx.createRadialGradient(725, 150, 0, 725, 150, 130)
    sun.addColorStop(0, 'rgba(255,244,214,1)')
    sun.addColorStop(0.15, 'rgba(255,232,188,0.65)')
    sun.addColorStop(1, 'rgba(255,232,188,0)')
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, 1024, 512)
    const tex = new THREE.CanvasTexture(c)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromEquirectangular(makeEnvTexture())
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.55
  pmrem.dispose()

  /* ---------------------------------------------------------------- */
  /*  Lights                                                          */
  /* ---------------------------------------------------------------- */
  const hemi = new THREE.HemisphereLight(0xbfe4ff, 0x66704a, 1.2)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xffe6bd, 2.9)
  sun.castShadow = true
  sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048)
  sun.shadow.camera.left = -15
  sun.shadow.camera.right = 15
  sun.shadow.camera.top = 15
  sun.shadow.camera.bottom = -15
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 80
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.025
  sun.target.position.set(0, 0, 0)
  scene.add(sun, sun.target)

  const moon = new THREE.DirectionalLight(0x8fb2e2, 0.0)
  scene.add(moon)

  // A warm bounce from the viewer's side keeps fur from going olive in the
  // green ground bounce, and gives faces a readable key without hard shadows.
  const fill = new THREE.DirectionalLight(0xffd2a2, 0.6)
  fill.position.set(7, 4.5, 5)
  fill.castShadow = false
  scene.add(fill)

  /* ---------------------------------------------------------------- */
  /*  Ground                                                          */
  /* ---------------------------------------------------------------- */
  const groundTex = createGroundTexture(1024, 7)
  groundTex.anisotropy = maxAnisotropy
  groundTex.repeat.set(34, 34)
  const groundMat = new THREE.MeshStandardMaterial({
    name: 'MeadowFloor',
    map: groundTex,
    vertexColors: true,
    roughness: 0.97,
    metalness: 0
  })

  const groundGeo = new THREE.PlaneGeometry(132, 132, 150, 150)
  groundGeo.rotateX(-Math.PI / 2)
  {
    const pos = groundGeo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = terrainHeight(x, z)
      pos.setY(i, y)
      const dPond = Math.hypot(x - POND.x, z - POND.z)
      const wet = 1 - smoothstep(4.0, 6.3, dPond)
      const far = smoothstep(28, 50, Math.hypot(x, z))
      const n = fbm2(x * 0.25 + 4, z * 0.25 + 9, 3)
      c.setRGB(
        lerp(0.86, 0.66, wet) * (0.88 + n * 0.22) * (1 - far * 0.18),
        lerp(0.98, 0.72, wet) * (0.88 + n * 0.2) * (1 - far * 0.12),
        lerp(0.8, 0.5, wet) * (0.9 + n * 0.16)
      )
      // sandy shore
      if (wet > 0.35) {
        c.lerp(new THREE.Color('#c8b083'), (wet - 0.35) * 0.7)
      }
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    groundGeo.computeVertexNormals()
  }
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.name = 'Ground'
  ground.receiveShadow = true
  group.add(ground)

  /* dirt trail ------------------------------------------------------ */
  {
    const positions = []
    const uvs = []
    const indices = []
    const steps = 150
    const width = 1.45
    for (let i = 0; i <= steps; i++) {
      const z = -46 + (i / steps) * 92
      const cx = pathX(z)
      const dx = pathX(z + 0.2) - pathX(z - 0.2)
      const nx = 1 / Math.hypot(1, dx / 0.4)
      const nz = -(dx / 0.4) / Math.hypot(1, dx / 0.4)
      const w = width * (0.85 + Math.sin(z * 0.4) * 0.1)
      for (const side of [-1, 1]) {
        const x = cx + nx * w * side
        const zz = z + nz * w * side
        positions.push(x, terrainHeight(x, zz) + 0.018, zz)
        uvs.push(side < 0 ? 0 : 1, i / steps * 8)
      }
      if (i < steps) {
        const a = i * 2
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(indices)
    g.computeVertexNormals()
    const grain = createGrainTexture(256, 44)
    grain.anisotropy = maxAnisotropy
    grain.repeat.set(2, 25)
    const m = new THREE.MeshStandardMaterial({
      name: 'Trail',
      map: grain,
      color: 0xb08a5c,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2
    })
    const trail = new THREE.Mesh(g, m)
    trail.receiveShadow = true
    group.add(trail)
  }

  /* ---------------------------------------------------------------- */
  /*  Pond                                                            */
  /* ---------------------------------------------------------------- */
  const waterNormal = createWaterNormalTexture(256, 3)
  waterNormal.anisotropy = maxAnisotropy
  waterNormal.repeat.set(2.4, 2.4)
  const waterMat = new THREE.MeshPhysicalMaterial({
    name: 'PondWater',
    color: 0x3c6f6e,
    roughness: 0.16,
    metalness: 0,
    transparent: true,
    opacity: 0.87,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    envMapIntensity: 1.35,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12
  })
  const water = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 72), waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set(POND.x, POND.level, POND.z)
  water.receiveShadow = true
  water.name = 'Water'
  group.add(water)

  // lily pads
  {
    const padGeos = []
    const flowerGeos = []
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU
      const rad = 0.7 + rnd() * 2.9
      const px = POND.x + Math.cos(a) * rad
      const pz = POND.z + Math.sin(a) * rad
      const size = 0.18 + rnd() * 0.17
      const pad = new THREE.CircleGeometry(size, 14, 0.25, TAU - 0.5)
      pad.rotateX(-Math.PI / 2)
      pad.rotateY(rnd() * TAU)
      pad.translate(px, POND.level + 0.008, pz)
      padGeos.push(pad)
      if (i < 4) {
        const flower = new THREE.SphereGeometry(size * 0.34, 8, 6)
        flower.scale(1, 0.72, 1)
        flower.translate(px, POND.level + 0.06, pz)
        flowerGeos.push(flower)
      }
    }
    const padMesh = new THREE.Mesh(
      mergeGeometries(padGeos, false),
      new THREE.MeshStandardMaterial({ color: 0x4e7d3c, roughness: 0.72, side: THREE.DoubleSide })
    )
    padMesh.name = 'LilyPads'
    padMesh.receiveShadow = true
    group.add(padMesh)
    const flowerMesh = new THREE.Mesh(
      mergeGeometries(flowerGeos, false),
      new THREE.MeshStandardMaterial({ color: 0xf3d7dc, roughness: 0.55, emissive: 0x3a1a22, emissiveIntensity: 0.2 })
    )
    flowerMesh.name = 'LilyFlowers'
    group.add(flowerMesh)
  }

  // reeds
  {
    const reedGeos = []
    for (let i = 0; i < 64; i++) {
      const a = rnd() * TAU
      const rad = POND.r * (0.9 + rnd() * 0.2)
      const x = POND.x + Math.cos(a) * rad
      const z = POND.z + Math.sin(a) * rad
      const h = 0.5 + rnd() * 0.8
      const g = new THREE.CylinderGeometry(0.006, 0.014, h, 3)
      g.translate(0, h / 2, 0)
      g.rotateZ((rnd() - 0.5) * 0.35)
      g.rotateX((rnd() - 0.5) * 0.25)
      g.translate(x, terrainHeight(x, z) - 0.05, z)
      reedGeos.push(g)
    }
    const reeds = new THREE.Mesh(
      mergeGeometries(reedGeos, false),
      new THREE.MeshStandardMaterial({ color: 0x5f7d3c, roughness: 0.9 })
    )
    reeds.castShadow = true
    reeds.name = 'Reeds'
    group.add(reeds)
  }

  /* ---------------------------------------------------------------- */
  /*  Grass blades                                                    */
  /* ---------------------------------------------------------------- */
  const grassUniform = { value: 0 }
  {
    const bladePositions = []
    const bladeColors = []
    const bladeIndices = []
    const blade = (angle, lean) => {
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const w = 0.028
      const h = 0.34 + (angle % 0.11) * 0.9
      const base = bladePositions.length / 3
      // 3 segments, gently curving
      let prevX = -w * 0.5
      let prevZ = 0
      for (let s = 0; s <= 2; s++) {
        const t = s / 2
        const y = h * t
        const x = -w * 0.5 * (1 - t) + lean * t * t
        const z = 0
        bladePositions.push(x * cos - prevZ * sin, y, x * sin + prevZ * cos)
        const shade = 0.32 + t * 0.5
        bladeColors.push(0.55 * shade, 0.86 * shade, 0.38 * shade)
      }
      for (let s = 0; s <= 2; s++) {
        const t = s / 2
        const y = h * t
        const x = w * 0.5 * (1 - t) + lean * t * t
        const z = 0
        bladePositions.push(x * cos - prevZ * sin, y, x * sin + prevZ * cos)
        const shade = 0.3 + t * 0.45
        bladeColors.push(0.5 * shade, 0.8 * shade, 0.34 * shade)
      }
      for (let s = 0; s < 2; s++) {
        const a = base + s
        const b = a + 1
        const c = a + 3
        const d = c + 1
        bladeIndices.push(a, c, b, b, c, d)
      }
    }
    blade(0, 0.045)
    blade(2.1, 0.06)
    blade(4.2, 0.03)
    const gg = new THREE.BufferGeometry()
    gg.setAttribute('position', new THREE.Float32BufferAttribute(bladePositions, 3))
    gg.setAttribute('color', new THREE.Float32BufferAttribute(bladeColors, 3))
    gg.setIndex(bladeIndices)
    gg.computeVertexNormals()
    const gm = new THREE.MeshStandardMaterial({
      name: 'GrassBlades',
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide
    })
    gm.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = grassUniform
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
            #include <begin_vertex>
            #ifdef USE_INSTANCING
              vec3 ipos = instanceMatrix[3].xyz;
            #else
              vec3 ipos = vec3(0.0);
            #endif
            float sway = sin(uTime * 1.35 + ipos.x * 0.45 + ipos.z * 0.37) * 0.5
                       + sin(uTime * 2.3 + ipos.z * 0.9) * 0.18;
            transformed.x += sway * 0.05 * clamp(position.y * 2.6, 0.0, 1.0);
            transformed.z += sway * 0.025 * clamp(position.y * 2.0, 0.0, 1.0);
          `
        )
    }
    const count = isMobile ? 5200 : 8600
    const inst = new THREE.InstancedMesh(gg, gm, count)
    inst.name = 'Grass'
    inst.receiveShadow = true
    const dummy = new THREE.Object3D()
    const c = new THREE.Color()
    let placed = 0
    let guard = 0
    while (placed < count && guard++ < count * 8) {
      const a = rnd() * TAU
      const r = Math.sqrt(rnd()) * 44
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (Math.hypot(x - POND.x, z - POND.z) < 4.7) continue
      if (pathDistance(x, z) < 1.4) continue
      if (r > 40) continue
      if (Math.hypot(x - POND.x, z - POND.z) < 5.4 && rnd() > 0.4) continue
      const s = 0.55 + rnd() * 1.15
      dummy.position.set(x, terrainHeight(x, z) - 0.015, z)
      dummy.rotation.set(0, rnd() * TAU, 0)
      dummy.scale.set(s * (0.7 + rnd() * 0.5), s, s * (0.7 + rnd() * 0.5))
      dummy.updateMatrix()
      inst.setMatrixAt(placed, dummy.matrix)
      const n = rnd()
      c.setRGB(0.82 + n * 0.3, 0.9 + n * 0.2, 0.72 + n * 0.25)
      inst.setColorAt(placed, c)
      placed++
    }
    inst.count = placed
    inst.instanceMatrix.needsUpdate = true
    group.add(inst)
  }

  /* ---------------------------------------------------------------- */
  /*  Wild flowers                                                    */
  /* ---------------------------------------------------------------- */
  {
    const petalPositions = []
    const petalIndices = []
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU
      const r0 = 0.012
      const r1 = 0.052
      const half = 0.024
      const cx = Math.cos(a)
      const cz = Math.sin(a)
      const tx = -Math.sin(a) * half
      const tz = Math.cos(a) * half
      const base = petalPositions.length / 3
      petalPositions.push(cx * r0 - tx, 0, cz * r0 - tz)
      petalPositions.push(cx * r0 + tx, 0, cz * r0 + tz)
      petalPositions.push(cx * r1 + tx * 0.15, 0.012, cz * r1 + tz * 0.15)
      petalPositions.push(cx * r1 - tx * 0.15, 0.012, cz * r1 - tz * 0.15)
      petalIndices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const petalGeo = new THREE.BufferGeometry()
    petalGeo.setAttribute('position', new THREE.Float32BufferAttribute(petalPositions, 3))
    petalGeo.setIndex(petalIndices)
    petalGeo.computeVertexNormals()
    const petalMat = new THREE.MeshStandardMaterial({
      vertexColors: false,
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0
    })
    const centerGeo = new THREE.SphereGeometry(0.017, 7, 5)
    centerGeo.scale(1, 0.6, 1)
    const centerMat = new THREE.MeshStandardMaterial({ color: 0xe8c34a, roughness: 0.8 })
    const stemGeo = new THREE.CylinderGeometry(0.005, 0.007, 1, 4)
    stemGeo.translate(0, 0.5, 0)
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x527a34, roughness: 0.9 })

    const count = isMobile ? 340 : 520
    const petals = new THREE.InstancedMesh(petalGeo, petalMat, count)
    const centers = new THREE.InstancedMesh(centerGeo, centerMat, count)
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, count)
    petals.name = 'FlowerPetals'
    const dummy = new THREE.Object3D()
    const colors = ['#f6f1df', '#f6f1df', '#f4e6cf', '#e9b8c5', '#e9b8c5', '#f2d56b', '#c5b3e2', '#f6f1df']
    let placed = 0
    let guard = 0
    while (placed < count && guard++ < count * 10) {
      const a = rnd() * TAU
      const r = 2 + Math.sqrt(rnd()) * 36
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (Math.hypot(x - POND.x, z - POND.z) < 5.0) continue
      if (pathDistance(x, z) < 1.7) continue
      if (rnd() > 0.72 && Math.hypot(x, z) < 5) continue
      const y = terrainHeight(x, z)
      const h = 0.22 + rnd() * 0.3
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, rnd() * TAU, 0)
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      stems.setMatrixAt(placed, dummy.matrix)

      dummy.position.set(x, y + h, z)
      dummy.rotation.set((rnd() - 0.5) * 0.25, rnd() * TAU, (rnd() - 0.5) * 0.25)
      dummy.scale.setScalar(0.75 + rnd() * 0.6)
      dummy.updateMatrix()
      petals.setMatrixAt(placed, dummy.matrix)
      centers.setMatrixAt(placed, dummy.matrix)
      petals.setColorAt(placed, new THREE.Color(colors[(rnd() * colors.length) | 0]))
      placed++
    }
    petals.count = centers.count = stems.count = placed
    petals.instanceMatrix.needsUpdate = true
    centers.instanceMatrix.needsUpdate = true
    stems.instanceMatrix.needsUpdate = true
    if (petals.instanceColor) petals.instanceColor.needsUpdate = true
    group.add(stems, petals, centers)
  }

  /* ---------------------------------------------------------------- */
  /*  Trees                                                           */
  /* ---------------------------------------------------------------- */
  const barkMat = new THREE.MeshStandardMaterial({
    name: 'Bark',
    color: 0x6f523a,
    roughness: 1,
    metalness: 0
  })
  const leafMat = new THREE.MeshStandardMaterial({
    name: 'Leaves',
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: true
  })
  const treeSpots = [
    [12.5, -14.5, 1.25, 'oak'],
    [-16.5, -12.5, 1.1, 'willow'],
    [18, 9, 1.0, 'oak'],
    [-19, 11, 0.9, 'birch'],
    [6.5, -25, 0.85, 'birch'],
    [-7.5, 25, 1.05, 'oak'],
    [25, -3, 0.8, 'birch'],
    [-26, 1, 0.95, 'oak'],
    [-2, -33, 1.05, 'willow'],
    [29, 18, 0.75, 'birch'],
    [-29, 20, 0.8, 'oak'],
    [22, 27, 0.7, 'birch']
  ]
  for (const [x, z, scale, kind] of treeSpots) {
    const y = terrainHeight(x, z)
    const tree = new THREE.Group()
    tree.position.set(x, y, z)
    tree.scale.setScalar(scale)
    tree.rotation.y = rnd() * TAU

    const trunkGeos = []
    const h = kind === 'birch' ? 4.6 : 3.6
    const trunk = new THREE.CylinderGeometry(0.16, 0.27, h, 7)
    trunk.translate(0, h / 2, 0)
    trunkGeos.push(trunk)
    const branchCount = 3
    for (let b = 0; b < branchCount; b++) {
      const len = 1.5 + rnd() * 1.1
      const br = new THREE.CylinderGeometry(0.05, 0.11, len, 5)
      br.translate(0, len / 2, 0)
      br.rotateZ(0.55 + rnd() * 0.5)
      br.rotateY((b / branchCount) * TAU + rnd() * 0.7)
      br.translate(0, h * (0.5 + rnd() * 0.28), 0)
      trunkGeos.push(br)
    }
    const trunkMesh = new THREE.Mesh(mergeGeometries(trunkGeos, false), barkMat)
    trunkMesh.castShadow = true
    trunkMesh.receiveShadow = true
    tree.add(trunkMesh)

    const leafGeos = []
    const leafBase = new THREE.Color(kind === 'birch' ? '#86b04a' : '#5b8f3e')
    const clusters = kind === 'birch' ? 10 : 14
    for (let ci = 0; ci < clusters; ci++) {
      const a = rnd() * TAU
      const rad = kind === 'birch' ? 0.7 + rnd() * 1.2 : 0.6 + rnd() * 1.75
      const ly = h * (0.62 + rnd() * 0.4)
      const size = (kind === 'birch' ? 0.55 : 0.72) + rnd() * 0.5
      const g = new THREE.IcosahedronGeometry(size, 1)
      const lp = g.attributes.position
      for (let i = 0; i < lp.count; i++) {
        const n = 0.86 + fbm2(lp.getX(i) * 2 + ci, lp.getZ(i) * 2 + ci * 3, 2) * 0.28
        lp.setXYZ(i, lp.getX(i) * n, lp.getY(i) * n * 0.86, lp.getZ(i) * n)
      }
      g.translate(Math.cos(a) * rad, ly, Math.sin(a) * rad)
      const c = leafBase.clone()
      c.offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.1)
      const col = new Float32Array(lp.count * 3)
      for (let i = 0; i < lp.count; i++) {
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      leafGeos.push(g)
    }
    const leaves = new THREE.Mesh(mergeGeometries(leafGeos, false), leafMat)
    leaves.castShadow = true
    leaves.receiveShadow = true
    tree.add(leaves)
    group.add(tree)
  }

  // distant tree line to soften the horizon
  {
    const leafGeos = []
    const trunkGeos = []
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * TAU + rnd() * 0.12
      const r = 44 + rnd() * 12
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const y = terrainHeight(x, z)
      const s = 1.4 + rnd() * 1.8
      const trunk = new THREE.CylinderGeometry(0.15, 0.22, 3.2, 5)
      trunk.translate(x, y + 1.6, z)
      trunkGeos.push(trunk)
      const g = new THREE.IcosahedronGeometry(1.5 * s * 0.55, 1)
      g.scale(1, 1.35, 1)
      g.translate(x, y + 3.4 + s * 0.5, z)
      const c = new THREE.Color('#3f6b33').offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.08)
      const col = new Float32Array(g.attributes.position.count * 3)
      for (let k = 0; k < g.attributes.position.count; k++) {
        col[k * 3] = c.r
        col[k * 3 + 1] = c.g
        col[k * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      leafGeos.push(g)
    }
    const trunks = new THREE.Mesh(mergeGeometries(trunkGeos, false), barkMat)
    const leaves = new THREE.Mesh(mergeGeometries(leafGeos, false), leafMat)
    leaves.castShadow = false
    group.add(trunks, leaves)
  }

  /* ---------------------------------------------------------------- */
  /*  Rocks, mushrooms, logs                                          */
  /* ---------------------------------------------------------------- */
  {
    const rockGeos = []
    const rockColors = []
    for (let i = 0; i < 22; i++) {
      const a = rnd() * TAU
      const r = 7 + Math.sqrt(rnd()) * 28
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (Math.hypot(x - POND.x, z - POND.z) < 4.8) continue
      const y = terrainHeight(x, z)
      const size = 0.18 + rnd() * 0.62
      const g = new THREE.IcosahedronGeometry(size, 1)
      const p = g.attributes.position
      for (let k = 0; k < p.count; k++) {
        const n = 0.72 + fbm2(p.getX(k) * 3 + i, p.getZ(k) * 3 + i * 2, 2) * 0.55
        p.setXYZ(k, p.getX(k) * n, p.getY(k) * n * 0.72, p.getZ(k) * n)
      }
      g.rotateY(rnd() * TAU)
      g.translate(x, y + size * 0.2, z)
      const c = new Float32Array(p.count * 3)
      const base = new THREE.Color(rnd() > 0.4 ? '#8c887c' : '#77746a')
      for (let k = 0; k < p.count; k++) {
        const moss = smoothstep(0.2, 0.9, p.getY(k) / size) * 0.55
        const col = base.clone().lerp(new THREE.Color('#6e7c46'), moss)
        c[k * 3] = col.r
        c[k * 3 + 1] = col.g
        c[k * 3 + 2] = col.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
      rockGeos.push(g)
    }
    const rocks = new THREE.Mesh(
      mergeGeometries(rockGeos, false),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true })
    )
    rocks.castShadow = true
    rocks.receiveShadow = true
    rocks.name = 'Rocks'
    group.add(rocks)
  }

  {
    const stemGeos = []
    const capGeos = []
    const spotGeos = []
    const center = { x: 5.6, z: -2.2 }
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU
      const r = 0.75 + (i % 3) * 0.24
      const x = center.x + Math.cos(a) * r
      const z = center.z + Math.sin(a) * r
      const y = terrainHeight(x, z)
      const s = 0.7 + rnd() * 0.55
      const stem = new THREE.CylinderGeometry(0.018 * s, 0.03 * s, 0.14 * s, 6)
      stem.translate(x, y + 0.07 * s, z)
      stemGeos.push(stem)
      const cap = new THREE.SphereGeometry(0.085 * s, 12, 7, 0, TAU, 0, Math.PI * 0.55)
      cap.scale(1, 0.72, 1)
      cap.translate(x, y + 0.14 * s, z)
      capGeos.push(cap)
      for (let k = 0; k < 4; k++) {
        const aa = rnd() * TAU
        const rr = rnd() * 0.06 * s
        const spot = new THREE.SphereGeometry(0.013 * s, 5, 4)
        spot.translate(x + Math.cos(aa) * rr, y + (0.17 + rnd() * 0.02) * s, z + Math.sin(aa) * rr)
        spotGeos.push(spot)
      }
    }
    const stems = new THREE.Mesh(
      mergeGeometries(stemGeos, false),
      new THREE.MeshStandardMaterial({ color: 0xeadfc6, roughness: 0.9 })
    )
    const caps = new THREE.Mesh(
      mergeGeometries(capGeos, false),
      new THREE.MeshStandardMaterial({ color: 0xb8412f, roughness: 0.66 })
    )
    const spots = new THREE.Mesh(
      mergeGeometries(spotGeos, false),
      new THREE.MeshStandardMaterial({ color: 0xf5ecdc, roughness: 0.8 })
    )
    stems.castShadow = caps.castShadow = spots.castShadow = true
    stems.name = 'Mushrooms'
    group.add(stems, caps, spots)
  }

  /* ---------------------------------------------------------------- */
  /*  Sky dressing: clouds, stars, moon                               */
  /* ---------------------------------------------------------------- */
  const cloudTex = createCloudTexture(256, 12)
  const clouds = []
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
      color: 0xfff6e8
    })
    const s = new THREE.Sprite(mat)
    const scale = 26 + rnd() * 30
    s.scale.set(scale, scale * 0.45, 1)
    s.position.set((rnd() - 0.5) * 150, 26 + rnd() * 18, (rnd() - 0.5) * 150)
    s.userData.speed = 0.25 + rnd() * 0.45
    group.add(s)
    clouds.push(s)
  }

  const starGeo = new THREE.BufferGeometry()
  {
    const pts = []
    for (let i = 0; i < 900; i++) {
      const a = rnd() * TAU
      const el = Math.asin(rnd() * 0.95 + 0.03)
      const r = 150
      pts.push(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r)
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  }
  const starMat = new THREE.PointsMaterial({
    color: 0xf4f0ff,
    size: 1.1,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false
  })
  const stars = new THREE.Points(starGeo, starMat)
  stars.name = 'Stars'
  group.add(stars)

  const moonMat = new THREE.SpriteMaterial({
    map: createSoftSpriteTexture(256, 'rgba(240,244,255,1)', 'rgba(240,244,255,0)'),
    color: 0xe8eeff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false
  })
  const moonSprite = new THREE.Sprite(moonMat)
  moonSprite.scale.set(11, 11, 1)
  group.add(moonSprite)

  /* ---------------------------------------------------------------- */
  /*  Fireflies + pollen                                              */
  /* ---------------------------------------------------------------- */
  const glowTex = createSoftSpriteTexture(128, 'rgba(255,240,170,1)', 'rgba(255,200,90,0)')
  const fireflyCount = isMobile ? 46 : 72
  const fireflyGeo = new THREE.BufferGeometry()
  const fireflyBase = new Float32Array(fireflyCount * 3)
  const fireflyPhase = new Float32Array(fireflyCount)
  {
    const pts = new Float32Array(fireflyCount * 3)
    for (let i = 0; i < fireflyCount; i++) {
      const nearPond = i % 2 === 0
      const a = rnd() * TAU
      const r = nearPond ? 2 + rnd() * 6 : 4 + rnd() * 24
      const cx = nearPond ? POND.x : 0
      const cz = nearPond ? POND.z : 0
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      const y = Math.max(terrainHeight(x, z), POND.level) + 0.25 + rnd() * 1.3
      pts[i * 3] = x
      pts[i * 3 + 1] = y
      pts[i * 3 + 2] = z
      fireflyBase[i * 3] = x
      fireflyBase[i * 3 + 1] = y
      fireflyBase[i * 3 + 2] = z
      fireflyPhase[i] = rnd() * TAU
    }
    fireflyGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
  }
  const fireflyMat = new THREE.PointsMaterial({
    map: glowTex,
    color: 0xffdf8a,
    size: 0.22,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  })
  const fireflies = new THREE.Points(fireflyGeo, fireflyMat)
  fireflies.name = 'Fireflies'
  group.add(fireflies)

  const pollenCount = isMobile ? 70 : 120
  const pollenGeo = new THREE.BufferGeometry()
  const pollenBase = new Float32Array(pollenCount * 3)
  {
    const pts = new Float32Array(pollenCount * 3)
    for (let i = 0; i < pollenCount; i++) {
      const a = rnd() * TAU
      const r = Math.sqrt(rnd()) * 20
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      pts[i * 3] = x
      pts[i * 3 + 1] = terrainHeight(x, z) + 0.4 + rnd() * 2.6
      pts[i * 3 + 2] = z
      pollenBase[i * 3] = pts[i * 3]
      pollenBase[i * 3 + 1] = pts[i * 3 + 1]
      pollenBase[i * 3 + 2] = pts[i * 3 + 2]
    }
    pollenGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
  }
  const pollenMat = new THREE.PointsMaterial({
    map: glowTex,
    color: 0xfff3c6,
    size: 0.055,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  })
  const pollen = new THREE.Points(pollenGeo, pollenMat)
  pollen.name = 'Pollen'
  group.add(pollen)

  /* ---------------------------------------------------------------- */
  /*  Butterflies                                                     */
  /* ---------------------------------------------------------------- */
  const butterflies = []
  {
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0,
      emissive: 0x2a1204,
      emissiveIntensity: 0.18
    })
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 })
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group()
      const hue = [0xe9a24a, 0xd97b4a, 0x86b6e0, 0xe6c75e, 0xd78bb0][i % 5]
      for (const side of [-1, 1]) {
        const geo = new THREE.CircleGeometry(0.085, 8, 0, Math.PI)
        geo.scale(1, 1.55, 1)
        // wing gradient
        const col = new Float32Array(geo.attributes.position.count * 3)
        const c = new THREE.Color(hue)
        for (let k = 0; k < geo.attributes.position.count; k++) {
          const v = clamp(geo.attributes.position.getY(k) / 0.14 + 0.5, 0, 1)
          const edge = new THREE.Color(0x3d2a20)
          const cc = edge.clone().lerp(c, v)
          col[k * 3] = cc.r
          col[k * 3 + 1] = cc.g
          col[k * 3 + 2] = cc.b
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
        const wing = new THREE.Mesh(geo, wingMat)
        wing.position.x = side * 0.004
        wing.rotation.y = side * 1.25
        wing.userData.side = side
        g.add(wing)
      }
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.07, 4, 6), bodyMat)
      body.rotation.x = Math.PI / 2
      g.add(body)
      const a = rnd() * TAU
      const r = 6 + rnd() * 13
      g.userData = {
        cx: Math.cos(a) * r,
        cz: Math.sin(a) * r,
        r: 1.2 + rnd() * 2.6,
        speed: 0.25 + rnd() * 0.35,
        phase: rnd() * TAU,
        baseY: terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + 0.9 + rnd() * 1.1,
        flee: new THREE.Vector3(),
        wings: g.children.slice(0, 2)
      }
      g.scale.setScalar(0.85 + rnd() * 0.4)
      butterflies.push(g)
      group.add(g)
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Ripple + dust pools                                             */
  /* ---------------------------------------------------------------- */
  const ripples = []
  {
    const ringGeo = new THREE.RingGeometry(0.72, 1, 40)
    ringGeo.rotateX(-Math.PI / 2)
    for (let i = 0; i < 10; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xd8f0e8,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
      const mesh = new THREE.Mesh(ringGeo, m)
      mesh.visible = false
      mesh.userData.life = 0
      group.add(mesh)
      ripples.push(mesh)
    }
  }

  const puffs = []
  {
    const tex = createSoftSpriteTexture(128, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)')
    for (let i = 0; i < 18; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex,
        color: 0xcdbd9c,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
      const s = new THREE.Sprite(m)
      s.visible = false
      s.userData.life = 0
      s.userData.vel = new THREE.Vector3()
      group.add(s)
      puffs.push(s)
    }
  }

  const shadowTex = createSoftSpriteTexture(128, 'rgba(20,26,14,0.55)', 'rgba(20,26,14,0)')
  const blobShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55
    })
  )
  blobShadow.rotation.x = -Math.PI / 2
  blobShadow.scale.set(1.05, 0.78, 1)
  blobShadow.renderOrder = 1
  group.add(blobShadow)

  /* ---------------------------------------------------------------- */
  /*  Day cycle                                                       */
  /* ---------------------------------------------------------------- */
  const sunDir = new THREE.Vector3()
  const state = {
    time: 0.41,
    day: 1,
    night: 0
  }

  const cTopDay = new THREE.Color('#6ea6d8')
  const cTopDusk = new THREE.Color('#6d7fa8')
  const cTopNight = new THREE.Color('#101a33')
  const cMidDay = new THREE.Color('#cfe2e7')
  const cMidDusk = new THREE.Color('#e7b28b')
  const cMidNight = new THREE.Color('#1b2744')
  const cHorDay = new THREE.Color('#f1dfc2')
  const cHorDusk = new THREE.Color('#f0a06c')
  const cHorNight = new THREE.Color('#25314d')
  const cSunHigh = new THREE.Color('#fff3dc')
  const cSunLow = new THREE.Color('#ffb06a')
  const cFogDay = new THREE.Color('#c8d8cd')
  const cFogDusk = new THREE.Color('#d6a88c')
  const cFogNight = new THREE.Color('#131c2c')
  const cHemiSkyDay = new THREE.Color('#bfe2ff')
  const cHemiSkyDusk = new THREE.Color('#e8b18c')
  const cHemiSkyNight = new THREE.Color('#2b3a5c')
  const cHemiGroundDay = new THREE.Color('#6d7a4c')
  const cHemiGroundNight = new THREE.Color('#1d241d')
  const tmpColor = new THREE.Color()

  scene.fog = new THREE.Fog(cFogDay.getHex(), 30, 105)

  function applyTime(t) {
    state.time = ((t % 1) + 1) % 1
    const ang = state.time * TAU
    const elev = Math.sin(ang)
    const day = smoothstep(-0.06, 0.16, elev)
    const dusk = clamp(1 - Math.abs(elev) / 0.34, 0, 1) * smoothstep(-0.2, 0.02, elev)
    const night = 1 - day
    state.day = day
    state.night = night
    sunDir.set(Math.cos(ang) * 0.85, elev, 0.42).normalize()

    const sunIntensity = 2.6 * day * (0.35 + 0.65 * clamp(elev * 1.6, 0, 1))
    sun.intensity = sunIntensity
    sun.color.copy(cSunLow).lerp(cSunHigh, smoothstep(0.05, 0.5, elev))
    sun.castShadow = day > 0.08
    moon.intensity = 0.0 + night * 0.42
    moon.position.copy(sunDir).multiplyScalar(-40)
    moon.position.y = Math.abs(moon.position.y) + 18

    hemi.intensity = 0.45 + day * 0.95
    hemi.color.copy(cHemiSkyNight).lerp(cHemiSkyDay, day).lerp(cHemiSkyDusk, dusk * 0.65)
    hemi.groundColor.copy(cHemiGroundNight).lerp(cHemiGroundDay, day)
    fill.intensity = 0.12 + day * 0.5

    const top = tmpColor.copy(cTopNight).lerp(cTopDay, day).lerp(cTopDusk, dusk * 0.55)
    skyUniforms.uTop.value.copy(top)
    skyUniforms.uMid.value.copy(cMidNight).lerp(cMidDay, day).lerp(cMidDusk, dusk * 0.7)
    skyUniforms.uHorizon.value.copy(cHorNight).lerp(cHorDay, day).lerp(cHorDusk, dusk * 0.85)
    skyUniforms.uSunDir.value.copy(sunDir)
    skyUniforms.uSunColor.value.copy(sun.color)
    skyUniforms.uNight.value = night

    const fog = cFogNight.clone().lerp(cFogDay, day).lerp(cFogDusk, dusk * 0.6)
    scene.fog.color.copy(fog)
    scene.background = null

    scene.environmentIntensity = 0.22 + day * 0.45

    for (const c of clouds) {
      c.material.color.setRGB(1, 1, 1).lerp(new THREE.Color('#3a4664'), night * 0.85)
      c.material.opacity = 0.18 + day * 0.5
    }
    starMat.opacity = smoothstep(0.4, 1, night)
    moonMat.opacity = smoothstep(0.55, 1, night) * 0.9
    fireflies.material.opacity = smoothstep(0.25, 0.85, night) * 0.95
    pollenMat.opacity = 0.1 + day * 0.5
    waterMat.color.set('#3c6f6e').lerp(new THREE.Color('#1c2f3c'), night * 0.7)
    waterMat.envMapIntensity = 0.5 + day * 0.9
    blobShadow.material.opacity = 0.18 + day * 0.34

    // moon opposite the sun
    const md = sunDir.clone().multiplyScalar(-1)
    moonSprite.position.copy(md).multiplyScalar(150)
    moonSprite.position.y = Math.abs(moonSprite.position.y) + 8
  }
  applyTime(state.time)

  /* ---------------------------------------------------------------- */
  /*  Effects API                                                     */
  /* ---------------------------------------------------------------- */
  function ripple(x, z, strength = 1) {
    if (!ripples.length) return
    const mesh = ripples.find((r) => !r.visible) || ripples[0]
    mesh.visible = true
    mesh.position.set(x, POND.level + 0.012, z)
    mesh.scale.setScalar(0.25 * strength)
    mesh.material.opacity = 0.5 * strength
    mesh.userData.life = 0
    mesh.userData.strength = strength
  }

  function puff(x, y, z, color = 0xcdbd9c, count = 5, spread = 0.4) {
    let spawned = 0
    for (const s of puffs) {
      if (s.visible) continue
      s.visible = true
      s.position.set(x + (rnd() - 0.5) * spread, y + rnd() * 0.1, z + (rnd() - 0.5) * spread)
      s.material.color.set(color)
      s.material.opacity = 0.55
      s.scale.setScalar(0.2 + rnd() * 0.3)
      s.userData.life = 0
      s.userData.maxLife = 0.8 + rnd() * 0.5
      s.userData.vel.set((rnd() - 0.5) * 0.8, 0.5 + rnd() * 0.8, (rnd() - 0.5) * 0.8)
      if (++spawned >= count) break
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Frame update                                                    */
  /* ---------------------------------------------------------------- */
  const playerPos = new THREE.Vector3()
  const update = (dt, elapsed, player) => {
    grassUniform.value = elapsed
    waterNormal.offset.x = elapsed * 0.008
    waterNormal.offset.y = elapsed * 0.011

    if (player) {
      playerPos.copy(player.position)
      blobShadow.position.set(player.position.x, terrainHeight(player.position.x, player.position.z) + 0.02, player.position.z)
      const air = player.airHeight || 0
      blobShadow.material.opacity = (0.18 + state.day * 0.34) * clamp(1 - air * 0.6, 0.15, 1)
      blobShadow.scale.setScalar((1.05 + air * 0.3))
      sun.position.copy(player.position).addScaledVector(sunDir, 30)
      sun.target.position.copy(player.position)
      sun.target.updateMatrixWorld()
    }

    for (const c of clouds) {
      c.position.x += c.userData.speed * dt
      if (c.position.x > 95) c.position.x = -95
    }

    // fireflies
    const fp = fireflyGeo.attributes.position
    for (let i = 0; i < fireflyCount; i++) {
      const ph = fireflyPhase[i]
      fp.setXYZ(
        i,
        fireflyBase[i * 3] + Math.sin(elapsed * 0.5 + ph) * 0.5,
        fireflyBase[i * 3 + 1] + Math.sin(elapsed * 0.8 + ph * 1.7) * 0.28,
        fireflyBase[i * 3 + 2] + Math.cos(elapsed * 0.43 + ph) * 0.5
      )
    }
    fp.needsUpdate = true
    fireflyMat.size = 0.18 + Math.sin(elapsed * 1.7) * 0.03

    // pollen drift
    const pp = pollenGeo.attributes.position
    for (let i = 0; i < pollenCount; i++) {
      pp.setXYZ(
        i,
        pollenBase[i * 3] + Math.sin(elapsed * 0.23 + i * 1.7) * 0.75,
        pollenBase[i * 3 + 1] + Math.sin(elapsed * 0.37 + i * 0.9) * 0.4,
        pollenBase[i * 3 + 2] + Math.cos(elapsed * 0.19 + i * 2.1) * 0.75
      )
    }
    pp.needsUpdate = true

    // butterflies
    for (const b of butterflies) {
      const u = b.userData
      const t = elapsed * u.speed + u.phase
      let x = u.cx + Math.cos(t) * u.r + Math.sin(t * 1.7) * 0.4
      let z = u.cz + Math.sin(t * 0.9) * u.r + Math.cos(t * 1.3) * 0.4
      if (player) {
        const dx = x - player.position.x
        const dz = z - player.position.z
        const d = Math.hypot(dx, dz)
        if (d < 2.4) {
          u.flee.x += (dx / (d + 0.01)) * dt * 3
          u.flee.z += (dz / (d + 0.01)) * dt * 3
        }
      }
      u.flee.multiplyScalar(Math.pow(0.35, dt))
      x += u.flee.x
      z += u.flee.z
      const y = Math.max(terrainHeight(x, z) + 0.6, u.baseY + Math.sin(elapsed * 1.8 + u.phase) * 0.3)
      b.position.set(x, y, z)
      const heading = Math.atan2(Math.cos(t * 0.9) * u.r * 0.9, -Math.sin(t) * u.r) + Math.PI / 2
      b.rotation.y = heading
      const flap = Math.sin(elapsed * 16 + u.phase) * 0.95
      for (const w of u.wings) {
        w.rotation.y = w.userData.side * (1.05 + flap * 0.45)
        w.rotation.z = w.userData.side * flap * 0.25
      }
    }

    // ripples
    for (const r of ripples) {
      if (!r.visible) continue
      r.userData.life += dt
      const life = r.userData.life
      const k = clamp(life / 1.25, 0, 1)
      r.scale.setScalar((0.25 + k * 1.6) * (r.userData.strength || 1))
      r.material.opacity = (1 - k) * 0.45
      if (k >= 1) {
        r.visible = false
        r.material.opacity = 0
      }
    }

    // dust
    for (const p of puffs) {
      if (!p.visible) continue
      p.userData.life += dt
      const k = p.userData.life / (p.userData.maxLife || 1)
      p.position.addScaledVector(p.userData.vel, dt)
      p.userData.vel.y -= dt * 0.35
      p.material.opacity = Math.max(0, 0.5 * (1 - k))
      p.scale.multiplyScalar(1 + dt * 0.55)
      if (k >= 1) {
        p.visible = false
        p.material.opacity = 0
      }
    }
  }

  return {
    group,
    terrainHeight,
    isWater,
    update,
    ripple,
    puff,
    applyTime,
    state,
    pond: POND,
    sunDir,
    sun,
    moon,
    sky,
    blobShadow,
    bounds: WORLD_RADIUS
  }
}
