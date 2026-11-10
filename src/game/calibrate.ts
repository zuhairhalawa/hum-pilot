// Warm-up: the player hums their lowest comfortable note, takes a breath, then
// hums their highest. Each step needs `needSeconds` of steady humming. A step
// only starts counting after a breath (silence) or once the pitch has clearly
// moved away from the previous step's note, so the tail of the low note is
// never taken as the high one.

import { median } from '../pitch/tracker.ts';

export type CalibStep = 'low' | 'high' | 'done';

export interface CalibResult {
  low: number; // MIDI, rounded to the nearest note
  high: number;
  lowExact: number;
  highExact: number;
}

export const MIN_SPAN = 5; // semitones; anything narrower is too cramped to steer

export class Calibrator {
  step: CalibStep = 'low';
  private got: number[] = [];
  private secs = 0;
  private armed = true;
  private lowExact = NaN;
  error: string | null = null;
  result: CalibResult | null = null;

  private readonly needSeconds: number;

  constructor(needSeconds = 1.5) {
    this.needSeconds = needSeconds;
  }

  /** Share of the current step done, 0..1. */
  get progress(): number {
    return Math.min(1, this.secs / this.needSeconds);
  }

  /** Latest median of this step's readings (for showing the note live). */
  get current(): number | null {
    return this.got.length ? median(this.got.slice(-30)) : null;
  }

  /** The low note once step 1 is done. */
  get lowNote(): number | null {
    return Number.isNaN(this.lowExact) ? null : Math.round(this.lowExact);
  }

  restart(): void {
    this.step = 'low';
    this.got = [];
    this.secs = 0;
    this.armed = true;
    this.error = null;
    this.result = null;
    this.lowExact = NaN;
  }

  /** Feed one tracker frame (smoothed MIDI or null for silence) lasting dt seconds. */
  push(midi: number | null, dt = 1 / 60): void {
    if (this.step === 'done') return;
    if (midi === null) {
      this.armed = true;
      // A long pause loses nothing: the step keeps what it has.
      return;
    }
    if (!this.armed) {
      if (this.step === 'high' && Math.abs(midi - this.lowExact) >= 3) this.armed = true;
      else return;
    }
    this.got.push(midi);
    this.secs += dt;
    if (this.secs < this.needSeconds) return;
    // Use the steadiest middle of what was hummed.
    const m = median(this.got);
    if (this.step === 'low') {
      this.lowExact = m;
      this.step = 'high';
      this.got = [];
      this.secs = 0;
      this.armed = false;
      return;
    }
    let low = this.lowExact;
    let high = m;
    if (high < low) [low, high] = [high, low]; // hummed in the other order: fine
    if (Math.round(high) - Math.round(low) < MIN_SPAN) {
      this.error = `Those notes are only ${Math.max(0, Math.round(high) - Math.round(low))} semitones apart. Try a lower low note and a higher high note.`;
      this.step = 'low';
      this.got = [];
      this.secs = 0;
      this.armed = false;
      this.lowExact = NaN;
      return;
    }
    this.result = { low: Math.round(low), high: Math.round(high), lowExact: low, highExact: high };
    this.step = 'done';
  }
}
