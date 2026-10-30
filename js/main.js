import * as THREE from '../vendor/three.module.js';
import { createWorld, terrainHeight, WORLD_RADIUS } from './world.js';
import { Warden } from './warden.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

const ui = new UI();
const audio = new AudioEngine();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('scene'),
    antialias: !matchMedia('(pointer: coarse)').matches,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
} catch (error) {
  console.error(error);
  const loading = document.getElementById('loading');
  loading.innerHTML = '<div class="loading-mark">H</div><div class="loading-text">WebGL is not available in this browser</div>';
  throw error;
}

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || innerWidth < 820;
const pixelCap = isTouch ? 1.6 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = false;
renderer.setClearColor(0x050808, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1010, 0.0335);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.045, 280);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
scene.userData.isOccluded = (ax, az, bx, bz) => world.isOccluded(ax, az, bx, bz);

const input = new Input({
  joystick: document.getElementById('joystick'),
  knob: document.getElementById('joystick-knob'),
  btnSprint: document.getElementById('btn-sprint'),
  btnLamp: document.getElementById('btn-lamp'),
  btnUse: document.getElementById('btn-use'),
  btnPause: document.getElementById('btn-pause'),
}, {
  onPause: () => togglePause(),
  onLockChange: (locked) => {
    if (!locked && game.state === 'playing' && !input.isTouch) ui.setLockHint(true);
    else ui.setLockHint(false);
  },
  onRequestLock: () => { input.requestPointerLock(); ui.setLockHint(false); },
  onHidden: () => { if (game.state === 'playing') togglePause(); },
  onTiltStatus: (status) => handleTiltStatus(status),
  onButton: () => { if (audio.ready && audio.enabled) audio.click(); },
});

ui.setTouch(isTouch);

/* ---------------- Lantern model ---------------- */

const lantern = new THREE.Group();
{
  // Unlit prop materials keep the lantern readable against its own point light.
  const metal = new THREE.MeshBasicMaterial({ color: 0x17130f });
  const brass = new THREE.MeshBasicMaterial({ color: 0x5b4526 });
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0xffb469,
    transparent: true,
    opacity: 0.92,
    fog: false,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.045, 10), metal);
  base.position.y = -0.13;
  lantern.add(base);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.09, 0.19, 8), metal);
  body.position.y = -0.02;
  lantern.add(body);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.16, 9, 1, true), glassMat);
  glass.position.y = 0.0;
  lantern.add(glass);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.105, 0.06, 8), metal);
  top.position.y = 0.115;
  lantern.add(top);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 8), metal);
  cap.position.y = 0.18;
  lantern.add(cap);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.19, 4), brass);
    bar.position.set(Math.cos(a) * 0.077, 0.0, Math.sin(a) * 0.077);
    lantern.add(bar);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.008, 4, 14, Math.PI), brass);
  ring.position.y = 0.215;
  ring.rotation.z = 0;
  lantern.add(ring);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: world.textures.glow,
    color: 0xffb66b,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  glow.position.y = -0.01;
  glow.scale.set(0.2, 0.2, 1);
  lantern.add(glow);

  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: world.textures.flame,
    color: 0xffc078,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  }));
  flame.position.y = -0.01;
  flame.scale.set(0.085, 0.17, 1);
  lantern.add(flame);

  lantern.userData = { glass: glassMat, glow, flame };
  lantern.position.set(0.55, -0.34, -1.1);
  lantern.rotation.set(0.06, -0.2, -0.06);
  lantern.scale.setScalar(0.45);
  lantern.visible = false;
  camera.add(lantern);
}

const lanternLight = new THREE.PointLight(0xffb168, 0, 31, 2);
lanternLight.position.set(0.0, -0.2, -1.0);
camera.add(lanternLight);

/* ---------------- State ---------------- */

const game = {
  state: 'title',
  time: 0,
  relics: 0,
  oil: 1,
  stamina: 1,
  staminaLocked: false,
  lanternOn: true,
  soundOn: loadPref('hollowfall.sound', true),
  tiltWanted: loadPref('hollowfall.tilt', false),
  fear: 0,
  shake: 0,
  stepDistance: 0,
  bobPhase: 0,
  moveAmount: 0,
  wardenPending: 0,
  wardenAwoken: false,
  introStage: 0,
  deathElapsed: 0,
  deathShown: false,
  winElapsed: 0,
  winShown: false,
  boundaryCooldown: 0,
  titleTime: 0,
  lastHintAt: -100,
  lastVanishHint: -100,
};

const player = {
  pos: new THREE.Vector3(0, terrainHeight(0, 34), 34),
  yaw: 0,
  pitch: -0.02,
  vx: 0,
  vz: 0,
  speed: 0,
  eye: 1.62,
};

const warden = new Warden(scene, world.textures, {
  onCatch: () => triggerDeath(),
  onAwake: () => {
    game.shake = 0.5;
    if (audio.ready) {
      audio.stinger();
      audio.whisper(-0.4, 1.3);
    }
    if (game.time - game.lastHintAt > 4) {
      game.lastHintAt = game.time;
      ui.setSubtitle('It only moves when you look away.', 5.2, { hint: true, force: true });
    }
  },
  onVanish: () => {
    if (game.time - game.lastVanishHint > 20) {
      game.lastVanishHint = game.time;
      ui.setSubtitle('It is gone. That is not the same as safe.', 3.4, { hint: true, force: true });
    }
  },
  onReturn: () => {
    if (audio.ready && audio.enabled) audio.whisper(0.5, 0.9);
  },
});

/* ---------------- Camera and movement ---------------- */

function placeTitleCamera(time) {
  const x = Math.sin(time * 0.06) * 1.3;
  const z = 33.2 + Math.cos(time * 0.047) * 0.65;
  const y = terrainHeight(x, z);
  camera.position.set(x, y + 2.15 + Math.sin(time * 0.11) * 0.03, z);
  camera.rotation.set(
    0.012 + Math.sin(time * 0.09) * 0.005,
    Math.sin(time * 0.043) * 0.055,
    Math.sin(time * 0.051) * 0.006
  );
  camera.fov = 74;
  camera.updateProjectionMatrix();
}

function applyPlayerCamera(dt, time) {
  const moving = Math.min(1, Math.abs(player.speed) / 3.7);
  const bob = Math.sin(game.bobPhase * 2) * 0.036 * game.moveAmount;
  const sway = Math.cos(game.bobPhase) * 0.024 * game.moveAmount;
  const breathe = Math.sin(time * 1.25) * 0.0055;

  const fear = game.fear;
  const impact = game.shake;
  const shakeYaw = Math.sin(time * 31) * 0.0042 * fear + Math.sin(time * 19.3) * 0.0022 * fear + Math.sin(time * 43) * 0.006 * impact;
  const shakePitch = Math.cos(time * 37) * 0.0032 * fear + Math.cos(time * 47) * 0.005 * impact;
  const roll = -sway * 0.55 + Math.sin(time * 0.63) * 0.002 + Math.sin(time * 23) * 0.0025 * fear;

  camera.position.set(player.pos.x + sway, player.pos.y + player.eye + bob + breathe, player.pos.z);
  camera.rotation.set(player.pitch + shakePitch, player.yaw + shakeYaw, roll);
  camera.fov = 72;
  camera.updateProjectionMatrix();

  const portrait = camera.aspect < 0.8;
  const lanternSway = Math.sin(game.bobPhase) * 0.012 * game.moveAmount;
  lantern.position.set(
    (portrait ? 0.33 : 0.55) + lanternSway,
    (portrait ? -0.31 : -0.34) + Math.cos(game.bobPhase * 2) * 0.008 * game.moveAmount,
    -1.1
  );
  lantern.rotation.z = -0.06 - lanternSway * 1.7;
}

function resolveCollisions(pos) {
  for (let i = 0; i < world.colliders.length; i++) {
    const c = world.colliders[i];
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const min = c.r + 0.34;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = min - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
}

function updatePlayer(dt, time) {
  const look = input.consumeLook(dt);
  player.yaw -= look.x * input.lookSensitivity;
  player.pitch -= look.y * input.lookSensitivity;
  player.pitch = clamp(player.pitch, -1.12, 1.02);

  const move = input.getMovement();
  const moving = Math.hypot(move.x, move.y) > 0.06;

  const sprintRequested = input.getSprinting() && moving;
  if (game.stamina <= 0.008) game.staminaLocked = true;
  if (game.stamina > 0.32) game.staminaLocked = false;
  const sprinting = sprintRequested && !game.staminaLocked && game.stamina > 0.01;

  const speed = sprinting ? 6.15 : 3.72;
  const forwardX = -Math.sin(player.yaw);
  const forwardZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);

  const targetVx = (forwardX * move.y + rightX * move.x) * speed;
  const targetVz = (forwardZ * move.y + rightZ * move.x) * speed;
  const accel = moving ? 10 : 13;
  player.vx = lerp(player.vx, targetVx, Math.min(1, dt * accel));
  player.vz = lerp(player.vz, targetVz, Math.min(1, dt * accel));

  const intendedX = player.pos.x + player.vx * dt;
  const intendedZ = player.pos.z + player.vz * dt;
  player.pos.x = intendedX;
  player.pos.z = intendedZ;
  resolveCollisions(player.pos);

  const radius = Math.hypot(player.pos.x, player.pos.z);
  if (radius > WORLD_RADIUS - 1.5) {
    const k = (WORLD_RADIUS - 1.5) / radius;
    player.pos.x *= k;
    player.pos.z *= k;
    if (game.boundaryCooldown <= 0) {
      game.boundaryCooldown = 9;
      ui.setSubtitle('The fog folds you back. There is nothing out there but the dark.', 3.5, { hint: true, force: true });
    }
  }
  if (game.boundaryCooldown > 0) game.boundaryCooldown -= dt;

  player.pos.y = terrainHeight(player.pos.x, player.pos.z);
  player.speed = Math.hypot(player.vx, player.vz);
  const targetMove = moving ? Math.min(1, player.speed / 3.7) : 0;
  game.moveAmount += (targetMove - game.moveAmount) * Math.min(1, dt * 7);

  if (moving && player.speed > 0.2) {
    game.bobPhase += dt * (5.2 + player.speed * 0.9);
    game.stepDistance += player.speed * dt;
    const stride = sprinting ? 2.55 : 1.95;
    if (game.stepDistance > stride) {
      game.stepDistance = 0;
      if (audio.ready) audio.footstep(sprinting ? 1.25 : 0.85, Math.sin(game.bobPhase) * 0.1);
    }
  } else {
    game.bobPhase += dt * 0.7;
  }

  if (sprinting) {
    game.stamina = Math.max(0, game.stamina - dt * 0.145);
  } else {
    game.stamina = Math.min(1, game.stamina + dt * 0.1);
  }

  if (game.lanternOn && game.oil > 0) {
    game.oil = Math.max(0, game.oil - dt * 0.0072);
    if (game.oil <= 0) {
      game.lanternOn = false;
      ui.setLantern(false);
      ui.toast('The lantern gutters out', 2.6);
      if (audio.ready) audio.denied();
    }
  }

  if (input.consumeLamp()) toggleLantern();
}

function toggleLantern(force) {
  if (game.state !== 'playing') return;
  const next = typeof force === 'boolean' ? force : !game.lanternOn;
  if (next && game.oil <= 0.005) {
    ui.toast('No oil left. Find a shrine.', 2.4);
    if (audio.ready) audio.denied();
    return;
  }
  game.lanternOn = next;
  ui.setLantern(next);
  if (audio.ready) audio.click();
  if (next && game.time > 4) ui.setSubtitle('The light finds the path. It also finds you.', 2.8, { hint: true });
}

/* ---------------- Relics and gate ---------------- */

function objectiveTarget() {
  if (game.relics >= 3) {
    return { x: 0, z: 46 };
  }
  let best = null;
  let bestD = Infinity;
  for (const s of world.shrines) {
    if (s.taken) continue;
    const d = Math.hypot(player.pos.x - s.position.x, player.pos.z - s.position.z);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? { x: best.position.x, z: best.position.z } : { x: 0, z: 46 };
}

function updateObjectiveText() {
  if (game.relics === 0) ui.setObjectiveTitle('Gather the three bells');
  else if (game.relics === 1) ui.setObjectiveTitle('Two bells remain');
  else if (game.relics === 2) ui.setObjectiveTitle('One bell remains');
  else ui.setObjectiveTitle('Return to the hollow gate');
}

function takeRelic(shrine) {
  if (!shrine || shrine.taken) return;
  game.relics += 1;
  world.takeShrine(shrine);
  world.setGateCount(game.relics);
  ui.setBells(game.relics);
  updateObjectiveText();
  game.oil = Math.min(1, game.oil + 0.34);
  game.shake = 0.85;
  ui.flash(false);
  ui.setSubtitle(shrine.data.whisper, 5.2, { force: true });
  if (audio.ready) audio.pickup();
  if (navigator.vibrate) navigator.vibrate(30);

  if (game.relics === 1) {
    game.wardenPending = 2.4;
  } else if (game.relics === 2) {
    warden.repel(7);
    if (!game.wardenAwoken) game.wardenPending = 1.6;
    ui.setSubtitle('The gate is listening. It wants the last one.', 4, { hint: true, force: true });
  } else {
    warden.repel(9);
    if (audio.ready) audio.bell(146.83, 0.16);
    ui.setSubtitle('All three. Now go back through the dark.', 5, { hint: true, force: true });
    ui.toast('THE GATE HAS HEARD YOU', 3.6);
  }
}

function openGate() {
  if (game.state !== 'playing' || game.relics < 3) return;
  game.state = 'win';
  game.winElapsed = 0;
  game.winShown = false;
  input.setPlaying(false);
  ui.setPrompt(null);
  world.openGate();
  world.setGateCount(3);
  warden.root.visible = false;
  if (audio.ready) {
    audio.gateOpen();
    setTimeout(() => { if (game.state === 'win') audio.win(); }, 1600);
  }
  ui.flash(true);
  if (navigator.vibrate) navigator.vibrate([20, 60, 30]);
  ui.setFear(0);
}

/* ---------------- Warden and game update ---------------- */

function updateWarden(dt, time) {
  if (game.wardenPending > 0) {
    game.wardenPending -= dt;
    if (game.wardenPending <= 0 && !warden.active) {
      warden.activate(player.pos, camera, false);
      game.wardenAwoken = true;
      game.shake = 0.7;
      ui.setFear(0.5);
    }
  }

  if (game.wardenAwoken) {
    warden.update(dt, time, player.pos, camera, game.relics, game.lanternOn);
  }

  const active = warden.active && warden.root.visible && warden.repelTimer <= 0;
  const dist = warden.distance;
  const threat = active ? clamp((32 - dist) / 32, 0, 1) : 0;
  const fearTarget = active ? warden.fear : Math.max(0, warden.fear - dt * 0.3);
  game.fear += (fearTarget - game.fear) * Math.min(1, dt * 4);
  ui.setFear(game.fear);
  if (audio.ready) audio.update(dt, threat, warden.visibleToPlayer, active);
}

function updateInteraction() {
  const shrine = world.nearestShrine(player.pos, 3.15);
  const gateDist = Math.hypot(player.pos.x - 0, player.pos.z - 46);

  if (shrine) {
    ui.setPrompt(game.relics === 0 ? 'TAKE THE FIRST BELL' : 'TAKE THE BELL FRAGMENT', { useReady: true });
  } else if (gateDist < 7.4) {
    if (game.relics >= 3) {
      ui.setPrompt('OPEN THE HOLLOW GATE', { useReady: true });
    } else {
      ui.setPrompt(`THE GATE IS SEALED · ${3 - game.relics} BELL${3 - game.relics === 1 ? '' : 'S'} MISSING`, { sealed: true });
    }
  } else {
    ui.setPrompt(null);
  }

  if (input.consumeUse()) {
    if (shrine) {
      takeRelic(shrine);
    } else if (gateDist < 7.4) {
      if (game.relics >= 3) {
        openGate();
      } else if (audio.ready) {
        audio.denied();
        ui.setSubtitle('Three sockets. Three bells. It will not open for less.', 3.4, { hint: true, force: true });
      }
    }
  }
}

function updateHud() {
  ui.setOil(game.oil, game.oil <= 0.001);
  ui.setStamina(game.stamina);
  const target = objectiveTarget();
  ui.updateCompass(player.yaw, {
    x: target.x - player.pos.x,
    z: target.z - player.pos.z,
  });
}

function updatePlaying(dt, time) {
  game.time += dt;

  if (game.introStage === 0 && game.time > 1.1) {
    game.introStage = 1;
    ui.setSubtitle('The gate closed behind you. It always does.', 3.6, { force: true });
  } else if (game.introStage === 1 && game.time > 6.6) {
    game.introStage = 2;
    ui.setSubtitle('Three bells keep the vale asleep. Bring them back.', 3.8, { hint: true });
  }

  updatePlayer(dt, time);
  applyPlayerCamera(dt, time);
  updateWarden(dt, time);
  if (game.state !== 'playing') return;
  updateInteraction();
  updateHud();

  game.shake = Math.max(0, game.shake - dt * 2.2);
}

function updateTitle(dt, time) {
  game.titleTime += dt;
  placeTitleCamera(game.titleTime);
  warden.visual.position.y = Math.sin(time * 0.7) * 0.018;
  warden.eyeGlow.material.opacity = 0.46 + Math.sin(time * 2.1) * 0.12;
  warden.root.rotation.y = 0;
  lantern.visible = false;
}

function updateDeath(dt, time) {
  game.deathElapsed += dt;
  const headPos = new THREE.Vector3();
  warden.head.getWorldPosition(headPos);
  const shake = Math.max(0.12, 0.9 - game.deathElapsed * 0.5);
  camera.position.set(
    player.pos.x + Math.sin(time * 41) * 0.03 * shake,
    player.pos.y + 1.45 + Math.cos(time * 37) * 0.02 * shake,
    player.pos.z
  );
  const target = headPos.clone();
  target.x += Math.sin(time * 29) * 0.05;
  target.y += Math.cos(time * 31) * 0.05;
  camera.lookAt(target);
  camera.rotation.z += Math.sin(time * 17) * 0.01;
  camera.fov = lerp(camera.fov, 58, Math.min(1, dt * 2.4));
  camera.updateProjectionMatrix();

  warden.arms[0].rotation.x = lerp(warden.arms[0].rotation.x, -1.25, Math.min(1, dt * 3));
  warden.arms[1].rotation.x = lerp(warden.arms[1].rotation.x, -1.25, Math.min(1, dt * 3));
  warden.head.rotation.z = Math.sin(time * 9) * 0.08;

  if (!game.deathShown && game.deathElapsed > 1.25) {
    game.deathShown = true;
    ui.showDeath({
      time: game.time,
      bells: game.relics,
      distance: warden.distance,
    });
  }
}

function updateWin(dt, time) {
  game.winElapsed += dt;
  const gateY = terrainHeight(0, 46) + 3.4;
  camera.position.y = lerp(camera.position.y, player.pos.y + 2.0, Math.min(1, dt * 0.7));
  const target = new THREE.Vector3(0, gateY, 46);
  const m = new THREE.Matrix4().lookAt(camera.position, target, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  camera.quaternion.slerp(q, Math.min(1, dt * 1.1));
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(time * 4) * 0.002);
  camera.quaternion.multiply(roll);
  camera.fov = lerp(camera.fov, 64, Math.min(1, dt * 0.8));
  camera.updateProjectionMatrix();

  if (!game.winShown && game.winElapsed > 2.6) {
    game.winShown = true;
    ui.showWin({
      time: game.time,
      bells: 3,
      distance: warden.distance,
    });
  }
}

/* ---------------- State transitions ---------------- */

function resetGame() {
  game.relics = 0;
  game.time = 0;
  game.oil = 1;
  game.stamina = 1;
  game.staminaLocked = false;
  game.lanternOn = true;
  game.fear = 0;
  game.shake = 0;
  game.stepDistance = 0;
  game.bobPhase = 0;
  game.moveAmount = 0;
  game.wardenPending = 0;
  game.wardenAwoken = false;
  game.introStage = 0;
  game.deathElapsed = 0;
  game.deathShown = false;
  game.winElapsed = 0;
  game.winShown = false;
  game.boundaryCooldown = 0;
  game.lastHintAt = -100;
  game.lastVanishHint = -100;

  player.pos.set(0, terrainHeight(0, 34), 34);
  player.yaw = 0;
  player.pitch = -0.09;
  player.vx = 0;
  player.vz = 0;
  player.speed = 0;
  player.eye = 1.62;

  world.reset();
  world.setGateCount(0);
  warden.reset();
  lantern.visible = true;
  lantern.userData.glass.opacity = 0.92;
  lantern.userData.glow.material.opacity = 0.38;
  lantern.userData.flame.material.opacity = 0.9;

  ui.setBells(0);
  updateObjectiveText();
  ui.setOil(1, false);
  ui.setStamina(1);
  ui.setPrompt(null);
  ui.setFear(0);
  ui.clearSubtitle();
  ui.setLantern(true);
  ui.setLockHint(false);
  camera.fov = 72;
  camera.updateProjectionMatrix();
  applyPlayerCamera(0, 0);
}

function startGame() {
  if (game.state === 'playing') return;
  ui.hideLoading();
  ui.hideTitle();
  ui.hidePause();
  ui.hideDeath();
  ui.hideWin();
  ui.showHud();
  resetGame();
  game.state = 'playing';
  input.setPlaying(true);
  audio.init().then(() => {
    audio.setEnabled(game.soundOn);
    audio.setPlaying(true);
  }).catch((error) => console.warn('Audio unavailable', error));
  if (!input.isTouch) {
    ui.setLockHint(true);
    setTimeout(() => { if (game.state === 'playing') ui.setLockHint(false); }, 7000);
  }
  if (game.tiltWanted && !input.tiltEnabled) {
    input.enableTilt().then((result) => {
      if (!result.ok) {
        game.tiltWanted = false;
        savePref('hollowfall.tilt', false);
      }
    });
  }
}

function backToTitle() {
  ui.hideDeath();
  ui.hideWin();
  ui.hidePause();
  ui.showTitle();
  ui.clearSubtitle();
  ui.setFear(0);
  resetGame();
  game.time = 0;
  game.titleTime = 0;
  game.state = 'title';
  input.setPlaying(false);
  lantern.visible = false;
  warden.root.visible = true;
  warden.root.position.set(2.3, terrainHeight(2.3, 7.8) + 0.02, 7.8);
  warden.root.rotation.y = 0;
  warden.eyeGlow.material.opacity = 0.55;
  audio.setPlaying(false);
  if (document.pointerLockElement) document.exitPointerLock();
}

function triggerDeath() {
  if (game.state !== 'playing') return;
  game.state = 'dead';
  game.deathElapsed = 0;
  game.deathShown = false;
  game.fear = 1;
  ui.setFear(1);
  ui.setPrompt(null);
  ui.setUseReady(false);
  input.setPlaying(false);
  if (document.pointerLockElement) document.exitPointerLock();
  if (audio.ready) audio.death();
  if (navigator.vibrate) navigator.vibrate([50, 40, 120]);
  warden.root.visible = true;
  warden.eyeGlow.material.opacity = 0.95;
  ui.clearSubtitle();
  camera.fov = 65;
  camera.updateProjectionMatrix();
}

function retry() {
  ui.hideDeath();
  ui.hideWin();
  ui.showHud();
  resetGame();
  game.state = 'playing';
  input.setPlaying(true);
  audio.setPlaying(true);
  if (audio.ready) { audio.setEnabled(game.soundOn); audio.click(); }
  if (!input.isTouch) ui.setLockHint(true);
}

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    input.setPlaying(false);
    ui.showPause();
    ui.setPrompt(null);
    ui.setLockHint(false);
    if (document.pointerLockElement) document.exitPointerLock();
    if (audio.ready) {
      audio.update(0, 0, false, false);
      audio.setPlaying(false);
    }
  } else if (game.state === 'paused') {
    game.state = 'playing';
    input.setPlaying(true);
    ui.hidePause();
    audio.setPlaying(true);
    clock.getDelta();
    if (!input.isTouch) ui.setLockHint(true);
    setTimeout(() => { if (game.state === 'playing') ui.setLockHint(false); }, 5000);
  }
}

/* ---------------- Tilt and sound settings ---------------- */

function handleTiltStatus(status) {
  const enabled = input.tilt.enabled;
  ui.setTilt(enabled, status);
  if (status === 'enabled') {
    game.tiltWanted = true;
    savePref('hollowfall.tilt', true);
    if (game.state === 'playing') ui.toast('Tilt control on · hold naturally to centre', 3);
  } else if (status === 'denied') {
    game.tiltWanted = false;
    savePref('hollowfall.tilt', false);
    ui.toast('Motion access denied. You can enable it in browser settings.', 4);
  } else if (status === 'no-sensor' || status === 'unsupported') {
    game.tiltWanted = false;
    savePref('hollowfall.tilt', false);
    ui.toast('No motion sensor found. Touch controls still work.', 3.6);
  }
}

async function toggleTilt() {
  if (input.tilt.enabled) {
    input.disableTilt();
    game.tiltWanted = false;
    savePref('hollowfall.tilt', false);
    ui.setTilt(false);
    ui.toast('Tilt control off', 2);
    if (audio.ready) audio.click();
    return;
  }
  if (audio.ready) audio.click();
  const result = await input.enableTilt();
  ui.setTilt(input.tilt.enabled, result.ok ? 'enabled' : result.reason);
  if (!result.ok) {
    game.tiltWanted = false;
    savePref('hollowfall.tilt', false);
  }
}

function setSound(enabled) {
  game.soundOn = enabled;
  savePref('hollowfall.sound', enabled);
  audio.setEnabled(enabled);
  ui.setSound(enabled);
  if (enabled) {
    audio.init().then(() => audio.setEnabled(true)).catch(() => {});
    if (audio.ready) audio.click();
    if (game.state === 'playing') ui.toast('Sound on', 1.6);
  } else if (game.state === 'playing') {
    ui.toast('Sound off', 1.6);
  }
}

/* ---------------- Events ---------------- */

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-retry').addEventListener('click', retry);
document.getElementById('btn-again').addEventListener('click', retry);
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-restart-pause').addEventListener('click', () => { ui.hidePause(); retry(); });
document.getElementById('btn-title-death').addEventListener('click', backToTitle);
document.getElementById('btn-title-win').addEventListener('click', backToTitle);
document.getElementById('btn-tilt-title').addEventListener('click', toggleTilt);
document.getElementById('btn-tilt-pause').addEventListener('click', toggleTilt);
document.getElementById('btn-sound-title').addEventListener('click', () => setSound(!game.soundOn));
document.getElementById('btn-sound-pause').addEventListener('click', () => setSound(!game.soundOn));

ui.setSound(game.soundOn);
ui.setTilt(false);
audio.enabled = game.soundOn;

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
  renderer.setSize(w, h);
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    input.tilt.recalibrate();
  }, 250);
});

/* ---------------- Boot and loop ---------------- */

const clock = new THREE.Clock();
let elapsed = 0;
let firstFrame = true;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  if (game.state === 'playing') {
    updatePlaying(dt, elapsed);
  } else if (game.state === 'title') {
    updateTitle(dt, elapsed);
  } else if (game.state === 'dead') {
    updateDeath(dt, elapsed);
  } else if (game.state === 'win') {
    updateWin(dt, elapsed);
  } else if (game.state === 'paused') {
    // Keep the world breathing behind the panel.
    camera.fov = 72;
  }

  const lanternTarget = (game.state === 'playing' && game.lanternOn) ? 34 : 0;
  lanternLight.intensity = lerp(lanternLight.intensity, lanternTarget, Math.min(1, dt * 7));
  lantern.userData.glow.material.opacity = lerp(lantern.userData.glow.material.opacity, game.lanternOn ? 0.38 : 0, Math.min(1, dt * 6));
  lantern.userData.flame.material.opacity = lerp(lantern.userData.flame.material.opacity, game.lanternOn ? 0.9 : 0, Math.min(1, dt * 6));
  lantern.userData.glass.opacity = lerp(lantern.userData.glass.opacity, game.lanternOn ? 0.92 : 0.1, Math.min(1, dt * 6));

  // Lantern light flicker.
  if (game.lanternOn) {
    lanternLight.intensity *= 0.94 + Math.sin(elapsed * 19) * 0.025 + Math.sin(elapsed * 47) * 0.018;
  }

  world.update(dt, elapsed);

  if (game.state === 'title') {
    // The title apparition: faint, patient, and too far away to trust.
    warden.root.position.y = terrainHeight(warden.root.position.x, warden.root.position.z) + 0.02;
  }

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    ui.hideLoading();
    window.__HOLLOW_READY = true;
  }
}

/* ---------------- Title setup ---------------- */

player.pos.set(0, terrainHeight(0, 34), 34);
placeTitleCamera(0);
warden.reset();
warden.root.visible = true;
warden.root.position.set(2.3, terrainHeight(2.3, 7.8) + 0.02, 7.8);
warden.root.rotation.y = 0;
warden.eyeGlow.material.opacity = 0.55;
lantern.visible = false;

ui.setSound(game.soundOn);
ui.setTilt(false);
ui.setBells(0);
updateObjectiveText();
ui.showTitle();
ui.hideHud();

// Expose a small, deterministic debug surface for capture and verification.
window.__HOLLOW = {
  game,
  player,
  warden,
  world,
  camera,
  scene,
  start: startGame,
  retry,
  backToTitle,
  teleport(x, z, yaw = player.yaw, pitch = player.pitch) {
    player.pos.set(x, terrainHeight(x, z), z);
    player.yaw = yaw;
    player.pitch = pitch;
    applyPlayerCamera(0, elapsed);
  },
  giveAll() {
    for (const shrine of world.shrines) {
      if (!shrine.taken) {
        takeRelic(shrine);
      }
    }
  },
  kill: triggerDeath,
  win: openGate,
  interact: updateInteraction,
  setTilt: toggleTilt,
  audio,
};

frame();

requestAnimationFrame(() => requestAnimationFrame(() => ui.hideLoading()));
