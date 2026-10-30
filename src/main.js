import * as THREE from 'three'
import { createWorld } from './game/world.js'
import { createRabbit } from './game/rabbit.js'
import { RabbitPlayer } from './game/player.js'
import { createControls } from './game/controls.js'
import { Soundscape } from './game/audio.js'
import './style.css'

const isMobile =
  window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 760

const canvas = document.getElementById('scene')
const loadingEl = document.getElementById('loading')
const loadBar = document.getElementById('loadBar')
const loadPct = document.getElementById('loadingPct')
const loadStatus = document.getElementById('loadStatus')
const hintEl = document.getElementById('hint')
const toastEl = document.getElementById('toast')

let toastTimer = 0
function toast(message, ms = 2400) {
  if (!toastEl) return
  toastEl.textContent = message
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms)
}

function setLoading(pct, status) {
  if (loadBar) loadBar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, pct))})`
  if (loadPct) loadPct.textContent = `${Math.round(pct * 100)}%`
  if (loadStatus && status) loadStatus.textContent = status
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.98
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setClearColor(0xbfd6d2, 1)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 260)
camera.position.set(3, 1.4, 9)

const sound = new Soundscape()
const clock = new THREE.Clock()

let world = null
let rabbit = null
let player = null
let controls = null
let raf = null
let running = false
let elapsed = 0
let fps = 60
let fpsAccum = 0
let fpsFrames = 0
let degraded = false

/* ------------------------------------------------------------------ */
/*  Camera rig                                                        */
/* ------------------------------------------------------------------ */

class CameraRig {
  constructor(cam, meadow) {
    this.camera = cam
    this.world = meadow
    this.yaw = 0
    this.pitch = 0.2
    this.distance = 4.4
    this.baseDistance = 2.72
    this.lookIdle = 10
    this.freeze = 0
    this.intro = 1
    this.smoothPos = new THREE.Vector3()
    this.smoothTarget = new THREE.Vector3()
    this.first = true
  }

  reset() {
    this.yaw = 0
    this.pitch = 0.2
    this.lookIdle = 10
  }

  update(dt, input, player) {
    const sens = window.innerWidth < 760 ? 0.0052 : 0.0042
    if (Math.abs(input.lookDX) + Math.abs(input.lookDY) > 0.1) {
      this.lookIdle = 0
      this.freeze = Math.max(0, this.freeze - dt)
      this.yaw -= input.lookDX * sens
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookDY * sens * 0.85, -0.12, 1.15)
    } else {
      this.lookIdle += dt
    }
    if (Math.abs(input.zoom) > 0.0001) {
      this.lookIdle = 0
      this.baseDistance = THREE.MathUtils.clamp(this.baseDistance + input.zoom * 2.2, 1.05, 6.4)
    }

    if (this.freeze > 0) this.freeze -= dt
    if (player.speedNorm > 0.22 && this.lookIdle > 1.6 && this.freeze <= 0) {
      this.yaw = this._dampAngle(this.yaw, player.heading + Math.PI, 1.15, dt)
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0.2, 1 - Math.exp(-0.5 * dt))
    }

    this.intro = Math.max(0, this.intro - dt / 3.2)
    const portrait = window.innerHeight > window.innerWidth
    const introDist = this.intro * 2.1
    const portraitBoost = portrait ? 0.55 : 0
    const dist = this.baseDistance + introDist + portraitBoost
    const pitch = this.pitch + this.intro * 0.12

    const target = new THREE.Vector3(player.position.x, player.position.y + 0.47 + player.airY * 0.55, player.position.z)
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(this.yaw) * Math.cos(pitch)
    )
    const desired = target.clone().addScaledVector(dir, dist)
    const ground = this.world.terrainHeight(desired.x, desired.z) + 0.32
    if (desired.y < ground) desired.y = ground

    if (this.first) {
      this.smoothPos.copy(desired)
      this.smoothTarget.copy(target)
      this.first = false
    } else {
      const k = 1 - Math.exp(-9 * dt)
      this.smoothPos.lerp(desired, k)
      this.smoothTarget.lerp(target, 1 - Math.exp(-14 * dt))
    }
    this.camera.position.copy(this.smoothPos)
    this.camera.lookAt(this.smoothTarget)
    player.setCameraPosition(this.smoothPos)
  }

  _dampAngle(current, target, speed, dt) {
    let d = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
    return current + d * (1 - Math.exp(-speed * dt))
  }

  photo(mode) {
    if (!player) return
    this.freeze = 8
    this.intro = 0
    this.first = false
    this.pitch = 0.12
    this.yaw = player.heading + Math.PI
    if (mode === 'face') {
      this.baseDistance = 0.98
      this.yaw = player.heading + 0.36
      this.pitch = 0.02
    } else if (mode === 'faceleft') {
      this.baseDistance = 0.82
      this.yaw = player.heading - 0.5
      this.pitch = 0.0
    } else if (mode === 'side') {
      this.baseDistance = 1.35
      this.yaw += Math.PI / 2
      this.pitch = 0.06
    } else if (mode === 'fur') {
      this.baseDistance = 0.62
      this.yaw += Math.PI / 2 + 0.25
      this.pitch = -0.06
    } else if (mode === 'top') {
      this.baseDistance = 3.4
      this.pitch = 0.95
    } else {
      this.baseDistance = 2.9
      this.pitch = 0.16
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Time of day                                                       */
/* ------------------------------------------------------------------ */
const TIME_PRESETS = [
  { t: 0.09, label: 'Morning mist' },
  { t: 0.25, label: 'High sun' },
  { t: 0.42, label: 'Golden hour' },
  { t: 0.49, label: 'Dusk' },
  { t: 0.73, label: 'Moonlight' }
]
let timeOfDay = 0.42
let timeTarget = null
let timeIndex = 2

function setTime(t) {
  timeOfDay = t
  timeTarget = null
  world?.applyTime(timeOfDay)
}

function cycleTime() {
  timeIndex = (timeIndex + 1) % TIME_PRESETS.length
  const preset = TIME_PRESETS[timeIndex]
  timeTarget = preset.t
  sound.chime()
  toast(preset.label)
}

function advanceTime(dt) {
  if (timeTarget != null) {
    let delta = timeTarget - timeOfDay
    if (delta > 0.5) delta -= 1
    if (delta < -0.5) delta += 1
    const step = Math.sign(delta) * Math.min(Math.abs(delta), dt * 0.35)
    timeOfDay = (timeOfDay + step + 1) % 1
    if (Math.abs(timeTarget - timeOfDay) < 0.002 || Math.abs(Math.abs(timeTarget - timeOfDay) - 1) < 0.002) {
      timeOfDay = timeTarget
      timeTarget = null
    }
  } else {
    timeOfDay = (timeOfDay + dt / 900) % 1
  }
  world?.applyTime(timeOfDay)
}

/* ------------------------------------------------------------------ */
/*  Events                                                            */
/* ------------------------------------------------------------------ */

function handlePlayerEvent(type, position, strength) {
  if (!world) return
  if (type === 'hop') {
    sound.hop()
    world.puff(position.x, position.y + 0.03, position.z, 0xcfc0a0, 3, 0.35)
  } else if (type === 'land') {
    sound.land(strength || 1)
    world.puff(position.x, position.y + 0.025, position.z, 0xd0c1a3, 7, 0.55)
    world.ripple(position.x, position.z, 0.4)
  } else if (type === 'splash') {
    sound.splash()
    world.ripple(position.x, position.z, 1.15)
    world.puff(position.x, world.pond.level + 0.06, position.z, 0xd8efe7, 6, 0.5)
  } else if (type === 'sniff') {
    sound.sniff()
  }
}

/* ------------------------------------------------------------------ */
/*  UI                                                                */
/* ------------------------------------------------------------------ */

function setupUi() {
  const tiltBtn = document.getElementById('btnTilt')
  const soundBtn = document.getElementById('btnSound')
  const timeBtn = document.getElementById('btnTime')
  const resetBtn = document.getElementById('btnReset')

  if (tiltBtn) {
    if (!('DeviceOrientationEvent' in window)) {
      tiltBtn.style.display = 'none'
    }
    tiltBtn.addEventListener('click', async () => {
      tiltBtn.classList.add('busy')
      const result = await controls.toggleTilt()
      tiltBtn.classList.remove('busy')
      tiltBtn.classList.toggle('active', controls.state.tiltEnabled)
      tiltBtn.setAttribute('aria-pressed', String(controls.state.tiltEnabled))
      toast(result.message, 3000)
    })
  }

  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      const muted = sound.toggleMuted()
      soundBtn.classList.toggle('muted', muted)
      soundBtn.setAttribute('aria-pressed', String(!muted))
      toast(muted ? 'Sound off' : 'Sound on', 1400)
    })
  }

  if (timeBtn) {
    timeBtn.addEventListener('click', cycleTime)
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      player?.reset()
      cameraRig?.reset()
      toast('Back to the trail', 1600)
    })
  }
}

let cameraRig = null

/* ------------------------------------------------------------------ */
/*  Boot                                                              */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    setLoading(0.04, 'waking the meadow')
    world = createWorld({
      renderer,
      scene,
      isMobile,
      maxAnisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy())
    })
    await new Promise((r) => requestAnimationFrame(r))
    setLoading(0.16, 'planting clover and wildflowers')

    cameraRig = new CameraRig(camera, world)
    controls = createControls({
      onFirstGesture: () => sound.start(),
      onToast: toast
    })
    setupUi()

    setLoading(0.24, 'growing a rabbit, one hair at a time')
    const furParam = new URLSearchParams(location.search).get('fur')
    const furQuality = furParam === 'low' || furParam === 'medium' || furParam === 'high' ? furParam : isMobile ? 'medium' : 'high'
    rabbit = await createRabbit({
      quality: furQuality,
      maxAnisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
      onProgress: ({ pct, detail }) => setLoading(0.24 + pct * 0.68, detail)
    })
    setLoading(0.94, 'teaching it to hop')

    player = new RabbitPlayer({ rabbit, world, scene, onEvent: handlePlayerEvent })
    scene.add(player.rig)
    world.applyTime(timeOfDay)
    cameraRig.first = true

    await new Promise((r) => requestAnimationFrame(r))
    setLoading(1, 'ready to roam')
    await new Promise((r) => setTimeout(r, 260))

    loadingEl?.classList.add('done')
    setTimeout(() => { if (loadingEl) loadingEl.style.display = 'none' }, 900)

    if (hintEl) {
      hintEl.innerHTML = isMobile
        ? '<span>Left thumb to roam</span><i></i><span>Drag to look</span><i></i><span>Pinch to zoom</span>'
        : '<span>WASD to roam</span><i></i><span>Drag to look</span><i></i><span>Space to pounce</span>'
      setTimeout(() => hintEl.classList.add('show'), 350)
      setTimeout(() => hintEl.classList.remove('show'), 7200)
    }

    running = true
    window.__clover = {
      ready: true,
      renderer,
      scene,
      camera,
      world,
      rabbit,
      player,
      controls,
      cameraRig,
      sound,
      stats: rabbit.stats,
      get fps() { return Math.round(fps) },
      furQuality,
      get time() { return timeOfDay },
      setTime,
      nextTime: cycleTime,
      photo: (m) => cameraRig.photo(m),
      teleport: (x, z) => {
        player.position.set(x, world.terrainHeight(x, z), z)
        player.velocity.set(0, 0, 0)
        cameraRig.first = true
      },
      hop: () => player.hop(),
      sniff: () => player.sniff()
    }
  } catch (err) {
    console.error(err)
    setLoading(1, 'the rabbit got away — reload to try again')
    if (loadStatus) loadStatus.textContent = String(err?.message || err)
  }
}

/* ------------------------------------------------------------------ */
/*  Loop                                                              */
/* ------------------------------------------------------------------ */

function tick() {
  const dt = Math.min(0.05, clock.getDelta())
  elapsed += dt
  fpsAccum += dt
  fpsFrames++
  if (fpsAccum > 0.5) {
    const measured = fpsFrames / fpsAccum
    fps = fps * 0.6 + measured * 0.4
    fpsAccum = 0
    fpsFrames = 0
    if (!degraded && elapsed > 6 && fps < 38 && renderer.getPixelRatio() > 1.05) {
      degraded = true
      renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.78))
      renderer.setSize(window.innerWidth, window.innerHeight, false)
    }
  }

  if (running && player && world && controls && cameraRig) {
    advanceTime(dt)
    const input = controls.sample(dt)
    if (input.hop) player.hop()
    if (input.sniff) player.sniff()
    player.update(dt, input, cameraRig.yaw)
    world.update(dt, elapsed, { position: player.position, airHeight: player.airY })
    cameraRig.update(dt, input, player)
    sound.update(dt, world.state.day)
  }

  renderer.render(scene, camera)
  raf = requestAnimationFrame(tick)
}

function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.fov = h > w ? 62 : 55
  camera.updateProjectionMatrix()
}

window.addEventListener('resize', resize)
window.addEventListener('orientationchange', () => setTimeout(resize, 250))

resize()
boot().then(() => {
  clock.start()
  tick()
})
