import { describe, expect, it } from 'vitest';
import { Calibrator } from '../src/game/calibrate.ts';
import { makeLevel, pitchToY, yToPitch, semitoneHeight, practiceTargets } from '../src/game/level.ts';
import { Flight, PLANE_HALF } from '../src/game/flight.ts';
import { scaleNotes } from '../src/pitch/notes.ts';
import { mulberry32 } from '../src/synth/hum.ts';

const hum = (c: Calibrator, midi: number | null, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) c.push(midi);
};

describe('warm-up', () => {
  it('finds the low and high note with a breath between', () => {
    const c = new Calibrator(1.5);
    hum(c, 45.1, 2.5); // keeps humming low past the 1.5 s it needs
    expect(c.step).toBe('high');
    hum(c, null, 0.4);
    hum(c, 56.9, 2);
    expect(c.step).toBe('done');
    expect(c.result).toMatchObject({ low: 45, high: 57 });
  });

  it('does not take the tail of the low note as the high note', () => {
    const c = new Calibrator(1.5);
    hum(c, 50, 4); // never stops
    expect(c.step).toBe('high');
    expect(c.progress).toBe(0);
  });

  it('starts the high step without a breath once the pitch clearly moves', () => {
    const c = new Calibrator(1.5);
    hum(c, 50, 1.6);
    hum(c, 58, 1.6);
    expect(c.result).toMatchObject({ low: 50, high: 58 });
  });

  it('asks again when the two notes are too close', () => {
    const c = new Calibrator(1.5);
    hum(c, 50, 1.6);
    hum(c, null, 0.3);
    hum(c, 53, 1.6);
    expect(c.step).toBe('low');
    expect(c.error).toMatch(/3 semitones apart/);
  });

  it('accepts the notes in either order', () => {
    const c = new Calibrator(1.5);
    hum(c, 60, 1.6);
    hum(c, null, 0.3);
    hum(c, 50, 1.6);
    expect(c.result).toMatchObject({ low: 50, high: 60 });
  });
});

describe('levels', () => {
  const r = { low: 46, high: 56 };
  it('maps the range onto the sky and back', () => {
    expect(pitchToY(46, r)).toBeGreaterThan(0.1);
    expect(pitchToY(56, r)).toBeLessThan(0.9);
    expect(yToPitch(pitchToY(51.3, r), r)).toBeCloseTo(51.3, 9);
  });

  it('puts every gap on a pentatonic note of the range, deterministically', () => {
    const a = makeLevel(r, 'x', { gates: 30 });
    const b = makeLevel(r, 'x', { gates: 30 });
    expect(a).toEqual(b);
    const scale = scaleNotes(r.low, r.high);
    for (const g of a) expect(scale).toContain(g.note);
    // singable: never more than two scale steps between neighbours
    for (let i = 1; i < a.length; i++) expect(Math.abs(scale.indexOf(a[i].note) - scale.indexOf(a[i - 1].note))).toBeLessThanOrEqual(2);
    // gaps get a little closer together
    expect(a[1].time - a[0].time).toBeGreaterThan(a[29].time - a[28].time);
  });

  it('makes every gap at least 3.2 semitones tall', () => {
    for (const g of makeLevel(r, 'y')) expect(g.half).toBeGreaterThanOrEqual(semitoneHeight(r) * 1.6 - 1e-9);
  });

  it('practice never asks for the same note twice in a row', () => {
    const t = practiceTargets(r, mulberry32(3), 40);
    for (let i = 1; i < t.length; i++) expect(t[i]).not.toBe(t[i - 1]);
  });
});

describe('flight', () => {
  const r = { low: 48, high: 60 };
  const gates = makeLevel(r, 'f', { gates: 6 });
  const run = (pitchAt: (t: number) => number | null) => {
    const f = new Flight(gates, r);
    while (!f.done) {
      const t = f.t;
      f.step(1 / 60, pitchAt(t));
    }
    return f;
  };
  const tune = (t: number) => {
    // hum each gate's note from halfway before it
    const i = gates.findIndex((g, k) => t < (k + 1 < gates.length ? (g.time + gates[k + 1].time) / 2 : Infinity));
    return gates[Math.max(0, i)].note;
  };

  it('threads every gate when you hum the tune', () => {
    const f = run(tune);
    expect(f.threaded).toBe(6);
    expect(f.lives).toBe(3);
  });

  it('a wrong note costs a try', () => {
    const f = run((t) => (Math.abs(t - gates[2].time) < 0.6 ? gates[2].note + 4 : tune(t)));
    expect(f.passes.filter((p) => !p.ok).map((p) => p.gate)).toEqual([2]);
    expect(f.lives).toBe(2);
    expect(f.passes[2].centsOff).toBe(400);
  });

  it('silence glides down instead of falling', () => {
    const f = new Flight(gates, r, 0.6);
    for (let i = 0; i < 60; i++) f.step(1 / 60, null);
    expect(f.y).toBeGreaterThan(0.55);
    expect(f.y).toBeLessThan(0.6);
  });

  it('ends after three misses', () => {
    const f = run(() => null);
    expect(f.lives).toBeLessThanOrEqual(0);
    expect(PLANE_HALF).toBeGreaterThan(0);
  });
});
