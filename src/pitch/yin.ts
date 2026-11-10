// YIN pitch detector (de Cheveigne & Kawahara, 2002).
// Steps: difference function, cumulative mean normalised difference (CMND),
// absolute threshold (first dip under the threshold, then walk down to its
// local minimum), parabolic interpolation. Clarity = 1 - CMND at the chosen lag.

import type { PitchFrame } from './acf.ts';

export interface YinOptions {
  minHz?: number;
  maxHz?: number;
  threshold?: number;
  /** Integration window in samples. Defaults to the buffer length minus the longest lag. */
  window?: number;
}

export class Yin {
  private d: Float32Array;
  readonly minHz: number;
  readonly maxHz: number;
  readonly threshold: number;

  readonly sampleRate: number;

  constructor(sampleRate: number, opts: YinOptions = {}) {
    this.sampleRate = sampleRate;
    this.minHz = opts.minHz ?? 70;
    this.maxHz = opts.maxHz ?? 1000;
    this.threshold = opts.threshold ?? 0.15;
    this.d = new Float32Array(Math.ceil(sampleRate / this.minHz) + 2);
  }

  /** Longest lag searched; a buffer must hold window + maxLag samples. */
  get maxLag(): number {
    return Math.ceil(this.sampleRate / this.minHz);
  }

  detect(buf: Float32Array): PitchFrame {
    const maxLag = Math.min(this.maxLag, Math.floor(buf.length / 2));
    const minLag = Math.max(2, Math.floor(this.sampleRate / this.maxHz));
    const W = buf.length - maxLag;
    const d = this.d;
    d[0] = 1;
    let running = 0;
    // Difference function and CMND in one pass.
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const v = buf[j] - buf[j + tau];
        s += v * v;
      }
      running += s;
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }
    // Absolute threshold: first dip under the threshold, then its local minimum.
    let tau = -1;
    for (let t = minLag; t < maxLag; t++) {
      if (d[t] < this.threshold) {
        while (t + 1 < maxLag && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau === -1) {
      // No dip under the threshold: take the global minimum, flagged by low clarity.
      let best = Infinity;
      for (let t = minLag; t < maxLag; t++) {
        if (d[t] < best) {
          best = d[t];
          tau = t;
        }
      }
    }
    if (tau <= 0) return { hz: 0, clarity: 0 };
    // Parabolic interpolation around tau for sub-sample precision.
    let better = tau;
    if (tau > 1 && tau < maxLag) {
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const den = a - 2 * b + c;
      if (den > 0) better = tau + (0.5 * (a - c)) / den;
    }
    return { hz: this.sampleRate / better, clarity: Math.max(0, Math.min(1, 1 - d[tau])) };
  }
}
