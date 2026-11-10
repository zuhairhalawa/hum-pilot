// Builds the fake-microphone recordings used by the browser tests (and the demo video).
// A synthetic voice does the warm-up (lowest note, breath, highest note), pauses,
// then hums the tune that the level's gates spell out, so a perfect run threads
// every gate. Writes test/fixtures/<name>.wav and <name>.json (the schedule).
// Usage: npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs';
import { VOICES, synthHum, wavBytes, type Note } from '../src/synth/hum.ts';
import { makeLevel, practiceTargets, hashSeed } from '../src/game/level.ts';
import { mulberry32 } from '../src/synth/hum.ts';
import { noteName } from '../src/pitch/notes.ts';

const SR = 48000;

interface Spec {
  name: string;
  voice: string;
  low: number;
  high: number;
  seed: string;
  gates: number;
  snrDb?: number;
  /** Hum this many semitones off the gate's note (to test misses). */
  detune?: (i: number) => number;
}

const SPECS: Spec[] = [
  { name: 'flight-warm', voice: 'warm', low: 46, high: 56, seed: 'e2e', gates: 12 },
  { name: 'flight-high-noisy', voice: 'high', low: 60, high: 70, seed: 'e2e2', gates: 12, snrDb: 15 },
  // Hums gate 4 and gate 8 three semitones too high: those two gates must be missed.
  { name: 'flight-two-misses', voice: 'deep', low: 41, high: 51, seed: 'e2e3', gates: 12, detune: (i) => (i === 4 || i === 8 ? 3.5 : 0) },
];

mkdirSync('test/fixtures', { recursive: true });

// Practice: warm-up, then each target note for 2.2 s with a breath between.
{
  const voice = VOICES.find((v) => v.name === 'light')!;
  const range = { low: 53, high: 64 };
  const targets = practiceTargets(range, mulberry32(hashSeed('p1-0')));
  const notes: Note[] = [{ midi: null, dur: 0.6 }, { midi: range.low, dur: 2.6 }, { midi: null, dur: 1.0 }, { midi: range.high, dur: 2.6 }, { midi: null, dur: 0.8 }];
  for (const t of targets) notes.push({ midi: t, dur: 2.2 }, { midi: null, dur: 0.4 });
  notes.push({ midi: null, dur: 3 });
  const hum = synthHum(voice, notes, { seed: 8, sampleRate: SR });
  writeFileSync('test/fixtures/practice-light.wav', wavBytes(hum.samples, SR));
  writeFileSync('test/fixtures/practice-light.json', JSON.stringify({ pseed: 'p1', range, targets, names: targets.map(noteName) }, null, 2));
  console.log('practice-light:', targets.map(noteName).join(' '));
}
// Demo video: warm-up, the 12-gate tune for seed "demo", a pause on the result,
// then the first three practice notes for pseed "demo".
{
  const voice = VOICES.find((v) => v.name === 'light')!;
  const range = { low: 53, high: 64 };
  const gates = makeLevel(range, 'demo', { gates: 12 });
  const notes: Note[] = [{ midi: null, dur: 0.6 }, { midi: range.low, dur: 2.6 }, { midi: null, dur: 1.0 }, { midi: range.high, dur: 2.6 }, { midi: null, dur: 1.6 }];
  const tuneStart = notes.reduce((a, n) => a + n.dur, 0);
  gates.forEach((g, i) => {
    const from = i === 0 ? 0 : (gates[i - 1].time + g.time) / 2;
    const to = i === gates.length - 1 ? g.time + 0.8 : (g.time + gates[i + 1].time) / 2;
    notes.push({ midi: g.note, dur: to - from });
  });
  const tuneEnd = notes.reduce((a, n) => a + n.dur, 0);
  const practiceStart = Math.ceil(tuneEnd + 11);
  notes.push({ midi: null, dur: practiceStart - tuneEnd });
  const targets = practiceTargets(range, mulberry32(hashSeed('demo-0'))).slice(0, 3);
  for (const t of targets) notes.push({ midi: t, dur: 2.2 }, { midi: null, dur: 0.5 });
  notes.push({ midi: null, dur: 4 });
  const hum = synthHum(voice, notes, { seed: 5, sampleRate: SR, glide: 0.05 });
  writeFileSync('test/fixtures/demo.wav', wavBytes(hum.samples, SR));
  writeFileSync(
    'test/fixtures/demo.json',
    JSON.stringify({ seed: 'demo', pseed: 'demo', range, tuneStart, tuneEnd, practiceStart, gates: gates.map((g) => noteName(g.note)), practice: targets.map(noteName), seconds: hum.samples.length / SR }, null, 2),
  );
  console.log(`demo: ${(hum.samples.length / SR).toFixed(1)} s, tune ${gates.map((g) => noteName(g.note)).join(' ')}, practice at ${practiceStart}s: ${targets.map(noteName).join(' ')}`);
}
for (const s of SPECS) {
  const voice = VOICES.find((v) => v.name === s.voice)!;
  const gates = makeLevel({ low: s.low, high: s.high }, s.seed, { gates: s.gates });
  const notes: Note[] = [
    { midi: null, dur: 0.6 },
    { midi: s.low, dur: 2.6 }, // warm-up step 1 needs 1.5 s of it
    { midi: null, dur: 1.0 },
    { midi: s.high, dur: 2.6 }, // step 2
    { midi: null, dur: 1.6 }, // "go quiet for a moment"
  ];
  const tuneStart = notes.reduce((a, n) => a + n.dur, 0);
  // Gate i's note is held from halfway after the previous gate to halfway before the next.
  const sched: { note: number; from: number; to: number }[] = [];
  gates.forEach((g, i) => {
    const from = i === 0 ? 0 : (gates[i - 1].time + g.time) / 2;
    const to = i === gates.length - 1 ? g.time + 0.8 : (g.time + gates[i + 1].time) / 2;
    const note = g.note + (s.detune?.(i) ?? 0);
    sched.push({ note, from, to });
    notes.push({ midi: note, dur: to - from });
  });
  notes.push({ midi: null, dur: 2.0 });
  const hum = synthHum(voice, notes, { seed: 7, sampleRate: SR, snrDb: s.snrDb, glide: 0.05 });
  writeFileSync(`test/fixtures/${s.name}.wav`, wavBytes(hum.samples, SR));
  const meta = {
    voice: s.voice,
    range: { low: s.low, high: s.high, lowName: noteName(s.low), highName: noteName(s.high) },
    seed: s.seed,
    gates: gates.map((g) => ({ note: g.note, name: noteName(g.note), time: +g.time.toFixed(3) })),
    tuneStart,
    tune: sched.map((x) => ({ ...x, name: noteName(x.note) })),
    expectMissed: gates.map((_, i) => i).filter((i) => (s.detune?.(i) ?? 0) !== 0),
    seconds: hum.samples.length / SR,
    snrDb: s.snrDb ?? null,
  };
  writeFileSync(`test/fixtures/${s.name}.json`, JSON.stringify(meta, null, 2));
  console.log(`${s.name}: ${meta.seconds.toFixed(1)} s, range ${meta.range.lowName}-${meta.range.highName}, tune ${meta.gates.map((g) => g.name).join(' ')}`);
}
