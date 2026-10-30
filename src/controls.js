import * as THREE from 'three';
import { clamp, damp, terrainHeight } from './utils.js';

const TAU = Math.PI * 2;

function shortestAngle(from, to) {
  let d = (to - from + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return d - Math.PI;
}

export class Controls {
  constructor({ camera, canvas, joystick, knob, hopButton, recenterButton, onHop, onFirstLook, toast }) {
    this.camera = camera;
    this.canvas = canvas;
    this.joystick = joystick;
    this.knob = knob;
    this.hopButton = hopButton;
    this.onHop = onHop;
    this.onFirstLook = onFirstLook;
    this.toast = toast;

    this.yaw = 0.62;
    this.pitch = 0.22;
    this.distance = 2.55;
    this.targetDistance = 2.55;
    this.manualTimer = 0;
    this.hasLooked = false;
    this.enabled = false;

    this.move = new THREE.Vector2();
    this.joystickMove = new THREE.Vector2();
    this.tiltMove = new THREE.Vector2();
    this.tiltEnabled = false;
    this.tiltZero = null;
    this.tiltRaw = { beta: 0, gamma: 0 };
    this.tiltFiltered = { beta: 0, gamma: 0 };

    this.joystickPointer = null;
    this.dragPointers = new Map();
    this.dragLast = new THREE.Vector2();
    this.pinchDistance = 0;
    this.hopQueued = false;
    this._bind();
  }

  _bind() {
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches || navigator.maxTouchPoints > 0;
    document.body.classList.toggle('is-touch', !!coarse);

    this.joystick.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      this.joystickPointer = event.pointerId;
      this.joystick.setPointerCapture(event.pointerId);
      this.joystick.classList.add('is-active');
      this._updateJoystick(event);
    });
    this.joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.joystickPointer) return;
      event.preventDefault();
      this._updateJoystick(event);
    });
    const endJoystick = (event) => {
      if (event.pointerId !== this.joystickPointer) return;
      this.joystickPointer = null;
      this.joystick.classList.remove('is-active');
      this.joystickMove.set(0, 0);
      this.knob.style.transform = 'translate(0px, 0px)';
    };
    this.joystick.addEventListener('pointerup', endJoystick);
    this.joystick.addEventListener('pointercancel', endJoystick);
    this.joystick.addEventListener('lostpointercapture', endJoystick);

    this.hopButton.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      this.hopQueued = true;
      this.hopButton.classList.add('is-pressed');
      window.setTimeout(() => this.hopButton.classList.remove('is-pressed'), 420);
      navigator.vibrate?.(8);
    });
    this.hopButton.addEventListener('pointerup', () => this.hopButton.classList.remove('is-pressed'));

    if (recenterButton) {
      recenterButton.addEventListener('click', () => this.recenter());
    }

    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      this.dragPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now(), moved: 0 });
      this.canvas.setPointerCapture(event.pointerId);
      if (this.dragPointers.size === 1) {
        this.dragLast.set(event.clientX, event.clientY);
      }
      if (this.dragPointers.size === 2) {
        const [a, b] = [...this.dragPointers.values()];
        this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    this.canvas.addEventListener('pointermove', (event) => {
      const pointer = this.dragPointers.get(event.pointerId);
      if (!pointer) return;
      event.preventDefault();
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.moved += Math.hypot(dx, dy);

      if (this.dragPointers.size === 2) {
        const [a, b] = [...this.dragPointers.values()];
        const next = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance > 0) {
          this.targetDistance = clamp(this.targetDistance * (this.pinchDistance / Math.max(1, next)), 1.65, 4.8);
          this.manualTimer = 2.4;
        }
        this.pinchDistance = next;
        return;
      }

      if (pointer.moved > 3) {
        this.yaw -= dx * 0.0052;
        this.pitch = clamp(this.pitch + dy * 0.0032, 0.05, 0.95);
        this.manualTimer = 2.2;
        if (!this.hasLooked) {
          this.hasLooked = true;
          this.onFirstLook?.();
        }
      }
    });

    const endDrag = (event) => {
      const pointer = this.dragPointers.get(event.pointerId);
      if (!pointer) return;
      const age = performance.now() - pointer.time;
      const isTap = this.dragPointers.size === 1 && pointer.moved < 10 && age < 260;
      this.dragPointers.delete(event.pointerId);
      if (isTap && this.enabled) {
        this.hopQueued = true;
      }
      if (this.dragPointers.size < 2) this.pinchDistance = 0;
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        this.targetDistance = clamp(this.targetDistance + event.deltaY * 0.0018, 1.65, 4.8);
        this.manualTimer = 2.2;
      },
      { passive: false }
    );

    window.addEventListener('keydown', (event) => {
      if (!this.enabled) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) this.hopQueued = true;
      }
    });

    this._boundOrientation = (event) => {
      if (event.beta == null || event.gamma == null) return;
      this.tiltRaw.beta = event.beta;
      this.tiltRaw.gamma = event.gamma;
      if (!this.tiltZero) {
        this.tiltZero = { beta: event.beta, gamma: event.gamma };
        this.tiltFiltered.beta = event.beta;
        this.tiltFiltered.gamma = event.gamma;
      }
    };
  }

  _updateJoystick(event) {
    const rect = this.joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width * 0.34;
    let x = event.clientX - cx;
    let y = event.clientY - cy;
    const length = Math.hypot(x, y);
    if (length > radius) {
      x = (x / length) * radius;
      y = (y / length) * radius;
    }
    this.joystickMove.set(x / radius, -y / radius);
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  async enableTilt() {
    if (this.tiltEnabled) return { ok: true };
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      return { ok: false, reason: 'Motion sensors are not available on this device.' };
    }
    try {
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await window.DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          return { ok: false, reason: 'Motion permission was not granted.' };
        }
      }
      window.addEventListener('deviceorientation', this._boundOrientation, true);
      this.tiltEnabled = true;
      this.tiltZero = null;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: 'Motion permission could not be requested.' };
    }
  }

  disableTilt() {
    window.removeEventListener('deviceorientation', this._boundOrientation, true);
    this.tiltEnabled = false;
    this.tiltMove.set(0, 0);
    this.tiltZero = null;
  }

  async toggleTilt() {
    if (this.tiltEnabled) {
      this.disableTilt();
      return { enabled: false };
    }
    const result = await this.enableTilt();
    return { ...result, enabled: this.tiltEnabled };
  }

  recenter() {
    this.pitch = 0.22;
    this.targetDistance = 2.55;
    this.distance = Math.min(this.distance, 3.2);
    this.manualTimer = 0;
    this.yaw = this._behindYaw ?? this.yaw;
  }

  consumeHop() {
    const value = this.hopQueued;
    this.hopQueued = false;
    return value;
  }

  _updateTilt(dt) {
    if (!this.tiltEnabled || !this.tiltZero) {
      this.tiltMove.multiplyScalar(Math.exp(-8 * dt));
      return;
    }
    const beta = this.tiltRaw.beta;
    const gamma = this.tiltRaw.gamma;
    this.tiltFiltered.beta = damp(this.tiltFiltered.beta, beta, 7, dt);
    this.tiltFiltered.gamma = damp(this.tiltFiltered.gamma, gamma, 7, dt);
    const db = this.tiltFiltered.beta - this.tiltZero.beta;
    const dg = this.tiltFiltered.gamma - this.tiltZero.gamma;

    const dead = 2.2;
    const x = Math.sign(dg) * clamp((Math.abs(dg) - dead) / 20, 0, 1);
    const y = Math.sign(db) * clamp((Math.abs(db) - dead) / 22, 0, 1);
    this.tiltMove.set(x, -y);
    if (this.tiltMove.lengthSq() < 0.008) this.tiltMove.set(0, 0);
  }

  update(dt, rabbitPosition, heading, isMoving) {
    this._updateTilt(dt);
    this.manualTimer = Math.max(0, this.manualTimer - dt);

    const raw = new THREE.Vector2(this.joystickMove.x + this.tiltMove.x, this.joystickMove.y + this.tiltMove.y);
    if (raw.lengthSq() > 1) raw.normalize();
    this.move.copy(raw);

    this.distance = damp(this.distance, this.targetDistance, 7, dt);

    if (isMoving && this.manualTimer <= 0) {
      const behind = heading + Math.PI;
      this._behindYaw = behind;
      const delta = shortestAngle(this.yaw, behind);
      this.yaw += delta * (1 - Math.exp(-1.8 * dt));
    }

    const target = new THREE.Vector3(rabbitPosition.x, rabbitPosition.y + 0.285 + (isMoving ? 0.015 : 0), rabbitPosition.z);
    const cosPitch = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch
    ).multiplyScalar(this.distance);

    const desired = target.clone().add(offset);
    const groundAtCamera = terrainHeight(desired.x, desired.z) + 0.33;
    desired.y = Math.max(desired.y, groundAtCamera);

    const camera = this.camera;
    camera.position.x = damp(camera.position.x, desired.x, 10, dt);
    camera.position.y = damp(camera.position.y, desired.y, 10, dt);
    camera.position.z = damp(camera.position.z, desired.z, 10, dt);
    camera.lookAt(target.x, target.y + 0.02, target.z);
  }

  cameraRelativeMove() {
    const x = this.move.x;
    const y = this.move.y;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return forward.multiplyScalar(y).add(right.multiplyScalar(x));
  }
}
