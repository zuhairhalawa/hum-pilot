// Levels: every gap sits on a real note of the player's own range (major
// pentatonic, rooted on their low note), and consecutive gaps move like a
// singable tune: mostly steps, sometimes a small leap.

import { mulberry32 } from '../synth/hum.ts';
import { scaleNotes } from '../pitch/notes.ts';

export interface Range {
  low: number;
  high: number;
}

export interface Gate {
  note: number; // MIDI note at the centre of the gap
  y: number; // 0 (bottom) .. 1 (top)
  half: number; // half-height of the gap, in the same units
  time: number; // seconds after take-off when the gate reaches the plane
}

export const MARGIN = 0.1;

/** Height (0 bottom .. 1 top) for a pitch, given the player's range. */
export function pitchToY(midi: number, r: Range): number {
  const lo = r.low - 0.5;
  const hi = r.high + 0.5;
  const t = (midi - lo) / (hi - lo);
  return MARGIN + Math.max(0, Math.min(1, t)) * (1 - 2 * MARGIN);
}

export function yToPitch(y: number, r: Range): number {
  const lo = r.low - 0.5;
  const hi = r.high + 0.5;
  return lo + ((y - MARGIN) / (1 - 2 * MARGIN)) * (hi - lo);
}

/** One semitone in height units. */
export function semitoneHeight(r: Range): number {
  return (1 - 2 * MARGIN) / (r.high - r.low + 1);
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Eight practice notes from the player's range, no note twice in a row. */
export function practiceTargets(r: Range, rnd: () => number, count = 8): number[] {
  const notes = scaleNotes(r.low, r.high);
  const out: number[] = [];
  while (out.length < count) {
    const n = notes[Math.floor(rnd() * notes.length)];
    if (n !== out[out.length - 1]) out.push(n);
  }
  return out;
}

export interface LevelOptions {
  gates?: number;
  firstAt?: number; // seconds after take-off
  spacing?: number; // seconds between gates at the start
  spacingEnd?: number; // ... and at the end (it gets a little faster)
}

export function makeLevel(r: Range, seed: string, opts: LevelOptions = {}): Gate[] {
  const n = opts.gates ?? 20;
  const firstAt = opts.firstAt ?? 2.6;
  const s0 = opts.spacing ?? 1.9;
  const s1 = opts.spacingEnd ?? 1.45;
  const notes = scaleNotes(r.low, r.high);
  const rnd = mulberry32(hashSeed(seed));
  // Generous gaps: at least 1.6 semitones tall each way, never under 7% of the screen.
  const half = Math.max(semitoneHeight(r) * 1.6, 0.07);
  const gates: Gate[] = [];
  let idx = Math.floor(notes.length / 2);
  let last = -1;
  let time = firstAt;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      let step = 0;
      for (let tries = 0; tries < 10; tries++) {
        const r1 = rnd();
        step = r1 < 0.35 ? 1 : r1 < 0.7 ? -1 : r1 < 0.82 ? 2 : r1 < 0.94 ? -2 : 0;
        const next = idx + step;
        if (next < 0 || next >= notes.length) continue;
        if (next === last && step !== 0) continue; // avoid ping-ponging
        break;
      }
      last = idx;
      idx = Math.max(0, Math.min(notes.length - 1, idx + step));
      time += s0 + (s1 - s0) * (i / Math.max(1, n - 1));
    }
    const note = notes[idx];
    gates.push({ note, y: pitchToY(note, r), half, time });
  }
  return gates;
}
