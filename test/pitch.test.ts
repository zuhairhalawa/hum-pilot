import { describe, expect, it } from 'vitest';
import { Yin } from '../src/pitch/yin.ts';
import { acfPitch } from '../src/pitch/acf.ts';
import { Tracker, SHIPPED, RAW } from '../src/pitch/tracker.ts';
import { detectFrames, track } from '../src/pitch/run.ts';
import { score, stepLatency, isOctaveError } from '../src/pitch/metrics.ts';
import { hzToMidi, midiToHz, noteName, scaleNotes, centsBetween } from '../src/pitch/notes.ts';
import { VOICES, synthHum, sine, type Note } from '../src/synth/hum.ts';

const SR = 48000;

function noteRun(v: (typeof VOICES)[number], step = 2): Note[] {
  const notes: Note[] = [{ midi: null, dur: 0.3 }];
  for (let m = v.range[0]; m <= v.range[1]; m += step) notes.push({ midi: m, dur: 0.9 }, { midi: null, dur: 0.3 });
  return notes;
}

describe('notes', () => {
  it('converts between Hz and MIDI', () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 9);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
    expect(noteName(69)).toBe('A4');
    expect(noteName(48)).toBe('C3');
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 9);
  });
  it('builds the pentatonic ladder inside a range', () => {
    expect(scaleNotes(48, 60)).toEqual([48, 50, 52, 55, 57, 60]);
  });
});

describe('YIN detector', () => {
  const yin = new Yin(SR);
  it('finds pure tones from 70 to 800 Hz within 1 cent', () => {
    for (let i = 0; i < 20; i++) {
      const hz = 70 * (800 / 70) ** (i / 19);
      const buf = sine(hz, 2048 / SR + 0.01, SR).subarray(0, 2048);
      const p = yin.detect(buf);
      expect(Math.abs(centsBetween(p.hz, hz))).toBeLessThan(1);
      expect(p.clarity).toBeGreaterThan(0.95);
    }
  });

  it('makes no octave errors on clean synthetic hums of all four voices', () => {
    for (const v of VOICES) {
      const h = synthHum(v, noteRun(v, 3), { seed: 11 });
      const s = score(track(detectFrames(h.samples, SR, 'yin'), RAW), h.f0, 'raw');
      expect(s.octave).toBe(0);
      expect(s.medianAbsCents).toBeLessThan(10);
    }
  });

  it('the replaced autocorrelation baseline does make octave errors on a deep hum', () => {
    // Why version 0 was dropped: the 250 Hz nasal murmur makes harmonic 2 or 3 the strongest peak.
    const v = VOICES[0];
    const h = synthHum(v, noteRun(v, 3), { seed: 11 });
    const acf = score(track(detectFrames(h.samples, SR, 'acf'), RAW), h.f0, 'raw');
    expect(acf.octave).toBeGreaterThan(0.05);
  });

  it('reports low clarity for noise', () => {
    let s = 1;
    const buf = new Float32Array(2048).map(() => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2);
    expect(yin.detect(buf).clarity).toBeLessThan(0.75);
    expect(acfPitch(new Float32Array(2048), SR).hz).toBe(0);
  });
});

describe('tracker', () => {
  const A3 = midiToHz(57);
  const feed = (t: Tracker, hz: number, clarity = 0.95, rms = 0.1) => t.push(hz, clarity, rms);

  it('ignores a single-frame octave slip', () => {
    const t = new Tracker();
    for (let i = 0; i < 6; i++) feed(t, A3);
    const slip = feed(t, A3 / 2);
    expect(slip.midi).toBeCloseTo(57, 5);
    const back = feed(t, A3);
    expect(back.midi).toBeCloseTo(57, 5);
  });

  it('follows a real leap once it repeats', () => {
    const t = new Tracker();
    for (let i = 0; i < 6; i++) feed(t, A3);
    const outs = [0, 1, 2, 3].map(() => feed(t, midiToHz(66)).midi!);
    expect(outs[0]).toBeCloseTo(57, 5);
    expect(outs[3]).toBeCloseTo(66, 5);
  });

  it('lets a much clearer reading replace a breathy octave-low onset at once', () => {
    const t = new Tracker();
    feed(t, A3 / 2, 0.78);
    feed(t, A3 / 2, 0.8);
    const fixed = feed(t, A3, 0.92);
    expect(fixed.midi).toBeCloseTo(57, 5);
  });

  it('stays silent on quiet noise and learns the noise floor', () => {
    const t = new Tracker();
    for (let i = 0; i < 120; i++) expect(feed(t, 300, 0.4, 0.01).voiced).toBe(false);
    expect(t.noiseFloor).toBeGreaterThan(0.008);
    // A hum only as loud as the noise is not believed...
    expect(feed(t, A3, 0.9, 0.012).voiced).toBe(false);
    // ...a hum clearly above it is.
    expect(feed(t, A3, 0.9, 0.05).voiced).toBe(true);
  });

  it('holds the note through a two-frame dropout, then lets go', () => {
    const t = new Tracker();
    for (let i = 0; i < 5; i++) feed(t, A3);
    expect(feed(t, 0, 0, 0).midi).toBeCloseTo(57, 5);
    expect(feed(t, 0, 0, 0).midi).toBeCloseTo(57, 5);
    for (let i = 0; i < 3; i++) feed(t, 0, 0, 0);
    expect(feed(t, 0, 0, 0).voiced).toBe(false);
  });

  it('starts a new note fresh after a breath', () => {
    const t = new Tracker();
    for (let i = 0; i < 5; i++) feed(t, A3);
    feed(t, 0, 0, 0);
    expect(feed(t, midiToHz(60)).midi).toBeCloseTo(60, 5);
  });
});

describe('shipped pipeline on synthetic hums (see docs/ACCURACY.md)', () => {
  it('clean: under 2% wrong-note frames, no octave errors', () => {
    for (const v of VOICES) {
      const h = synthHum(v, noteRun(v), { seed: 21 });
      const s = score(track(detectFrames(h.samples, SR, 'yin'), SHIPPED), h.f0, 'tracked', h.intended);
      expect(s.gross).toBeLessThan(0.02);
      expect(s.octave).toBe(0);
      expect(s.detected).toBeGreaterThan(0.98);
    }
  });

  it('room noise at 10 dB SNR: under 3% wrong-note frames', () => {
    for (const v of VOICES) {
      const h = synthHum(v, noteRun(v), { seed: 31, snrDb: 10 });
      const s = score(track(detectFrames(h.samples, SR, 'yin'), SHIPPED), h.f0, 'tracked', h.intended);
      expect(s.gross).toBeLessThan(0.03);
    }
  });

  it('settles on a new note within 110 ms', () => {
    for (const v of VOICES) {
      const mid = Math.round((v.range[0] + v.range[1]) / 2);
      const h = synthHum(v, [{ midi: null, dur: 0.3 }, { midi: mid - 3, dur: 1 }, { midi: mid + 2, dur: 1 }], { seed: 41, glide: 0.01 });
      const lat = stepLatency(track(detectFrames(h.samples, SR, 'yin'), SHIPPED), 1.3, mid + 2, 'tracked');
      expect(lat).toBeLessThan(0.11);
    }
  });

  it('counts octave errors correctly', () => {
    expect(isOctaveError(1190)).toBe(true);
    expect(isOctaveError(-1210)).toBe(true);
    expect(isOctaveError(1900)).toBe(true);
    expect(isOctaveError(700)).toBe(false);
  });
});
