export class Soundscape {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.master = null;
  }

  unlock() {
    if (!this.enabled) return;
    this.ensureContext();
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }

  ensureContext() {
    if (this.context) return this.context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.24;
    this.master.connect(this.context.destination);
    return this.context;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.context?.suspend().catch(() => {});
    } else {
      this.unlock();
    }
  }

  tone({ frequency, endFrequency, duration, type = 'sine', volume = 0.2, delay = 0 }) {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  noise({ duration = 0.18, volume = 0.12, delay = 0 } = {}) {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (!context) return;
    const length = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(context.currentTime + delay);
  }

  select() {
    this.tone({ frequency: 520, endFrequency: 680, duration: 0.09, type: 'sine', volume: 0.12 });
  }

  move() {
    this.tone({ frequency: 190, endFrequency: 140, duration: 0.15, type: 'triangle', volume: 0.16 });
    this.tone({ frequency: 540, endFrequency: 470, duration: 0.08, type: 'sine', volume: 0.06, delay: 0.015 });
  }

  capture() {
    this.tone({ frequency: 130, endFrequency: 60, duration: 0.32, type: 'sawtooth', volume: 0.12 });
    this.noise({ duration: 0.24, volume: 0.11 });
    this.tone({ frequency: 760, endFrequency: 1140, duration: 0.18, type: 'sine', volume: 0.1, delay: 0.04 });
  }

  check() {
    this.tone({ frequency: 640, duration: 0.12, type: 'sine', volume: 0.1 });
    this.tone({ frequency: 780, duration: 0.16, type: 'sine', volume: 0.1, delay: 0.1 });
  }

  victory() {
    [392, 494, 587, 784].forEach((frequency, index) => {
      this.tone({ frequency, duration: 0.42, type: 'sine', volume: 0.09, delay: index * 0.11 });
    });
  }

  defeat() {
    [330, 294, 247].forEach((frequency, index) => {
      this.tone({ frequency, endFrequency: frequency * 0.92, duration: 0.5, type: 'triangle', volume: 0.09, delay: index * 0.14 });
    });
  }
}
