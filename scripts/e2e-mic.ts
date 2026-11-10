// Browser test of the real microphone path. Edge is started with a fake microphone
// that plays a synthetic hum (test/fixtures/*.wav, made by `npm run fixtures`):
// warm-up, then the tune the gates spell. Checks the range the game found, which
// gates were threaded or missed, and compares the browser's pitch trace with an
// offline run of the same detector on the same file (extra delay in the browser).
// Usage: node --experimental-strip-types scripts/e2e-mic.ts [base-url] [fixture names...]
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyse } from '../src/pitch/run.ts';
import { SHIPPED } from '../src/pitch/tracker.ts';

const BASE = process.argv[2] ?? 'http://localhost:5193';
const names = process.argv.slice(3).length ? process.argv.slice(3) : ['flight-warm', 'flight-high-noisy', 'flight-two-misses', 'practice-light'];
const SHOTS = resolve('shots/e2e');
mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve('../video/node_modules/playwright/index.mjs')).href);

function readWav(path: string): { x: Float32Array; sr: number } {
  const b = readFileSync(path);
  const sr = b.readUInt32LE(24);
  const n = b.readUInt32LE(40) / 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  return { x, sr };
}

/** First time >= from at which the trace sits within half a semitone of `note` for 3 frames. */
function settle(trace: { t: number; midi: number | null }[], from: number, note: number): number {
  for (let i = 0; i + 2 < trace.length; i++) {
    if (trace[i].t < from) continue;
    if ([0, 1, 2].every((k) => trace[i + k].midi !== null && Math.abs(trace[i + k].midi! - note) < 0.5)) return trace[i].t;
  }
  return NaN;
}

const report: Record<string, unknown>[] = [];
let failed = false;
for (const name of names) {
  const meta = JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8'));
  const wav = resolve(`test/fixtures/${name}.wav`);
  const profile = resolve(`test-results/profile-${name}`);
  rmSync(profile, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    viewport: { width: 1280, height: 820 },
    permissions: ['microphone'],
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(String(e)));
  page.on('console', (m: { type(): string; text(): string }) => m.type() === 'error' && errors.push(m.text()));
  if (name.startsWith('practice')) {
    await page.goto(`${BASE}/?pseed=${meta.pseed}`);
    await page.click('[data-act=practice]');
    await page.waitForFunction(() => (window as any).__hum.mode === 'practice', null, { timeout: 20000 });
    await page.waitForFunction(() => (window as any).__hum.practice?.i >= 2, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${name}-ring.png` });
    await page.waitForFunction(() => (window as any).__hum.mode === 'practiceDone', null, { timeout: 60000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-done.png` });
    const st = await page.evaluate(() => ({ range: (window as any).__hum.range, results: (window as any).__hum.practice.results }));
    await ctx.close();
    const matched = st.results.filter((r: { matched: boolean }) => r.matched).length;
    const notesOk = JSON.stringify(st.results.map((r: { note: number }) => r.note)) === JSON.stringify(meta.targets);
    const ok = matched === meta.targets.length && notesOk && errors.length === 0 && st.range?.low === meta.range.low && st.range?.high === meta.range.high;
    if (!ok) failed = true;
    const row = { fixture: name, ok, range: st.range, matched: `${matched}/${meta.targets.length}`, cents: st.results.map((r: { cents: number | null }) => r.cents), errors };
    console.log(JSON.stringify(row));
    report.push(row);
    continue;
  }
  await page.goto(`${BASE}/?seed=${meta.seed}&gates=${meta.gates.length}`);
  await page.click('[data-act=fly]');
  await page.waitForFunction(() => (window as any).__hum.mode === 'ready', null, { timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/${name}-ready.png` });
  await page.waitForFunction(() => (window as any).__hum.mode === 'flying', null, { timeout: 15000 });
  await page.waitForFunction(() => (window as any).__hum.flightT > 9, null, { timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/${name}-flight.png` });
  await page.waitForFunction(() => (window as any).__hum.mode === 'result', null, { timeout: 40000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}-result.png` });
  const st = await page.evaluate(() => {
    const h = (window as any).__hum;
    return { range: h.range, passes: h.passes, threaded: h.threaded, gates: h.gates, log: h.flightLog, detectMs: h.detectMsMedian, baseLatency: h.baseLatency, sampleRate: h.sampleRate };
  });
  await ctx.close();

  // Offline run of the same detector on the same file, anchored the same way (t = 0 at take-off).
  const { x, sr } = readWav(wav);
  const off = analyse(x, sr, 'yin', SHIPPED);
  const takeoff = off.find((f) => f.t > meta.tuneStart - 0.3 && f.voiced)!.t;
  const offTrace = off.filter((f) => f.t >= takeoff).map((f) => ({ t: f.t - takeoff, midi: f.midi }));
  const brTrace = st.log as { t: number; midi: number | null }[];
  const deltas: number[] = [];
  const lat: number[] = [];
  meta.tune.forEach((n: { note: number; from: number }, k: number) => {
    if (k === 0 || meta.tune[k - 1].note === n.note) return;
    const changeAt = n.from + (meta.tuneStart - takeoff); // in take-off time
    const a = settle(offTrace, changeAt, n.note);
    const b = settle(brTrace, changeAt - 0.2, n.note);
    if (Number.isFinite(a) && Number.isFinite(b)) deltas.push(b - a);
    if (Number.isFinite(a)) lat.push(a - changeAt);
  });
  const med = (v: number[]) => [...v].sort((p, q) => p - q)[v.length >> 1];
  const missed = (st.passes as { gate: number; ok: boolean }[]).filter((p) => !p.ok).map((p) => p.gate);
  const rangeOk = st.range && st.range.low === meta.range.low && st.range.high === meta.range.high;
  const missOk = JSON.stringify(missed) === JSON.stringify(meta.expectMissed);
  const sameGates = JSON.stringify(st.gates.map((g: { note: number }) => g.note)) === JSON.stringify(meta.gates.map((g: { note: number }) => g.note));
  const ok = rangeOk && missOk && sameGates && errors.length === 0;
  if (!ok) failed = true;
  const row = {
    fixture: name,
    ok,
    range: st.range,
    expectedRange: meta.range,
    threaded: `${st.threaded}/${meta.gates.length}`,
    missed,
    expectMissed: meta.expectMissed,
    centsOff: (st.passes as { centsOff: number | null }[]).map((p) => p.centsOff),
    noteChanges: deltas.length,
    browserMinusOfflineMs: { median: Math.round(1000 * med(deltas)), min: Math.round(1000 * Math.min(...deltas)), max: Math.round(1000 * Math.max(...deltas)) },
    offlineSettleMs: { median: Math.round(1000 * med(lat)), max: Math.round(1000 * Math.max(...lat)) },
    detectMsMedian: st.detectMs,
    baseLatencyMs: st.baseLatency !== null ? Math.round(st.baseLatency * 1000 * 10) / 10 : null,
    sampleRate: st.sampleRate,
    errors,
  };
  console.log(JSON.stringify(row));
  report.push(row);
}
writeFileSync('test-results/e2e-mic.json', JSON.stringify({ base: BASE, date: new Date().toISOString(), report }, null, 2));
process.exit(failed ? 1 : 0);
