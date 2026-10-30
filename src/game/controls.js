import { clamp } from './rng.js'

const TOUCH_LEFT_ZONE = 0.46

export function createControls({ onFirstGesture = () => {}, onToast = () => {} } = {}) {
  const state = {
    moveX: 0,
    moveY: 0,
    lookDX: 0,
    lookDY: 0,
    zoom: 0,
    hop: false,
    sniff: false,
    run: false,
    tiltX: 0,
    tiltY: 0,
    tiltEnabled: false
  }

  const keys = new Set()
  const lookPointers = new Map()
  let stickPointer = null
  let stickOrigin = { x: 0, y: 0 }
  let stickVec = { x: 0, y: 0 }
  let pinchDistance = 0
  let firstGestureDone = false

  const stickEl = document.getElementById('stick')
  const knobEl = document.getElementById('stickKnob')

  function firstGesture() {
    if (firstGestureDone) return
    firstGestureDone = true
    onFirstGesture()
  }

  function isUi(target) {
    return !!(target.closest && target.closest('[data-ui]'))
  }

  function showStick(x, y) {
    if (!stickEl) return
    stickEl.classList.add('active')
    stickEl.style.left = `${x}px`
    stickEl.style.top = `${y}px`
    if (knobEl) knobEl.style.transform = 'translate(-50%, -50%)'
  }

  function hideStick() {
    if (!stickEl) return
    stickEl.classList.remove('active')
    if (knobEl) knobEl.style.transform = 'translate(-50%, -50%)'
  }

  function updateStick(clientX, clientY) {
    const dx = clientX - stickOrigin.x
    const dy = clientY - stickOrigin.y
    const radius = 52
    const len = Math.hypot(dx, dy)
    const k = len > radius ? radius / len : 1
    stickVec.x = (dx * k) / radius
    stickVec.y = (-dy * k) / radius
    if (knobEl) {
      knobEl.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`
    }
  }

  function onPointerDown(e) {
    if (isUi(e.target)) return
    firstGesture()
    if (e.pointerType === 'mouse') {
      // Desktop: drag anywhere to look, keyboard to move.
      lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      e.target.setPointerCapture?.(e.pointerId)
      return
    }
    const leftZone = e.clientX < window.innerWidth * TOUCH_LEFT_ZONE
    if (leftZone && e.clientY > window.innerHeight * 0.16 && !stickPointer) {
      stickPointer = e.pointerId
      stickOrigin = { x: e.clientX, y: e.clientY }
      stickVec = { x: 0, y: 0 }
      showStick(e.clientX, e.clientY)
      e.target.setPointerCapture?.(e.pointerId)
      return
    }
    lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (lookPointers.size === 2) {
      const [a, b] = [...lookPointers.values()]
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
    }
    e.target.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e) {
    if (e.pointerType === 'mouse') {
      const p = lookPointers.get(e.pointerId)
      if (!p) return
      state.lookDX += e.clientX - p.x
      state.lookDY += e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      return
    }
    if (e.pointerId === stickPointer) {
      updateStick(e.clientX, e.clientY)
      return
    }
    const p = lookPointers.get(e.pointerId)
    if (!p) return
    if (lookPointers.size >= 2) {
      p.x = e.clientX
      p.y = e.clientY
      const [a, b] = [...lookPointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      state.zoom += (pinchDistance - d) * 0.006
      pinchDistance = d
      return
    }
    state.lookDX += e.clientX - p.x
    state.lookDY += e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
  }

  function onPointerUp(e) {
    if (e.pointerId === stickPointer) {
      stickPointer = null
      stickVec = { x: 0, y: 0 }
      hideStick()
    }
    lookPointers.delete(e.pointerId)
    if (lookPointers.size < 2) pinchDistance = 0
  }

  window.addEventListener('pointerdown', onPointerDown, { passive: true })
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('pointercancel', onPointerUp, { passive: true })
  window.addEventListener('contextmenu', (e) => {
    if (!isUi(e.target)) e.preventDefault()
  })

  window.addEventListener(
    'wheel',
    (e) => {
      if (isUi(e.target)) return
      state.zoom += e.deltaY * 0.0012
    },
    { passive: true }
  )

  window.addEventListener('keydown', (e) => {
    firstGesture()
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
    keys.add(e.code)
    if (e.code === 'Space' && !e.repeat) state.hop = true
    if (e.code === 'KeyF' && !e.repeat) state.sniff = true
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => {
    keys.clear()
    lookPointers.clear()
    stickPointer = null
    stickVec = { x: 0, y: 0 }
    hideStick()
  })

  // on-screen buttons
  for (const [id, action] of [
    ['btnHop', () => (state.hop = true)],
    ['btnSniff', () => (state.sniff = true)]
  ]) {
    const el = document.getElementById(id)
    if (!el) continue
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      firstGesture()
      action()
      el.classList.add('pressed')
      setTimeout(() => el.classList.remove('pressed'), 140)
    })
  }

  /* -------------------------------------------------------------- */
  /*  Accelerometer tilt (optional, iOS permission aware)            */
  /* -------------------------------------------------------------- */
  let baseBeta = null
  let baseGamma = null
  let tiltRaw = { x: 0, y: 0 }
  let tiltSmooth = { x: 0, y: 0 }
  let tiltHandler = null

  async function enableTilt() {
    if (!('DeviceOrientationEvent' in window)) {
      return { ok: false, message: 'This device has no motion sensor.' }
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const result = await DeviceOrientationEvent.requestPermission()
        if (result !== 'granted') {
          return { ok: false, message: 'Motion access was not granted.' }
        }
      }
    } catch (err) {
      return { ok: false, message: 'Motion access needs a tap on this button.' }
    }

    if (tiltHandler) window.removeEventListener('deviceorientation', tiltHandler)
    baseBeta = null
    baseGamma = null
    tiltRaw = { x: 0, y: 0 }
    let sawData = false
    tiltHandler = (e) => {
      if (e.beta == null || e.gamma == null) return
      sawData = true
      if (baseBeta == null) {
        baseBeta = e.beta
        baseGamma = e.gamma
      }
      const x = clamp((e.gamma - baseGamma) / 24, -1, 1)
      const y = clamp(-(e.beta - baseBeta) / 26, -1, 1)
      tiltRaw.x = Math.abs(x) < 0.06 ? 0 : x
      tiltRaw.y = Math.abs(y) < 0.06 ? 0 : y
    }
    window.addEventListener('deviceorientation', tiltHandler, true)
    await new Promise((r) => setTimeout(r, 450))
    if (!sawData) {
      window.removeEventListener('deviceorientation', tiltHandler)
      tiltHandler = null
      return { ok: false, message: 'No tilt data — this browser has no motion sensor.' }
    }
    state.tiltEnabled = true
    return { ok: true, message: 'Tilt on — lean to roam. Tap Tilt again to recenter.' }
  }

  function disableTilt() {
    if (tiltHandler) window.removeEventListener('deviceorientation', tiltHandler)
    tiltHandler = null
    state.tiltEnabled = false
    tiltRaw = { x: 0, y: 0 }
    tiltSmooth = { x: 0, y: 0 }
    return { ok: true, message: 'Tilt off' }
  }

  async function toggleTilt() {
    if (state.tiltEnabled) return disableTilt()
    return enableTilt()
  }

  function sample(dt) {
    let moveX = stickVec.x
    let moveY = stickVec.y
    if (keys.has('KeyA') || keys.has('ArrowLeft')) moveX -= 1
    if (keys.has('KeyD') || keys.has('ArrowRight')) moveX += 1
    if (keys.has('KeyW') || keys.has('ArrowUp')) moveY += 1
    if (keys.has('KeyS') || keys.has('ArrowDown')) moveY -= 1

    tiltSmooth.x += (tiltRaw.x - tiltSmooth.x) * Math.min(1, dt * 7)
    tiltSmooth.y += (tiltRaw.y - tiltSmooth.y) * Math.min(1, dt * 7)
    moveX += tiltSmooth.x * 0.85
    moveY += tiltSmooth.y * 0.85
    const m = Math.hypot(moveX, moveY)
    if (m > 1) {
      moveX /= m
      moveY /= m
    }

    const out = {
      moveX,
      moveY,
      lookDX: state.lookDX,
      lookDY: state.lookDY,
      zoom: state.zoom,
      hop: state.hop,
      sniff: state.sniff,
      run: keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stickVec.x, stickVec.y) > 0.92
    }
    state.lookDX = 0
    state.lookDY = 0
    state.zoom = 0
    state.hop = false
    state.sniff = false
    return out
  }

  function getTiltVector() {
    return { x: tiltSmooth.x, y: tiltSmooth.y }
  }

  return {
    sample,
    toggleTilt,
    disableTilt,
    getTiltVector,
    state,
    isTiltSupported: 'DeviceOrientationEvent' in window
  }
}
