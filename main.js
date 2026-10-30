import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/* ------------------------------------------------------------------------- *
 * Harebell — a quiet little rabbit sandbox.
 * Everything below is generated at runtime: the meadow, the weather, the
 * soundscape, and the fur that catches the low sun. The rabbit's body arrives
 * as a tiny hand-built GLB, then gets dressed in procedural shell fur.
 * ------------------------------------------------------------------------- */

const canvas = document.querySelector('#world')
const app = document.querySelector('#app')
const intro = document.querySelector('#intro')
const hud = document.querySelector('#hud')
const loader = document.querySelector('#loader')
const loaderBar = document.querySelector('#loader-bar')
const playButton = document.querySelector('#play')
const introTilt = document.querySelector('#intro-tilt')
const hudTilt = document.querySelector('#hud-tilt')
const soundButton = document.querySelector('#sound')
const photoButton = document.querySelector('#photo')
const photoExit = document.querySelector('#photo-exit')
const hopButton = document.querySelector('#hop')
const stickZone = document.querySelector('#stick-zone')
const stick = document.querySelector('#stick')
const stickKnob = document.querySelector('.stick-knob')
const timeLabel = document.querySelector('#time-label')
const placeName = document.querySelector('#place-name')
const hint = document.querySelector('#hint')
const hintText = document.querySelector('#hint-text')
const toast = document.querySelector('#toast')
const toastText = document.querySelector('#toast-text')

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
const isMobileViewport = Math.min(innerWidth, innerHeight) < 760
const LOW_POWER = isTouch || isMobileViewport
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt))
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const rand = (a = 0, b = 1) => a + Math.random() * (b - a)
const TAU = Math.PI * 2

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(20261030)

/* ------------------------------------------------------------------------- *
 * Tiny procedural textures. Keeping these canvas-made means the download is
 * just code and the meadow can be remixed without hunting for art packs.
 * ------------------------------------------------------------------------- */

function hash2(x, y, seed = 0) {
  let h = Math.imul(x + seed * 17, 374761393) + Math.imul(y + seed * 31, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function periodicNoise2(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const wrap = n => ((n % period) + period) % period
  const a = hash2(wrap(xi), wrap(yi), seed)
  const b = hash2(wrap(xi + 1), wrap(yi), seed)
  const c = hash2(wrap(xi), wrap(yi + 1), seed)
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed)
  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}
function fbm2(x, y, period, octaves = 4, seed = 0) {
  let value = 0, amplitude = .5, frequency = 1, total = 0
  for (let i = 0; i < octaves; i++) {
    value += amplitude * periodicNoise2(x * frequency, y * frequency, period * frequency, seed + i * 11)
    total += amplitude
    amplitude *= .5
    frequency *= 2
  }
  return value / total
}

/* ------------------------------------------------------------------------- *
 * A small Sobel normal-map baker. It turns the painted ground and the rabbit's
 * fur albedo into believable micro-relief without another download.
 * ------------------------------------------------------------------------- */

function bakeNormalMap(source, size = 512, strength = 2.2) {
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = srcCanvas.height = size
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
  srcCtx.drawImage(source, 0, 0, size, size)
  const src = srcCtx.getImageData(0, 0, size, size).data
  const out = srcCtx.createImageData(size, size)
  const lum = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    lum[i] = (src[i * 4] * .299 + src[i * 4 + 1] * .587 + src[i * 4 + 2] * .114) / 255
  }
  const at = (x, y) => lum[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const inv = 1 / Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      out.data[i] = (-dx * inv * .5 + .5) * 255
      out.data[i + 1] = (dy * inv * .5 + .5) * 255
      out.data[i + 2] = (inv * .5 + .5) * 255
      out.data[i + 3] = 255
    }
  }
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = normalCanvas.height = size
  normalCanvas.getContext('2d').putImageData(out, 0, 0)
  const texture = new THREE.CanvasTexture(normalCanvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.NoColorSpace
  texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1)
  return texture
}

function makeGroundTexture() {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  const image = ctx.createImageData(S, S)
  const data = image.data
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S
      const broad = fbm2(u * 7, v * 7, 7, 4, 2)
      const fine = fbm2(u * 42, v * 42, 42, 3, 9)
      const blades = periodicNoise2(u * 190, v * 86, 190, 23)
      const golden = smoothstep(.56, .8, fbm2(u * 4 + 3, v * 4 + 9, 4, 3, 7))
      let r = 40 + broad * 29 + fine * 16 + golden * 38
      let g = 57 + broad * 35 + fine * 20 + golden * 30
      let b = 29 + broad * 17 + fine * 7 + golden * 14
      const fleck = blades > .8 ? (blades - .8) * 210 : 0
      r += fleck * .68; g += fleck; b += fleck * .43
      const shade = smoothstep(.7, .95, fine) * -17
      const i = (y * S + x) * 4
      data[i] = clamp(r + shade, 0, 255)
      data[i + 1] = clamp(g + shade, 0, 255)
      data[i + 2] = clamp(b + shade * .6, 0, 255)
      data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  // A few hand-painted grass strokes break up the grid of the noise.
  ctx.globalCompositeOperation = 'soft-light'
  for (let i = 0; i < 7200; i++) {
    const x = rng() * S, y = rng() * S
    const h = 4 + rng() * 20
    ctx.strokeStyle = rng() > .62 ? 'rgba(191,186,109,.26)' : 'rgba(14,35,18,.24)'
    ctx.lineWidth = .5 + rng() * 1.25
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + rand(-5, 5), y - h * .55, x + rand(-9, 9), y - h)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  const texture = new THREE.CanvasTexture(c)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function makeFurMaps() {
  const S = 512
  const height = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S
      // Fine, vertically combed strands + slower patches of undercoat.
      const strand = periodicNoise2(u * 210, v * 42, 210, 3)
      const strand2 = periodicNoise2(u * 490, v * 110, 490, 8)
      const under = fbm2(u * 17, v * 12, 17, 4, 5)
      height[y * S + x] = strand * .48 + strand2 * .26 + under * .26
    }
  }
  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = colorCanvas.height = S
  const colorCtx = colorCanvas.getContext('2d')
  const colorImage = colorCtx.createImageData(S, S)
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = normalCanvas.height = S
  const normalCtx = normalCanvas.getContext('2d')
  const normalImage = normalCtx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const h = height[y * S + x]
      const i = (y * S + x) * 4
      // Warm, low-contrast colour: the vertex colours set each part's coat.
      const warm = smoothstep(.3, .8, h)
      colorImage.data[i] = 211 + warm * 42
      colorImage.data[i + 1] = 199 + warm * 40
      colorImage.data[i + 2] = 181 + warm * 38
      colorImage.data[i + 3] = 255
      const xl = height[y * S + ((x - 1 + S) % S)]
      const xr = height[y * S + ((x + 1) % S)]
      const yu = height[((y - 1 + S) % S) * S + x]
      const yd = height[((y + 1) % S) * S + x]
      const nx = (xl - xr) * 5.5
      const ny = (yu - yd) * 5.5
      const nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz)
      normalImage.data[i] = (nx * inv * .5 + .5) * 255
      normalImage.data[i + 1] = (ny * inv * .5 + .5) * 255
      normalImage.data[i + 2] = (nz * inv * .5 + .5) * 255
      normalImage.data[i + 3] = 255
    }
  }
  colorCtx.putImageData(colorImage, 0, 0)
  normalCtx.putImageData(normalImage, 0, 0)
  const color = new THREE.CanvasTexture(colorCanvas)
  color.wrapS = color.wrapT = THREE.RepeatWrapping
  color.colorSpace = THREE.SRGBColorSpace
  color.anisotropy = 4
  const normal = new THREE.CanvasTexture(normalCanvas)
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping
  normal.colorSpace = THREE.NoColorSpace
  normal.anisotropy = 4
  return { color, normal }
}

function makeBarkTexture(birch = false) {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  ctx.fillStyle = birch ? '#cabca2' : '#4d3d2c'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < (birch ? 55 : 260); i++) {
    const x = rng() * S, y = rng() * S
    if (birch) {
      ctx.fillStyle = rng() > .5 ? 'rgba(40,37,31,.62)' : 'rgba(113,99,76,.35)'
      ctx.beginPath()
      ctx.ellipse(x, y, 2 + rng() * 10, .7 + rng() * 2, rand(-.1, .1), 0, TAU)
      ctx.fill()
    } else {
      ctx.strokeStyle = rng() > .5 ? 'rgba(28,21,15,.37)' : 'rgba(127,102,69,.28)'
      ctx.lineWidth = .5 + rng() * 2.2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + rand(-3, 3), y + 18 + rng() * 56)
      ctx.stroke()
    }
  }
  const texture = new THREE.CanvasTexture(c)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1, 2.5)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeCloudTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(S / 2, S / 2 + 8, 4, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,249,236,.72)')
  g.addColorStop(.35, 'rgba(255,245,225,.4)')
  g.addColorStop(.72, 'rgba(249,231,200,.1)')
  g.addColorStop(1, 'rgba(249,231,200,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(S * .52, S * .53, S * .42, S * .23, 0, 0, TAU)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(S * .35, S * .62, S * .23, S * .17, 0, 0, TAU)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(S * .67, S * .58, S * .24, S * .18, 0, 0, TAU)
  ctx.fill()
  return new THREE.CanvasTexture(c)
}

function makeLeafTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, S, S)
  // A loose spray of leaves, drawn into one card. The card is instanced around
  // the canopy volumes to soften the faceted low-poly silhouettes.
  const palette = ['#6f8447', '#829653', '#98a966', '#5f753f', '#a8b675', '#7b8c4f']
  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU)
    const r = Math.sqrt(rng()) * S * .4
    const x = S / 2 + Math.cos(a) * r
    const y = S / 2 + Math.sin(a) * r * .82
    const len = rand(13, 29)
    const wid = len * rand(.55, .9)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rand(0, TAU))
    ctx.fillStyle = palette[Math.floor(rng() * palette.length)]
    ctx.beginPath()
    ctx.ellipse(0, 0, len, wid, 0, 0, TAU)
    ctx.fill()
    // A fine midrib catches the light.
    ctx.strokeStyle = 'rgba(218,224,166,.24)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-len * .75, 0)
    ctx.lineTo(len * .75, 0)
    ctx.stroke()
    ctx.restore()
  }
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function makePollenTexture(kind = 'dot') {
  const S = 64
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  if (kind === 'seed') {
    ctx.translate(S / 2, S / 2)
    ctx.strokeStyle = 'rgba(250,240,214,.85)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a) * 23, Math.sin(a) * 23)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,249,231,.94)'
    ctx.beginPath()
    ctx.arc(0, 0, 2.2, 0, TAU)
    ctx.fill()
  } else {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
    g.addColorStop(0, 'rgba(255,248,220,1)')
    g.addColorStop(.25, 'rgba(255,231,169,.85)')
    g.addColorStop(.65, 'rgba(255,213,130,.2)')
    g.addColorStop(1, 'rgba(255,210,120,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
  }
  return new THREE.CanvasTexture(c)
}

function makeGlowTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,237,195,.95)')
  g.addColorStop(.1, 'rgba(255,222,161,.55)')
  g.addColorStop(.35, 'rgba(255,198,114,.15)')
  g.addColorStop(.7, 'rgba(255,180,90,.04)')
  g.addColorStop(1, 'rgba(255,180,90,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(c)
}

function makeContactTexture() {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(20,29,18,.46)')
  g.addColorStop(.55, 'rgba(20,29,18,.19)')
  g.addColorStop(1, 'rgba(20,29,18,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(c)
}

function makeEnvTexture() {
  const W = 1024, H = 512
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#8fa8b7')
  sky.addColorStop(.38, '#d4c9ad')
  sky.addColorStop(.55, '#e6c38b')
  sky.addColorStop(.7, '#7b7953')
  sky.addColorStop(1, '#39442d')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  // A soft warm sun and a few cloud streaks become the PBR environment.
  const sx = W * .25, sy = H * .43
  const glow = ctx.createRadialGradient(sx, sy, 3, sx, sy, 160)
  glow.addColorStop(0, 'rgba(255,241,199,1)')
  glow.addColorStop(.08, 'rgba(255,226,165,.9)')
  glow.addColorStop(.4, 'rgba(255,206,139,.25)')
  glow.addColorStop(1, 'rgba(255,199,125,0)')
  ctx.fillStyle = glow
  ctx.fillRect(sx - 180, sy - 180, 360, 360)
  ctx.globalAlpha = .11
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 ? '#fff3d9' : '#8c9b87'
    ctx.beginPath()
    ctx.ellipse(rand(0, W), rand(H * .16, H * .5), rand(45, 170), rand(2, 10), 0, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ------------------------------------------------------------------------- *
 * Renderer, scene and camera.
 * ------------------------------------------------------------------------- */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !LOW_POWER,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
})
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LOW_POWER ? 1.7 : 2))
renderer.setSize(innerWidth, innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.24
renderer.shadowMap.enabled = true
renderer.shadowMap.type = LOW_POWER ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap
renderer.info.autoReset = true

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0xd8c9a9, .0088)

const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .05, 190)
camera.position.set(-2.25, 1.54, 3.35)
const cameraTarget = new THREE.Vector3(-.25, .74, .1)
camera.lookAt(cameraTarget)

const sunDir = new THREE.Vector3(-.48, .47, .74).normalize()
const sunColor = new THREE.Color('#ffd8a6')
const glowTexture = makeGlowTexture()

const pmrem = new THREE.PMREMGenerator(renderer)
pmrem.compileEquirectangularShader()
const envTexture = makeEnvTexture()
const envMap = envTexture.mapping === THREE.EquirectangularReflectionMapping
  ? pmrem.fromEquirectangular(envTexture).texture
  : null
scene.environment = envMap
scene.environmentIntensity = .54
envTexture.dispose()
pmrem.dispose()

const hemi = new THREE.HemisphereLight(0xd0e2e5, 0x5c5636, .88)
scene.add(hemi)

const sun = new THREE.DirectionalLight(sunColor, 4.65)
sun.position.copy(sunDir).multiplyScalar(35)
sun.castShadow = true
sun.shadow.mapSize.set(LOW_POWER ? 1024 : 2048, LOW_POWER ? 1024 : 2048)
sun.shadow.camera.near = 1
sun.shadow.camera.far = 70
sun.shadow.camera.left = -11
sun.shadow.camera.right = 11
sun.shadow.camera.top = 13
sun.shadow.camera.bottom = -9
sun.shadow.bias = -.00025
sun.shadow.normalBias = .022
sun.shadow.radius = LOW_POWER ? 1.4 : 2.4
scene.add(sun)
scene.add(sun.target)

const fill = new THREE.DirectionalLight(0xaccbdd, .55)
fill.position.set(12, 8, -14)
scene.add(fill)

// A low, warm rim keeps the fur's silhouette alive against the cool meadow.
const rim = new THREE.DirectionalLight(0xffc07a, 1.5)
rim.position.set(9, 6, -16)
scene.add(rim)

const warmBounce = new THREE.PointLight(0xf2bb72, 2.2, 18, 2)
warmBounce.position.set(-3, 1.4, 2)
scene.add(warmBounce)

/* ------------------------------------------------------------------------- *
 * Sky, clouds and sun glow.
 * ------------------------------------------------------------------------- */

const skyUniforms = {
  uTop: { value: new THREE.Color('#5f9bc9') },
  uMid: { value: new THREE.Color('#bfd3da') },
  uHorizon: { value: new THREE.Color('#ffd3a2') },
  uSun: { value: sunColor },
  uSunDir: { value: sunDir },
  uTime: { value: 0 },
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(150, 48, 28),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uHorizon, uSun, uSunDir;
      uniform float uTime;
      void main() {
        float h = clamp(vDir.y * .5 + .5, 0., 1.);
        float horizon = smoothstep(.31, .57, h);
        vec3 color = mix(uHorizon, uMid, horizon);
        color = mix(color, uTop, smoothstep(.54, .96, h));
        float sun = max(dot(normalize(vDir), uSunDir), 0.);
        color += uSun * pow(sun, 800.) * 2.2;
        color += uSun * pow(sun, 24.) * .18;
        color += uSun * pow(sun, 5.) * .045;
        float band = sin(vDir.y * 30. + vDir.x * 4. + uTime * .035) * .5 + .5;
        color += vec3(.03, .022, .012) * band * smoothstep(.36, .6, h) * (1. - smoothstep(.65, .9, h));
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
)
sky.renderOrder = -10
sky.frustumCulled = false
scene.add(sky)

const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffe0a1,
  transparent: true,
  opacity: .72,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  fog: false,
}))
sunGlow.position.copy(sunDir).multiplyScalar(110)
sunGlow.scale.set(44, 44, 1)
sunGlow.renderOrder = -8
scene.add(sunGlow)

const cloudTexture = makeCloudTexture()
for (let i = 0; i < 9; i++) {
  const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
    map: cloudTexture,
    color: i % 3 === 0 ? 0xf8dcb5 : 0xfff3da,
    transparent: true,
    opacity: rand(.12, .26),
    depthWrite: false,
    fog: false,
  }))
  const angle = rand(0, TAU)
  const radius = rand(62, 105)
  cloud.position.set(Math.cos(angle) * radius, rand(13, 30), Math.sin(angle) * radius)
  cloud.scale.set(rand(24, 55), rand(6, 14), 1)
  scene.add(cloud)
}

const birdMaterial = new THREE.LineBasicMaterial({ color: 0x3c453a, transparent: true, opacity: .32, fog: true })
const birds = []
for (let i = 0; i < 4; i++) {
  const pts = [new THREE.Vector3(-.25, 0, 0), new THREE.Vector3(0, .08, 0), new THREE.Vector3(.25, 0, 0)]
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const bird = new THREE.Line(geo, birdMaterial)
  bird.position.set(rand(-18, 18), rand(14, 22), rand(-28, -18))
  bird.scale.setScalar(rand(.7, 1.3))
  scene.add(bird)
  birds.push({ object: bird, phase: rand(0, TAU), speed: rand(.06, .12) })
}

/* ------------------------------------------------------------------------- *
 * The meadow floor.
 * ------------------------------------------------------------------------- */

const POND = { x: -9.6, z: -3.8, radius: 4.35, waterY: -.27 }
const BURROW = { x: -4.4, z: -10.2 }
const OAK = { x: 3.7, z: -11.8 }

function terrainHeight(x, z) {
  const r = Math.hypot(x, z)
  const calm = smoothstep(1.5, 8.5, r)
  let h = (.17 * Math.sin(x * .21 + 1.2) * Math.cos(z * .18 - .3)
    + .07 * Math.sin(x * .43 + .1) * Math.cos(z * .39 + 1.4)) * calm
  const pd = Math.hypot(x - POND.x, z - POND.z)
  h -= .82 * (1 - smoothstep(2.0, 6.2, pd))
  const far = smoothstep(22, 48, r)
  h += far * (1.05 + .7 * Math.sin(x * .08 + .7) + .5 * Math.cos(z * .09 - .3))
  h += smoothstep(45, 75, r) * (2.5 * Math.sin(x * .035 + 1.2) * Math.sin(z * .041 - .4))
  return h
}

const groundTexture = makeGroundTexture()
groundTexture.repeat.set(46, 46)
groundTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
const groundNormal = bakeNormalMap(groundTexture.image, 1024, 3.4)
groundNormal.repeat.copy(groundTexture.repeat)

const groundGeometry = new THREE.PlaneGeometry(132, 132, LOW_POWER ? 132 : 190, LOW_POWER ? 132 : 190)
groundGeometry.rotateX(-Math.PI / 2)
const groundPositions = groundGeometry.attributes.position
const groundColors = new Float32Array(groundPositions.count * 3)
const cTmp = new THREE.Color()
for (let i = 0; i < groundPositions.count; i++) {
  const x = groundPositions.getX(i)
  const z = groundPositions.getZ(i)
  const y = terrainHeight(x, z)
  groundPositions.setY(i, y)
  const n = fbm2((x + 60) * .08, (z + 60) * .08, 15, 3, 4)
  const n2 = fbm2((x + 60) * .35, (z + 60) * .35, 60, 2, 8)
  const golden = smoothstep(.55, .78, n)
  cTmp.setRGB(
    .75 + n2 * .22 + golden * .16,
    .82 + n2 * .16 + golden * .10,
    .63 + n2 * .15 + golden * .06
  )
  const pondEdge = smoothstep(4.2, 6.4, Math.hypot(x - POND.x, z - POND.z))
  cTmp.multiplyScalar(.66 + pondEdge * .34)
  groundColors[i * 3] = cTmp.r
  groundColors[i * 3 + 1] = cTmp.g
  groundColors[i * 3 + 2] = cTmp.b
}
groundGeometry.setAttribute('color', new THREE.BufferAttribute(groundColors, 3))
groundGeometry.computeVertexNormals()
const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({
  map: groundTexture,
  normalMap: groundNormal,
  normalScale: new THREE.Vector2(.42, .42),
  vertexColors: true,
  roughness: .96,
  metalness: 0,
  color: 0xf1ebd7,
}))
ground.receiveShadow = true
scene.add(ground)

// Winding ribbon path from the long grass to the burrow.
const pathCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(1.4, 0, 5.6),
  new THREE.Vector3(.6, 0, 3.2),
  new THREE.Vector3(-.8, 0, 1.0),
  new THREE.Vector3(-2.0, 0, -1.5),
  new THREE.Vector3(-3.1, 0, -4.6),
  new THREE.Vector3(-3.0, 0, -7.0),
  new THREE.Vector3(-4.4, 0, -9.7),
], false, 'catmullrom', .45)
const PATH_SEGMENTS = 110
const pathPositions = [], pathUvs = [], pathIndices = [], pathColors = []
for (let i = 0; i <= PATH_SEGMENTS; i++) {
  const t = i / PATH_SEGMENTS
  const p = pathCurve.getPoint(t)
  const tangent = pathCurve.getTangent(t)
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  const width = .72 + .2 * Math.sin(t * 19 + .4) + .12 * Math.sin(t * 7.2)
  for (let s = -1; s <= 1; s += 2) {
    const x = p.x + side.x * width * s
    const z = p.z + side.z * width * s
    pathPositions.push(x, terrainHeight(x, z) + .018, z)
    pathUvs.push(s * .5 + .5, t * 8)
    const tone = .69 + .1 * Math.sin(t * 35 + s)
    pathColors.push(tone, tone * .85, tone * .61)
  }
  if (i < PATH_SEGMENTS) {
    const a = i * 2
    pathIndices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
  }
}
const pathGeometry = new THREE.BufferGeometry()
pathGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pathPositions, 3))
pathGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(pathUvs, 2))
pathGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pathColors, 3))
pathGeometry.setIndex(pathIndices)
pathGeometry.computeVertexNormals()
const pathMesh = new THREE.Mesh(pathGeometry, new THREE.MeshStandardMaterial({
  color: 0xc7b184,
  vertexColors: true,
  roughness: 1,
  polygonOffset: true,
  polygonOffsetFactor: -1,
}))
pathMesh.receiveShadow = true
scene.add(pathMesh)

/* ------------------------------------------------------------------------- *
 * Water, lily pads and reeds.
 * ------------------------------------------------------------------------- */

const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: sunDir },
  uSun: { value: new THREE.Color('#ffe1aa') },
  uDeep: { value: new THREE.Color('#263c34') },
  uSky: { value: new THREE.Color('#b9c3aa') },
}
const water = new THREE.Mesh(
  new THREE.CircleGeometry(POND.radius, 64),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: waterUniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vWorld;
      uniform float uTime;
      uniform vec3 uSunDir, uSun, uDeep, uSky;
      void main() {
        vec2 p = vWorld.xz;
        float w1 = sin(p.x * 3.4 + uTime * .72) * cos(p.y * 2.7 - uTime * .51);
        float w2 = sin((p.x + p.y) * 7.1 - uTime * 1.1);
        float w3 = sin(length(p - vec2(-9.6, -3.8)) * 11.0 - uTime * 1.6);
        vec3 n = normalize(vec3((w1 * .055 + w2 * .018), 1.0, (w2 * .045 + w3 * .012)));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 2.4);
        vec3 color = mix(uDeep, uSky, .32 + fresnel * .62);
        color *= .76 + .3 * smoothstep(-.7, .5, w1 + w3 * .4);
        vec3 reflected = reflect(-uSunDir, n);
        color += uSun * pow(max(dot(reflected, viewDir), 0.0), 90.0) * 1.4;
        color += uSun * pow(max(dot(reflected, viewDir), 0.0), 13.0) * .07;
        gl_FragColor = vec4(color, .93);
      }
    `,
  })
)
water.rotation.x = -Math.PI / 2
water.position.set(POND.x, POND.waterY, POND.z)
scene.add(water)

const lilyMaterial = new THREE.MeshStandardMaterial({ color: 0x536a3d, roughness: .82, side: THREE.DoubleSide })
const lilyGeometry = new THREE.CircleGeometry(.27, 16, .2, Math.PI * 2 - .4)
lilyGeometry.rotateX(-Math.PI / 2)
for (let i = 0; i < 11; i++) {
  const a = rand(0, TAU), r = rand(.8, 3.65)
  const lily = new THREE.Mesh(lilyGeometry, i % 3 === 0 ? new THREE.MeshStandardMaterial({ color: 0x6a7c49, roughness: .85, side: THREE.DoubleSide }) : lilyMaterial)
  lily.position.set(POND.x + Math.cos(a) * r, POND.waterY + .015, POND.z + Math.sin(a) * r)
  lily.rotation.y = rand(0, TAU)
  lily.scale.setScalar(rand(.65, 1.35))
  scene.add(lily)
}

const reedStemMaterial = new THREE.MeshStandardMaterial({ color: 0x697048, roughness: .95 })
const reedTipMaterial = new THREE.MeshStandardMaterial({ color: 0x6d5034, roughness: .95 })
const reedStems = new THREE.InstancedMesh(new THREE.CylinderGeometry(.008, .016, 1, 4), reedStemMaterial, 150)
const reedTips = new THREE.InstancedMesh(new THREE.CylinderGeometry(.021, .012, .16, 5), reedTipMaterial, 150)
const dummy = new THREE.Object3D()
for (let i = 0; i < 150; i++) {
  const a = rand(0, TAU)
  const r = POND.radius + rand(-.2, 2.0)
  const x = POND.x + Math.cos(a) * r
  const z = POND.z + Math.sin(a) * r
  const base = terrainHeight(x, z)
  const h = rand(.42, 1.25)
  dummy.position.set(x, base + h / 2, z)
  dummy.rotation.set(rand(-.08, .08), rand(0, TAU), rand(-.12, .12))
  dummy.scale.set(1, h, 1)
  dummy.updateMatrix()
  reedStems.setMatrixAt(i, dummy.matrix)
  dummy.position.y = base + h + .05
  dummy.scale.setScalar(rand(.8, 1.2))
  dummy.updateMatrix()
  reedTips.setMatrixAt(i, dummy.matrix)
}
reedStems.castShadow = false
reedTips.castShadow = false
scene.add(reedStems, reedTips)

/* ------------------------------------------------------------------------- *
 * Grass. A handful of instanced blades with a little wind in the vertex shader.
 * ------------------------------------------------------------------------- */

function makeGrassClumpGeometry() {
  const positions = [], uvs = [], indices = [], colors = []
  let vertex = 0
  const bladeCount = 8
  for (let b = 0; b < bladeCount; b++) {
    const angle = b / bladeCount * TAU + rand(-.45, .45)
    const height = rand(.1, .36)
    const width = rand(.0045, .0095)
    const bend = rand(.025, .09)
    const lean = rand(.01, .075)
    const ox = Math.cos(angle) * rand(0, .13)
    const oz = Math.sin(angle) * rand(0, .13)
    const dx = Math.cos(angle), dz = Math.sin(angle)
    const segments = 3
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const y = t * height
      const w = width * Math.max(.06, 1 - t * .96)
      const cx = ox + dx * (lean * t + bend * t * t)
      const cz = oz + dz * (lean * t + bend * t * t)
      const sideX = -dz, sideZ = dx
      positions.push(cx - sideX * w, y, cz - sideZ * w)
      positions.push(cx + sideX * w, y, cz + sideZ * w)
      uvs.push(0, t, 1, t)
      const shade = .5 + t * .62
      colors.push(shade, shade, shade, shade, shade, shade)
      if (i < segments) {
        const a = vertex + i * 2
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
    vertex += (segments + 1) * 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

const grassTime = { value: 0 }
const grassMaterial = new THREE.MeshStandardMaterial({
  color: 0xa9b98a,
  roughness: .94,
  metalness: 0,
  side: THREE.DoubleSide,
  vertexColors: true,
})
grassMaterial.onBeforeCompile = shader => {
  shader.uniforms.uTime = grassTime
  shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
    #include <begin_vertex>
    #ifdef USE_INSTANCING
      vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float bend = smoothstep(0.0, 1.0, position.y);
      float sway = sin(uTime * 1.15 + iPos.x * .58 + iPos.z * .43) * .105
                 + sin(uTime * 2.03 + iPos.z * 1.2) * .025;
      transformed.x += sway * bend * bend;
      transformed.z += sway * .38 * bend * bend;
    #endif
  `)
}
grassMaterial.customProgramCacheKey = () => 'harebell-grass-wind-v2'

function distanceToPath(x, z) {
  let min = Infinity
  for (let i = 0; i <= 30; i++) {
    const p = pathCurve.getPoint(i / 30)
    const d = Math.hypot(x - p.x, z - p.z)
    if (d < min) min = d
  }
  return min
}

const grassGeometry = makeGrassClumpGeometry()
const grassCount = LOW_POWER ? 13000 : 26000
const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount)
grass.receiveShadow = true
grass.castShadow = false
const grassColor = new THREE.Color()
let placed = 0, attempts = 0
while (placed < grassCount && attempts < grassCount * 4) {
  attempts++
  const a = rng() * TAU
  const r = Math.sqrt(rng()) * 38
  const x = Math.cos(a) * r
  const z = Math.sin(a) * r
  if (Math.hypot(x - POND.x, z - POND.z) < POND.radius + 1.5) continue
  if (Math.hypot(x - BURROW.x, z - BURROW.z) < 2.3) continue
  if (distanceToPath(x, z) < 1.5) continue
  const y = terrainHeight(x, z)
  dummy.position.set(x, y - .012, z)
  dummy.rotation.set(rand(-.07, .07), rand(0, TAU), rand(-.07, .07))
  dummy.scale.set(rand(.78, 1.25), rand(.62, 1.55), rand(.78, 1.25))
  dummy.updateMatrix()
  grass.setMatrixAt(placed, dummy.matrix)
  const hue = .225 + rng() * .075
  const sat = .3 + rng() * .2
  const light = .2 + rng() * .16
  grassColor.setHSL(hue, sat, light)
  grass.setColorAt(placed, grassColor)
  placed++
}
grass.instanceMatrix.needsUpdate = true
if (grass.instanceColor) grass.instanceColor.needsUpdate = true
scene.add(grass)

/* ------------------------------------------------------------------------- *
 * Flowers. Petal heads, stems and pollen centres are three instanced draws.
 * ------------------------------------------------------------------------- */

function makeFlowerHeadGeometry() {
  const positions = [], indices = []
  const petals = 5
  for (let i = 0; i < petals; i++) {
    const a = i / petals * TAU
    const dx = Math.cos(a), dz = Math.sin(a)
    const sx = -dz, sz = dx
    const base = i * 4
    positions.push(
      dx * .012, .004, dz * .012,
      dx * .02 + sx * .028, .014, dz * .02 + sz * .028,
      dx * .085, .025, dz * .085,
      dx * .02 - sx * .028, .014, dz * .02 - sz * .028,
    )
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

const flowerCount = LOW_POWER ? 560 : 1200
const flowerHead = new THREE.InstancedMesh(
  makeFlowerHeadGeometry(),
  new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: .86, side: THREE.DoubleSide, emissive: 0x1a1208, emissiveIntensity: .06 }),
  flowerCount
)
const flowerStem = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(.006, .009, 1, 4),
  new THREE.MeshStandardMaterial({ color: 0x4d6338, roughness: .95 }),
  flowerCount
)
const flowerCenter = new THREE.InstancedMesh(
  new THREE.SphereGeometry(.015, 7, 5),
  new THREE.MeshStandardMaterial({ color: 0xe7b74f, roughness: .8, emissive: 0x6e4814, emissiveIntensity: .2 }),
  flowerCount
)
const flowerPalette = [0xf3e7c8, 0xf0d6a1, 0xe5b5aa, 0xf6eedd, 0xc9c6ee, 0xd8c7e0, 0xf0c778, 0xbcc9ea]
// Drifts of wildflowers rather than an even sprinkle: a handful of soft
// clusters with a looser scatter between them.
const flowerClusters = []
for (let i = 0; i < 42; i++) {
  const a = rng() * TAU
  const r = 3.2 + Math.sqrt(rng()) * 26
  const x = Math.cos(a) * r, z = Math.sin(a) * r
  if (Math.hypot(x - POND.x, z - POND.z) < POND.radius + 1.6) continue
  if (Math.hypot(x - BURROW.x, z - BURROW.z) < 2.0) continue
  if (distanceToPath(x, z) < 1.4) continue
  flowerClusters.push({ x, z, radius: rand(1.1, 3.4) })
}
// A few hand-placed drifts near the opening view guarantee colour in frame.
for (const [x, z, radius] of [[2.4, 1.5, 1.9], [-2.4, 2.9, 1.5], [4.9, -1.5, 1.7], [-1.2, -5.0, 1.3], [6.3, 4.4, 1.6], [-4.6, 6.2, 1.8]]) {
  flowerClusters.push({ x, z, radius })
}
placed = 0; attempts = 0
while (placed < flowerCount && attempts < flowerCount * 12) {
  attempts++
  let x, z
  if (flowerClusters.length && rng() < .78) {
    const c = flowerClusters[Math.floor(rng() * flowerClusters.length)]
    const a = rng() * TAU
    const rr = Math.sqrt(rng()) * c.radius
    x = c.x + Math.cos(a) * rr
    z = c.z + Math.sin(a) * rr
  } else {
    const a = rng() * TAU
    const r = 2.5 + Math.sqrt(rng()) * 27
    x = Math.cos(a) * r; z = Math.sin(a) * r
  }
  if (Math.hypot(x - POND.x, z - POND.z) < POND.radius + 1.2) continue
  if (Math.hypot(x - BURROW.x, z - BURROW.z) < 1.6) continue
  if (distanceToPath(x, z) < 1.0) continue
  if (fbm2((x + 40) * .16, (z + 40) * .16, 13, 2, 4) < .38) continue
  const y = terrainHeight(x, z)
  const s = rand(.75, 1.45)
  const stemH = rand(.18, .38) * s
  dummy.position.set(x, y, z)
  dummy.rotation.set(0, rand(0, TAU), rand(-.06, .06))
  dummy.scale.set(s, stemH, s)
  dummy.updateMatrix()
  flowerStem.setMatrixAt(placed, dummy.matrix)
  dummy.position.y = y + stemH
  dummy.scale.setScalar(s * .72)
  dummy.updateMatrix()
  flowerHead.setMatrixAt(placed, dummy.matrix)
  dummy.position.y = y + stemH + .008 * s
  dummy.scale.setScalar(s * .5)
  dummy.updateMatrix()
  flowerCenter.setMatrixAt(placed, dummy.matrix)
  flowerHead.setColorAt(placed, new THREE.Color(flowerPalette[Math.floor(rng() * flowerPalette.length)]))
  placed++
}
flowerHead.count = flowerStem.count = flowerCenter.count = placed
flowerHead.instanceMatrix.needsUpdate = flowerStem.instanceMatrix.needsUpdate = flowerCenter.instanceMatrix.needsUpdate = true
if (flowerHead.instanceColor) flowerHead.instanceColor.needsUpdate = true
flowerHead.castShadow = false
flowerStem.castShadow = false
scene.add(flowerHead, flowerStem, flowerCenter)

// A low carpet of clover leaves catches the light between the taller blades.
function makeCloverGeometry() {
  const positions = [], indices = []
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU + .35
    const cx = Math.cos(a) * .024, cz = Math.sin(a) * .024
    const base = positions.length / 3
    positions.push(cx, .012, cz)
    const sides = 7
    for (let j = 0; j < sides; j++) {
      const ang = j / sides * TAU
      positions.push(
        cx + Math.cos(ang) * .026,
        .013 + Math.sin(ang * 2) * .003,
        cz + Math.sin(ang) * .026,
      )
    }
    for (let j = 0; j < sides; j++) {
      indices.push(base, base + 1 + j, base + 1 + (j + 1) % sides)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

const cloverCount = LOW_POWER ? 900 : 2200
const clover = new THREE.InstancedMesh(
  makeCloverGeometry(),
  new THREE.MeshStandardMaterial({ color: 0x4f6a38, roughness: .93, side: THREE.DoubleSide }),
  cloverCount,
)
placed = 0; attempts = 0
while (placed < cloverCount && attempts < cloverCount * 5) {
  attempts++
  const a = rng() * TAU
  const r = Math.sqrt(rng()) * 22
  const x = Math.cos(a) * r, z = Math.sin(a) * r
  if (Math.hypot(x - POND.x, z - POND.z) < POND.radius + .8) continue
  if (distanceToPath(x, z) < .8) continue
  if (fbm2((x + 13) * .23, (z + 13) * .23, 17, 2, 6) < .4) continue
  const y = terrainHeight(x, z)
  dummy.position.set(x, y - .002, z)
  dummy.rotation.set(rand(-.05, .05), rand(0, TAU), rand(-.05, .05))
  dummy.scale.setScalar(rand(.7, 1.5))
  dummy.updateMatrix()
  clover.setMatrixAt(placed, dummy.matrix)
  clover.setColorAt(placed, grassColor.setHSL(.24 + rng() * .05, .34 + rng() * .18, .2 + rng() * .12))
  placed++
}
clover.count = placed
clover.instanceMatrix.needsUpdate = true
if (clover.instanceColor) clover.instanceColor.needsUpdate = true
clover.castShadow = false
clover.receiveShadow = true
scene.add(clover)

/* ------------------------------------------------------------------------- *
 * Rocks and the burrow.
 * ------------------------------------------------------------------------- */

function rockGeometry(seed) {
  const geo = new THREE.DodecahedronGeometry(1, 1)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const n = .78 + .3 * fbm2(x * 2.1 + seed, z * 1.7 + y + seed, 8, 3, seed)
    pos.setXYZ(i, x * n, y * n * .88, z * n)
  }
  geo.computeVertexNormals()
  return geo
}
const rockPositions = [
  [-6.6, -7.4, 1.0], [-12.8, -1.3, .7], [-8.7, 1.2, .55], [-10.8, -7.4, .8],
  [2.1, -4.8, .4], [8.8, -5.5, .9], [7.7, 7.4, .55], [-15.6, -9.2, 1.25],
  [-3.0, 10.5, .5], [12.3, -12.0, 1.15], [-16.0, 6.5, .7], [5.3, 2.2, .3],
]
const rockMats = [
  new THREE.MeshStandardMaterial({ color: 0x746c57, roughness: .95 }),
  new THREE.MeshStandardMaterial({ color: 0x615e4c, roughness: .95 }),
  new THREE.MeshStandardMaterial({ color: 0x89806a, roughness: .95 }),
]
rockPositions.forEach(([x, z, s], i) => {
  const rock = new THREE.Mesh(rockGeometry(i * 3.7), rockMats[i % 3])
  const y = terrainHeight(x, z)
  rock.position.set(x, y + .13 * s, z)
  rock.scale.set(s * rand(.9, 1.45), s * rand(.5, .85), s * rand(.9, 1.4))
  rock.rotation.set(rand(-.2, .2), rand(0, TAU), rand(-.18, .18))
  rock.castShadow = true
  rock.receiveShadow = true
  scene.add(rock)
  if (s > .7) {
    const tuft = new THREE.Mesh(grassGeometry, grassMaterial)
    tuft.position.set(x + .45, y, z + .2)
    tuft.scale.setScalar(.46)
    tuft.rotation.y = rand(0, TAU)
    scene.add(tuft)
  }
})

// A soft, grassy mound with a dark doorway tucked under the old oak.
const dirtMaterial = new THREE.MeshStandardMaterial({ color: 0x66523a, roughness: 1 })
const mound = new THREE.Mesh(new THREE.SphereGeometry(2.35, 40, 24), dirtMaterial)
mound.scale.set(1.15, .62, .9)
mound.position.set(BURROW.x, terrainHeight(BURROW.x, BURROW.z) - .1, BURROW.z)
mound.castShadow = true
mound.receiveShadow = true
scene.add(mound)
const doorAngle = Math.atan2(0 - BURROW.x, 0 - BURROW.z)
const doorPosition = new THREE.Vector3(
  BURROW.x + Math.sin(doorAngle) * 1.88,
  terrainHeight(BURROW.x, BURROW.z) + .47,
  BURROW.z + Math.cos(doorAngle) * 1.88
)
const burrowDoor = new THREE.Mesh(
  new THREE.CircleGeometry(.74, 30),
  new THREE.MeshStandardMaterial({ color: 0x120e0a, roughness: 1, emissive: 0x050302, emissiveIntensity: .3 })
)
burrowDoor.position.copy(doorPosition)
burrowDoor.scale.y = 1.22
burrowDoor.rotation.y = doorAngle
scene.add(burrowDoor)
const doorRim = new THREE.Mesh(
  new THREE.TorusGeometry(.77, .13, 6, 22, Math.PI),
  new THREE.MeshStandardMaterial({ color: 0x544231, roughness: 1 })
)
doorRim.position.copy(doorPosition)
doorRim.position.y += .01
doorRim.rotation.y = doorAngle
doorRim.rotation.z = 0
scene.add(doorRim)
for (let i = 0; i < 13; i++) {
  const a = doorAngle + rand(-1.2, 1.2)
  const r = rand(1.7, 2.5)
  const x = BURROW.x + Math.sin(a) * r
  const z = BURROW.z + Math.cos(a) * r
  const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(.08, .21), 0), rockMats[i % 3])
  pebble.position.set(x, terrainHeight(x, z) + .05, z)
  pebble.rotation.set(rand(0, TAU), rand(0, TAU), 0)
  pebble.castShadow = true
  scene.add(pebble)
}

/* ------------------------------------------------------------------------- *
 * Trees and a far treeline.
 * ------------------------------------------------------------------------- */

const barkOak = makeBarkTexture(false)
const barkBirch = makeBarkTexture(true)
const barkOakMat = new THREE.MeshStandardMaterial({ map: barkOak, color: 0xa58e6f, roughness: .97 })
const barkBirchMat = new THREE.MeshStandardMaterial({ map: barkBirch, color: 0xd7cdb7, roughness: .95 })
const leafMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x4c6136, roughness: .93, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x617441, roughness: .92, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x7b7c48, roughness: .93, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x8b814a, roughness: .94, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0x536b3f, roughness: .93, flatShading: true }),
]

function cylinderBetween(a, b, r1, r2, material, radial = 7) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const geo = new THREE.CylinderGeometry(r2, r1, len, radial, 1, false)
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.copy(a).add(b).multiplyScalar(.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function makeCanopyBlob(radius, material, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 2)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const n = 1 + .19 * (fbm2((x + seed) * 1.8, (z + y * .7 + seed) * 1.8, 17, 3, seed) - .5)
    pos.setXYZ(i, x * n, y * n * .84, z * n)
  }
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

const leafCards = []
const leafCardPalette = ['#71894b', '#849b58', '#9aaa67', '#647c44', '#a9b777', '#7c8f51']

function createTree(x, z, scale = 1, type = 'oak', castShadow = true) {
  const group = new THREE.Group()
  const canopyParts = []
  const baseY = terrainHeight(x, z)
  group.position.set(x, baseY, z)
  const birch = type === 'birch'
  const mat = birch ? barkBirchMat : barkOakMat
  const height = (birch ? rand(5.3, 7.6) : rand(4.6, 6.8)) * scale
  const trunkR = (birch ? .115 : .25) * scale
  const lean = rand(-.34, .34)
  const leanZ = rand(-.3, .3)
  let prev = new THREE.Vector3(0, 0, 0)
  const trunkPts = []
  for (let i = 0; i <= 3; i++) {
    const t = i / 3
    const p = new THREE.Vector3(lean * t * t, height * t, leanZ * t * t)
    trunkPts.push(p)
    if (i > 0) group.add(cylinderBetween(prev, p, trunkR * (1.5 - t * .8), trunkR * (1.2 - t * .75), mat, birch ? 8 : 9))
    prev = p
  }
  const canopyCenter = trunkPts[3].clone()
  const branches = birch ? 4 : 5
  for (let i = 0; i < branches; i++) {
    const t = .44 + i / branches * .4
    const from = new THREE.Vector3(lean * t * t, height * t, leanZ * t * t)
    const a = rand(0, TAU)
    const len = (birch ? rand(1.1, 2.1) : rand(1.5, 2.8)) * scale
    const to = from.clone().add(new THREE.Vector3(Math.cos(a) * len, rand(.7, 1.7) * scale, Math.sin(a) * len))
    group.add(cylinderBetween(from, to, trunkR * .38, trunkR * .1, mat, 6))
    const blobR = (birch ? rand(.75, 1.25) : rand(1.05, 1.75)) * scale
    const blob = makeCanopyBlob(blobR, leafMaterials[Math.floor(rng() * leafMaterials.length)], x + z + i * 11)
    blob.position.copy(to)
    blob.scale.y = rand(.7, 1.0)
    group.add(blob)
    canopyParts.push({ blob, radius: blobR })
  }
  const crownR = (birch ? rand(1.65, 2.2) : rand(2.5, 3.4)) * scale
  const crown = makeCanopyBlob(crownR, leafMaterials[Math.floor(rng() * leafMaterials.length)], x + z + 5)
  crown.position.copy(canopyCenter).add(new THREE.Vector3(0, crownR * .22, 0))
  crown.scale.set(rand(1.1, 1.5), rand(.65, .9), rand(1.1, 1.45))
  group.add(crown)
  canopyParts.push({ blob: crown, radius: crownR })
  group.traverse(o => { if (o.isMesh) { o.castShadow = castShadow; o.receiveShadow = true } })
  group.rotation.y = rand(0, TAU)
  scene.add(group)
  group.updateMatrixWorld(true)

  // Scatter leaf cards on the canopy shell. They are all merged into one
  // instanced draw later, so a whole wood costs a single extra call.
  const perPart = castShadow ? 88 : 24
  const pos = new THREE.Vector3()
  for (const { blob, radius } of canopyParts) {
    for (let i = 0; i < perPart; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize()
      const rr = rand(.86, 1.14)
      pos.set(
        blob.position.x + dir.x * radius * blob.scale.x * rr,
        blob.position.y + dir.y * radius * blob.scale.y * rr,
        blob.position.z + dir.z * radius * blob.scale.z * rr,
      )
      pos.applyMatrix4(group.matrixWorld)
      leafCards.push({
        pos: pos.clone(),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU))),
        scale: rand(.38, .78) * scale,
        color: new THREE.Color(leafCardPalette[Math.floor(rng() * leafCardPalette.length)]),
      })
    }
  }
  return group
}

// Hero trees frame the opening shot; the rest fill the middle distance.
createTree(OAK.x, OAK.z, 1.28, 'oak')
createTree(-14.4, -10.2, 1.2, 'oak')
createTree(13.2, -14.2, 1.1, 'birch')
createTree(-17.2, 4.5, 1.0, 'birch')
createTree(15.8, 14.0, 1.2, 'oak')
createTree(22.0, 1.0, .95, 'birch')
createTree(-14.8, 18.8, 1.0, 'oak')
createTree(5.6, 26.0, .85, 'birch')
createTree(24.5, -5.0, 1.0, 'oak')
createTree(-23.0, -2.5, .9, 'oak')
for (let i = 0; i < 16; i++) {
  const a = rand(0, TAU)
  const r = rand(27, 44)
  createTree(Math.cos(a) * r, Math.sin(a) * r, rand(.7, 1.25), rng() > .72 ? 'birch' : 'oak', false)
}

// One instanced draw for every leaf card in the meadow.
{
  const geo = new THREE.PlaneGeometry(1, 1)
  const leafTexture = makeLeafTexture()
  const mat = new THREE.MeshStandardMaterial({
    map: leafTexture,
    alphaTest: .42,
    side: THREE.DoubleSide,
    roughness: .92,
    metalness: 0,
    color: 0xffffff,
  })
  const cards = new THREE.InstancedMesh(geo, mat, leafCards.length)
  for (let i = 0; i < leafCards.length; i++) {
    const card = leafCards[i]
    dummy.position.copy(card.pos)
    dummy.quaternion.copy(card.quat)
    dummy.scale.setScalar(card.scale)
    dummy.updateMatrix()
    cards.setMatrixAt(i, dummy.matrix)
    cards.setColorAt(i, card.color)
  }
  cards.instanceMatrix.needsUpdate = true
  if (cards.instanceColor) cards.instanceColor.needsUpdate = true
  cards.castShadow = false
  cards.receiveShadow = true
  scene.add(cards)
}

/* ------------------------------------------------------------------------- *
 * Airborne life: pollen, dandelion seeds and butterflies.
 * ------------------------------------------------------------------------- */

const pollenCount = LOW_POWER ? 130 : 240
const pollenPositions = new Float32Array(pollenCount * 3)
const pollenPhase = new Float32Array(pollenCount)
for (let i = 0; i < pollenCount; i++) {
  const a = rand(0, TAU), r = Math.sqrt(rng()) * 26
  pollenPositions[i * 3] = Math.cos(a) * r
  pollenPositions[i * 3 + 1] = rand(.3, 4.5)
  pollenPositions[i * 3 + 2] = Math.sin(a) * r
  pollenPhase[i] = rand(0, TAU)
}
const pollenGeo = new THREE.BufferGeometry()
pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPositions, 3))
const pollen = new THREE.Points(pollenGeo, new THREE.PointsMaterial({
  map: makePollenTexture('dot'),
  color: 0xffe5a7,
  size: .07,
  sizeAttenuation: true,
  transparent: true,
  opacity: .6,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
}))
scene.add(pollen)

const seedCount = LOW_POWER ? 26 : 44
const seedPositions = new Float32Array(seedCount * 3)
for (let i = 0; i < seedCount; i++) {
  const a = rand(0, TAU), r = rand(2, 22)
  seedPositions[i * 3] = Math.cos(a) * r
  seedPositions[i * 3 + 1] = rand(.6, 3.5)
  seedPositions[i * 3 + 2] = Math.sin(a) * r
}
const seedGeo = new THREE.BufferGeometry()
seedGeo.setAttribute('position', new THREE.BufferAttribute(seedPositions, 3))
const seeds = new THREE.Points(seedGeo, new THREE.PointsMaterial({
  map: makePollenTexture('seed'),
  color: 0xfff1cf,
  size: .22,
  sizeAttenuation: true,
  transparent: true,
  opacity: .48,
  depthWrite: false,
}))
scene.add(seeds)

const butterflies = []
const butterflyPalette = [0xf2d7a4, 0xe8ae76, 0xd9c2df, 0xf1ead5, 0xcaa46c]
for (let i = 0; i < (LOW_POWER ? 6 : 9); i++) {
  const group = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({
    color: butterflyPalette[i % butterflyPalette.length],
    roughness: .8,
    side: THREE.DoubleSide,
    emissive: 0x34230d,
    emissiveIntensity: .15,
  })
  const wingGeo = new THREE.CircleGeometry(.075, 9)
  wingGeo.scale(1.3, .82, 1)
  const left = new THREE.Mesh(wingGeo, mat)
  left.position.x = -.068
  left.rotation.y = Math.PI / 2
  const right = new THREE.Mesh(wingGeo, mat)
  right.position.x = .068
  right.rotation.y = Math.PI / 2
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.009, .013, .16, 5), new THREE.MeshStandardMaterial({ color: 0x32271b, roughness: .9 }))
  body.rotation.x = Math.PI / 2
  group.add(left, right, body)
  group.scale.setScalar(rand(.65, 1.05))
  scene.add(group)
  butterflies.push({
    group, left, right, body,
    cx: rand(-11, 11), cz: rand(-9, 11),
    rx: rand(3, 9), rz: rand(2.5, 7),
    speed: rand(.18, .38), phase: rand(0, TAU), height: rand(.7, 1.7),
    flap: rand(9, 13), phase2: rand(0, TAU),
  })
}

/* ------------------------------------------------------------------------- *
 * The rabbit. A hand-built GLB provides the anatomy; here it is re-assembled
 * into animation pivots, dressed in vertex-coloured coat, and wrapped in six
 * layers of procedural shell fur.
 * ------------------------------------------------------------------------- */

const furMaps = makeFurMaps()
furMaps.color.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
furMaps.normal.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())

const FUR_TINTS = {
  Fur_Warm: '#7e593b',
  Fur_Sunlit: '#946b47',
  Fur_Cream: '#d2ba95',
  Skin_Pink: '#b87972',
  Eye_Obsidian: '#0d0805',
  Eye_Starlight: '#fff4dc',
  Claw_Horn: '#3b2b20',
}
function materialTint(material) {
  return new THREE.Color(FUR_TINTS[material?.name] || '#8f6845')
}

const furBaseMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  map: furMaps.color,
  normalMap: furMaps.normal,
  normalScale: new THREE.Vector2(1.05, 1.05),
  roughness: .88,
  metalness: 0,
  vertexColors: true,
  sheen: .9,
  sheenColor: new THREE.Color('#d9b68d'),
  sheenRoughness: .62,
  envMapIntensity: .35,
  anisotropy: .35,
  anisotropyRotation: Math.PI * .5,
})

const SHELL_COUNT = LOW_POWER ? 5 : 7
const furShellMaterials = []
for (let i = 0; i < SHELL_COUNT; i++) {
  const level = i / Math.max(1, SHELL_COUNT - 1)
  const material = furBaseMaterial.clone()
  material.color.setRGB(1 + level * .035, 1 + level * .02, 1 + level * .005)
  material.roughness = .9
  material.sheen = .95
  material.onBeforeCompile = shader => {
    shader.uniforms.uFurLevel = { value: .10 + level * .62 }
    shader.uniforms.uFurSeed = { value: i * 31.73 + 7.1 }
    shader.vertexShader = 'varying vec3 vFurPos;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      vFurPos = position;
    `)
    shader.fragmentShader = /* glsl */`
      varying vec3 vFurPos;
      uniform float uFurLevel;
      uniform float uFurSeed;
      float furHash(vec3 p) {
        p = fract(p * .3183099 + .1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float furNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(mix(mix(furHash(i), furHash(i + vec3(1,0,0)), f.x),
                       mix(furHash(i + vec3(0,1,0)), furHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(furHash(i + vec3(0,0,1)), furHash(i + vec3(1,0,1)), f.x),
                       mix(furHash(i + vec3(0,1,1)), furHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float furFbm(vec3 p) {
        return furNoise(p) * .56 + furNoise(p * 2.03 + 7.7) * .29 + furNoise(p * 4.11 + 2.3) * .15;
      }
    ` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', /* glsl */`
      #include <alphatest_fragment>
      float strand = furFbm(vec3(vFurPos.x * 150., vFurPos.y * 24., vFurPos.z * 150.) + uFurSeed);
      float tip = furNoise(vec3(vFurPos.x * 380., vFurPos.y * 62., vFurPos.z * 380.) + uFurSeed * 2.1);
      if (strand * .74 + tip * .26 < uFurLevel) discard;
    `)
  }
  material.customProgramCacheKey = () => 'harebell-fur-shell-v3'
  furShellMaterials.push(material)
}

const skinMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xb77870,
  roughness: .58,
  metalness: 0,
  sheen: .45,
  sheenColor: new THREE.Color('#f0b9ab'),
  sheenRoughness: .7,
  clearcoat: .18,
  clearcoatRoughness: .55,
  envMapIntensity: .28,
})
const noseMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x9c5d58,
  roughness: .32,
  metalness: 0,
  clearcoat: .55,
  clearcoatRoughness: .26,
  envMapIntensity: .5,
})
const eyeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x1a0b05,
  roughness: .16,
  metalness: .05,
  clearcoat: .85,
  clearcoatRoughness: .06,
  envMapIntensity: .62,
})
const glintMaterial = new THREE.MeshBasicMaterial({ color: 0xfff7e2, toneMapped: false })

function setVertexTint(geometry, color) {
  const count = geometry.attributes.position.count
  const values = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    values[i * 3] = color.r
    values[i * 3 + 1] = color.g
    values[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3))
}

function offsetFurGeometry(geometry, distance) {
  const g = geometry.clone()
  const pos = g.attributes.position
  const nor = g.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * distance,
      pos.getY(i) + nor.getY(i) * distance,
      pos.getZ(i) + nor.getZ(i) * distance,
    )
  }
  pos.needsUpdate = true
  return g
}

function addFurShells(mesh, highDetail = false) {
  const count = highDetail ? SHELL_COUNT : Math.max(2, SHELL_COUNT - 2)
  for (let i = 0; i < count; i++) {
    const level = i / Math.max(1, count - 1)
    const distance = .002 + .019 * level
    const shell = new THREE.Mesh(offsetFurGeometry(mesh.geometry, distance), furShellMaterials[i % furShellMaterials.length])
    shell.castShadow = false
    shell.receiveShadow = true
    shell.matrixAutoUpdate = false
    shell.updateMatrix()
    mesh.add(shell)
  }
}

function bakeFurPiece(root, names, offset) {
  const geometries = []
  for (const name of names) {
    const object = root.getObjectByName(name)
    if (!object) continue
    object.updateWorldMatrix(true, false)
    const geometry = object.geometry.clone()
    geometry.applyMatrix4(object.matrixWorld)
    setVertexTint(geometry, materialTint(object.material))
    if (geometry.attributes.tangent) geometry.deleteAttribute('tangent')
    geometries.push(geometry)
  }
  if (!geometries.length) return null
  const merged = mergeGeometries(geometries, false)
  geometries.forEach(g => g.dispose())
  if (offset) merged.translate(-offset.x, -offset.y, -offset.z)
  return merged
}

const HEAD_ANCHOR = new THREE.Vector3(0, .62, .24)
const TAIL_ANCHOR = new THREE.Vector3(0, .58, -.35)
const FRONT_ANCHOR_L = new THREE.Vector3(-.185, .405, .245)
const FRONT_ANCHOR_R = new THREE.Vector3(.185, .405, .245)
const HIND_ANCHOR_L = new THREE.Vector3(-.202, .29, -.17)
const HIND_ANCHOR_R = new THREE.Vector3(.202, .29, -.17)

const rabbit = {
  root: new THREE.Group(),
  tilt: new THREE.Group(),
  parts: {},
  ready: false,
  pos: new THREE.Vector3(0, 0, 0),
  facing: 0,
  speed: 0,
  moveDir: new THREE.Vector3(0, 0, 1),
  jumpY: 0,
  jumpV: 0,
  grounded: true,
  hopPhase: rand(0, 1),
  idleTime: 0,
  blinkTime: rand(2, 5),
  blink: 0,
  earFlick: rand(2, 6),
  noseTwitch: 0,
  airTime: 0,
}
rabbit.root.add(rabbit.tilt)
rabbit.pos.y = terrainHeight(0, 0)
rabbit.root.position.copy(rabbit.pos)

const whiskerMaterial = new THREE.LineBasicMaterial({
  color: 0xf0e2c8,
  transparent: true,
  opacity: .38,
  depthWrite: false,
  fog: true,
})

function createWhiskers(parent) {
  const group = new THREE.Group()
  group.position.set(0, .075, .36)
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 5; i++) {
      const y = .015 + i * .012
      const length = .19 + i * .027
      const points = []
      for (let s = 0; s <= 3; s++) {
        const t = s / 3
        points.push(new THREE.Vector3(
          side * (.065 + t * length),
          y - Math.sin(t * Math.PI) * .025 - t * .018,
          .055 + Math.sin(t * 1.4) * .07 + t * .025,
        ))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      group.add(new THREE.Line(geo, whiskerMaterial))
    }
  }
  parent.add(group)
  return group
}

const loaderProgress = { value: 0 }
function setLoaderProgress(value) {
  loaderProgress.value = clamp(value, 0, 1)
  loaderBar.style.width = `${loaderProgress.value * 100}%`
}

const gltfLoader = new GLTFLoader()
function loadRabbit() {
  return new Promise((resolve, reject) => {
    gltfLoader.load('assets/rabbit.glb', gltf => {
      try {
        assembleRabbit(gltf.scene)
        resolve()
      } catch (error) {
        reject(error)
      }
    }, event => {
      if (event.total) setLoaderProgress(.16 + .64 * event.loaded / event.total)
      else setLoaderProgress(.46)
    }, reject)
  })
}

function assembleProceduralRabbit(source) {
  source.updateMatrixWorld(true)
  setLoaderProgress(.84)

  // Static torso / haunch mass is merged into a single continuous fur surface.
  const bodyGeometry = bakeFurPiece(source, ['Body', 'Haunch_L', 'Haunch_R', 'Chest', 'Belly', 'Neck'])
  const bodyMesh = new THREE.Mesh(bodyGeometry, furBaseMaterial)
  bodyMesh.name = 'FurBody'
  bodyMesh.castShadow = true
  bodyMesh.receiveShadow = true
  rabbit.tilt.add(bodyMesh)
  addFurShells(bodyMesh, true)

  // The head has its own pivot so it can nod, sniff and look around.
  const headPivot = new THREE.Group()
  headPivot.name = 'HeadPivot'
  headPivot.position.copy(HEAD_ANCHOR)
  rabbit.tilt.add(headPivot)
  const headGeometry = bakeFurPiece(source, ['Head', 'Cheek_L', 'Cheek_R', 'Muzzle_L', 'Muzzle_R'], HEAD_ANCHOR)
  const headMesh = new THREE.Mesh(headGeometry, furBaseMaterial)
  headMesh.name = 'FurHead'
  headMesh.castShadow = true
  headMesh.receiveShadow = true
  headPivot.add(headMesh)
  addFurShells(headMesh, true)

  // Limbs are paired with their paws so a single bone-like pivot moves both.
  function addLimb(side, names, anchor, highDetail = false) {
    const geometry = bakeFurPiece(source, names, anchor)
    const mesh = new THREE.Mesh(geometry, furBaseMaterial)
    mesh.name = `FurLimb_${side}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.add(new THREE.Group())
    const pivot = new THREE.Group()
    pivot.name = `LimbPivot_${side}`
    pivot.position.copy(anchor)
    pivot.add(mesh)
    rabbit.tilt.add(pivot)
    addFurShells(mesh, highDetail)
    return pivot
  }
  const frontL = addLimb('FrontL', ['FrontLeg_L', 'FrontPaw_L'], FRONT_ANCHOR_L)
  const frontR = addLimb('FrontR', ['FrontLeg_R', 'FrontPaw_R'], FRONT_ANCHOR_R)
  const hindL = addLimb('HindL', ['HindFoot_L', 'Toe_L'], HIND_ANCHOR_L)
  const hindR = addLimb('HindR', ['HindFoot_R', 'Toe_R'], HIND_ANCHOR_R)

  // A wagging pom-pom.
  const tailPivot = new THREE.Group()
  tailPivot.name = 'TailPivot'
  tailPivot.position.copy(TAIL_ANCHOR)
  rabbit.tilt.add(tailPivot)
  const tailGeometry = bakeFurPiece(source, ['Tail', 'TailTuft1', 'TailTuft2'], TAIL_ANCHOR)
  const tailMesh = new THREE.Mesh(tailGeometry, furBaseMaterial)
  tailMesh.castShadow = true
  tailMesh.receiveShadow = true
  tailPivot.add(tailMesh)
  addFurShells(tailMesh, true)

  // Reattach the face and ears to the head pivot, preserving their rest pose.
  source.updateMatrixWorld(true)
  for (const name of ['Eye_L', 'Eye_R', 'Glint_L', 'Glint_R', 'Nose', 'Ear_L', 'Ear_R', 'EarInner_L', 'EarInner_R']) {
    const object = source.getObjectByName(name)
    if (!object) continue
    const worldPos = object.getWorldPosition(new THREE.Vector3())
    const worldQuat = object.getWorldQuaternion(new THREE.Quaternion())
    const worldScale = object.getWorldScale(new THREE.Vector3())
    headPivot.add(object)
    object.position.copy(worldPos).sub(HEAD_ANCHOR)
    object.quaternion.copy(worldQuat)
    object.scale.copy(worldScale)
  }
  headPivot.updateMatrixWorld(true)

  // Give the ears their own pivots: they already sit at the base of each ear.
  const earL = source.getObjectByName('Ear_L')
  const earR = source.getObjectByName('Ear_R')
  const innerL = source.getObjectByName('EarInner_L')
  const innerR = source.getObjectByName('EarInner_R')
  const ears = []
  for (const [ear, inner, side] of [[earL, innerL, -1], [earR, innerR, 1]]) {
    if (!ear) continue
    if (inner) ear.attach(inner)
    const baseQuat = ear.quaternion.clone()
    if (inner) {
      inner.material = skinMaterial
      inner.castShadow = true
      inner.receiveShadow = true
    }
    if (ear.isMesh) {
      const cBase = new THREE.Color('#986f49')
      const cTip = new THREE.Color('#5d422b')
      const count = ear.geometry.attributes.position.count
      const values = new Float32Array(count * 3)
      const pos = ear.geometry.attributes.position
      for (let vi = 0; vi < count; vi++) {
        const t = smoothstep(.26, .46, pos.getY(vi))
        const col = cBase.clone().lerp(cTip, t)
        values[vi * 3] = col.r
        values[vi * 3 + 1] = col.g
        values[vi * 3 + 2] = col.b
      }
      ear.geometry.setAttribute('color', new THREE.BufferAttribute(values, 3))
      ear.material = furBaseMaterial
      ear.castShadow = true
      ear.receiveShadow = true
      addFurShells(ear, true)
    }
    ears.push({ object: ear, baseQuat, side, phase: rand(0, TAU) })
  }

  // Furless details get their own tactile materials.
  const eyes = []
  for (const [name, glintName, side] of [['Eye_L', 'Glint_L', -1], ['Eye_R', 'Glint_R', 1]]) {
    const eye = source.getObjectByName(name)
    const glint = source.getObjectByName(glintName)
    if (eye) {
      eye.material = eyeMaterial
      eye.castShadow = true
    }
    if (glint) {
      glint.material = glintMaterial
      glint.castShadow = false
    }
    if (eye) {
      const anchor = eye.getWorldPosition(new THREE.Vector3())
      if (glint) anchor.lerp(glint.getWorldPosition(new THREE.Vector3()), .25)
      const pivot = new THREE.Group()
      pivot.position.copy(anchor).sub(HEAD_ANCHOR)
      headPivot.add(pivot)
      pivot.attach(eye)
      if (glint) pivot.attach(glint)
      eyes.push({ pivot, side })
    }
  }
  const nose = source.getObjectByName('Nose')
  if (nose) {
    nose.material = noseMaterial
    nose.castShadow = true
  }

  const whiskers = createWhiskers(headPivot)
  // A second, fainter set catches the light from the other side.
  whiskers.children.forEach((line, index) => {
    if (index % 2 === 0) line.material = whiskerMaterial
  })

  rabbit.parts = {
    headPivot, bodyMesh, headMesh, tailPivot, ears, eyes, nose, whiskers,
    frontL, frontR, hindL, hindR,
  }

  // Soft grounding disc under the rabbit; the directional shadow does the rest.
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 1.0),
    new THREE.MeshBasicMaterial({
      map: makeContactTexture(),
      transparent: true,
      opacity: .8,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.y = .017
  contact.renderOrder = 1
  rabbit.root.add(contact)
  rabbit.parts.contact = contact

  scene.add(rabbit.root)
  rabbit.ready = true

  // Original source meshes that were merged away can be released.
  source.traverse(o => {
    if (o.isMesh && !o.parent) o.geometry.dispose()
  })
  setLoaderProgress(.96)
}

/* ------------------------------------------------------------------------- *
 * The rabbit itself is a hand-picked, skinned GLB (Rabbit by Dakota.Hinkle,
 * CC BY 4.0). Its baked 2K fur map carries the fine coat, while a small set
 * of body-space bone rotations give it breath, ear flicks, sniffing and a
 * believable bound. Keeping the original skeleton means the silhouette and
 * the fur never have to be rebuilt in code.
 * ------------------------------------------------------------------------- */

const RABBIT_HEIGHT = 1.04
const RABBIT_BONE_NAMES = {
  spine1: 'spine 1_18',
  spine3: 'spine 3_16',
  spine4: 'spine 4_15',
  spine5: 'spine 5_14',
  neck: 'neck_5',
  head: 'head_4',
  jaw: 'jaw_2',
  earL: 'ear.L_0',
  earR: 'ear.R_1',
  tail: 'tail_19',
  armL: 'Upper arm.L_9',
  forearmL: 'lower arm.L_8',
  handL: 'Hand.L_7',
  armR: 'Upper arm.R_13',
  forearmR: 'lower arm.R_12',
  handR: 'Hand.R_11',
  thighL: 'upper leg.L_23',
  shinL: 'Lower leg.L_22',
  footL: 'foot.L_21',
  thighR: 'upper leg.R_27',
  shinR: 'Lower leg.R_26',
  footR: 'foot.R_25',
}

const rabbitFurMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xfff4e3,
  roughness: .84,
  metalness: 0,
  sheen: .72,
  sheenColor: new THREE.Color('#e3c39a'),
  sheenRoughness: .58,
  envMapIntensity: .48,
  side: THREE.FrontSide,
})

function assembleRabbit(source) {
  source.updateMatrixWorld(true)
  setLoaderProgress(.84)

  // Bound the bind pose, then fit the rabbit to the meadow's scale and set
  // its feet exactly on the ground.
  const bounds = new THREE.Box3().setFromObject(source)
  const size = bounds.getSize(new THREE.Vector3())
  const scale = RABBIT_HEIGHT / Math.max(.001, size.y)

  const visual = new THREE.Group()
  visual.name = 'RabbitVisual'
  visual.scale.setScalar(scale)
  visual.position.y = -bounds.min.y * scale + .008
  rabbit.tilt.add(visual)
  visual.add(source)
  source.updateMatrixWorld(true)

  // The source ships with a baked fur albedo and a metallic eye cap. Replace
  // both with physically plausible materials tuned for the meadow light.
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  source.traverse(o => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
    o.frustumCulled = false
    if (o.material?.name === 'Material.001') {
      o.castShadow = false
      o.material = new THREE.MeshPhysicalMaterial({
        color: 0x080604,
        roughness: .1,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: .04,
        envMapIntensity: 1.15,
      })
      return
    }
    const map = o.material?.map
    if (map) {
      map.anisotropy = maxAniso
      map.colorSpace = THREE.SRGBColorSpace
      rabbitFurMaterial.map = map
      const furNormal = bakeNormalMap(map.image, 1024, 1.05)
      rabbitFurMaterial.normalMap = furNormal
      rabbitFurMaterial.normalScale.set(.55, .55)
      rabbitFurMaterial.needsUpdate = true
    }
    o.material = rabbitFurMaterial
  })

  // Snapshot every bone's rest pose and the rotation that carries its parent
  // space into the rabbit's body space. Rotating in body space means the
  // animations stay readable even though the export's bone rolls are exotic.
  const rootQ = new THREE.Quaternion()
  source.getWorldQuaternion(rootQ)
  const rootQInv = rootQ.clone().invert()
  const bones = {}
  for (const [key, name] of Object.entries(RABBIT_BONE_NAMES)) {
    const bone = source.getObjectByName(name)
    if (!bone) continue
    const parentQ = new THREE.Quaternion()
    bone.parent.getWorldQuaternion(parentQ)
    const bodyQ = rootQInv.clone().multiply(parentQ)
    bones[key] = {
      bone,
      rest: bone.quaternion.clone(),
      parent: bodyQ,
    }
  }

  // Soft grounding disc under the rabbit; the directional shadow does the rest.
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, .84),
    new THREE.MeshBasicMaterial({
      map: makeContactTexture(),
      transparent: true,
      opacity: .82,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.y = .017
  contact.renderOrder = 1
  rabbit.root.add(contact)

  rabbit.parts = {
    source,
    visual,
    bones,
    ears: [
      { entry: bones.earL, side: -1, phase: rand(0, TAU) },
      { entry: bones.earR, side: 1, phase: rand(0, TAU) },
    ],
    contact,
  }
  rabbit.anim = {
    headX: 0, headY: 0, headZ: 0, neckX: 0, spineX: 0,
    earLX: 0, earLZ: 0, earRX: 0, earRZ: 0,
    armLX: 0, armRX: 0, forearmLX: 0, forearmRX: 0,
    thighLX: 0, thighRX: 0, shinLX: 0, shinRX: 0,
    tailX: 0, tailY: 0,
  }

  scene.add(rabbit.root)
  rabbit.ready = true
  setLoaderProgress(.96)
}


/* ------------------------------------------------------------------------- *
 * Input: a soft thumb-stick, a hop button, drag-to-look and optional tilt.
 * ------------------------------------------------------------------------- */

const input = {
  joyX: 0,
  joyY: 0,
  keyX: 0,
  keyY: 0,
  sprint: false,
  x: 0,
  y: 0,
}
const keys = new Set()
const joystick = { active: false, pointerId: null, x: 0, y: 0, max: 35 }
const tilt = {
  enabled: false,
  x: 0,
  y: 0,
  smoothX: 0,
  smoothY: 0,
  base: null,
  hasSignal: false,
  awaiting: false,
}
let gameStarted = false
let photoMode = false
let camYaw = 2.52
const CAMERA_SHOULDER = -.38
let camPitch = .245
let camDistance = isMobileViewport ? 5.1 : 4.75
let lastLookTime = -10
let cameraSettling = false
let dragging = false
let dragPointer = null
let lastPointer = { x: 0, y: 0 }
let lastMoveTime = 0
let placeTimer = 0
let hintTimer = 0

function setStickVisual(x, y) {
  stickKnob.style.transform = `translate(${x * joystick.max}px, ${y * joystick.max}px)`
  stickZone.classList.toggle('active', Math.hypot(x, y) > .06)
}

function updateJoystick(event) {
  const rect = stick.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  let dx = event.clientX - cx
  let dy = event.clientY - cy
  const len = Math.hypot(dx, dy)
  if (len > joystick.max) {
    dx = dx / len * joystick.max
    dy = dy / len * joystick.max
  }
  joystick.x = dx / joystick.max
  joystick.y = -dy / joystick.max
  setStickVisual(joystick.x, joystick.y)
}

stickZone.addEventListener('pointerdown', event => {
  if (!gameStarted) return
  if (photoMode) { setPhotoMode(false); return }
  event.preventDefault()
  joystick.active = true
  joystick.pointerId = event.pointerId
  stickZone.setPointerCapture?.(event.pointerId)
  updateJoystick(event)
})
stickZone.addEventListener('pointermove', event => {
  if (!joystick.active || event.pointerId !== joystick.pointerId) return
  event.preventDefault()
  updateJoystick(event)
})
function endJoystick(event) {
  if (!joystick.active || (event && event.pointerId !== joystick.pointerId)) return
  joystick.active = false
  joystick.pointerId = null
  joystick.x = 0
  joystick.y = 0
  setStickVisual(0, 0)
}
stickZone.addEventListener('pointerup', endJoystick)
stickZone.addEventListener('pointercancel', endJoystick)
stickZone.addEventListener('lostpointercapture', endJoystick)

function triggerHop() {
  if (!gameStarted || photoMode) return
  if (!rabbit.ready || !rabbit.grounded) return
  rabbit.grounded = false
  rabbit.jumpV = 4.35
  rabbit.airTime = 0
  rabbit.parts.contact.visible = false
  meadowAudio.hop()
  if (navigator.vibrate) navigator.vibrate(9)
}
hopButton.addEventListener('pointerdown', event => {
  event.preventDefault()
  triggerHop()
  hopButton.classList.add('pressed')
})
hopButton.addEventListener('pointerup', () => hopButton.classList.remove('pressed'))
hopButton.addEventListener('pointercancel', () => hopButton.classList.remove('pressed'))

const keyMap = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
}
window.addEventListener('keydown', event => {
  if (event.code === 'Escape') {
    if (photoMode) setPhotoMode(false)
    return
  }
  if (event.code === 'Space') {
    if (!event.repeat && (gameStarted || !gameStarted)) {
      event.preventDefault()
      triggerHop()
    }
    return
  }
  if (event.code === 'KeyP' && gameStarted) {
    if (!event.repeat) setPhotoMode(!photoMode)
    return
  }
  if (keyMap[event.code]) {
    keys.add(keyMap[event.code])
    event.preventDefault()
  }
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') input.sprint = true
})
window.addEventListener('keyup', event => {
  if (keyMap[event.code]) keys.delete(keyMap[event.code])
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') input.sprint = false
})
window.addEventListener('blur', () => {
  keys.clear()
  input.sprint = false
  endJoystick()
})

canvas.addEventListener('pointerdown', event => {
  if (photoMode) { setPhotoMode(false); return }
  if (!gameStarted) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  dragging = true
  dragPointer = event.pointerId
  lastPointer.x = event.clientX
  lastPointer.y = event.clientY
  canvas.setPointerCapture?.(event.pointerId)
  canvas.style.cursor = 'grabbing'
})
canvas.addEventListener('pointermove', event => {
  if (!dragging || event.pointerId !== dragPointer) return
  const dx = event.clientX - lastPointer.x
  const dy = event.clientY - lastPointer.y
  lastPointer.x = event.clientX
  lastPointer.y = event.clientY
  camYaw -= dx * .0048
  camPitch = clamp(camPitch + dy * .0027, .06, .52)
  lastLookTime = performance.now() / 1000
})
function endDrag(event) {
  if (event && event.pointerId !== dragPointer) return
  dragging = false
  dragPointer = null
  canvas.style.cursor = ''
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)
canvas.addEventListener('lostpointercapture', endDrag)
canvas.addEventListener('wheel', event => {
  if (!gameStarted) return
  camDistance = clamp(camDistance + event.deltaY * .0022, 2.6, 5.4)
}, { passive: true })

/* ------------------------------------------------------------------------- *
 * Tilt permission. iOS will only ask from inside a real tap, which is why
 * nothing here runs until the switch (or HUD button) is pressed.
 * ------------------------------------------------------------------------- */

function syncTiltUI() {
  const pressed = tilt.enabled ? 'true' : 'false'
  introTilt.setAttribute('aria-pressed', pressed)
  hudTilt.setAttribute('aria-pressed', pressed)
  const note = document.querySelector('#tilt-note')
  if (note) note.textContent = tilt.enabled ? 'Motion ready · lean to steer' : 'Optional motion steering'
}

function onDeviceOrientation(event) {
  if (event.gamma == null && event.beta == null) return
  tilt.hasSignal = true
  if (!tilt.base) {
    tilt.base = { beta: event.beta || 0, gamma: event.gamma || 0 }
    return
  }
  let dx = (event.gamma || 0) - tilt.base.gamma
  let dy = (event.beta || 0) - tilt.base.beta
  const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0
  if (Math.abs(angle) === 90) {
    const tmp = dx
    dx = dy * Math.sign(angle)
    dy = -tmp * Math.sign(angle)
  } else if (Math.abs(angle) === 180) {
    dx = -dx
    dy = -dy
  }
  tilt.x = clamp(dx / 19, -1, 1)
  tilt.y = clamp(-dy / 19, -1, 1)
}

async function setTiltEnabled(next) {
  if (tilt.awaiting) return
  if (!next) {
    tilt.enabled = false
    window.removeEventListener('deviceorientation', onDeviceOrientation)
    tilt.x = tilt.y = tilt.smoothX = tilt.smoothY = 0
    tilt.base = null
    syncTiltUI()
    showToast('Tilt steering off · joystick ready')
    return
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    showToast('This device has no motion sensor')
    return
  }
  tilt.awaiting = true
  introTilt.disabled = hudTilt.disabled = true
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission()
      if (permission !== 'granted') throw new Error('permission denied')
    }
    window.addEventListener('deviceorientation', onDeviceOrientation, true)
    tilt.enabled = true
    tilt.base = null
    syncTiltUI()
    showToast('Tilt steering on · lean gently')
    setTimeout(() => {
      if (tilt.enabled && !tilt.hasSignal) showToast('No motion signal yet · joystick still works')
    }, 2200)
  } catch (error) {
    showToast('Motion access is off · the joystick still works')
    tilt.enabled = false
    syncTiltUI()
  } finally {
    tilt.awaiting = false
    introTilt.disabled = hudTilt.disabled = false
  }
}
introTilt.addEventListener('click', () => setTiltEnabled(!tilt.enabled))
hudTilt.addEventListener('click', () => {
  if (!gameStarted) return
  setTiltEnabled(!tilt.enabled)
})

/* ------------------------------------------------------------------------- *
 * A hand-made little soundscape: wind, footsteps, one bird at a time.
 * ------------------------------------------------------------------------- */

class MeadowAudio {
  constructor() {
    this.ctx = null
    this.master = null
    this.windGain = null
    this.birdTimer = 5.5
    this.muted = false
    this.started = false
  }
  async start() {
    if (this.started) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {})
      return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = .72
    this.master.connect(this.ctx.destination)
    const seconds = 2.4
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      last = last * .985 + (Math.random() * 2 - 1) * .015
      data[i] = last * 3.2
    }
    this.noise = buffer
    const wind = this.ctx.createBufferSource()
    wind.buffer = buffer
    wind.loop = true
    const windFilter = this.ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 520
    windFilter.Q.value = .7
    this.windGain = this.ctx.createGain()
    this.windGain.gain.value = .08
    wind.connect(windFilter).connect(this.windGain).connect(this.master)
    wind.start()
    const leaves = this.ctx.createBufferSource()
    leaves.buffer = buffer
    leaves.loop = true
    leaves.playbackRate.value = 1.33
    const leafFilter = this.ctx.createBiquadFilter()
    leafFilter.type = 'bandpass'
    leafFilter.frequency.value = 1850
    leafFilter.Q.value = 1.8
    const leafGain = this.ctx.createGain()
    leafGain.gain.value = .009
    leaves.connect(leafFilter).connect(leafGain).connect(this.master)
    leaves.start()
    const lfo = this.ctx.createOscillator()
    lfo.frequency.value = .075
    const lfoGain = this.ctx.createGain()
    lfoGain.gain.value = .035
    lfo.connect(lfoGain).connect(this.windGain.gain)
    lfo.start()
    this.started = true
  }
  setMuted(muted) {
    this.muted = muted
    if (!this.master) return
    this.master.gain.cancelScheduledValues(this.ctx.currentTime)
    this.master.gain.setTargetAtTime(muted ? 0 : .72, this.ctx.currentTime, .08)
  }
  chirp() {
    if (!this.started || this.muted || this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    const notes = 2 + Math.floor(Math.random() * 3)
    const base = 2100 + Math.random() * 1300
    for (let i = 0; i < notes; i++) {
      const t = now + i * (.09 + Math.random() * .035)
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(base * (1 + Math.random() * .18), t)
      osc.frequency.exponentialRampToValueAtTime(base * (1.22 + Math.random() * .2), t + .055)
      gain.gain.setValueAtTime(.0001, t)
      gain.gain.exponentialRampToValueAtTime(.035, t + .008)
      gain.gain.exponentialRampToValueAtTime(.0001, t + .09)
      osc.connect(gain).connect(this.master)
      osc.start(t)
      osc.stop(t + .1)
    }
  }
  thump(strength = .5) {
    if (!this.started || this.muted || this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 155 + strength * 100
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(.0001, now)
    gain.gain.exponentialRampToValueAtTime(.08 * strength, now + .013)
    gain.gain.exponentialRampToValueAtTime(.0001, now + .14)
    src.connect(filter).connect(gain).connect(this.master)
    src.start(now)
    src.stop(now + .17)
  }
  hop() {
    if (!this.started || this.muted || this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, now)
    osc.frequency.exponentialRampToValueAtTime(230, now + .13)
    gain.gain.setValueAtTime(.0001, now)
    gain.gain.exponentialRampToValueAtTime(.028, now + .012)
    gain.gain.exponentialRampToValueAtTime(.0001, now + .16)
    osc.connect(gain).connect(this.master)
    osc.start(now)
    osc.stop(now + .18)
  }
  chime() {
    if (!this.started || this.muted || this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    ;[660, 990].forEach((freq, i) => {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(.0001, now + i * .06)
      gain.gain.exponentialRampToValueAtTime(.024, now + i * .06 + .012)
      gain.gain.exponentialRampToValueAtTime(.0001, now + i * .06 + .38)
      osc.connect(gain).connect(this.master)
      osc.start(now + i * .06)
      osc.stop(now + i * .06 + .4)
    })
  }
  update(dt) {
    if (!this.started) return
    this.birdTimer -= dt
    if (this.birdTimer <= 0) {
      this.chirp()
      this.birdTimer = rand(4.5, 13)
    }
    if (this.windGain) {
      const t = performance.now() * .0001
      this.windGain.gain.value = .072 + Math.sin(t * .71) * .012 + Math.sin(t * 1.93 + 1.4) * .007
    }
  }
}
const meadowAudio = new MeadowAudio()

/* ------------------------------------------------------------------------- *
 * Interface.
 * ------------------------------------------------------------------------- */

let toastTimer = 0
function showToast(text, duration = 2700) {
  toastText.textContent = text
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration)
}

function setPhotoMode(next) {
  if (!gameStarted) return
  photoMode = next
  app.classList.toggle('photo-mode', next)
  photoButton.setAttribute('aria-pressed', next ? 'true' : 'false')
  if (next) showToast('Photo mode · tap anywhere to return', 1800)
  else hideToast()
}
function hideToast() {
  toast.classList.remove('show')
}

function startGame() {
  if (!rabbit.ready) return
  if (gameStarted) return
  gameStarted = true
  app.classList.add('playing')
  intro.setAttribute('aria-hidden', 'true')
  hud.setAttribute('aria-hidden', 'false')
  cameraSettling = true
  lastMoveTime = performance.now() / 1000
  meadowAudio.start().catch(() => {})
  setTimeout(() => {
    if (gameStarted) meadowAudio.chime()
  }, 450)
  hintText.textContent = isTouch ? 'Drag to look · follow the path' : 'Drag to look · WASD to wander · space to hop'
  hintTimer = setTimeout(() => hint.classList.add('hidden'), 7600)
  if (isTouch && !reducedMotion) navigator.vibrate?.(12)
  updatePlaceName(true)
}

playButton.addEventListener('click', startGame)

soundButton.addEventListener('click', () => {
  const nextMuted = !meadowAudio.muted
  meadowAudio.setMuted(nextMuted)
  soundButton.setAttribute('aria-pressed', nextMuted ? 'false' : 'true')
  soundButton.setAttribute('aria-label', nextMuted ? 'Unmute sound' : 'Mute sound')
  showToast(nextMuted ? 'Sound off' : 'Sound on')
})
photoButton.addEventListener('click', () => setPhotoMode(!photoMode))
photoExit.addEventListener('click', () => setPhotoMode(false))

const placeSpots = [
  { x: POND.x, z: POND.z, r: 7.4, name: 'Stillwater Pond' },
  { x: BURROW.x, z: BURROW.z, r: 5.6, name: 'The Burrow' },
  { x: OAK.x, z: OAK.z, r: 7.0, name: 'The Old Oak' },
  { x: 0, z: 0, r: 6.8, name: 'The Long Grass' },
  { x: 3, z: 13, r: 8.5, name: 'Butterfly Rise' },
]
let currentPlace = ''
function updatePlaceName(force = false) {
  if (!gameStarted) return
  const x = rabbit.pos.x, z = rabbit.pos.z
  let name = 'The Far Meadow'
  for (const spot of placeSpots) {
    if (Math.hypot(x - spot.x, z - spot.z) < spot.r) { name = spot.name; break }
  }
  if (!force && name === currentPlace) return
  currentPlace = name
  placeName.textContent = name
  if (force) return
  if (placeName.animate) {
    placeName.animate([
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 520, easing: 'cubic-bezier(.2,.6,.3,1)' })
  }
}

window.addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, (w < 760 ? 1.7 : 2)))
  camDistance = w < 760 ? 5.1 : 4.75
})

/* ------------------------------------------------------------------------- *
 * Small landing puffs.
 * ------------------------------------------------------------------------- */

const dustTexture = makePollenTexture('dot')
const puffs = []
for (let i = 0; i < 18; i++) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dustTexture,
    color: 0xd8c39b,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  }))
  sprite.scale.setScalar(.2)
  sprite.visible = false
  scene.add(sprite)
  puffs.push({ sprite, life: 0, maxLife: 0, vx: 0, vy: 0, vz: 0 })
}
let puffCursor = 0
function spawnPuff(x, z, amount = 3) {
  const y = terrainHeight(x, z) + .06
  for (let i = 0; i < amount; i++) {
    const p = puffs[puffCursor++ % puffs.length]
    p.sprite.position.set(x + rand(-.15, .15), y, z + rand(-.15, .15))
    p.sprite.material.opacity = rand(.1, .2)
    p.sprite.scale.setScalar(rand(.1, .25))
    p.life = p.maxLife = rand(.4, .8)
    p.vx = rand(-.35, .35)
    p.vy = rand(.1, .35)
    p.vz = rand(-.35, .35)
    p.sprite.visible = true
  }
}
function updatePuffs(dt) {
  for (const p of puffs) {
    if (p.life <= 0) continue
    p.life -= dt
    if (p.life <= 0) {
      p.sprite.visible = false
      continue
    }
    p.sprite.position.x += p.vx * dt
    p.sprite.position.y += p.vy * dt
    p.sprite.position.z += p.vz * dt
    p.vx *= .96; p.vz *= .96
    const t = p.life / p.maxLife
    p.sprite.material.opacity = t * .16
    p.sprite.scale.setScalar(lerp(.42, .12, t))
  }
}

/* ------------------------------------------------------------------------- *
 * Player movement and rabbit performance.
 * ------------------------------------------------------------------------- */

const playerForward = new THREE.Vector3()
const desiredMove = new THREE.Vector3()
const camForward = new THREE.Vector3()
const camRight = new THREE.Vector3()
let landingSquash = 0
let lastFacing = 0
let turnLean = 0

function applyDeadzone(v, dead = .12) {
  const a = Math.abs(v)
  if (a < dead) return 0
  return Math.sign(v) * (a - dead) / (1 - dead)
}

function updatePlayer(dt) {
  let rawX = 0, rawY = 0
  if (joystick.active) {
    rawX = joystick.x
    rawY = joystick.y
  } else {
    rawX = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0)
    rawY = (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0)
    if (tilt.enabled) {
      tilt.smoothX = damp(tilt.smoothX, applyDeadzone(tilt.x, .1), 5, dt)
      tilt.smoothY = damp(tilt.smoothY, applyDeadzone(tilt.y, .1), 5, dt)
      rawX = clamp(rawX + tilt.smoothX, -1, 1)
      rawY = clamp(rawY + tilt.smoothY, -1, 1)
    }
  }
  const rawLen = Math.hypot(rawX, rawY)
  if (rawLen > 1) { rawX /= rawLen; rawY /= rawLen }
  input.x = damp(input.x, rawX, 16, dt)
  input.y = damp(input.y, rawY, 16, dt)
  input.joyX = rawX
  input.joyY = rawY

  const magnitude = clamp(Math.hypot(input.x, input.y), 0, 1)
  const maxSpeed = (input.sprint ? 4.55 : 3.25) * (isTouch ? 1.08 : 1)
  const targetSpeed = magnitude > .04 ? maxSpeed * Math.pow(magnitude, .82) : 0
  rabbit.speed = damp(rabbit.speed, targetSpeed, magnitude > .04 ? 5.8 : 7.5, dt)
  if (rabbit.speed < .025) rabbit.speed = 0

  camForward.set(Math.sin(camYaw), 0, Math.cos(camYaw))
  camRight.set(Math.cos(camYaw), 0, -Math.sin(camYaw))
  desiredMove.set(0, 0, 0)
  if (magnitude > .035) {
    desiredMove.addScaledVector(camForward, input.y)
    desiredMove.addScaledVector(camRight, input.x)
    if (desiredMove.lengthSq() > 0) {
      desiredMove.normalize()
      rabbit.moveDir.copy(desiredMove)
      const targetFacing = Math.atan2(desiredMove.x, desiredMove.z)
      let delta = targetFacing - rabbit.facing
      delta = ((delta + Math.PI) % TAU + TAU) % TAU - Math.PI
      rabbit.facing += delta * (1 - Math.exp(-11 * dt))
      turnLean = damp(turnLean, clamp(-delta * 3.2, -.22, .22), 6, dt)
    }
  } else {
    turnLean = damp(turnLean, 0, 4, dt)
  }
  rabbit.facing = ((rabbit.facing + Math.PI) % TAU + TAU) % TAU - Math.PI
  rabbit.root.rotation.y = rabbit.facing

  if (rabbit.speed > .02) {
    rabbit.pos.x += Math.sin(rabbit.facing) * rabbit.speed * dt
    rabbit.pos.z += Math.cos(rabbit.facing) * rabbit.speed * dt
    lastMoveTime = performance.now() / 1000
  }

  // The pond is for looking, not swimming.
  const pd = Math.hypot(rabbit.pos.x - POND.x, rabbit.pos.z - POND.z)
  if (pd < POND.radius + .28) {
    const nx = (rabbit.pos.x - POND.x) / (pd || 1)
    const nz = (rabbit.pos.z - POND.z) / (pd || 1)
    rabbit.pos.x = POND.x + nx * (POND.radius + .28)
    rabbit.pos.z = POND.z + nz * (POND.radius + .28)
    rabbit.speed *= .35
  }

  // Don't burrow through the burrow.
  const bd = Math.hypot(rabbit.pos.x - BURROW.x, rabbit.pos.z - BURROW.z)
  if (bd < 2.05) {
    const nx = (rabbit.pos.x - BURROW.x) / (bd || 1)
    const nz = (rabbit.pos.z - BURROW.z) / (bd || 1)
    rabbit.pos.x = BURROW.x + nx * 2.05
    rabbit.pos.z = BURROW.z + nz * 2.05
    rabbit.speed *= .4
  }

  // An invisible, generous edge to the sandbox.
  const rr = Math.hypot(rabbit.pos.x, rabbit.pos.z)
  if (rr > 45) {
    rabbit.pos.x *= 45 / rr
    rabbit.pos.z *= 45 / rr
    rabbit.speed *= .45
  }

  // Vertical: a manual hop, then gravity and a soft landing.
  if (!rabbit.grounded) {
    rabbit.airTime += dt
    rabbit.jumpV -= 11.4 * dt
    rabbit.jumpY += rabbit.jumpV * dt
    if (rabbit.jumpY <= 0) {
      rabbit.jumpY = 0
      rabbit.jumpV = 0
      rabbit.grounded = true
      landingSquash = .24
      spawnPuff(rabbit.pos.x, rabbit.pos.z, 5)
      meadowAudio.thump(1)
      rabbit.parts.contact.visible = true
      if (navigator.vibrate) navigator.vibrate(7)
    }
  }

  const groundY = terrainHeight(rabbit.pos.x, rabbit.pos.z)
  let hopBob = 0
  const moving = rabbit.speed > .12 && rabbit.grounded
  if (moving) {
    const previousPhase = rabbit.hopPhase
    rabbit.hopPhase += dt * (1.1 + rabbit.speed * .27)
    if (rabbit.hopPhase >= 1) {
      rabbit.hopPhase %= 1
      if (rabbit.speed > 1.2) {
        meadowAudio.thump(clamp(rabbit.speed / 3.4, .3, 1))
        spawnPuff(rabbit.pos.x - Math.sin(rabbit.facing) * .18, rabbit.pos.z - Math.cos(rabbit.facing) * .18, 1)
      }
    }
    hopBob = Math.abs(Math.sin(rabbit.hopPhase * Math.PI)) * clamp(.045 + rabbit.speed * .013, .04, .12)
    if (previousPhase > rabbit.hopPhase) { /* wrapped */ }
  } else {
    rabbit.hopPhase = damp(rabbit.hopPhase % 1, 0, 4, dt)
    if (rabbit.hopPhase < .005) rabbit.hopPhase = 0
  }
  rabbit.pos.y = groundY
  rabbit.root.position.set(rabbit.pos.x, groundY + rabbit.jumpY + hopBob, rabbit.pos.z)

  const airHeight = rabbit.jumpY + hopBob
  rabbit.parts.contact.position.y = .017 - airHeight
  rabbit.parts.contact.material.opacity = .8 * (1 - clamp(airHeight / 1.2, 0, 1) * .72)
  rabbit.parts.contact.scale.setScalar(1 - clamp(airHeight, 0, 1) * .18)

  landingSquash = Math.max(0, landingSquash - dt)
  rabbit.idleTime = (magnitude > .04 || !rabbit.grounded) ? 0 : rabbit.idleTime + dt
  rabbit.turnLean = turnLean
  rabbit.lastFacing = lastFacing
  lastFacing = rabbit.facing
}

const qScratch = new THREE.Quaternion()
const qAxis = new THREE.Quaternion()
const qConj = new THREE.Quaternion()
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)

// Turn a body-space rotation into the bone's local space. The export's bone
// rolls are arbitrary, so this keeps every animation axis intuitive.
function poseBone(entry, rx = 0, ry = 0, rz = 0) {
  if (!entry) return
  qScratch.identity()
  if (rz) qScratch.multiply(qAxis.setFromAxisAngle(AXIS_Z, rz))
  if (ry) qScratch.multiply(qAxis.setFromAxisAngle(AXIS_Y, ry))
  if (rx) qScratch.multiply(qAxis.setFromAxisAngle(AXIS_X, rx))
  qConj.copy(entry.parent).invert().multiply(qScratch).multiply(entry.parent)
  entry.bone.quaternion.copy(entry.rest).premultiply(qConj)
}

function updateRabbitAnimation(dt, time) {
  if (!rabbit.ready) return
  const p = rabbit.parts
  const a = rabbit.anim
  const bones = p.bones
  const moving = rabbit.speed > .18
  const air = !rabbit.grounded
  const hopWave = Math.sin(rabbit.hopPhase * Math.PI * 2)
  const idle = rabbit.idleTime
  const breath = Math.sin(time * 1.45 + .7)
  const squash = landingSquash > 0 ? Math.sin((landingSquash / .24) * Math.PI) : 0
  const settle = !moving && !air ? smoothstep(0, 2.4, idle) : 1
  const at = (key, target, speed) => (a[key] = damp(a[key], target, speed, dt))

  // Whole-body breathing, a little squash on landing, and a lean into turns.
  rabbit.tilt.position.y = breath * .0035 - squash * .03
  rabbit.tilt.scale.set(1 + squash * .02, 1 - squash * .045 + breath * .0008, 1 + squash * .02)
  rabbit.tilt.rotation.x = damp(rabbit.tilt.rotation.x, (air ? -.12 : moving ? -.04 : .015) - squash * .03, 5, dt)
  rabbit.tilt.rotation.z = damp(rabbit.tilt.rotation.z, rabbit.turnLean, 5, dt)

  // Spine and neck: a slow breath, a little more when bounding.
  poseBone(bones.spine3, at('spineX', breath * .012 + (moving ? hopWave * .018 : 0), 4))
  poseBone(bones.neck, at('neckX', air ? -.05 : breath * .007, 5))

  // Head: nod with the gait, sniff, and look around when the meadow is quiet.
  const idleLook = Math.sin(time * .33) * .2 + Math.sin(time * .71 + 1.2) * .075
  const nod = (moving ? hopWave * .07 : 0) + (air ? -.16 : 0) + Math.sin(time * .83) * .022 - squash * .06 + settle * .018
  poseBone(
    bones.head,
    at('headX', nod, 7),
    at('headY', settle * idleLook + (moving ? .03 : 0), 3.2),
    at('headZ', settle * Math.sin(time * .42 + 2.1) * .05, 3.5),
  )

  // Ears: two soft antennae that overshoot the body's motion.
  rabbit.earFlick -= dt
  if (rabbit.earFlick <= 0) {
    rabbit.earFlick = rand(3.8, 8.5)
    rabbit.earFlickPulse = .34
  }
  rabbit.earFlickPulse = Math.max(0, (rabbit.earFlickPulse || 0) - dt)
  const flick = rabbit.earFlickPulse > 0 ? Math.sin((1 - rabbit.earFlickPulse / .34) * Math.PI) * .24 : 0
  const earLag = Math.sin(rabbit.hopPhase * Math.PI * 2 - .7) * (moving ? .1 : 0)
  for (const ear of p.ears) {
    const s = ear.side
    const wind = Math.sin(time * 1.1 + ear.phase) * .022
    const perk = air ? -.38 : 0
    const x = at(s < 0 ? 'earLX' : 'earRX', perk + earLag + wind - (s < 0 ? flick : 0), 6)
    const z = at(s < 0 ? 'earLZ' : 'earRZ', Math.sin(time * .75 + ear.phase) * .02 + (air ? s * .18 : 0) + (s > 0 ? flick : 0), 5)
    poseBone(ear.entry, x, 0, z)
  }

  // Legs: paddle through the bound, tuck in the air, settle when still.
  const frontSwing = moving ? hopWave * .6 : 0
  const hindSwing = moving ? -hopWave * .42 : 0
  poseBone(bones.armL, at('armLX', (air ? .95 : 0) + frontSwing, 12))
  poseBone(bones.armR, at('armRX', (air ? .8 : 0) - frontSwing, 12))
  poseBone(bones.forearmL, at('forearmLX', (air ? .65 : 0) + frontSwing * .32, 10))
  poseBone(bones.forearmR, at('forearmRX', (air ? .55 : 0) - frontSwing * .32, 10))
  poseBone(bones.thighL, at('thighLX', (air ? -.5 : 0) + hindSwing, 10))
  poseBone(bones.thighR, at('thighRX', (air ? -.42 : 0) - hindSwing, 10))
  poseBone(bones.shinL, at('shinLX', (air ? .72 : 0) + (moving ? hopWave * .25 : 0), 10))
  poseBone(bones.shinR, at('shinRX', (air ? .62 : 0) - (moving ? hopWave * .25 : 0), 10))

  // Pom-pom.
  poseBone(bones.tail, at('tailX', moving ? -.08 : Math.sin(time * 1.7) * .018, 5), at('tailY', Math.sin(time * 2.3) * (moving ? .24 : .08), 5))
}


/* ------------------------------------------------------------------------- *
 * Camera: a soft third-person orbit that starts as a portrait and settles in.
 * ------------------------------------------------------------------------- */

const cameraDesired = new THREE.Vector3()
const lookDesired = new THREE.Vector3()
const lookSmoothed = new THREE.Vector3(-.2, .72, .1)
const introLook = new THREE.Vector3(-.38, .74, .06)

function updateCamera(dt, time) {
  if (!gameStarted) {
    const yaw = 2.54 + Math.sin(time * .07) * .018
    const pitch = .205 + Math.sin(time * .11 + .8) * .008
    const dist = isMobileViewport ? 5.0 : 4.65
    const look = introLook
    cameraDesired.set(
      look.x - Math.sin(yaw) * Math.cos(pitch) * dist,
      look.y + Math.sin(pitch) * dist,
      look.z - Math.cos(yaw) * Math.cos(pitch) * dist,
    )
    camera.position.lerp(cameraDesired, 1 - Math.exp(-2.2 * dt))
    lookSmoothed.lerp(look, 1 - Math.exp(-2.4 * dt))
    camera.lookAt(lookSmoothed)
    return
  }

  if (cameraSettling) {
    camYaw = damp(camYaw, rabbit.facing + CAMERA_SHOULDER, 2.9, dt)
    if (Math.abs(((camYaw - rabbit.facing - CAMERA_SHOULDER + Math.PI) % TAU + TAU) % TAU - Math.PI) < .006 && rabbit.speed < .1) {
      cameraSettling = false
    }
  } else if (!dragging && rabbit.speed > .15 && performance.now() / 1000 - lastLookTime > 1.35) {
    camYaw = damp(camYaw, rabbit.facing + CAMERA_SHOULDER, 1.25, dt)
  }

  const pitch = camPitch
  camForward.set(Math.sin(camYaw), 0, Math.cos(camYaw))
  const targetY = rabbit.pos.y + (airOffset() + .66)
  lookDesired.set(
    rabbit.pos.x + camForward.x * .55,
    targetY,
    rabbit.pos.z + camForward.z * .55,
  )
  const dist = camDistance + (!rabbit.grounded ? .22 : 0)
  cameraDesired.set(
    rabbit.pos.x - camForward.x * Math.cos(pitch) * dist,
    rabbit.pos.y + airOffset() + .72 + Math.sin(pitch) * dist,
    rabbit.pos.z - camForward.z * Math.cos(pitch) * dist,
  )
  // Never let the camera sink into a hill.
  const floor = terrainHeight(cameraDesired.x, cameraDesired.z) + .55
  if (cameraDesired.y < floor) cameraDesired.y = floor
  camera.position.lerp(cameraDesired, 1 - Math.exp(-5.2 * dt))
  lookSmoothed.lerp(lookDesired, 1 - Math.exp(-6.5 * dt))
  camera.lookAt(lookSmoothed)
}

function airOffset() {
  return clamp(rabbit.jumpY * .35, 0, .35)
}

/* ------------------------------------------------------------------------- *
 * The living meadow.
 * ------------------------------------------------------------------------- */

const pollenBase = pollenPositions.slice()
const seedBase = seedPositions.slice()
const dustWorld = new THREE.Vector3()
let birdTime = 0
let placeTick = 0

function updateEnvironment(dt, time) {
  grassTime.value = time
  skyUniforms.uTime.value = time
  waterUniforms.uTime.value = time

  sky.position.copy(camera.position)
  sunGlow.position.copy(camera.position).addScaledVector(sunDir, 108)
  // Shadow frustum follows the wanderer, keeping texels small and crisp.
  sun.position.set(rabbit.pos.x - 16, 21, rabbit.pos.z + 22)
  sun.target.position.set(rabbit.pos.x, rabbit.pos.y, rabbit.pos.z)
  sun.target.updateMatrixWorld()
  warmBounce.position.set(rabbit.pos.x - 2.2, rabbit.pos.y + 1.15, rabbit.pos.z + 1.8)

  const pp = pollenGeo.attributes.position
  for (let i = 0; i < pollenCount; i++) {
    const ph = pollenPhase[i]
    pp.setXYZ(
      i,
      pollenBase[i * 3] + Math.sin(time * .12 + ph) * .55 + Math.sin(time * .27 + ph * 2) * .12,
      pollenBase[i * 3 + 1] + Math.sin(time * .21 + ph) * .34,
      pollenBase[i * 3 + 2] + Math.cos(time * .1 + ph * .7) * .55,
    )
  }
  pp.needsUpdate = true
  pollen.position.set(rabbit.pos.x, terrainHeight(rabbit.pos.x, rabbit.pos.z), rabbit.pos.z)

  const sp = seedGeo.attributes.position
  for (let i = 0; i < seedCount; i++) {
    const ph = i * 1.7
    sp.setXYZ(
      i,
      seedBase[i * 3] + Math.sin(time * .09 + ph) * .7,
      seedBase[i * 3 + 1] + Math.sin(time * .17 + ph) * .3 + ((time * .075 + ph) % 1.4),
      seedBase[i * 3 + 2] + Math.cos(time * .08 + ph) * .6,
    )
  }
  sp.needsUpdate = true
  seeds.position.set(rabbit.pos.x, terrainHeight(rabbit.pos.x, rabbit.pos.z), rabbit.pos.z)

  for (const b of birds) {
    b.phase += dt * b.speed
    b.object.position.x += Math.sin(b.phase) * dt * 1.7
    b.object.position.z += Math.cos(b.phase * .7) * dt * .7
    b.object.position.y += Math.sin(b.phase * 2.2) * dt * .14
    b.object.scale.y = .75 + Math.sin(b.phase * 7) * .25
  }

  for (const b of butterflies) {
    const t = time * b.speed + b.phase
    const x = b.cx + Math.sin(t) * b.rx
    const z = b.cz + Math.cos(t * .82 + 1.1) * b.rz
    const y = terrainHeight(x, z) + b.height + Math.sin(t * 2.3) * .16
    b.group.position.set(x, y, z)
    b.group.rotation.y = Math.atan2(Math.cos(t) * b.rx, -Math.sin(t * .82 + 1.1) * b.rz * .82)
    b.left.rotation.y = Math.PI / 2 + Math.sin(time * b.flap + b.phase2) * .9
    b.right.rotation.y = Math.PI / 2 - Math.sin(time * b.flap + b.phase2) * .9
    b.body.rotation.x = Math.PI / 2
    b.group.rotation.z = Math.sin(t * 2) * .08
  }

  updatePuffs(dt)
  placeTick += dt
  if (placeTick > .45) {
    placeTick = 0
    updatePlaceName()
  }
}

/* ------------------------------------------------------------------------- *
 * Boot.
 * ------------------------------------------------------------------------- */

let lastTimestamp = 0
const clock = new THREE.Clock()

function animate(timestamp = 0) {
  const dt = Math.min(.045, clock.getDelta())
  const time = clock.elapsedTime
  if (rabbit.ready) {
    updatePlayer(dt)
    updateRabbitAnimation(dt, time)
  }
  updateCamera(dt, time)
  updateEnvironment(dt, time)
  meadowAudio.update(dt)
  renderer.render(scene, camera)
  lastTimestamp = timestamp
}

async function boot() {
  setLoaderProgress(.06)
  camera.aspect = innerWidth / innerHeight
  camera.fov = isMobileViewport ? 47 : 42
  camera.updateProjectionMatrix()
  setLoaderProgress(.12)
  await loadRabbit()
  setLoaderProgress(.98)
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera)
    else renderer.compile(scene, camera)
  } catch {}
  // A couple of warm-up frames, then reveal the meadow.
  renderer.render(scene, camera)
  setLoaderProgress(1)
  document.querySelector('.loader-copy span').textContent = 'The meadow is awake'
  await new Promise(resolve => setTimeout(resolve, 280))
  loader.classList.add('done')
  document.body.dataset.ready = 'true'
  window.__HAREBELL_READY__ = true
  clock.start()
  renderer.setAnimationLoop(animate)
  lastTimestamp = performance.now()
}

boot().catch(error => {
  console.error(error)
  document.querySelector('.loader-copy span').textContent = 'The meadow could not wake'
  document.querySelector('.loader-copy').classList.add('error')
})

window.addEventListener('pagehide', () => {
  if (meadowAudio.ctx) meadowAudio.ctx.suspend().catch(() => {})
})
window.addEventListener('pageshow', () => {
  if (meadowAudio.ctx && !meadowAudio.muted) meadowAudio.ctx.resume().catch(() => {})
})

// A small handle for visual QA and for anyone who wants to tinker.
window.__harebell = {
  scene, renderer, camera, rabbit, sun, hemi, fill, rim, ground, THREE,
  setView(yaw, pitch = camPitch, dist = camDistance) {
    camYaw = yaw; camPitch = pitch; camDistance = dist
    cameraSettling = false
    lastLookTime = performance.now() / 1000 + 999
  },
}
