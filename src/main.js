import './style.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createWorld, POND } from './world.js'
import { Hare } from './hare.js'
import { MeadowAudio } from './audio.js'
import { Particles } from './fx.js'

const canvas = document.querySelector('#scene')
const loaderEl = document.querySelector('#loader')
const loadBar = document.querySelector('#load-bar')
const loadNote = document.querySelector('#load-note')
const introEl = document.querySelector('#intro')
const hudEl = document.querySelector('#hud')
const enterEl = document.querySelector('#enter')
const joystickEl = document.querySelector('#joystick')
const joystickStick = joystickEl.querySelector('.joystick-stick')
const hopEl = document.querySelector('#hop')
const hintEl = document.querySelector('#hint')
const toastEl = document.querySelector('#toast')
const timeLabel = document.querySelector('#time-label')
const helpEl = document.querySelector('#help')
const permissionNote = document.querySelector('#permission-note')

const coarsePointer = window.matchMedia('(pointer: coarse)').matches
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isMobile = coarsePointer || /Android|iPad|iPhone|iPod/i.test(navigator.userAgent)
if (coarsePointer) document.body.classList.add('touch')

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
})
const gl = renderer.getContext()
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
const gpuName = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : ''
const softwareGPU = /swiftshader|llvmpipe|software|lavapipe/i.test(gpuName)
const quality = softwareGPU
  ? 0.28
  : isMobile
    ? Math.min(window.innerWidth, window.innerHeight) < 700
      ? 0.62
      : 0.76
    : 1
const maxDPR = softwareGPU ? 0.72 : isMobile ? 1.55 : 2
const DPR = Math.min(window.devicePixelRatio || 1, maxDPR)

renderer.setPixelRatio(DPR)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.04
renderer.shadowMap.enabled = !softwareGPU
renderer.shadowMap.type = THREE.PCFShadowMap

const scene = new THREE.Scene()
scene.name = 'ThistledownMeadow'
const camera = new THREE.PerspectiveCamera(41, window.innerWidth / window.innerHeight, 0.08, 120)
camera.position.set(3.1, 1.7, -3.4)

const world = createWorld(scene, renderer, quality)
const hare = new Hare(scene, renderer, quality)
const audio = new MeadowAudio()
const hearts = new Particles(scene, { count: 50, kind: 'heart', color: '#e2a090', size: 0.075, gravity: -0.12, drag: 0.8 })
const dust = new Particles(scene, { count: 80, kind: 'dust', color: '#c9b98b', size: 0.06, gravity: 0.45, drag: 2.2 })
const splash = new Particles(scene, { count: 70, kind: 'dust', color: '#cfe3d8', size: 0.05, gravity: 2.7, drag: 1.6 })

const startTime = performance.now()
let last = startTime
let time = 0
let started = false
let ready = false
let helpOpen = false
let toastTimer = null
let hintTimer = null
let night = false
let soundOn = true
let tiltEnabled = false
let tiltReady = false
let tiltBase = null
const tilt = { x: 0, y: 0 }
const keys = new Set()
const joy = { x: 0, y: 0, active: false, pointer: null }
const velocity = new THREE.Vector3()
const moveDir = new THREE.Vector3()
const cameraTarget = new THREE.Vector3(0, 0.76, 0)
const cameraLook = new THREE.Vector3(0, 0.76, 0)
const cameraYaw = { current: Math.PI - 0.48, target: 0.14 }
const cameraPitch = { current: 0.15, target: 0.2 }
const cameraDistance = { current: 3.15, target: 3.8 }
const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()

let stepTimer = 0
let splashTimer = 0
let wasGrounded = true
let petCount = 0

const petLines = [
  'You have been accepted.',
  'A soft nose twitch.',
  'The ears approve.',
  'A small, warm weight leans in.',
  'The meadow can wait.',
]

function showToast(message, duration = 2300) {
  toastEl.textContent = message
  toastEl.classList.add('is-visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), duration)
}

function showPermissionNote(message, duration = 3400) {
  permissionNote.textContent = message
  permissionNote.classList.add('is-visible')
  clearTimeout(showPermissionNote.timer)
  showPermissionNote.timer = setTimeout(() => permissionNote.classList.remove('is-visible'), duration)
}

function setLoading(progress, note) {
  loadBar.style.width = `${Math.max(2, Math.min(100, progress))}%`
  if (note) loadNote.textContent = note
}

function syncSoundUI() {
  const pref = document.querySelector('#pref-sound')
  pref.classList.toggle('is-on', soundOn)
  pref.setAttribute('aria-pressed', String(soundOn))
  pref.querySelector('.pref-state').textContent = soundOn ? 'on' : 'off'
  const btn = document.querySelector('#btn-sound')
  btn.classList.toggle('is-on', soundOn)
  btn.classList.toggle('is-muted', !soundOn)
  btn.setAttribute('aria-pressed', String(soundOn))
  btn.setAttribute('aria-label', soundOn ? 'Mute meadow sound' : 'Unmute meadow sound')
}

function syncTiltUI() {
  const pref = document.querySelector('#pref-tilt')
  pref.classList.toggle('is-on', tiltEnabled)
  pref.setAttribute('aria-pressed', String(tiltEnabled))
  pref.querySelector('.pref-state').textContent = tiltEnabled ? 'on' : 'off'
  const btn = document.querySelector('#btn-tilt')
  btn.classList.toggle('is-on', tiltEnabled)
  btn.setAttribute('aria-pressed', String(tiltEnabled))
  btn.setAttribute('aria-label', tiltEnabled ? 'Disable tilt steering' : 'Enable tilt steering')
}

async function setSound(on) {
  soundOn = on
  syncSoundUI()
  if (on) {
    await audio.start()
    audio.setMuted(false)
  } else {
    audio.setMuted(true)
  }
}

function handleOrientation(e) {
  if (!tiltEnabled) return
  if (e.beta == null || e.gamma == null) return
  if (!tiltBase) tiltBase = { beta: e.beta, gamma: e.gamma }
  let x = e.gamma - tiltBase.gamma
  let y = e.beta - tiltBase.beta
  const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0
  if (angle === 90) {
    const nx = y
    y = -x
    x = nx
  } else if (angle === -90 || angle === 270) {
    const nx = -y
    y = x
    x = nx
  }
  tilt.x = THREE.MathUtils.clamp(x / 21, -1, 1)
  tilt.y = THREE.MathUtils.clamp(-y / 23, -1, 1)
}

async function setTilt(on, fromGesture = false) {
  if (on) {
    if (!('DeviceOrientationEvent' in window)) {
      showToast('This little device has no tilt sensor.')
      return false
    }
    try {
      if (isIOS && typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (!fromGesture) {
          showPermissionNote('Tap the tilt button once more to allow motion access.')
          return false
        }
        const permission = await DeviceOrientationEvent.requestPermission()
        if (permission !== 'granted') {
          showPermissionNote('Motion access is off. You can still wander with the joystick.')
          syncTiltUI()
          return false
        }
      }
      if (!tiltReady) {
        window.addEventListener('deviceorientation', handleOrientation, true)
        tiltReady = true
      }
      tiltBase = null
      tiltEnabled = true
      syncTiltUI()
      if (started) showToast('Tilt steering on · lean gently to wander')
      return true
    } catch (err) {
      console.warn('Motion permission was not granted.', err)
      showPermissionNote('Motion access is off. The joystick is always here.')
      syncTiltUI()
      return false
    }
  }
  tiltEnabled = false
  tilt.x = 0
  tilt.y = 0
  tiltBase = null
  syncTiltUI()
  if (started) showToast('Tilt steering off')
  return false
}

function toggleTime() {
  night = !night
  world.setTimeMode(night ? 'night' : 'day')
  const btn = document.querySelector('#btn-time')
  btn.classList.toggle('is-night', night)
  btn.setAttribute('aria-label', night ? 'Bring back the sun' : 'Turn the light to moonrise')
  timeLabel.textContent = night ? 'moonrise' : 'golden hour'
  audio.timeOfDay(night)
  showToast(night ? 'The meadow turns to moonlight.' : 'The sun returns, warm as before.')
}

function openHelp() {
  helpOpen = true
  helpEl.classList.add('is-open')
  helpEl.setAttribute('aria-hidden', 'false')
  resetJoystick()
  keys.clear()
}

function closeHelp() {
  helpOpen = false
  helpEl.classList.remove('is-open')
  helpEl.setAttribute('aria-hidden', 'true')
}

function resetJoystick() {
  joy.x = 0
  joy.y = 0
  joy.active = false
  joy.pointer = null
  joystickEl.classList.remove('is-active')
  joystickStick.style.transform = 'translate(-50%, -50%)'
}

function updateJoystick(e) {
  const rect = joystickEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  let dx = (e.clientX - cx) / (rect.width * 0.36)
  let dy = (e.clientY - cy) / (rect.height * 0.36)
  const mag = Math.hypot(dx, dy)
  if (mag > 1) {
    dx /= mag
    dy /= mag
  }
  joy.x = dx
  joy.y = dy
  joystickStick.style.transform = `translate(calc(-50% + ${dx * 38}px), calc(-50% + ${dy * 38}px))`
}

joystickEl.addEventListener('pointerdown', (e) => {
  if (helpOpen) return
  e.preventDefault()
  e.stopPropagation()
  joy.active = true
  joy.pointer = e.pointerId
  joystickEl.classList.add('is-active')
  joystickEl.setPointerCapture(e.pointerId)
  updateJoystick(e)
})

joystickEl.addEventListener('pointermove', (e) => {
  if (!joy.active || e.pointerId !== joy.pointer) return
  e.preventDefault()
  updateJoystick(e)
})

function endJoystick(e) {
  if (e.pointerId !== joy.pointer) return
  e.preventDefault()
  resetJoystick()
}
joystickEl.addEventListener('pointerup', endJoystick)
joystickEl.addEventListener('pointercancel', endJoystick)
joystickEl.addEventListener('lostpointercapture', (e) => {
  if (joy.pointer === e.pointerId) resetJoystick()
})

function hop() {
  if (!started || helpOpen) return
  if (hare.jump()) {
    audio.hop()
    hopEl.classList.add('is-pressed')
    setTimeout(() => hopEl.classList.remove('is-pressed'), 160)
    burstAtFeet(4)
  }
}

hopEl.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  e.stopPropagation()
  hop()
})

// Camera orbit, pinch, and tap-to-pet.
const activePointers = new Map()
let dragState = null
let pinchState = null

canvas.addEventListener('pointerdown', (e) => {
  if (!started || helpOpen) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  canvas.setPointerCapture(e.pointerId)
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (activePointers.size === 1) {
    dragState = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      yaw: cameraYaw.target,
      pitch: cameraPitch.target,
      moved: 0,
      time: performance.now(),
    }
  } else if (activePointers.size === 2) {
    const pts = [...activePointers.values()]
    pinchState = { distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), start: cameraDistance.target }
    dragState = null
  }
})

canvas.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinchState && activePointers.size === 2) {
    const pts = [...activePointers.values()]
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    const ratio = pinchState.distance / Math.max(1, dist)
    cameraDistance.target = THREE.MathUtils.clamp(pinchState.start * ratio, 2.45, 6.2)
    return
  }
  if (!dragState || e.pointerId !== dragState.id) return
  const dx = e.clientX - dragState.x
  const dy = e.clientY - dragState.y
  dragState.moved += Math.abs(dx) + Math.abs(dy)
  cameraYaw.target = dragState.yaw - dx * 0.0062
  cameraYaw.current = cameraYaw.target
  cameraPitch.target = THREE.MathUtils.clamp(dragState.pitch + dy * 0.0042, 0.035, 0.84)
  cameraPitch.current = cameraPitch.target
  dragState.x = e.clientX
  dragState.y = e.clientY
  hintEl.classList.add('is-faded')
})

function finishPointer(e) {
  if (!activePointers.has(e.pointerId)) return
  activePointers.delete(e.pointerId)
  if (pinchState && activePointers.size < 2) pinchState = null
  if (dragState && dragState.id === e.pointerId) {
    const tap =
      dragState.moved < 7 &&
      performance.now() - dragState.time < 380 &&
      activePointers.size === 0
    dragState = null
    if (tap) tryPet(e.clientX, e.clientY)
  }
  if (activePointers.size === 0) {
    dragState = null
    pinchState = null
  }
}
canvas.addEventListener('pointerup', finishPointer)
canvas.addEventListener('pointercancel', finishPointer)

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!started) return
    e.preventDefault()
    cameraDistance.target = THREE.MathUtils.clamp(cameraDistance.target + e.deltaY * 0.0025, 2.45, 6.2)
  },
  { passive: false },
)

function tryPet(clientX, clientY) {
  const rect = canvas.getBoundingClientRect()
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointerNdc, camera)
  const hits = raycaster.intersectObject(hare.group, true)
  if (!hits.length) return
  if (!hare.pet()) return
  const p = new THREE.Vector3(0, 0.9, -0.3)
  hare.group.localToWorld(p)
  p.y += hare.jumpHeight
  hearts.burst(p, { count: 9, speed: 0.32, up: 0.35, spread: 0.22, size: 1.15, life: 1.5 })
  audio.pet()
  petCount++
  if (petCount === 1) showToast(petLines[0])
  else if (petCount === 4) showToast(petLines[1])
  else if (petCount === 8) showToast(petLines[2])
  hintEl.classList.add('is-faded')
}

function burstAtFeet(count = 5) {
  const p = hare.group.position.clone()
  p.y = 0.04
  dust.burst(p, { count, speed: 0.4, up: 0.25, spread: 0.18, size: 0.7, life: 0.75 })
}

// Intro controls.
enterEl.addEventListener('click', async () => {
  if (!ready || started) return
  started = true
  document.body.classList.add('playing')
  introEl.setAttribute('aria-hidden', 'true')
  hudEl.setAttribute('aria-hidden', 'false')
  cameraYaw.target = 0.16
  cameraPitch.target = 0.28
  cameraDistance.target = isMobile ? 4.5 : 4.75
  if (soundOn) await setSound(true)
  if (tiltEnabled) {
    // Already granted from the intro toggle; if not, ask now from a fresh gesture.
    await setTilt(true, true)
  }
  resetJoystick()
  hintEl.classList.remove('is-hidden')
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => hintEl.classList.add('is-faded'), 14000)
  showToast('No objectives. The afternoon is yours.', 3200)
})

document.querySelector('#pref-sound').addEventListener('click', () => {
  setSound(!soundOn)
})

document.querySelector('#pref-tilt').addEventListener('click', async () => {
  const next = !tiltEnabled
  if (next) await setTilt(true, true)
  else await setTilt(false)
})

document.querySelector('#btn-sound').addEventListener('click', () => {
  setSound(!soundOn)
})

document.querySelector('#btn-tilt').addEventListener('click', async () => {
  const next = !tiltEnabled
  if (next) await setTilt(true, true)
  else await setTilt(false)
})

document.querySelector('#btn-time').addEventListener('click', toggleTime)
document.querySelector('#btn-help').addEventListener('click', openHelp)
document.querySelector('#help-close').addEventListener('click', closeHelp)
helpEl.querySelector('.sheet-backdrop').addEventListener('click', closeHelp)

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && helpOpen) {
    closeHelp()
    return
  }
  if (!started) {
    if ((e.code === 'Enter' || e.code === 'Space') && ready) {
      e.preventDefault()
      enterEl.click()
    }
    return
  }
  if (helpOpen) return
  keys.add(e.code)
  if (e.code === 'Space') {
    e.preventDefault()
    hop()
  }
  if (e.code === 'KeyN') toggleTime()
  if (e.code === 'KeyM') setSound(!soundOn)
  if (e.code === 'KeyH' || e.code === 'Slash') openHelp()
})

window.addEventListener('keyup', (e) => keys.delete(e.code))
window.addEventListener('blur', () => {
  keys.clear()
  resetJoystick()
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDPR))
  renderer.setSize(window.innerWidth, window.innerHeight)
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.clear()
    resetJoystick()
    audio.setMuted(true)
  } else if (started && soundOn) {
    audio.setMuted(false)
  }
})

function updateMovement(dt) {
  if (!started || helpOpen) {
    velocity.multiplyScalar(Math.exp(-8 * dt))
    return
  }

  let ix = joy.x
  let iy = -joy.y
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1
  if (keys.has('KeyW') || keys.has('ArrowUp')) iy += 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) iy -= 1

  if (tiltEnabled) {
    ix += tilt.x * 0.82
    iy += tilt.y * 0.82
  }

  resampleInput()
  function resampleInput() {
    let mag = Math.hypot(ix, iy)
    if (mag > 1) {
      ix /= mag
      iy /= mag
      mag = 1
    }
    if (mag < 0.11) {
      ix = 0
      iy = 0
      mag = 0
    } else {
      const remap = (mag - 0.11) / 0.89
      ix = (ix / mag) * remap
      iy = (iy / mag) * remap
      mag = remap
    }
    moveDir.set(0, 0, 0)
    if (mag > 0.01) {
      const forward = new THREE.Vector3(-Math.sin(cameraYaw.target), 0, -Math.cos(cameraYaw.target))
      const right = new THREE.Vector3(Math.cos(cameraYaw.target), 0, -Math.sin(cameraYaw.target))
      moveDir.copy(forward).multiplyScalar(iy).addScaledVector(right, ix).normalize()
    }

    const pondDist = Math.hypot(hare.group.position.x - POND.x, hare.group.position.z - POND.z)
    const inWater = pondDist < POND.radius - 0.15
    const speedMax = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3.35 : 2.95
    const targetSpeed = mag * speedMax * (inWater ? 0.58 : 1)
    velocity.x = THREE.MathUtils.damp(velocity.x, moveDir.x * targetSpeed, 9, dt)
    velocity.z = THREE.MathUtils.damp(velocity.z, moveDir.z * targetSpeed, 9, dt)
    const speed = Math.hypot(velocity.x, velocity.z)

    if (mag > 0.02) {
      const heading = Math.atan2(-moveDir.x, -moveDir.z)
      hare.update(dt, time, { moveAmount: Math.min(1, mag * 1.4), speed, heading })
      hintEl.classList.add('is-faded')
    } else {
      hare.update(dt, time, { moveAmount: 0, speed, heading: hare.heading })
    }

    const nextX = hare.group.position.x + velocity.x * dt
    const nextZ = hare.group.position.z + velocity.z * dt
    const r = Math.hypot(nextX, nextZ)
    if (r > 15.1) {
      const k = 15.1 / r
      hare.group.position.x = nextX * k
      hare.group.position.z = nextZ * k
      velocity.multiplyScalar(0.3)
    } else {
      hare.group.position.x = nextX
      hare.group.position.z = nextZ
    }

    // Footfalls, dust, and little splashes.
    const grounded = hare.grounded
    if (grounded && !wasGrounded) {
      audio.land()
      if (inWater) {
        splash.burst(hare.group.position.clone().setY(0.08), { count: 20, speed: 1.1, up: 1.4, spread: 0.2, size: 1.2, life: 0.6 })
        audio.splash()
      } else {
        burstAtFeet(9)
      }
      hare.landSquash = 1
    }
    wasGrounded = grounded

    stepTimer -= dt
    if (grounded && speed > 0.45 && stepTimer <= 0) {
      stepTimer = 0.2 + (1 - Math.min(1, speed / 3)) * 0.15
      if (inWater) {
        splash.burst(hare.group.position.clone().setY(0.08), { count: 4, speed: 0.45, up: 0.55, spread: 0.16, size: 0.7, life: 0.45 })
      } else {
        burstAtFeet(2)
      }
    }
    splashTimer -= dt
    if (inWater && splashTimer <= 0) {
      splashTimer = 0.6
      audio.splash()
      splash.burst(hare.group.position.clone().setY(0.07), { count: 6, speed: 0.7, up: 0.9, spread: 0.24, size: 0.8, life: 0.55 })
    }

    world.contactShadow.visible = !inWater
  }
}

function updateCamera(dt) {
  const target = new THREE.Vector3(hare.group.position.x, hare.group.position.y + 0.86, hare.group.position.z)
  if (!started) {
    const base = Math.PI - 0.42 + Math.sin(time * 0.08) * 0.11
    cameraYaw.current = base
    cameraYaw.target = base
    cameraPitch.current = 0.13 + Math.sin(time * 0.11) * 0.012
    cameraPitch.target = cameraPitch.current
    cameraDistance.current = 4.15
    cameraDistance.target = 4.15
    target.x -= 0.34
    cameraTarget.lerp(target, 1 - Math.exp(-3 * dt))
  } else {
    const dx = Math.atan2(Math.sin(cameraYaw.target - cameraYaw.current), Math.cos(cameraYaw.target - cameraYaw.current))
    cameraYaw.current += dx * (1 - Math.exp(-2.8 * dt))
    cameraPitch.current = THREE.MathUtils.damp(cameraPitch.current, cameraPitch.target, 10, dt)
    cameraDistance.current = THREE.MathUtils.damp(cameraDistance.current, cameraDistance.target, 6, dt)
    cameraTarget.lerp(target, 1 - Math.exp(-7 * dt))
  }

  const cp = Math.cos(cameraPitch.current)
  const desired = new THREE.Vector3(
    cameraTarget.x + Math.sin(cameraYaw.current) * cameraDistance.current * cp,
    cameraTarget.y + Math.sin(cameraPitch.current) * cameraDistance.current + 0.06,
    cameraTarget.z + Math.cos(cameraYaw.current) * cameraDistance.current * cp,
  )
  if (desired.y < 0.42) desired.y = 0.42

  camera.position.lerp(desired, 1 - Math.exp(-(started ? 5.5 : 2.7) * dt))
  cameraLook.lerp(cameraTarget, 1 - Math.exp(-8 * dt))
  camera.lookAt(cameraLook)
}

function applyFurEnvironment() {
  if (!hare.fur) return
  const pal = world.getPalette()
  hare.fur.setEnvironment({
    sunColor: pal.sun,
    sunDir: pal.sunDir,
    skyColor: pal.hemiSky,
    groundColor: pal.hemiGround,
    fogColor: pal.fog,
    fogDensity: 0.017,
  })
}

function renderLoop(now) {
  requestAnimationFrame(renderLoop)
  const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000))
  last = now
  time += dt

  if (ready) {
    if (started) {
      updateMovement(dt)
    } else {
      hare.update(dt, time, { moveAmount: 0, speed: 0, heading: hare.heading })
    }
    world.update(dt, time, hare.group.position, hare.grounded, hare.jumpHeight)
    hearts.update(dt)
    dust.update(dt)
    splash.update(dt)
    applyFurEnvironment()
    audio.update(time)
    updateCamera(dt)
  }

  renderer.render(scene, camera)
}

async function init() {
  syncSoundUI()
  syncTiltUI()
  setLoading(8, 'waking the grass')
  const loader = new GLTFLoader()
  loader.manager.onProgress = (_url, loaded, total) => {
    const pct = total ? (loaded / total) * 100 : 40
    setLoading(12 + pct * 0.58, 'combing the fur')
  }
  try {
    setLoading(16, 'combing the fur')
    await hare.load(loader, '/models/hare.glb')
    setLoading(78, 'placing the stones')
    await new Promise((resolve) => setTimeout(resolve, 120))
    setLoading(100, 'letting the light in')
    await new Promise((resolve) => setTimeout(resolve, 420))
    ready = true
    enterEl.disabled = false
    document.body.classList.add('ready')
    introEl.setAttribute('aria-hidden', 'false')
    loaderEl.setAttribute('aria-hidden', 'true')
    last = performance.now()
    requestAnimationFrame(renderLoop)
  } catch (err) {
    console.error(err)
    loadNote.textContent = 'the hare is hiding — please refresh'
    loaderEl.classList.add('has-error')
  }
}

// Warm up the render loop so the loading card is not a black rectangle if
// something goes wrong; the world is already built above.
renderer.render(scene, camera)
init()

window.__thistle = { scene, renderer, camera, hare, world }

