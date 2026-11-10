// Synthetic hums for testing. No real voices are used anywhere in the tests.
// A hum is a harmonic source (spectral tilt + nasal-murmur resonances) with
// vibrato, slow pitch drift, period jitter, amplitude shimmer, breath noise at
// the onset and optional room noise. Every sample comes with the true f0, so
// detector error can be measured exactly. Deterministic for a given seed.

export interface Voice {
  name: string;
  /** Comfortable range in MIDI notes (low, high). */
  range: [number, number];
  /** Nasal murmur resonances: [centre Hz, bandwidth Hz, gain]. */
  formants: [number, number, number][];
  /** Spectral tilt in dB per octave (more negative = darker). */
  tiltDb: number;
}

export const VOICES: Voice[] = [
  // Low voice: the 250 Hz murmur sits on harmonics 2-3, so they outweigh the fundamental.
  { name: 'deep', range: [41, 53], formants: [[250, 80, 1], [1100, 200, 0.12], [2300, 300, 0.05]], tiltDb: -6 },
  { name: 'warm', range: [45, 57], formants: [[270, 90, 1], [1200, 220, 0.1], [2400, 300, 0.04]], tiltDb: -8 },
  { name: 'light', range: [53, 65], formants: [[300, 110, 1], [1300, 250, 0.1], [2600, 300, 0.04]], tiltDb: -9 },
  { name: 'high', range: [58, 72], formants: [[330, 120, 1], [1400, 260, 0.08], [2800, 300, 0.03]], tiltDb: -10 },
];

export interface Note {
  midi: number | null; // null = silence
  dur: number; // seconds
}

export interface HumOptions {
  sampleRate?: number;
  seed?: number;
  vibratoCents?: number;
  vibratoHz?: number;
  driftCents?: number;
  jitter?: number; // relative period jitter (0.003 = 0.3 %)
  shimmerDb?: number;
  breath?: number; // breath-noise level relative to voice at onset
  /** Room noise SNR in dB (pink noise). Infinity = clean. */
  snrDb?: number;
  /** Glide time between consecutive notes, seconds. */
  glide?: number;
  level?: number; // peak-ish amplitude of the voice
}

export interface Hum {
  samples: Float32Array;
  f0: Float32Array; // true f0 per sample, 0 = silence
  /** The note the singer means (MIDI, no vibrato or drift), NaN = silence. */
  intended: Float32Array;
  sampleRate: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resonance(f: number, F: number, B: number): number {
  const F2 = F * F;
  return F2 / Math.sqrt((F2 - f * f) ** 2 + (B * f) ** 2);
}

export function humSpectrum(voice: Voice, f0: number, nyq: number): Float32Array {
  const K = Math.max(1, Math.floor(Math.min(5000, nyq * 0.9) / f0));
  const amps = new Float32Array(K);
  for (let k = 1; k <= K; k++) {
    const f = k * f0;
    let env = 0.08; // a little broadband energy so no harmonic is exactly zero
    for (const [F, B, g] of voice.formants) env += g * resonance(f, F, B);
    amps[k - 1] = env * 10 ** ((voice.tiltDb * Math.log2(k)) / 20);
  }
  let norm = 0;
  for (const a of amps) norm += a * a;
  norm = Math.sqrt(norm);
  for (let i = 0; i < K; i++) amps[i] /= norm;
  return amps;
}

export function synthHum(voice: Voice, notes: Note[], opts: HumOptions = {}): Hum {
  const sr = opts.sampleRate ?? 48000;
  const rnd = mulberry32(opts.seed ?? 1);
  const vibC = opts.vibratoCents ?? 25;
  const vibHz = opts.vibratoHz ?? 5.2 + rnd() * 0.8;
  const driftC = opts.driftCents ?? 12;
  const jitter = opts.jitter ?? 0.003;
  const shimmerDb = opts.shimmerDb ?? 0.8;
  const breath = opts.breath ?? 0.25;
  const glide = opts.glide ?? 0.06;
  const level = opts.level ?? 0.25;
  const total = Math.round(notes.reduce((s, n) => s + n.dur, 0) * sr);
  const samples = new Float32Array(total);
  const f0 = new Float32Array(total);

  // Build the target pitch (midi) per sample with short glides between sounding notes.
  const target = new Float32Array(total).fill(NaN);
  let i0 = 0;
  for (const n of notes) {
    const len = Math.round(n.dur * sr);
    if (n.midi !== null) target.fill(n.midi, i0, i0 + len);
    i0 += len;
  }
  // Envelope: attack/release on every sounding run.
  const env = new Float32Array(total);
  const att = Math.round(0.07 * sr);
  const rel = Math.round(0.09 * sr);
  for (let i = 0; i < total; i++) env[i] = Number.isNaN(target[i]) ? 0 : 1;
  const envS = new Float32Array(total);
  let e = 0;
  for (let i = 0; i < total; i++) {
    e += env[i] > e ? (1 - e) / att : -(e / rel);
    if (e < 0) e = 0;
    envS[i] = e;
  }

  let phase = 0;
  let drift = 0;
  let driftV = 0;
  let shimmer = 0;
  let glidePitch = NaN;
  let amps: Float32Array = new Float32Array(1);
  let ampsAt = -1;
  let periodJit = 0;
  let nextJit = 0;
  const glideCoef = 1 - Math.exp(-1 / (glide * sr));
  for (let i = 0; i < total; i++) {
    const t = target[i];
    const fresh = i === 0 || Number.isNaN(target[i - 1]);
    if (!Number.isNaN(t)) {
      // A note after a breath starts on pitch; legato notes glide into each other.
      glidePitch = Number.isNaN(glidePitch) || fresh ? t : glidePitch + (t - glidePitch) * glideCoef;
    } else if (envS[i] < 1e-4) {
      glidePitch = NaN;
    }
    if (Number.isNaN(glidePitch) || envS[i] < 1e-4) continue;
    // Slow drift: a damped random walk in cents.
    driftV += (rnd() - 0.5) * 0.02 - driftV * 0.0005 - drift * 0.0000004;
    drift += driftV * 0.001;
    const driftCents = Math.max(-1, Math.min(1, drift)) * driftC;
    const vib = vibC * Math.sin((2 * Math.PI * vibHz * i) / sr) * Math.min(1, envS[i] * 1.5);
    const midi = glidePitch + (vib + driftCents) / 100;
    if (phase >= nextJit) {
      periodJit = (rnd() - 0.5) * 2 * jitter;
      nextJit = Math.floor(phase) + 1;
    }
    const hz = 440 * 2 ** ((midi - 69) / 12) * (1 + periodJit);
    f0[i] = 440 * 2 ** ((midi - 69) / 12);
    if (i - ampsAt >= 256 || ampsAt < 0) {
      amps = humSpectrum(voice, hz, sr / 2);
      ampsAt = i;
      shimmer += (rnd() - 0.5) * 0.3;
      shimmer *= 0.97;
    }
    phase += hz / sr;
    let s = 0;
    const p = 2 * Math.PI * phase;
    for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin((k + 1) * p);
    const g = level * envS[i] * 10 ** ((shimmer * shimmerDb) / 20);
    // Breath noise strongest during the attack.
    const breathy = breath * (1 - Math.min(1, envS[i])) * 2 + breath * 0.08;
    samples[i] = g * (s + breathy * (rnd() * 2 - 1));
  }

  if (opts.snrDb !== undefined && Number.isFinite(opts.snrDb)) addPinkNoise(samples, opts.snrDb, rnd, envS);
  const intended = new Float32Array(total).fill(NaN);
  for (let i = 0; i < total; i++) if (f0[i] > 0) intended[i] = target[i];
  return { samples, f0, intended, sampleRate: sr };
}

/** Pink noise (Paul Kellet filter) scaled to the given SNR against the voiced part of the signal. */
export function addPinkNoise(x: Float32Array, snrDb: number, rnd: () => number, voicedEnv?: Float32Array): void {
  let sig = 0;
  let cnt = 0;
  for (let i = 0; i < x.length; i++) {
    if (!voicedEnv || voicedEnv[i] > 0.5) {
      sig += x[i] * x[i];
      cnt++;
    }
  }
  const sigRms = Math.sqrt(sig / Math.max(1, cnt));
  const noise = new Float32Array(x.length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let nn = 0;
  for (let i = 0; i < x.length; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    noise[i] = v;
    nn += v * v;
  }
  const nRms = Math.sqrt(nn / x.length);
  const k = (sigRms / 10 ** (snrDb / 20)) / (nRms || 1);
  for (let i = 0; i < x.length; i++) x[i] += noise[i] * k;
}

export function sine(hz: number, seconds: number, sr = 48000, amp = 0.3): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}

/** 16-bit PCM mono WAV. */
export function wavBytes(x: Float32Array, sr: number): Uint8Array {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + x.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return new Uint8Array(buf);
}
