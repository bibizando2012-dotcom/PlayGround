const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.playing = false;
    this.master = null;
    this.dry = null;
    this.reverb = null;
    this.reverbGain = null;
    this.noiseBuffer = null;
    this.droneGain = null;
    this.windGain = null;
    this.droneNodes = [];
    this.windNodes = [];
    this.nextWhisper = 0;
    this.nextHeartbeat = 0;
    this.nextWardenStep = 0;
    this.threat = 0;
    this.lastTime = 0;
    this.volume = 0.85;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx({ latencyHint: 'interactive' });

    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 14;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.35;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.92;

    this.master.connect(this.dry);
    this.dry.connect(limiter);
    limiter.connect(ctx.destination);

    // Generated impulse response: a cold, long stone hall.
    const seconds = 2.6;
    const rate = ctx.sampleRate;
    const impulse = ctx.createBuffer(2, Math.floor(rate * seconds), rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const t = i / data.length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.8) * (0.7 + Math.random() * 0.3);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.4;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.noiseBuffer = ctx.createBuffer(1, rate * 3, rate);
    const nd = this.noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      nd[i] = last * 3.2;
    }

    this._buildDrone();
    this._buildWind();
    this.nextWhisper = ctx.currentTime + 4;
    this.ready = true;
  }

  _buildDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    filter.Q.value = 0.7;
    filter.connect(this.droneGain);

    const specs = [
      { type: 'sine', freq: 27.5, gain: 0.09, detune: 0 },
      { type: 'sine', freq: 55, gain: 0.05, detune: -4 },
      { type: 'triangle', freq: 82.4, gain: 0.018, detune: 7 },
      { type: 'sawtooth', freq: 110, gain: 0.006, detune: -11 },
    ];
    for (const spec of specs) {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.value = spec.freq;
      osc.detune.value = spec.detune;
      const g = ctx.createGain();
      g.gain.value = spec.gain;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      this.droneNodes.push(osc);
    }

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.037;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 75;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const breath = ctx.createOscillator();
    breath.type = 'sine';
    breath.frequency.value = 0.061;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.014;
    breath.connect(breathGain);
    breathGain.connect(this.droneGain.gain);
    breath.start();
  }

  _buildWind() {
    const ctx = this.ctx;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.55;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 1500;

    source.connect(band);
    band.connect(low);
    low.connect(this.windGain);
    source.start();

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.047;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain);
    lfoGain.connect(band.frequency);
    lfo.start();

    const pan = ctx.createStereoPanner();
    const panLfo = ctx.createOscillator();
    panLfo.frequency.value = 0.023;
    const panGain = ctx.createGain();
    panGain.gain.value = 0.5;
    panLfo.connect(panGain);
    panGain.connect(pan.pan);
    panLfo.start();

    this.windGain.disconnect();
    this.windGain.connect(pan);
    pan.connect(this.master);

    this.windNodes.push(source, lfo, panLfo);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(enabled ? this.volume : 0, now, 0.08);
    if (enabled && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setPlaying(playing) {
    this.playing = playing;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const level = playing ? 1 : 0.48;
    this.droneGain.gain.setTargetAtTime(this.playing ? 0.85 : 0.36, now, 1.5);
    this.windGain.gain.setTargetAtTime(this.playing ? 0.38 : 0.2, now, 1.8);
    if (this.droneGain) this.droneGainScale = level;
  }

  _out(node, pan = 0, wet = 0.24) {
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    node.connect(panner);
    panner.connect(this.master);
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      panner.connect(send);
      send.connect(this.reverb);
    }
    return panner;
  }

  _noise(duration = 1, loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = loop;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    src._duration = duration;
    return src;
  }

  click() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, t);
    osc.frequency.exponentialRampToValueAtTime(340, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g);
    this._out(g, 0, 0.1);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  footstep(intensity = 1, pan = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._noise(0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 160 + Math.random() * 150;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    const amp = 0.028 + intensity * 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    src.connect(filter);
    filter.connect(g);
    this._out(g, pan, 0.12);
    src.start(t);
    src.stop(t + 0.18);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(64, t);
    thud.frequency.exponentialRampToValueAtTime(38, t + 0.1);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.035 * intensity, t + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    thud.connect(tg);
    this._out(tg, pan, 0);
    thud.start(t);
    thud.stop(t + 0.14);
  }

  wardenStep(pan = 0, volume = 0.08) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(48, t);
    osc.frequency.exponentialRampToValueAtTime(24, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(g);
    this._out(g, pan, 0.3);
    osc.start(t);
    osc.stop(t + 0.4);
    const src = this._noise(0.3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(volume * 0.5, t + 0.012);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f);
    f.connect(ng);
    this._out(ng, pan, 0.25);
    src.start(t);
    src.stop(t + 0.3);
  }

  heartbeat(threat = 0.5) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const amp = 0.035 + threat * 0.13;
    const thump = (delay, gain) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const t = now + delay;
      osc.frequency.setValueAtTime(58, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(g);
      this._out(g, 0, 0.05);
      osc.start(t);
      osc.stop(t + 0.24);
    };
    thump(0, amp);
    thump(0.18, amp * 0.64);
  }

  bell(base = 220, volume = 0.12, pan = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const partials = [
      [1, 0.55, 2.8],
      [2.01, 0.3, 2.1],
      [3.02, 0.15, 1.4],
      [4.1, 0.09, 0.9],
      [5.43, 0.05, 0.6],
    ];
    for (const [mul, amp, dur] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * mul * (0.995 + Math.random() * 0.01);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(volume * amp, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g);
      this._out(g, pan, 0.5);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    }
  }

  pickup() {
    if (!this.ctx || !this.enabled) return;
    this.bell(196, 0.14);
    setTimeout(() => this.bell(293.66, 0.11), 170);
    setTimeout(() => this.bell(392, 0.09), 340);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(72, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(g);
    this._out(g, 0, 0.4);
    osc.start(t);
    osc.stop(t + 1.2);
  }

  denied() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [freq, vol] of [[70, 0.1], [104, 0.05]]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      osc.connect(g);
      this._out(g, 0, 0.2);
      osc.start(t);
      osc.stop(t + 0.45);
    }
  }

  whisper(pan = 0, intensity = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = this._noise(1.8);
    src.loop = true;
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.Q.value = 7;
    bp1.frequency.setValueAtTime(700, now);
    bp1.frequency.linearRampToValueAtTime(1150, now + 0.6);
    bp1.frequency.linearRampToValueAtTime(620, now + 1.4);
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.value = 11;
    bp2.frequency.setValueAtTime(1900, now);
    bp2.frequency.linearRampToValueAtTime(1400, now + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.032 * intensity, now + 0.2);
    g.gain.linearRampToValueAtTime(0.018 * intensity, now + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.75);
    src.connect(bp1);
    src.connect(bp2);
    bp1.connect(g);
    bp2.connect(g);
    this._out(g, pan, 0.8);
    src.start(now);
    src.stop(now + 1.8);

    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(118, now);
    voice.frequency.linearRampToValueAtTime(92, now + 0.8);
    voice.frequency.linearRampToValueAtTime(126, now + 1.5);
    const vf = ctx.createBiquadFilter();
    vf.type = 'lowpass';
    vf.frequency.value = 460;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0.0001, now);
    vg.gain.exponentialRampToValueAtTime(0.013 * intensity, now + 0.3);
    vg.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    voice.connect(vf);
    vf.connect(vg);
    this._out(vg, pan, 0.9);
    voice.start(now);
    voice.stop(now + 1.7);
  }

  stinger() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const noise = this._noise(1.6);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(0.22, now + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    noise.connect(hp);
    hp.connect(ng);
    this._out(ng, 0, 0.45);
    noise.start(now);
    noise.stop(now + 1.0);

    for (const [freq, dest, delay, vol] of [[220, 42, 0, 0.12], [327, 61, 0.03, 0.06]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const t = now + delay;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(dest, t + 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      osc.connect(g);
      this._out(g, 0, 0.5);
      osc.start(t);
      osc.stop(t + 1.6);
    }
    this.bell(110, 0.08);
  }

  gateOpen() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = this._noise(4);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(180, now);
    f.frequency.linearRampToValueAtTime(800, now + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 4);
    src.connect(f);
    f.connect(g);
    this._out(g, 0, 0.6);
    src.start(now);
    src.stop(now + 4);
    this.bell(98, 0.16);
    setTimeout(() => this.bell(146.83, 0.13), 500);
    setTimeout(() => this.bell(196, 0.11), 1000);
  }

  win() {
    if (!this.ctx || !this.enabled) return;
    const notes = [196, 246.94, 293.66, 392];
    notes.forEach((n, i) => setTimeout(() => this.bell(n, 0.1), i * 420));
  }

  death() {
    if (!this.ctx || !this.enabled) return;
    this.stinger();
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(46, now);
    osc.frequency.exponentialRampToValueAtTime(18, now + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 3);
    osc.connect(g);
    this._out(g, 0, 0.3);
    osc.start(now);
    osc.stop(now + 3.1);
  }

  update(dt, threat, visible, active) {
    if (!this.ctx || !this.ready || !this.enabled) return;
    const now = this.ctx.currentTime;

    const target = active ? clamp(threat, 0, 1) : 0;
    this.threat += (target - this.threat) * Math.min(1, dt * 2);

    if (this.playing && this.threat > 0.08) {
      const interval = 1.15 - this.threat * 0.62;
      if (now > this.nextHeartbeat) {
        this.heartbeat(this.threat);
        this.nextHeartbeat = now + interval;
      }
    }

    if (this.playing && active && this.threat > 0.12 && now > this.nextWardenStep) {
      this.wardenStep((Math.random() - 0.5) * 0.8, 0.035 + this.threat * 0.06);
      this.nextWardenStep = now + 1.4 - this.threat * 0.7;
    }

    if (this.playing && this.threat < 0.55 && now > this.nextWhisper) {
      const pan = (Math.random() - 0.5) * 1.4;
      this.whisper(pan, 0.75 + Math.random() * 0.5);
      this.nextWhisper = now + 8 + Math.random() * 12;
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
}
