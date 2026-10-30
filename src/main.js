import * as THREE from 'three';
import './style.css';
import { createWorld } from './world.js';
import { loadRabbit } from './rabbit.js';
import { Controls } from './controls.js';
import { MeadowAudio } from './audio.js';
import { DustField } from './effects.js';
import { clamp, damp, easeInOutCubic, terrainHeight, terrainNormal } from './utils.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const loading = $('loading');
const loadingBar = $('loadingBar');
const loadingPercent = $('loadingPercent');
const startButton = $('enterButton');
const intro = $('intro');
const infoPanel = $('infoPanel');
const motionToggle = $('motionToggle');
const motionSwitch = $('motionSwitch');
const soundToggle = $('soundToggle');
const infoButton = $('infoButton');
const toastElement = $('toast');
const cameraHint = $('cameraHint');
const rotateNote = $('rotateNote');

const isTouch = window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0;
const isNarrow = Math.min(window.innerWidth, window.innerHeight) < 820;
const mobile = isTouch || isNarrow;

const quality = mobile
  ? {
      grass: 9200,
      grassScale: 0.93,
      flowerScale: 0.74,
      treeScale: 0.84,
      rockScale: 0.8,
      shadowSize: 1024,
      furLayers: 6,
      pixelRatio: 1.65,
    }
  : {
      grass: 14800,
      grassScale: 1,
      flowerScale: 1,
      treeScale: 1,
      rockScale: 1,
      shadowSize: 2048,
      furLayers: 9,
      pixelRatio: 2,
    };

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.environmentIntensity = 0.58;
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.045, 220);

let world = null;
let rabbit = null;
let controls = null;
let dust = null;
const audio = new MeadowAudio();

let state = 'loading';
let ready = false;
let soundOn = true;
let toastTimer = 0;
let elapsed = 0;
let lastGround = true;
let transition = null;
let introTime = 0;
let hasShownRotateNote = false;
let degradeDone = false;
let fpsAccumulator = 0;
let fpsFrames = 0;
let fpsTimer = 0;

const HERO = {
  yaw: 0.7,
  pitch: 0.18,
  distance: 2.42,
  targetY: 0.285,
};

function setProgress(value) {
  const percent = Math.round(clamp(value, 0, 1) * 100);
  loadingBar.style.transform = `scaleX(${clamp(value, 0, 1)})`;
  loadingPercent.textContent = `${percent}%`;
}

function showToast(message, duration = 3200) {
  toastElement.textContent = message;
  toastElement.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove('is-visible'), duration);
}

function setMotionUI(enabled) {
  motionToggle.setAttribute('aria-pressed', String(enabled));
  motionSwitch.setAttribute('aria-checked', String(enabled));
  motionToggle.classList.toggle('is-on', enabled);
}

function setSoundUI() {
  soundToggle.setAttribute('aria-pressed', String(soundOn));
  soundToggle.classList.toggle('is-muted', !soundOn);
}

function placeHeroCamera(time) {
  const target = new THREE.Vector3(0, terrainHeight(0, 0) + HERO.targetY, 0);
  const yaw = HERO.yaw + Math.sin(time * 0.055) * 0.018;
  const pitch = HERO.pitch + Math.sin(time * 0.042 + 0.8) * 0.004;
  const cos = Math.cos(pitch);
  camera.position.set(
    target.x + Math.sin(yaw) * cos * HERO.distance,
    target.y + Math.sin(pitch) * HERO.distance,
    target.z + Math.cos(yaw) * cos * HERO.distance
  );
  camera.lookAt(target.x - 0.14, target.y + 0.012, target.z);
}

function openPanel() {
  infoPanel.classList.add('is-open');
  infoPanel.setAttribute('aria-hidden', 'false');
  if (controls) controls.enabled = false;
}

function closePanel() {
  infoPanel.classList.remove('is-open');
  infoPanel.setAttribute('aria-hidden', 'true');
  if (controls && state === 'playing') controls.enabled = true;
}

async function toggleMotion() {
  if (!controls) return;
  const result = await controls.toggleTilt();
  if (result.ok === false) {
    showToast(result.reason, 3800);
    setMotionUI(controls.tiltEnabled);
    return;
  }
  setMotionUI(result.enabled);
  showToast(result.enabled ? 'Tilt steering on — tip gently to drift.' : 'Tilt steering off.');
}

function enterMeadow() {
  if (!ready || state === 'playing') return;
  state = 'playing';
  intro.classList.add('is-leaving');
  intro.setAttribute('aria-hidden', 'true');
  document.body.classList.add('playing');
  $('hud').setAttribute('aria-hidden', 'false');
  $('brand').setAttribute('aria-hidden', 'false');
  startButton.blur();
  navigator.vibrate?.(12);

  if (controls) {
    controls.enabled = true;
    controls.yaw = HERO.yaw;
    controls.pitch = HERO.pitch;
    controls.distance = HERO.distance;
    controls.targetDistance = 2.55;
    controls.manualTimer = 3.2;
    transition = {
      time: 0,
      duration: 2.6,
      fromYaw: HERO.yaw,
      fromPitch: HERO.pitch,
      fromDistance: HERO.distance,
      toYaw: Math.PI,
      toPitch: 0.235,
      toDistance: 2.55,
    };
  }

  window.setTimeout(() => {
    intro.classList.remove('is-visible');
    intro.classList.remove('is-leaving');
  }, 1150);

  audio.start().catch(() => {});
  audio.setMuted(!soundOn);

  window.setTimeout(() => {
    if (!controls?.hasLooked) showToast('No objectives. The meadow is yours.', 3700);
  }, 2600);

  window.setTimeout(() => {
    if (!hasShownRotateNote && window.innerHeight > window.innerWidth && isTouch) {
      hasShownRotateNote = true;
      rotateNote.classList.add('is-visible');
      window.setTimeout(() => rotateNote.classList.remove('is-visible'), 6500);
    }
  }, 5200);
}

function dampAngle(current, target, lambda, dt) {
  let delta = (target - current + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  delta -= Math.PI;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function resolvePosition(position) {
  if (!world) return;
  for (const collider of world.colliders) {
    const dx = position.x - collider.x;
    const dz = position.z - collider.z;
    const distance = Math.hypot(dx, dz);
    const minimum = collider.radius + 0.22;
    if (distance < minimum && distance > 0.0001) {
      const push = (minimum - distance) / distance;
      position.x += dx * push;
      position.z += dz * push;
    }
  }
  const radius = Math.hypot(position.x, position.z);
  if (radius > 36) {
    position.x = (position.x / radius) * 36;
    position.z = (position.z / radius) * 36;
  }
}

function handleMovement(dt) {
  if (!rabbit || !controls || state !== 'playing') return new THREE.Vector3();
  const direction = controls.cameraRelativeMove();
  const magnitude = Math.min(1, direction.length());
  const moveForAnimation = direction.clone().multiplyScalar(magnitude);

  if (magnitude > 0.045) {
    direction.normalize();
    const targetHeading = Math.atan2(direction.x, direction.z);
    rabbit.player.rotation.y = dampAngle(rabbit.player.rotation.y, targetHeading, 12, dt);
    const speed = (rabbit.onGround ? 1.62 : 0.92) * magnitude;
    const next = rabbit.player.position.clone();
    next.x += direction.x * speed * dt;
    next.z += direction.z * speed * dt;
    resolvePosition(next);
    rabbit.player.position.x = next.x;
    rabbit.player.position.z = next.z;
  }

  if (controls.consumeHop()) {
    if (rabbit.hop()) {
      audio.hop();
      const p = rabbit.player.position;
      dust.spawn({ x: p.x, y: p.y, z: p.z }, 0.42);
    }
  }

  const ground = terrainHeight(rabbit.player.position.x, rabbit.player.position.z);
  rabbit.update(dt, elapsed, moveForAnimation, ground);

  if (!lastGround && rabbit.onGround) {
    audio.land();
  }
  lastGround = rabbit.onGround;

  const requests = rabbit.takeDustRequests();
  if (requests.length) {
    for (const request of requests) dust.spawn(rabbit.player.position, request.strength);
  }
  return moveForAnimation;
}

function updateCamera(dt, isMoving) {
  if (!controls) return;
  if (state === 'intro' || state === 'loading') {
    placeHeroCamera(introTime);
    return;
  }

  if (transition) {
    transition.time += dt;
    const t = clamp(transition.time / transition.duration, 0, 1);
    const e = easeInOutCubic(t);
    controls.yaw = transition.fromYaw + ((transition.toYaw - transition.fromYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * e;
    controls.pitch = transition.fromPitch + (transition.toPitch - transition.fromPitch) * e;
    controls.distance = transition.fromDistance + (transition.toDistance - transition.fromDistance) * e;
    controls.manualTimer = Math.max(controls.manualTimer, 1.2);
    if (t >= 1 || controls.hasLooked) {
      transition = null;
      controls.manualTimer = Math.max(controls.manualTimer, 0.7);
    }
  }

  controls.update(dt, rabbit.player.position, rabbit.player.rotation.y, isMoving);
}

function maybeDegradeQuality(dt) {
  if (!rabbit || !world || state !== 'playing' || degradeDone) return;
  fpsTimer += dt;
  if (fpsTimer < 4.5) return;
  const fps = fpsFrames / fpsAccumulator;
  fpsAccumulator = 0;
  fpsFrames = 0;
  fpsTimer = 0;
  if (fps < 36) {
    degradeDone = true;
    rabbit.setFurLayers(Math.max(3, rabbit.getFurLayers() - 3));
    world.grass.userData.reduce?.();
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(width, height, false);
}

let lastFrameTime = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  elapsed += dt;
  let movingNow = false;

  if (state === 'intro' || state === 'loading') {
    introTime += dt;
    if (rabbit) rabbit.update(dt, elapsed, new THREE.Vector3(), terrainHeight(0, 0));
    updateCamera(dt, false);
  } else if (state === 'playing') {
    const moving = handleMovement(dt);
    movingNow = moving.length() > 0.045;
    if (dust) dust.update(dt);
    maybeDegradeQuality(dt);
    fpsAccumulator += dt;
    fpsFrames += 1;
    updateCamera(dt, movingNow);
  }

  if (world) world.update(dt, elapsed, rabbit?.player.position);
  renderer.render(scene, camera);
}

async function boot() {
  setProgress(0.05);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  setProgress(0.12);

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    if (total > 0) setProgress(0.14 + (loaded / total) * 0.62);
  };
  manager.onError = () => {
    loadingPercent.textContent = 'A nettle in the works';
  };

  try {
    const rabbitPromise = loadRabbit({ scene, manager, quality });
    setProgress(0.2);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    world = createWorld({ scene, renderer, quality });
    setProgress(0.6);
    rabbit = await rabbitPromise;
    setProgress(0.86);

    rabbit.player.position.set(0, terrainHeight(0, 0), 0);
    rabbit.player.rotation.y = 0;
    lastGround = true;
    dust = new DustField(scene);

    controls = new Controls({
      camera,
      canvas,
      joystick: $('joystick'),
      knob: $('joystickKnob'),
      hopButton: $('hopButton'),
      recenterButton: $('recenterButton'),
      onHop: () => {},
      onFirstLook: () => {
        cameraHint.classList.add('is-hidden');
      },
      toast: showToast,
    });
    setMotionUI(false);
    setSoundUI();

    placeHeroCamera(0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    setProgress(1);
    ready = true;
    state = 'intro';
    startButton.disabled = false;
    document.body.dataset.sceneState = 'ready';
    document.body.dataset.rabbitFurLayers = String(rabbit.getFurLayers());

    window.setTimeout(() => {
      loading.classList.add('is-done');
      intro.classList.add('is-visible');
    }, 350);

    window.__hollow = {
      scene,
      camera,
      renderer,
      rabbit,
      world,
      controls,
      audio,
      get state() {
        return state;
      },
      get furLayers() {
        return rabbit?.getFurLayers();
      },
    };
  } catch (error) {
    console.error('Could not grow Clover Hollow', error);
    loading.classList.add('is-error');
    loadingPercent.textContent = 'The meadow could not grow';
    startButton.disabled = true;
    document.body.dataset.sceneState = 'error';
    showToast('Something went wrong loading the meadow. Please refresh.', 8000);
  }
}

// UI events.
startButton.addEventListener('click', enterMeadow);

$('hopButton').addEventListener('pointerdown', () => {
  if (state !== 'playing') return;
});

motionToggle.addEventListener('click', () => {
  toggleMotion();
});
motionSwitch.addEventListener('click', () => {
  toggleMotion();
});

soundToggle.addEventListener('click', () => {
  soundOn = !soundOn;
  audio.setMuted(!soundOn);
  setSoundUI();
  if (state === 'playing') showToast(soundOn ? 'Meadow sound on.' : 'Meadow sound off.', 1800);
});

infoButton.addEventListener('click', () => {
  openPanel();
});

for (const closer of document.querySelectorAll('[data-close-panel]')) {
  closer.addEventListener('click', closePanel);
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && infoPanel.classList.contains('is-open')) closePanel();
});

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

// Pause expensive rendering when hidden. The clock is clamped on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastFrameTime = performance.now();
});

// A lovely little detail: click or tap the meadow to hop, as long as the
// gesture was a tap and not a camera drag. This is handled inside Controls.

setProgress(0.02);
boot();
resize();

function animate() {
  frame();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
