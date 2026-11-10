// Turns raw per-frame pitch guesses into a steady control signal.
// Every stage can be switched off so the accuracy script can measure what each
// one adds (see docs/TEST-LOG.md):
//   1. voicing gate  - loud enough (adaptive to the room's noise floor) and periodic enough
//   2. jump guard    - a leap of more than `jumpSemis` must repeat for `jumpFrames`
//                      frames before it is believed (stops one-frame octave slips)...
//                   ...unless the new value is clearly more periodic (clarity at least
//                      `clarityWin` above the frames it would replace): breathy note onsets
//                      often read an octave low, and the clean pitch must win at once
//   3. median filter - median of the last `median` accepted values
//   4. hangover      - a voice dropout shorter than `hangFrames` keeps the last note
//   5. fresh start   - voice back after a dropout on a different note = a new note:
//                      clear the window so the old note does not drag the new one

import { hzToMidi } from './notes.ts';

export interface TrackerOptions {
  minClarity?: number;
  rmsFloor?: number;
  noiseRatio?: number;
  median?: number;
  jumpSemis?: number;
  jumpFrames?: number;
  hangFrames?: number;
  /** 0 = off. See stage 2 above. */
  clarityWin?: number;
  /** After a dropout, a voice on a different note starts a fresh window (stage 5). */
  freshAfterBreath?: boolean;
}

export interface TrackerOutput {
  voiced: boolean;
  midi: number | null; // smoothed pitch, null when silent
  rawMidi: number | null; // this frame's detector output, if voiced
}

export const SHIPPED: Required<TrackerOptions> = {
  minClarity: 0.75,
  rmsFloor: 0.004,
  noiseRatio: 3,
  median: 3,
  jumpSemis: 7,
  jumpFrames: 3,
  hangFrames: 3,
  clarityWin: 0.04,
  freshAfterBreath: true,
};

export const RAW: Required<TrackerOptions> = {
  ...SHIPPED,
  median: 1,
  jumpFrames: 0,
  hangFrames: 0,
  clarityWin: 0,
  freshAfterBreath: false,
};

export class Tracker {
  readonly o: Required<TrackerOptions>;
  private hist: number[] = [];
  private histClarity: number[] = [];
  private pending: number[] = [];
  private noise = 0.002;
  private silentFor = 99;
  private last: number | null = null;

  constructor(opts: TrackerOptions = {}) {
    this.o = { ...SHIPPED, ...opts };
  }

  reset(): void {
    this.hist = [];
    this.histClarity = [];
    this.pending = [];
    this.silentFor = 99;
    this.last = null;
  }

  get noiseFloor(): number {
    return this.noise;
  }

  push(hz: number, clarity: number, rms: number): TrackerOutput {
    const o = this.o;
    const gate = Math.max(o.rmsFloor, this.noise * o.noiseRatio);
    const voicedNow = hz > 0 && rms > gate && clarity >= o.minClarity;
    if (!voicedNow) {
      // Noise floor. Falls fast. Rises (in about a second) only on frames that are clearly not
      // a voice: the quiet tail of a hum is still periodic and must not raise the gate.
      if (rms < this.noise) this.noise = 0.7 * this.noise + 0.3 * rms;
      else if (clarity < 0.6) this.noise = 0.98 * this.noise + 0.02 * rms;
      this.silentFor++;
      this.pending = [];
      if (this.silentFor <= o.hangFrames && this.last !== null) {
        return { voiced: true, midi: this.last, rawMidi: null };
      }
      this.hist = [];
      this.histClarity = [];
      this.last = null;
      return { voiced: false, midi: null, rawMidi: null };
    }
    const m = hzToMidi(hz);
    if (o.freshAfterBreath && this.silentFor > 0 && this.hist.length && Math.abs(m - median(this.hist)) > 1) {
      // Voice is back after a dropout on a different note: a new note, not a continuation.
      this.hist = [];
      this.histClarity = [];
      this.pending = [];
    }
    this.silentFor = 0;
    let accepted: number | null = m;
    const ref = this.hist.length ? median(this.hist) : null;
    const refClarity = this.histClarity.length ? Math.max(...this.histClarity) : 0;
    if (o.jumpFrames > 0 && ref !== null && Math.abs(m - ref) > o.jumpSemis && o.clarityWin > 0 && clarity >= refClarity + o.clarityWin) {
      // A cleaner reading than anything in the window: start over from it.
      this.pending = [];
      this.hist = [m];
      this.histClarity = [clarity];
    } else if (o.jumpFrames > 0 && ref !== null && Math.abs(m - ref) > o.jumpSemis) {
      // Hold big leaps until they repeat (all pending values within a semitone of each other).
      if (this.pending.length && Math.abs(m - this.pending[this.pending.length - 1]) > 1) this.pending = [];
      this.pending.push(m);
      if (this.pending.length >= o.jumpFrames) {
        this.hist = [...this.pending];
        this.histClarity = this.hist.map(() => clarity);
        this.pending = [];
      } else {
        accepted = null;
      }
    } else {
      this.pending = [];
      this.hist.push(m);
      this.histClarity.push(clarity);
    }
    if (accepted !== null && this.hist.length > o.median) {
      this.hist.splice(0, this.hist.length - o.median);
      this.histClarity.splice(0, this.histClarity.length - o.median);
    }
    const out = this.hist.length ? median(this.hist) : null;
    this.last = out;
    return { voiced: out !== null, midi: out, rawMidi: m };
  }
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : 0.5 * (s[k - 1] + s[k]);
}

export function rmsOf(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}
