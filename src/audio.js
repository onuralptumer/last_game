// Procedural audio: every sound in the game is synthesized with WebAudio.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.55;
    this.intensity = 0; // 0 = calm, 1 = combat
    this._nextBeat = 0;
    this._beatIndex = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.comp);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = this.musicVolume;
    this.music.connect(this.master);

    // Shared reverb send for that cavernous arena feel.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    this.noiseBuf = this._noiseBuffer(2);
    this._startAmbience();
  }

  setVolumes(sfx, music) {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // Output chain for a single voice: gain -> panner -> sfx (+ reverb send).
  _out(vol = 1, pan = 0, wet = 0.3) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(this.sfx);
    if (wet > 0) {
      const s = ctx.createGain();
      s.gain.value = wet;
      p.connect(s);
      s.connect(this.reverbSend);
    }
    return g;
  }

  _noise(dest, { dur = 0.2, type = 'lowpass', freq = 1200, freqEnd = null, q = 0.7, gain = 1, attack = 0.002, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  _tone(dest, { freq = 440, freqEnd = null, dur = 0.2, type = 'sine', gain = 0.5, attack = 0.003, when = 0, curve = 'exp' }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
      else o.frequency.linearRampToValueAtTime(freqEnd, t + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, { vol = 1, pan = 0 } = {}) {
    if (!this.ctx || vol < 0.01) return;
    const r = (a, b) => a + Math.random() * (b - a);
    let o;
    switch (name) {
      case 'pistol':
        o = this._out(0.7 * vol, pan, 0.35);
        this._noise(o, { dur: 0.18, freq: 4200, freqEnd: 500, gain: 0.9 });
        this._tone(o, { freq: 180, freqEnd: 50, dur: 0.14, type: 'triangle', gain: 0.8 });
        this._tone(o, { freq: r(1400, 1600), freqEnd: 300, dur: 0.05, type: 'square', gain: 0.12 });
        break;
      case 'rifle':
        o = this._out(0.5 * vol, pan, 0.3);
        this._noise(o, { dur: 0.11, freq: r(3000, 3800), freqEnd: 600, gain: 0.9 });
        this._tone(o, { freq: r(140, 160), freqEnd: 45, dur: 0.1, type: 'triangle', gain: 0.8 });
        break;
      case 'shotgun':
        o = this._out(0.85 * vol, pan, 0.45);
        this._noise(o, { dur: 0.45, freq: 2600, freqEnd: 180, gain: 1 });
        this._tone(o, { freq: 120, freqEnd: 30, dur: 0.35, type: 'sine', gain: 1 });
        this._noise(o, { dur: 0.08, type: 'highpass', freq: 5000, gain: 0.4 });
        // pump
        this._noise(o, { dur: 0.06, type: 'bandpass', freq: 1800, q: 4, gain: 0.5, when: 0.42 });
        this._noise(o, { dur: 0.07, type: 'bandpass', freq: 1200, q: 4, gain: 0.5, when: 0.55 });
        break;
      case 'rail':
        o = this._out(0.8 * vol, pan, 0.6);
        this._tone(o, { freq: 2400, freqEnd: 90, dur: 0.7, type: 'sawtooth', gain: 0.35 });
        this._tone(o, { freq: 70, freqEnd: 30, dur: 0.6, type: 'sine', gain: 1 });
        this._noise(o, { dur: 0.6, type: 'bandpass', freq: 6000, freqEnd: 400, q: 1.5, gain: 0.6 });
        break;
      case 'railCharge':
        o = this._out(0.25 * vol, pan, 0.2);
        this._tone(o, { freq: 300, freqEnd: 1800, dur: 0.6, type: 'sine', gain: 0.4, curve: 'lin' });
        break;
      case 'launcher':
        o = this._out(0.7 * vol, pan, 0.4);
        this._noise(o, { dur: 0.3, freq: 900, freqEnd: 150, gain: 0.9 });
        this._tone(o, { freq: 220, freqEnd: 60, dur: 0.25, type: 'square', gain: 0.25 });
        break;
      case 'explosion':
        o = this._out(1.0 * vol, pan, 0.7);
        this._noise(o, { dur: 1.3, freq: 1600, freqEnd: 60, gain: 1, attack: 0.005 });
        this._tone(o, { freq: 90, freqEnd: 22, dur: 1.0, type: 'sine', gain: 1 });
        break;
      case 'reload':
        o = this._out(0.45 * vol, pan, 0.1);
        this._noise(o, { dur: 0.05, type: 'bandpass', freq: 2500, q: 5, gain: 0.7 });
        this._noise(o, { dur: 0.06, type: 'bandpass', freq: 1500, q: 5, gain: 0.7, when: 0.35 });
        this._tone(o, { freq: 900, freqEnd: 600, dur: 0.04, type: 'square', gain: 0.1, when: 0.36 });
        break;
      case 'empty':
        o = this._out(0.4 * vol, pan, 0.05);
        this._noise(o, { dur: 0.03, type: 'bandpass', freq: 3500, q: 8, gain: 0.8 });
        break;
      case 'hit':
        o = this._out(0.35 * vol, 0, 0);
        this._tone(o, { freq: 1900, freqEnd: 1300, dur: 0.05, type: 'triangle', gain: 0.5 });
        break;
      case 'crit':
        o = this._out(0.45 * vol, 0, 0);
        this._tone(o, { freq: 2600, freqEnd: 2100, dur: 0.08, type: 'triangle', gain: 0.5 });
        this._tone(o, { freq: 3900, dur: 0.06, type: 'sine', gain: 0.3, when: 0.02 });
        break;
      case 'kill':
        o = this._out(0.5 * vol, 0, 0.1);
        this._tone(o, { freq: 520, freqEnd: 260, dur: 0.18, type: 'square', gain: 0.18 });
        this._tone(o, { freq: 1040, freqEnd: 780, dur: 0.12, type: 'sine', gain: 0.35, when: 0.03 });
        break;
      case 'gore':
        o = this._out(0.6 * vol, pan, 0.3);
        this._noise(o, { dur: 0.35, freq: 700, freqEnd: 120, gain: 0.9 });
        this._tone(o, { freq: 110, freqEnd: 40, dur: 0.3, type: 'sawtooth', gain: 0.3 });
        break;
      case 'hurt':
        o = this._out(0.7 * vol, pan, 0.1);
        this._tone(o, { freq: 90, freqEnd: 45, dur: 0.25, type: 'sawtooth', gain: 0.5 });
        this._noise(o, { dur: 0.15, freq: 900, gain: 0.6 });
        break;
      case 'dash':
        o = this._out(0.5 * vol, 0, 0.2);
        this._noise(o, { dur: 0.3, type: 'bandpass', freq: 600, freqEnd: 3500, q: 1.2, gain: 0.8 });
        break;
      case 'jump':
        o = this._out(0.2 * vol, 0, 0);
        this._noise(o, { dur: 0.08, freq: 900, gain: 0.5 });
        break;
      case 'land':
        o = this._out(0.35 * vol, 0, 0.05);
        this._noise(o, { dur: 0.12, freq: 500, gain: 0.8 });
        this._tone(o, { freq: 80, freqEnd: 40, dur: 0.1, gain: 0.5 });
        break;
      case 'step':
        o = this._out(0.12 * vol, r(-0.2, 0.2), 0);
        this._noise(o, { dur: 0.07, type: 'bandpass', freq: r(500, 900), q: 1, gain: 0.7 });
        break;
      case 'pickup':
        o = this._out(0.4 * vol, 0, 0.2);
        this._tone(o, { freq: 660, dur: 0.12, type: 'sine', gain: 0.4 });
        this._tone(o, { freq: 990, dur: 0.18, type: 'sine', gain: 0.35, when: 0.07 });
        break;
      case 'shard':
        o = this._out(0.22 * vol, 0, 0.3);
        this._tone(o, { freq: r(1700, 2300), dur: 0.15, type: 'sine', gain: 0.4 });
        break;
      case 'growl':
        o = this._out(0.4 * vol, pan, 0.4);
        this._tone(o, { freq: r(70, 95), freqEnd: r(45, 60), dur: 0.7, type: 'sawtooth', gain: 0.35 });
        this._noise(o, { dur: 0.6, type: 'bandpass', freq: 400, q: 3, gain: 0.5 });
        break;
      case 'shriek':
        o = this._out(0.35 * vol, pan, 0.5);
        this._tone(o, { freq: r(900, 1200), freqEnd: r(2200, 2800), dur: 0.35, type: 'sawtooth', gain: 0.2 });
        this._noise(o, { dur: 0.35, type: 'bandpass', freq: 3000, q: 4, gain: 0.4 });
        break;
      case 'swipe':
        o = this._out(0.35 * vol, pan, 0.2);
        this._noise(o, { dur: 0.18, type: 'bandpass', freq: 1500, freqEnd: 400, q: 2, gain: 0.7 });
        break;
      case 'wispShot':
        o = this._out(0.35 * vol, pan, 0.5);
        this._tone(o, { freq: 600, freqEnd: 200, dur: 0.3, type: 'sine', gain: 0.5 });
        this._tone(o, { freq: 1210, freqEnd: 400, dur: 0.25, type: 'triangle', gain: 0.2 });
        break;
      case 'wispCharge':
        o = this._out(0.2 * vol, pan, 0.4);
        this._tone(o, { freq: 200, freqEnd: 700, dur: 0.5, type: 'sine', gain: 0.4, curve: 'lin' });
        break;
      case 'slam':
        o = this._out(1.0 * vol, pan, 0.6);
        this._noise(o, { dur: 0.9, freq: 500, freqEnd: 40, gain: 1 });
        this._tone(o, { freq: 60, freqEnd: 20, dur: 0.8, type: 'sine', gain: 1 });
        break;
      case 'roar':
        o = this._out(0.9 * vol, pan, 0.8);
        this._tone(o, { freq: 55, freqEnd: 35, dur: 2.2, type: 'sawtooth', gain: 0.5 });
        this._tone(o, { freq: 82, freqEnd: 50, dur: 2.0, type: 'sawtooth', gain: 0.35 });
        this._noise(o, { dur: 2.0, type: 'bandpass', freq: 300, freqEnd: 120, q: 2, gain: 0.7, attack: 0.3 });
        break;
      case 'spawn':
        o = this._out(0.3 * vol, pan, 0.6);
        this._noise(o, { dur: 0.8, type: 'bandpass', freq: 200, freqEnd: 1600, q: 3, gain: 0.6, attack: 0.3 });
        break;
      case 'waveStart':
        o = this._out(0.8 * vol, 0, 0.9);
        this._tone(o, { freq: 55, dur: 2.8, type: 'sawtooth', gain: 0.35, attack: 0.4 });
        this._tone(o, { freq: 82.4, dur: 2.8, type: 'sawtooth', gain: 0.25, attack: 0.5 });
        this._tone(o, { freq: 110, dur: 2.5, type: 'square', gain: 0.08, attack: 0.6 });
        break;
      case 'waveClear':
        o = this._out(0.6 * vol, 0, 0.8);
        [261.6, 311.1, 392, 523.2].forEach((f, i) =>
          this._tone(o, { freq: f, dur: 1.6, type: 'triangle', gain: 0.25, when: i * 0.12, attack: 0.02 })
        );
        break;
      case 'thunder':
        o = this._out(0.9 * vol, pan, 0.9);
        this._noise(o, { dur: 3.5, freq: 400, freqEnd: 50, gain: 1, attack: 0.08 });
        this._noise(o, { dur: 0.4, freq: 2500, freqEnd: 300, gain: 0.5, when: 0 });
        break;
      case 'ui':
        o = this._out(0.25 * vol, 0, 0.1);
        this._tone(o, { freq: 1200, freqEnd: 900, dur: 0.06, type: 'triangle', gain: 0.4 });
        break;
      case 'uiHover':
        o = this._out(0.1 * vol, 0, 0);
        this._tone(o, { freq: 2200, dur: 0.03, type: 'sine', gain: 0.3 });
        break;
      case 'buy':
        o = this._out(0.4 * vol, 0, 0.3);
        this._tone(o, { freq: 392, dur: 0.12, type: 'triangle', gain: 0.4 });
        this._tone(o, { freq: 587, dur: 0.25, type: 'triangle', gain: 0.4, when: 0.08 });
        break;
      case 'deny':
        o = this._out(0.3 * vol, 0, 0);
        this._tone(o, { freq: 160, dur: 0.18, type: 'square', gain: 0.25 });
        break;
      case 'switch':
        o = this._out(0.3 * vol, 0, 0.05);
        this._noise(o, { dur: 0.05, type: 'bandpass', freq: 2000, q: 6, gain: 0.6 });
        this._noise(o, { dur: 0.05, type: 'bandpass', freq: 1300, q: 6, gain: 0.5, when: 0.12 });
        break;
      case 'heartbeat':
        o = this._out(0.6 * vol, 0, 0);
        this._tone(o, { freq: 60, freqEnd: 35, dur: 0.15, gain: 0.9 });
        this._tone(o, { freq: 55, freqEnd: 32, dur: 0.15, gain: 0.7, when: 0.22 });
        break;
      case 'death':
        o = this._out(0.9 * vol, 0, 0.9);
        this._tone(o, { freq: 220, freqEnd: 30, dur: 3, type: 'sawtooth', gain: 0.3 });
        this._noise(o, { dur: 3, freq: 600, freqEnd: 40, gain: 0.6 });
        break;
      case 'secondWind':
        o = this._out(0.6 * vol, 0, 0.8);
        this._tone(o, { freq: 300, freqEnd: 1200, dur: 0.8, type: 'triangle', gain: 0.4 });
        break;
    }
  }

  // --- Ambience & adaptive music -------------------------------------------------
  _startAmbience() {
    const ctx = this.ctx;
    // Rain: filtered noise bed.
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 900;
    const rf2 = ctx.createBiquadFilter();
    rf2.type = 'lowpass';
    rf2.frequency.value = 7000;
    const rg = ctx.createGain();
    rg.gain.value = 0.07;
    rain.connect(rf);
    rf.connect(rf2);
    rf2.connect(rg);
    rg.connect(this.sfx);
    rain.start();

    // Drone pad: detuned saws under a slow-moving lowpass.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneFilter.Q.value = 6;
    const dg = ctx.createGain();
    dg.gain.value = 0.16;
    this.droneFilter.connect(dg);
    dg.connect(this.music);
    const ds = ctx.createGain();
    ds.gain.value = 0.5;
    dg.connect(ds);
    ds.connect(this.reverbSend);
    [36.7, 36.95, 55.0, 73.4].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start();
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = ctx.createGain();
    lg.gain.value = 120;
    lfo.connect(lg);
    lg.connect(this.droneFilter.frequency);
    lfo.start();

    this._nextBeat = ctx.currentTime + 0.5;
  }

  // Called each frame; schedules a pulsing combat beat when intensity is high.
  update(intensityTarget) {
    if (!this.ctx) return;
    this.intensity += (intensityTarget - this.intensity) * 0.02;
    const ctx = this.ctx;
    this.droneFilter.frequency.setTargetAtTime(220 + this.intensity * 500, ctx.currentTime, 0.5);
    const beat = 60 / 104 / 2; // eighth notes
    const bass = [36.7, 36.7, 43.6, 36.7, 41.2, 36.7, 49.0, 46.2];
    while (this._nextBeat < ctx.currentTime + 0.15) {
      const t = this._nextBeat - ctx.currentTime;
      const i = this._beatIndex++;
      if (this.intensity > 0.25) {
        const v = Math.min(1, (this.intensity - 0.25) * 1.6);
        if (i % 4 === 0) this._tone(this.music, { freq: 110, freqEnd: 38, dur: 0.35, gain: 0.55 * v, when: Math.max(0, t) });
        if (i % 8 === 4) this._noise(this.music, { dur: 0.2, type: 'bandpass', freq: 1800, q: 0.8, gain: 0.18 * v, when: Math.max(0, t) });
        if (i % 2 === 1) this._noise(this.music, { dur: 0.04, type: 'highpass', freq: 8000, gain: 0.06 * v, when: Math.max(0, t) });
        if (i % 2 === 0)
          this._tone(this.music, { freq: bass[(i / 2) % 8 | 0] * 2, dur: 0.25, type: 'sawtooth', gain: 0.09 * v, when: Math.max(0, t) });
      }
      this._nextBeat += beat;
    }
  }
}
