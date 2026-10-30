const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class TiltController {
  constructor(onStatus = () => {}) {
    this.enabled = false;
    this.onStatus = onStatus;
    this.neutral = null;
    this.smoothX = 0;
    this.smoothY = 0;
    this.sawEvent = false;
    this.handler = this._onOrientation.bind(this);
    this.watchdog = null;
    this.sensorStart = 0;
  }

  static supported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  async enable() {
    if (this.enabled) return { ok: true, reason: 'already' };
    if (!TiltController.supported()) {
      this.onStatus('unsupported');
      return { ok: false, reason: 'unsupported' };
    }

    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission();
        if (result !== 'granted') {
          this.onStatus('denied');
          return { ok: false, reason: 'denied' };
        }
      } catch (error) {
        this.onStatus('denied');
        return { ok: false, reason: 'denied' };
      }
    }

    this.enabled = true;
    this.neutral = null;
    this.smoothX = 0;
    this.smoothY = 0;
    this.sawEvent = false;
    this.sensorStart = performance.now();
    window.addEventListener('deviceorientation', this.handler, true);

    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (!this.sawEvent) {
        this.disable();
        this.onStatus('no-sensor');
      }
    }, 2200);

    this.onStatus('enabled');
    return { ok: true, reason: 'enabled' };
  }

  disable() {
    this.enabled = false;
    this.neutral = null;
    window.removeEventListener('deviceorientation', this.handler, true);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  recalibrate() {
    this.neutral = null;
  }

  _onOrientation(event) {
    if (!this.enabled) return;
    if (event.beta === null && event.gamma === null) return;
    this.sawEvent = true;
    this.lastEvent = event;

    const angle = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) % 360;
    const beta = event.beta ?? 0;
    const gamma = event.gamma ?? 0;

    let roll;
    let pitch;
    if (angle === 90) {
      roll = -beta;
      pitch = gamma;
    } else if (angle === 270 || angle === -90) {
      roll = beta;
      pitch = -gamma;
    } else if (angle === 180) {
      roll = -gamma;
      pitch = -beta;
    } else {
      roll = gamma;
      pitch = beta;
    }

    if (!this.neutral) {
      this.neutral = { roll, pitch };
      return;
    }

    // Slow baseline tracking stops a held phone from spinning forever.
    this.neutral.roll += (roll - this.neutral.roll) * 0.00055;
    this.neutral.pitch += (pitch - this.neutral.pitch) * 0.00055;

    const dead = 1.7;
    const range = 25;
    let dx = (roll - this.neutral.roll);
    let dy = (pitch - this.neutral.pitch);
    dx = Math.sign(dx) * Math.max(0, Math.abs(dx) - dead) / range;
    dy = Math.sign(dy) * Math.max(0, Math.abs(dy) - dead) / range;
    this.smoothX += (clamp(dx, -1, 1) - this.smoothX) * 0.18;
    this.smoothY += (clamp(dy, -1, 1) - this.smoothY) * 0.18;
  }

  update(dt) {
    if (!this.enabled) return { x: 0, y: 0 };
    // Convert tilt into a look velocity in pixels per second.
    return {
      x: this.smoothX * 330 * dt,
      y: this.smoothY * 190 * dt,
    };
  }
}

export class Input {
  constructor(elements, callbacks = {}) {
    this.el = elements;
    this.callbacks = callbacks;
    this.keys = new Set();
    this.playing = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || innerWidth < 820;
    this.lookSensitivity = this.isTouch ? 0.0053 : 0.0024;

    this.moveX = 0;
    this.moveY = 0;
    this.sprint = false;
    this.lookDX = 0;
    this.lookDY = 0;
    this.useQueued = false;
    this.lampQueued = false;
    this.joystickPointer = null;
    this.joystickCenter = { x: 0, y: 0 };
    this.joystickRadius = 42;
    this.lookPointer = null;
    this.lookPointerType = 'touch';
    this.lastLook = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.sprintPointer = null;

    this.tilt = new TiltController((status) => this.callbacks.onTiltStatus?.(status));
    this.tiltEnabled = false;
    this._tiltWanted = false;

    this._bind();
  }

  _bind() {
    const { joystick, knob, btnSprint, btnLamp, btnUse, btnPause } = this.el;

    joystick.addEventListener('pointerdown', (e) => {
      if (!this.playing) return;
      e.preventDefault();
      this.joystickPointer = e.pointerId;
      const rect = joystick.getBoundingClientRect();
      this.joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.joystickRadius = rect.width * 0.34;
      joystick.classList.add('active');
      joystick.setPointerCapture?.(e.pointerId);
      this._updateJoystick(e.clientX, e.clientY);
    });
    joystick.addEventListener('pointermove', (e) => {
      if (this.joystickPointer !== e.pointerId) return;
      e.preventDefault();
      this._updateJoystick(e.clientX, e.clientY);
    });
    const endJoystick = (e) => {
      if (this.joystickPointer !== e.pointerId) return;
      this.joystickPointer = null;
      this.moveX = 0;
      this.moveY = 0;
      joystick.classList.remove('active');
      knob.style.transform = 'translate(0px, 0px)';
    };
    joystick.addEventListener('pointerup', endJoystick);
    joystick.addEventListener('pointercancel', endJoystick);

    const holdButton = (button, onDown, onUp) => {
      button.addEventListener('pointerdown', (e) => {
        if (!this.playing) return;
        e.preventDefault();
        e.stopPropagation();
        button.classList.add('is-down');
        button.setPointerCapture?.(e.pointerId);
        this.callbacks.onButton?.();
        onDown(e);
      });
      const up = (e) => {
        button.classList.remove('is-down');
        onUp?.(e);
      };
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('pointerleave', (e) => {
        if (e.buttons === 0) button.classList.remove('is-down');
      });
    };

    holdButton(btnSprint, () => { this.sprint = true; }, () => { this.sprint = false; });
    holdButton(btnLamp, () => { this.lampQueued = true; });
    holdButton(btnUse, () => { this.useQueued = true; });
    btnPause.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.callbacks.onPause?.();
    });

    // Look drag on the world.
    window.addEventListener('pointerdown', (e) => {
      if (!this.playing) return;
      if (e.pointerType === 'mouse') return;
      if (e.target.closest('button, .joystick, .overlay, .toast')) return;
      if (this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      this.lookPointerType = e.pointerType || 'touch';
      this.lastLook = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
      if (!this.playing) return;
      if (e.pointerId !== this.lookPointer) return;
      const dx = e.clientX - this.lastLook.x;
      const dy = e.clientY - this.lastLook.y;
      this.lastLook = { x: e.clientX, y: e.clientY };
      this.lookDX += dx;
      this.lookDY += dy;
      e.preventDefault();
    }, { passive: false });

    const endLook = (e) => {
      if (e.pointerId === this.lookPointer) this.lookPointer = null;
    };
    window.addEventListener('pointerup', endLook);
    window.addEventListener('pointercancel', endLook);

    // Desktop pointer lock.
    window.addEventListener('mousemove', (e) => {
      if (!this.playing || !this.pointerLocked) return;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });

    const canvas = document.getElementById('scene');
    canvas.addEventListener('click', () => {
      if (!this.playing || this.isTouch || this.pointerLocked) return;
      if (this.callbacks.onRequestLock) this.callbacks.onRequestLock();
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      const wasLocked = this.pointerLocked;
      this.pointerLocked = locked;
      this.callbacks.onLockChange?.(locked);
      if (wasLocked && !locked && this.playing) {
        this.callbacks.onPause?.();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
          this.keys.add(e.code);
        }
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        this.callbacks.onPause?.();
        return;
      }
      if (!this.playing) return;
      if (e.code === 'KeyE' || e.code === 'Space') {
        e.preventDefault();
        this.useQueued = true;
      }
      if (e.code === 'KeyF') this.lampQueued = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.sprint = false;
      this.moveX = 0;
      this.moveY = 0;
      this.joystickPointer = null;
      this.lookPointer = null;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.callbacks.onHidden?.();
    });
  }

  _updateJoystick(clientX, clientY) {
    const { knob } = this.el;
    let dx = clientX - this.joystickCenter.x;
    let dy = clientY - this.joystickCenter.y;
    const len = Math.hypot(dx, dy);
    const radius = this.joystickRadius;
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / radius;
    const ny = dy / radius;
    const magnitude = Math.hypot(nx, ny);
    if (magnitude < 0.13) {
      this.moveX = 0;
      this.moveY = 0;
    } else {
      const scaled = Math.min(1, (magnitude - 0.13) / 0.87) / magnitude;
      this.moveX = nx * scaled;
      this.moveY = -ny * scaled;
    }
  }

  setPlaying(playing) {
    this.playing = playing;
    if (!playing) {
      this.moveX = 0;
      this.moveY = 0;
      this.sprint = false;
      this.keys.clear();
      this.lookDX = 0;
      this.lookDY = 0;
      this.useQueued = false;
      this.lampQueued = false;
    }
  }

  async enableTilt() {
    this._tiltWanted = true;
    const result = await this.tilt.enable();
    this.tiltEnabled = this.tilt.enabled;
    return result;
  }

  disableTilt() {
    this._tiltWanted = false;
    this.tilt.disable();
    this.tiltEnabled = false;
    this.tilt.recalibrate();
  }

  async retryWantedTilt() {
    if (!this._tiltWanted) return;
    await this.enableTilt();
  }

  consumeLook(dt = 1 / 60) {
    const touch = this.tilt.update(dt);
    const out = { x: this.lookDX + touch.x, y: this.lookDY + touch.y };
    this.lookDX = 0;
    this.lookDY = 0;
    return out;
  }

  consumeUse() {
    const v = this.useQueued;
    this.useQueued = false;
    return v;
  }

  consumeLamp() {
    const v = this.lampQueued;
    this.lampQueued = false;
    return v;
  }

  getMovement() {
    let x = this.moveX;
    let y = this.moveY;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  getSprinting() {
    return this.sprint || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  requestPointerLock() {
    const canvas = document.getElementById('scene');
    canvas.requestPointerLock?.();
  }
}
