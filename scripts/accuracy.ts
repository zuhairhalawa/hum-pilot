// Measures pitch accuracy and latency of every detector/tracker version on
// synthetic tones and synthetic hums, and writes docs/accuracy.json.
// Usage: npm run accuracy            full run (all notes)
//        npm run accuracy -- --quick every third note
//        npm run accuracy -- --sweep  also try tracker settings (for tuning)
import { writeFileSync, mkdirSync } from 'node:fs';
import { analyse, detectFrames, track, type DetectorName, type RawFrame } from '../src/pitch/run.ts';
import { score, stepLatency, type Score } from '../src/pitch/metrics.ts';
import { RAW, SHIPPED, type TrackerOptions } from '../src/pitch/tracker.ts';
import { VOICES, synthHum, sine, mulberry32, addPinkNoise, type Note, type Hum } from '../src/synth/hum.ts';

const SR = 48000;
const quick = process.argv.includes('--quick');
const sweep = process.argv.includes('--sweep');

interface Version {
  id: string;
  label: string;
  detector: DetectorName;
  tracker: TrackerOptions;
}

const VERSIONS: Version[] = [
  { id: 'v0', label: 'Autocorrelation peak, no smoothing', detector: 'acf', tracker: RAW },
  { id: 'v1', label: 'YIN, no smoothing', detector: 'yin', tracker: RAW },
  { id: 'v2', label: 'YIN + median of 5', detector: 'yin', tracker: { ...RAW, median: 5 } },
  { id: 'v3', label: 'v2 + jump guard + hangover', detector: 'yin', tracker: { ...SHIPPED, median: 5, clarityWin: 0, freshAfterBreath: false } },
  { id: 'v4', label: 'v3 + clearer reading wins', detector: 'yin', tracker: { ...SHIPPED, median: 5, freshAfterBreath: false } },
  { id: 'v5', label: 'v4 + fresh start after a breath', detector: 'yin', tracker: { ...SHIPPED, median: 5 } },
  { id: 'v6', label: 'v5 with median of 3 (shipped)', detector: 'yin', tracker: SHIPPED },
];

const CONDITIONS: { id: string; label: string; snrDb?: number }[] = [
  { id: 'clean', label: 'Clean hum' },
  { id: 'snr20', label: 'Room noise, SNR 20 dB', snrDb: 20 },
  { id: 'snr10', label: 'Room noise, SNR 10 dB', snrDb: 10 },
  { id: 'snr5', label: 'Room noise, SNR 5 dB (loud fan)', snrDb: 5 },
];

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '-');

function humSet(voiceIdx: number, seed: number, snrDb?: number): Hum {
  const v = VOICES[voiceIdx];
  const notes: Note[] = [{ midi: null, dur: 0.4 }];
  for (let m = v.range[0]; m <= v.range[1]; m += quick ? 3 : 1) notes.push({ midi: m, dur: 1.1 }, { midi: null, dur: 0.35 });
  return synthHum(v, notes, { seed, snrDb, sampleRate: SR });
}

function combine(ss: Score[]): Score {
  const n = ss.reduce((s, x) => s + x.frames, 0);
  const w = (k: keyof Score) => ss.reduce((s, x) => s + (Number.isFinite(x[k]) ? x[k] * x.frames : 0), 0) / n;
  return {
    frames: n,
    detected: w('detected'),
    medianAbsCents: w('medianAbsCents'),
    p95AbsCents: w('p95AbsCents'),
    gross: w('gross'),
    octave: w('octave'),
    wobbleCents: w('wobbleCents'),
    falseVoiced: ss.reduce((s, x) => s + x.falseVoiced, 0) / ss.length,
  };
}

// ---------- signals (built once) ----------
const humSets: Record<string, Hum[]> = {};
for (const cond of CONDITIONS) humSets[cond.id] = VOICES.map((_, vi) => humSet(vi, 100 + vi * 7 + (cond.snrDb ?? 0), cond.snrDb));
const stepSigs: { hum: Hum; stepT: number; b: number }[] = [];
const STEPS = [2, 5, 7, -5, -12, 12];
{
  let trial = 0;
  for (const v of VOICES) {
    for (const st of STEPS) {
      const a = Math.round((v.range[0] + v.range[1]) / 2) - Math.trunc(st / 2);
      const b = a + st;
      // Near-instant note change (10 ms glide) so the number is the system's delay, not the singer's.
      const hum = synthHum(v, [{ midi: null, dur: 0.3 }, { midi: a, dur: 1.0 }, { midi: b, dur: 1.0 }], { seed: 500 + trial++, sampleRate: SR, glide: 0.01 });
      stepSigs.push({ hum, stepT: 1.3, b });
    }
  }
}
const frameCache = new Map<string, RawFrame[]>();
function frames(key: string, h: Hum, det: DetectorName): RawFrame[] {
  const k = `${key}|${det}`;
  if (!frameCache.has(k)) frameCache.set(k, detectFrames(h.samples, SR, det));
  return frameCache.get(k)!;
}

interface Eval {
  control: Record<string, Score>;
  latency: { medianMs: number; worstMs: number; missed: number };
}

function evaluate(det: DetectorName, tr: TrackerOptions): Eval {
  const control: Record<string, Score> = {};
  for (const cond of CONDITIONS) {
    control[cond.id] = combine(humSets[cond.id].map((h, vi) => score(track(frames(`${cond.id}${vi}`, h, det), tr), h.f0, 'tracked', h.intended)));
  }
  const lat = stepSigs.map((s, i) => stepLatency(track(frames(`step${i}`, s.hum, det), tr), s.stepT, s.b, 'tracked'));
  const ok = lat.filter(Number.isFinite).sort((a, b) => a - b);
  return { control, latency: { medianMs: 1000 * ok[ok.length >> 1], worstMs: 1000 * ok[ok.length - 1], missed: lat.length - ok.length } };
}

const line = (id: string, c: Score) =>
  `${id.padEnd(6)} median ${fmt(c.medianAbsCents)} c, p95 ${fmt(c.p95AbsCents)} c, wrong note ${pct(c.gross)}, octave ${pct(c.octave)}, wobble ${fmt(c.wobbleCents)} c, heard ${pct(c.detected)}`;

const results: Record<string, unknown> = { date: new Date().toISOString().slice(0, 10), sampleRate: SR, bufferSamples: 2048, hopMs: 1000 / 60, quick };

// 1. Pure tones: the detector alone.
{
  const hzs: number[] = [];
  for (let i = 0; i < 25; i++) hzs.push(70 * (800 / 70) ** (i / 24));
  const out: Record<string, { medianCents: number; worstCents: number; octaveFrames: number }> = {};
  for (const det of ['acf', 'yin'] as DetectorName[]) {
    const errs: number[] = [];
    for (const hz of hzs) for (const f of analyse(sine(hz, 0.5, SR), SR, det, RAW)) if (f.hz > 0) errs.push(Math.abs(1200 * Math.log2(f.hz / hz)));
    errs.sort((a, b) => a - b);
    out[det] = { medianCents: errs[errs.length >> 1], worstCents: errs[errs.length - 1], octaveFrames: errs.filter((e) => e > 600).length };
    console.log(`sines 70-800 Hz ${det}: median ${fmt(out[det].medianCents, 2)} c, worst ${fmt(out[det].worstCents, 1)} c`);
  }
  results.sines = { tones: hzs.length, ...out };
}

// 2. Detector accuracy against the true f0 (raw frames, before any smoothing).
{
  const out: Record<string, Record<string, Score>> = {};
  for (const det of ['acf', 'yin'] as DetectorName[]) {
    out[det] = {};
    for (const cond of CONDITIONS) {
      out[det][cond.id] = combine(humSets[cond.id].map((h, vi) => score(track(frames(`${cond.id}${vi}`, h, det), RAW), h.f0, 'raw')));
      console.log(`detector ${det} ${line(cond.id, out[det][cond.id])}`);
    }
  }
  results.detector = out;
}

// 3. Control accuracy (what steers the plane) and latency for each version.
const versions: Record<string, Eval & { label: string }> = {};
for (const ver of VERSIONS) {
  const e = evaluate(ver.detector, ver.tracker);
  versions[ver.id] = { label: ver.label, ...e };
  console.log(`== ${ver.id} ${ver.label}`);
  for (const cond of CONDITIONS) console.log('   ' + line(cond.id, e.control[cond.id]));
  console.log(`   latency median ${fmt(e.latency.medianMs, 0)} ms, worst ${fmt(e.latency.worstMs, 0)} ms, missed ${e.latency.missed}/${stepSigs.length}`);
}
results.versions = versions;

// 4. Compute cost per frame.
{
  const fr = detectFrames(synthHum(VOICES[1], [{ midi: 50, dur: 3 }], { seed: 9 }).samples, SR, 'yin');
  const ms = fr.map((f) => f.ms).sort((a, b) => a - b);
  results.computeMs = { median: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)] };
  console.log(`compute yin: median ${fmt(ms[ms.length >> 1], 2)} ms/frame, p95 ${fmt(ms[Math.floor(ms.length * 0.95)], 2)} ms`);
}

// 5. Room noise with nobody humming: share of frames that would move the plane.
{
  const rnd = mulberry32(77);
  const x = new Float32Array(SR * 5);
  addPinkNoise(x, 0, rnd);
  let e = 0;
  for (const v of x) e += v * v;
  const k = 0.01 / Math.sqrt(e / x.length);
  for (let i = 0; i < x.length; i++) x[i] *= k; // about -40 dBFS
  const out: Record<string, number> = {};
  for (const ver of VERSIONS) out[ver.id] = analyse(x, SR, ver.detector, ver.tracker).filter((f) => f.voiced).length / (x.length / (SR / 60));
  results.noiseOnly = out;
  console.log('noise only, share of frames heard as a hum:', out);
}

// 6. Optional settings sweep used while tuning the tracker.
if (sweep) {
  const rows: { opts: TrackerOptions; e: Eval }[] = [];
  for (const median of [3, 5, 7]) {
    for (const minClarity of [0.6, 0.7, 0.75]) {
      for (const noiseRatio of [2, 3]) {
        const opts = { ...SHIPPED, median, minClarity, noiseRatio };
        rows.push({ opts, e: evaluate('yin', opts) });
      }
    }
  }
  console.log('\nsweep (median, minClarity, noiseRatio): clean / snr10 / snr5 wrong-note %, heard %, wobble, latency');
  for (const r of rows) {
    const c = r.e.control;
    console.log(
      `m${r.opts.median} c${r.opts.minClarity} n${r.opts.noiseRatio}: wrong ${pct(c.clean.gross)}/${pct(c.snr10.gross)}/${pct(c.snr5.gross)} heard ${pct(c.clean.detected)}/${pct(c.snr10.detected)}/${pct(c.snr5.detected)} wobble ${fmt(c.clean.wobbleCents)} lat ${fmt(r.e.latency.medianMs, 0)} ms`,
    );
  }
  results.sweep = rows;
}

mkdirSync('docs', { recursive: true });
writeFileSync(quick ? 'docs/accuracy-quick.json' : 'docs/accuracy.json', JSON.stringify(results, null, 2));
console.log('wrote', quick ? 'docs/accuracy-quick.json' : 'docs/accuracy.json');
