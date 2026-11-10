// Runs a detector + tracker over a whole recording the same way the browser
// does: every `hop` samples, look at the latest `size` samples.

import { acfPitch } from './acf.ts';
import { Tracker, rmsOf, type TrackerOptions, type TrackerOutput } from './tracker.ts';
import { Yin } from './yin.ts';

export type DetectorName = 'acf' | 'yin';

export interface RawFrame {
  t: number; // seconds, end of the analysis buffer (when the browser would know)
  start: number; // sample index of the buffer start
  end: number; // sample index of the buffer end
  hz: number;
  clarity: number;
  rms: number;
  ms: number; // compute time for this frame
}

export interface FrameResult extends RawFrame, TrackerOutput {}

export function detectFrames(x: Float32Array, sr: number, detector: DetectorName = 'yin', size = 2048, hop = Math.round(sr / 60)): RawFrame[] {
  const yin = new Yin(sr);
  const out: RawFrame[] = [];
  for (let end = size; end <= x.length; end += hop) {
    const buf = x.subarray(end - size, end);
    const t0 = performance.now();
    const p = detector === 'acf' ? acfPitch(buf, sr) : yin.detect(buf);
    const ms = performance.now() - t0;
    out.push({ t: end / sr, start: end - size, end, hz: p.hz, clarity: p.clarity, rms: rmsOf(buf), ms });
  }
  return out;
}

export function track(frames: RawFrame[], opts: TrackerOptions = {}): FrameResult[] {
  const tr = new Tracker(opts);
  return frames.map((f) => ({ ...f, ...tr.push(f.hz, f.clarity, f.rms) }));
}

export function analyse(x: Float32Array, sr: number, detector: DetectorName = 'yin', opts: TrackerOptions = {}): FrameResult[] {
  return track(detectFrames(x, sr, detector), opts);
}
