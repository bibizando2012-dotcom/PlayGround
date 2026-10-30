/*
 * A tiny procedural soundscape: wind, meadow air, soft chimes and pawfalls.
 * No audio files, no network, no autoplay before the user enters.
 */
export class MeadowAudio {
  constructor() {
    this.ctx = null
    this.master = null
    this.windGain = null
    this.muted = false
    this.started = false
    this.nextBird = 0
    this.nextChime = 0
    this.noiseBuffer = null
  }

  async start() {
    if (this.started) {
      await this.ctx?.resume()
      return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    await this.ctx.resume()
    this.started = true
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.32
    this.master.connect(this.ctx.destination)

    this.noiseBuffer = this.makeNoise(4)
    this.windGain = this.ctx.createGain()
    this.windGain.gain.value = 0.055
    this.windGain.connect(this.master)

    const wind = this.ctx.createBufferSource()
    wind.buffer = this.noiseBuffer
    wind.loop = true
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 780
    lp.Q.value = 0.25
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 95
    wind.connect(lp).connect(hp).connect(this.windGain)
    wind.start()

    // Slow breathing filter movement makes the wind feel alive.
    const lfo = this.ctx.createOscillator()
    const lfoGain = this.ctx.createGain()
    lfo.frequency.value = 0.085
    lfoGain.gain.value = 260
    lfo.connect(lfoGain).connect(lp.frequency)
    lfo.start()

    this.time = this.ctx.currentTime
    this.nextBird = this.time + 2.2
    this.nextChime = this.time + 8
  }

  makeNoise(seconds) {
    const rate = this.ctx.sampleRate
    const buffer = this.ctx.createBuffer(1, rate * seconds, rate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = 0.985 * last + 0.015 * white
      data[i] = last * 2.2 + white * 0.08
    }
    return buffer
  }

  setMuted(muted) {
    this.muted = muted
    if (!this.ctx || !this.master) return
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(muted ? 0 : 0.32, now, 0.15)
  }

  async toggle() {
    if (!this.started) await this.start()
    this.setMuted(!this.muted)
    return this.muted
  }

  update(time) {
    if (!this.started || this.muted) return
    const now = this.ctx.currentTime
    if (now > this.nextBird) {
      this.bird(now + 0.02)
      this.nextBird = now + 5 + Math.random() * 11
    }
    if (now > this.nextChime) {
      this.chime(now + 0.02, 720 + Math.random() * 260, 0.022)
      this.nextChime = now + 14 + Math.random() * 20
    }
    // Wind ebbs and flows.
    if (this.windGain) {
      const g = 0.04 + 0.025 * (0.5 + 0.5 * Math.sin(time * 0.12)) + Math.random() * 0.002
      this.windGain.gain.setTargetAtTime(g, now, 0.4)
    }
  }

  tone({ freq = 440, endFreq = freq, type = 'sine', gain = 0.05, attack = 0.005, decay = 0.3, pan = 0, delay = 0 }) {
    if (!this.ctx || this.muted) return
    const t = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + decay)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    if (p) {
      p.pan.setValueAtTime(pan, t)
      osc.connect(g).connect(p).connect(this.master)
    } else {
      osc.connect(g).connect(this.master)
    }
    osc.start(t)
    osc.stop(t + attack + decay + 0.05)
  }

  chime(time, freq, gain = 0.04) {
    if (!this.ctx) return
    this.tone({ freq, endFreq: freq * 1.012, type: 'sine', gain, attack: 0.02, decay: 1.4, pan: Math.random() * 1.2 - 0.6 })
    this.tone({ freq: freq * 2.01, endFreq: freq * 2.0, type: 'sine', gain: gain * 0.3, attack: 0.02, decay: 0.9, pan: 0.2 })
    void time
  }

  bird(time) {
    if (!this.ctx) return
    const base = 1900 + Math.random() * 1300
    const notes = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < notes; i++) {
      const f = base * (0.9 + Math.random() * 0.28)
      this.tone({
        freq: f,
        endFreq: f * (1.15 + Math.random() * 0.25),
        type: 'sine',
        gain: 0.016,
        attack: 0.01,
        decay: 0.09 + Math.random() * 0.09,
        pan: Math.random() * 1.6 - 0.8,
        delay: i * (0.1 + Math.random() * 0.08),
      })
    }
    void time
  }

  hop() {
    this.tone({ freq: 190, endFreq: 95, type: 'sine', gain: 0.035, attack: 0.004, decay: 0.14, pan: -0.1 })
    this.tone({ freq: 900, endFreq: 340, type: 'triangle', gain: 0.008, attack: 0.002, decay: 0.08, pan: 0.2 })
  }

  land() {
    this.tone({ freq: 88, endFreq: 52, type: 'sine', gain: 0.05, attack: 0.003, decay: 0.18, pan: 0 })
    this.tone({ freq: 280, endFreq: 110, type: 'triangle', gain: 0.01, attack: 0.002, decay: 0.09, pan: 0.1 })
  }

  pet() {
    const base = 610
    ;[1, 1.25, 1.5, 2].forEach((m, i) => {
      this.tone({ freq: base * m, endFreq: base * m * 1.01, type: 'sine', gain: 0.026, attack: 0.02, decay: 0.55, delay: i * 0.075, pan: (i - 1.5) * 0.2 })
    })
  }

  nibble() {
    for (let i = 0; i < 3; i++) {
      this.tone({ freq: 260 + Math.random() * 100, endFreq: 150, type: 'triangle', gain: 0.009, attack: 0.001, decay: 0.045, delay: i * 0.085, pan: 0.25 })
    }
  }

  splash() {
    this.tone({ freq: 420, endFreq: 100, type: 'sine', gain: 0.03, attack: 0.003, decay: 0.3 })
    this.tone({ freq: 1150, endFreq: 500, type: 'triangle', gain: 0.009, attack: 0.003, decay: 0.2 })
  }

  timeOfDay(night) {
    const notes = night ? [392, 523.25, 659.25] : [523.25, 659.25, 783.99]
    notes.forEach((f, i) =>
      this.tone({ freq: f, endFreq: f, type: 'sine', gain: 0.018, attack: 0.08, decay: 1.7, delay: i * 0.16, pan: (i - 1) * 0.4 }),
    )
  }
}
