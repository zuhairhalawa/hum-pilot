// Baseline detector (version 0 of Hum Pilot): pick the highest autocorrelation
// peak in the 70-1000 Hz lag range. Kept only so the accuracy script can show
// why it was replaced. It makes octave errors on hums whose second harmonic is
// stronger than the fundamental.

export interface PitchFrame {
  hz: number; // 0 when no pitch
  clarity: number; // 0..1, higher = more periodic
}

export function acfPitch(buf: Float32Array, sampleRate: number, minHz = 70, maxHz = 1000): PitchFrame {
  const n = buf.length;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), n - 1);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
  if (energy < 1e-9) return { hz: 0, clarity: 0 };
  let best = -Infinity;
  let bestLag = -1;
  const r: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += buf[i] * buf[i + lag];
    s /= n - lag; // unbiased
    r[lag] = s;
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (bestLag <= minLag || bestLag >= maxLag) return { hz: 0, clarity: 0 };
  const a = r[bestLag - 1];
  const b = r[bestLag];
  const c = r[bestLag + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const clarity = Math.max(0, Math.min(1, best / (energy / n)));
  return { hz: sampleRate / (bestLag + shift), clarity };
}
