// Microphone -> YIN -> tracker, once per animation frame.
// Browser voice processing is switched off: noise suppression treats a steady
// hum as noise and can erase it, and auto gain makes the noise floor jump.

import { Yin } from '../pitch/yin.ts';
import { Tracker, rmsOf, type TrackerOutput } from '../pitch/tracker.ts';

export interface MicFrame extends TrackerOutput {
  hz: number;
  clarity: number;
  rms: number;
  ms: number; // time spent on pitch detection this frame
}

export class Mic {
  ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private buf = new Float32Array(2048);
  private yin: Yin | null = null;
  readonly tracker = new Tracker();
  /** While > now (ms), input is ignored (the game is playing a reference note). */
  muteUntil = 0;

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get running(): boolean {
    return !!this.analyser;
  }

  async start(): Promise<void> {
    if (this.analyser) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.yin = new Yin(this.ctx.sampleRate);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
  }

  read(): MicFrame | null {
    if (!this.analyser || !this.yin) return null;
    this.analyser.getFloatTimeDomainData(this.buf);
    const t0 = performance.now();
    const p = this.yin.detect(this.buf);
    const ms = performance.now() - t0;
    const rms = rmsOf(this.buf);
    const muted = performance.now() < this.muteUntil;
    const r = muted ? this.tracker.push(0, 0, 0) : this.tracker.push(p.hz, p.clarity, rms);
    return { ...r, hz: p.hz, clarity: p.clarity, rms, ms };
  }
}

/** Small sound effects. Pass/crash are noise bursts on purpose: they have no pitch, so if they
 * leak from the speakers into the microphone they cannot steer the plane. */
export class Sfx {
  enabled = true;
  private readonly getCtx: () => AudioContext | null;
  constructor(getCtx: () => AudioContext | null) {
    this.getCtx = getCtx;
  }

  private noise(dur: number, freq: number, q: number, gain: number): void {
    const ctx = this.getCtx();
    if (!ctx || !this.enabled) return;
    const n = Math.round(ctx.sampleRate * dur);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const s = ctx.createBufferSource();
    s.buffer = b;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(ctx.destination);
    s.start();
  }

  pass(): void {
    this.noise(0.12, 2600, 1.2, 0.5); // a paper "fwip"
  }

  crash(): void {
    this.noise(0.35, 500, 0.7, 0.9); // a crumple
  }

  /** Reference tone for practice. The caller mutes the mic while it plays. */
  tone(hz: number, seconds = 1): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.04);
    g.gain.setValueAtTime(0.18, t + seconds - 0.15);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + seconds + 0.02);
  }
}
