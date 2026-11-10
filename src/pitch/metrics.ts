// Scoring helpers shared by the unit tests and scripts/accuracy.ts.

import { hzToMidi } from './notes.ts';
import type { FrameResult } from './run.ts';

export interface Score {
  frames: number; // frames where the whole buffer is voiced
  detected: number; // share of those the tracker called voiced
  medianAbsCents: number;
  p95AbsCents: number;
  gross: number; // share off by more than 50 cents
  octave: number; // share off by about an octave (or octave + fifth)
  wobbleCents: number; // spread of the error after removing each note's mean (plane wobble)
  falseVoiced: number; // share of fully silent frames called voiced
}

export function isOctaveError(cents: number): boolean {
  const a = Math.abs(cents);
  return Math.abs(a - 1200) < 150 || Math.abs(a - 1902) < 150 || Math.abs(a - 2400) < 150;
}

/** Truth f0 at the centre of each frame's buffer, or 0 if any part of the buffer is silent. */
function truthAt(f0: Float32Array, f: { start: number; end: number }): number {
  if (f0[f.start] <= 0 || f0[f.end - 1] <= 0) return 0;
  return f0[(f.start + f.end) >> 1];
}

function silentBuffer(f0: Float32Array, f: { start: number; end: number }): boolean {
  // Cheap check: start, middle and end silent, plus a stride sample.
  for (let i = f.start; i < f.end; i += 128) if (f0[i] > 0) return false;
  return f0[f.end - 1] <= 0;
}

/** `use`: 'raw' scores the detector output alone; 'tracked' scores the smoothed control signal. */
// With `intended`, errors are measured against the note the singer means (no
// vibrato or drift), which is what should steer the plane; otherwise against
// the true f0 at the buffer centre.
export function score(frames: FrameResult[], f0: Float32Array, use: 'raw' | 'tracked', intended?: Float32Array): Score {
  const errs: number[] = [];
  const byNote = new Map<number, number[]>();
  let voicedFrames = 0;
  let detected = 0;
  let silent = 0;
  let falseV = 0;
  for (const f of frames) {
    let truth = truthAt(f0, f);
    if (truth > 0 && intended) {
      const a = intended[f.start];
      const b = intended[f.end - 1];
      const c = intended[(f.start + f.end) >> 1];
      truth = a === b && b === c ? 440 * 2 ** ((c - 69) / 12) : 0;
      if (truth === 0) continue; // note change inside this buffer: not scored
    }
    if (truth > 0) {
      voicedFrames++;
      const midi = use === 'raw' ? (f.hz > 0 && f.voiced ? hzToMidi(f.hz) : null) : f.midi;
      if (midi === null) continue;
      detected++;
      const c = (midi - hzToMidi(truth)) * 100;
      errs.push(c);
      const key = Math.round(hzToMidi(truth));
      if (!byNote.has(key)) byNote.set(key, []);
      byNote.get(key)!.push(c);
    } else if (silentBuffer(f0, f)) {
      silent++;
      if (f.voiced) falseV++;
    }
  }
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const q = (p: number) => (abs.length ? abs[Math.min(abs.length - 1, Math.floor(p * abs.length))] : NaN);
  let wob = 0;
  let wn = 0;
  for (const cs of byNote.values()) {
    const ok = cs.filter((c) => Math.abs(c) < 50);
    if (ok.length < 3) continue;
    const m = ok.reduce((s, c) => s + c, 0) / ok.length;
    for (const c of ok) {
      wob += (c - m) ** 2;
      wn++;
    }
  }
  return {
    frames: voicedFrames,
    detected: voicedFrames ? detected / voicedFrames : 0,
    medianAbsCents: q(0.5),
    p95AbsCents: q(0.95),
    gross: errs.length ? errs.filter((c) => Math.abs(c) > 50).length / errs.length : 0,
    octave: errs.length ? errs.filter(isOctaveError).length / errs.length : 0,
    wobbleCents: wn ? Math.sqrt(wob / wn) : NaN,
    falseVoiced: silent ? falseV / silent : 0,
  };
}

/**
 * Latency of a pitch step: seconds from the moment the sung note changes to
 * the first frame whose output is within 50 cents of the new note and stays
 * there for 3 frames. Uses frame end times (when the browser would know).
 */
export function stepLatency(frames: FrameResult[], stepTime: number, newMidi: number, use: 'raw' | 'tracked'): number {
  const val = (f: FrameResult) => (use === 'raw' ? (f.hz > 0 && f.voiced ? hzToMidi(f.hz) : null) : f.midi);
  for (let i = 0; i + 2 < frames.length; i++) {
    if (frames[i].t < stepTime) continue;
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const v = val(frames[i + k]);
      if (v === null || Math.abs(v - newMidi) > 0.5) ok = false;
    }
    if (ok) return frames[i].t - stepTime;
  }
  return NaN;
}
