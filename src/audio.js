/**
 * A tiny procedural soundscape. Every sound is synthesised at runtime so the
 * meadow does not depend on a single external audio asset.
 */
export class MeadowAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.muted = false;
    this.started = false;
    this.birdTimer = null;
    this._noiseBuffer = null;
  }

  async start() {
    if (this.started) {
      await this.ctx?.resume?.();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    await this.ctx.resume?.();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.master.connect(this.ctx.destination);
    this._noiseBuffer = this._makeNoise(4.5);

    this._makeWind();
    this._makeUnderstory();
    this._scheduleBird(true);
    this.started = true;
  }

  _makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.965 + white * 0.035;
        data[i] = last * 3.2 + white * 0.1;
      }
    }
    return buffer;
  }

  _makeWind() {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = true;

    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 620;
    low.Q.value = 0.35;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1080;
    band.Q.value = 0.55;

    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.12;
    const bandGain = ctx.createGain();
    bandGain.gain.value = 0.018;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.071;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain);
    lfoGain.connect(low.frequency);

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.043;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.008;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(bandGain.gain);

    source.connect(low);
    low.connect(lowGain);
    lowGain.connect(this.master);
    source.connect(band);
    band.connect(bandGain);
    bandGain.connect(this.master);

    this.windGain = lowGain;
    source.start();
    lfo.start();
    lfo2.start();
  }

  _makeUnderstory() {
    const ctx = this.ctx;
    // A low, barely audible bed of leaves and insects.
    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2600;
    const gain = ctx.createGain();
    gain.gain.value = 0.0045;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();

    const shimmer = ctx.createOscillator();
    shimmer.frequency.value = 4100;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.0015;
    const shimmerLfo = ctx.createOscillator();
    shimmerLfo.frequency.value = 0.17;
    const shimmerLfoGain = ctx.createGain();
    shimmerLfoGain.gain.value = 0.0012;
    shimmerLfo.connect(shimmerLfoGain);
    shimmerLfoGain.connect(shimmerGain.gain);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.master);
    shimmer.start();
    shimmerLfo.start();
  }

  _chirp() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const pan = ctx.createStereoPanner?.();
    if (pan) {
      pan.pan.value = Math.random() * 1.3 - 0.65;
      pan.connect(this.master);
    }
    const destination = pan || this.master;
    const base = 1900 + Math.random() * 1700;
    const notes = 2 + Math.floor(Math.random() * 4);

    for (let i = 0; i < notes; i += 1) {
      const start = now + i * (0.085 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const length = 0.065 + Math.random() * 0.1;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), start);
      osc.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.48), start + length * 0.46);
      osc.frequency.exponentialRampToValueAtTime(base * (0.85 + Math.random() * 0.2), start + length);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.028 + Math.random() * 0.015, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(start);
      osc.stop(start + length + 0.02);
    }
  }

  _scheduleBird(initial = false) {
    const delay = initial ? 1500 + Math.random() * 3000 : 4500 + Math.random() * 8500;
    this.birdTimer = window.setTimeout(() => {
      this._chirp();
      if (Math.random() < 0.3) window.setTimeout(() => this._chirp(), 320 + Math.random() * 600);
      this._scheduleBird();
    }, delay);
  }

  _thump(frequency, duration, volume) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.48, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);

    if (this._noiseBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = this._noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(volume * 0.25, now);
      nGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.master);
      source.start(now);
      source.stop(now + duration);
    }
  }

  hop() {
    this._thump(155, 0.16, 0.035);
  }

  land() {
    this._thump(96, 0.22, 0.05);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.08);
    }
  }

  destroy() {
    if (this.birdTimer) window.clearTimeout(this.birdTimer);
    this.ctx?.close?.();
  }
}
