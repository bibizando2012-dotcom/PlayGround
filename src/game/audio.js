/**
 * A tiny procedural soundscape: wind, birds, crickets, paw thumps and splashes.
 * Everything is synthesised with WebAudio, so the build ships no audio files.
 */
export class Soundscape {
  constructor() {
    this.ctx = null
    this.master = null
    this.started = false
    this.muted = false
    this.nextBird = 2.5
    this.nextCricket = 1.2
    this.day = 1
  }

  start() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    try {
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.45
      this.master.connect(this.ctx.destination)
      this.started = true
      this._wind()
      this.ctx.resume()
    } catch {
      this.ctx = null
    }
  }

  _noiseBuffer(seconds = 2) {
    const ctx = this.ctx
    const len = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    return buffer
  }

  _wind() {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this._noiseBuffer(3)
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 520
    filter.Q.value = 0.4
    const gain = ctx.createGain()
    gain.gain.value = 0.055
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.025
    lfo.connect(lfoGain).connect(gain.gain)
    src.connect(filter).connect(gain).connect(this.master)
    src.start()
    lfo.start()
    this.windGain = gain
  }

  _envelope(node, time, attack, hold, release, peak = 1) {
    const g = node.gain
    g.cancelScheduledValues(time)
    g.setValueAtTime(0.0001, time)
    g.exponentialRampToValueAtTime(peak, time + attack)
    g.setValueAtTime(peak, time + attack + hold)
    g.exponentialRampToValueAtTime(0.0001, time + attack + hold + release)
  }

  bird() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const base = 1500 + Math.random() * 1900
    const notes = 1 + Math.floor(Math.random() * 3)
    const t0 = ctx.currentTime
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.08)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      const f = base * (0.9 + Math.random() * 0.4)
      osc.frequency.setValueAtTime(f, t)
      osc.frequency.exponentialRampToValueAtTime(f * (1.2 + Math.random() * 0.5), t + 0.06)
      osc.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.14)
      this._envelope(gain, t, 0.012, 0.02, 0.09, 0.022)
      osc.connect(gain).connect(this.master)
      osc.start(t)
      osc.stop(t + 0.22)
    }
  }

  cricket() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = 3900 + Math.random() * 700
      const tt = t + i * 0.07
      this._envelope(gain, tt, 0.005, 0.012, 0.035, 0.008)
      osc.connect(gain).connect(this.master)
      osc.start(tt)
      osc.stop(tt + 0.07)
    }
  }

  hop() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, t)
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.14)
    this._envelope(gain, t, 0.008, 0.02, 0.16, 0.12)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.22)
  }

  land(strength = 1) {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this._noiseBuffer(0.3)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 380
    const gain = ctx.createGain()
    this._envelope(gain, t, 0.005, 0.02, 0.18, Math.min(0.16, 0.05 + strength * 0.03))
    src.connect(filter).connect(gain).connect(this.master)
    src.start(t)
    src.stop(t + 0.25)
  }

  splash() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this._noiseBuffer(0.6)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1100
    filter.Q.value = 0.7
    const gain = ctx.createGain()
    this._envelope(gain, t, 0.01, 0.04, 0.4, 0.16)
    src.connect(filter).connect(gain).connect(this.master)
    src.start(t)
    src.stop(t + 0.5)
  }

  sniff() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const src = ctx.createBufferSource()
      src.buffer = this._noiseBuffer(0.2)
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 900 + i * 180
      filter.Q.value = 1.4
      const gain = ctx.createGain()
      const tt = t + i * 0.14
      this._envelope(gain, tt, 0.02, 0.02, 0.08, 0.03)
      src.connect(filter).connect(gain).connect(this.master)
      src.start(tt)
      src.stop(tt + 0.16)
    }
  }

  chime() {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    ;[523.25, 659.25, 783.99].forEach((f, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      this._envelope(gain, t + i * 0.09, 0.02, 0.05, 0.7, 0.03)
      osc.connect(gain).connect(this.master)
      osc.start(t + i * 0.09)
      osc.stop(t + i * 0.09 + 0.8)
    })
  }

  update(dt, dayFactor) {
    if (!this.ctx || !this.started) return
    this.day = dayFactor
    this.nextBird -= dt
    this.nextCricket -= dt
    if (this.windGain) {
      const target = 0.035 + dayFactor * 0.04
      this.windGain.gain.value += (target - this.windGain.gain.value) * Math.min(1, dt * 0.6)
    }
    if (this.nextBird <= 0) {
      this.nextBird = 3 + Math.random() * 7
      if (dayFactor > 0.55) this.bird()
    }
    if (this.nextCricket <= 0) {
      this.nextCricket = 0.6 + Math.random() * 1.4
      if (dayFactor < 0.35) this.cricket()
    }
  }

  setMuted(muted) {
    this.muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.05)
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted)
    return this.muted
  }
}
