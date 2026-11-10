// The flight itself, with no drawing: plane height follows the hummed pitch,
// silence glides, gates are checked as they pass. Pure, so it can be tested
// and replayed.

import { pitchToY, yToPitch, type Gate, type Range } from './level.ts';

export const PLANE_HALF = 0.018; // plane half-height in screen units
export const FOLLOW_TAU = 0.09; // seconds: how fast the plane chases the target height
export const GLIDE_SINK = 0.035; // screen heights per second while silent

export interface Pass {
  gate: number;
  ok: boolean;
  centsOff: number | null; // how far the hummed pitch was from the gate's note, if humming
  y: number;
}

export interface TrailPoint {
  t: number;
  y: number;
  humming: boolean;
}

export class Flight {
  t = 0; // seconds since take-off
  y: number;
  vy = 0;
  humming = false;
  lives: number;
  next = 0; // index of the next gate to reach the plane
  passes: Pass[] = [];
  trail: TrailPoint[] = [];
  hurtUntil = -1;

  readonly gates: Gate[];
  readonly range: Range;

  constructor(gates: Gate[], range: Range, startY = 0.5, lives = 3) {
    this.gates = gates;
    this.range = range;
    this.y = startY;
    this.lives = lives;
  }

  get done(): boolean {
    return this.lives <= 0 || this.next >= this.gates.length;
  }

  get threaded(): number {
    return this.passes.filter((p) => p.ok).length;
  }

  /**
   * Advance by dt seconds. `midi` is the tracker's smoothed pitch (null = silent),
   * `targetY` overrides it (keyboard play).
   */
  step(dt: number, midi: number | null, targetY: number | null = null): Pass | null {
    if (this.done) return null;
    this.t += dt;
    const target = targetY ?? (midi !== null ? pitchToY(midi, this.range) : null);
    const prev = this.y;
    this.humming = target !== null;
    if (target !== null) {
      this.y += (target - this.y) * (1 - Math.exp(-dt / FOLLOW_TAU));
    } else {
      this.y = Math.max(0.03, this.y - GLIDE_SINK * dt);
    }
    this.vy = (this.y - prev) / Math.max(dt, 1e-6);
    this.trail.push({ t: this.t, y: this.y, humming: this.humming });
    if (this.trail.length > 6000) this.trail.splice(0, this.trail.length - 6000);

    const g = this.gates[this.next];
    if (g && this.t >= g.time) {
      const ok = Math.abs(this.y - g.y) <= g.half - PLANE_HALF;
      const hummed = midi ?? (targetY !== null ? yToPitch(targetY, this.range) : null);
      const pass: Pass = { gate: this.next, ok, centsOff: hummed !== null ? Math.round((hummed - g.note) * 100) : null, y: this.y };
      this.passes.push(pass);
      if (!ok) {
        this.lives--;
        this.hurtUntil = this.t + 0.8;
      }
      this.next++;
      return pass;
    }
    return null;
  }
}
