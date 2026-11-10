// Canvas drawing: an airmail sky. Ruled lines are the notes of your range,
// gates are perforated stamp columns, each gap carries a postmark with its
// note, and the plane's dashed trail is your hum.

import { noteName, scaleNotes } from '../pitch/notes.ts';
import { pitchToY, type Gate, type Range } from './level.ts';
import type { Flight } from './flight.ts';

export const C = {
  skyTop: '#c7d8ee',
  skyBottom: '#e8eff8',
  ink: '#0f1e3d',
  blue: '#1c3f94',
  red: '#d2343e',
  redDark: '#a8222c',
  stamp: '#f2c14e',
  paper: '#fbfcfe',
  paperShade: '#c3d1e6',
};

export interface Scene {
  t: number; // flight time (s) or idle time
  range: Range;
  gates: Gate[];
  flight: Flight | null;
  planeY: number;
  planeVy: number;
  pitch: number | null; // current smoothed MIDI, for the ladder highlight
  speed: number; // screen widths per second
  reduceMotion: boolean;
  flash: { gate: number; ok: boolean; at: number }[];
  wallClock: number; // seconds, for idle animation
  target?: { note: number; half: number; hold: number } | null; // practice ring
  planeXFrac?: number; // override the plane's horizontal position (title screen)
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  depth: number;
}

const clouds: Cloud[] = Array.from({ length: 7 }, (_, i) => ({
  x: (i * 0.37) % 1.2,
  y: 0.12 + ((i * 0.53) % 0.75),
  s: 0.6 + ((i * 0.29) % 0.7),
  depth: 0.15 + ((i * 0.41) % 0.5),
}));

export function planeX(w: number): number {
  return Math.max(70, w * 0.26);
}

export function render(ctx: CanvasRenderingContext2D, w: number, h: number, sc: Scene): void {
  const Y = (y: number) => h * (1 - y);
  const px = sc.planeXFrac !== undefined ? sc.planeXFrac * w : planeX(w);
  const speedPx = sc.speed * w;

  // Sky
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.skyTop);
  g.addColorStop(1, C.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Paper-cut clouds, parallax
  for (const c of clouds) {
    const drift = sc.reduceMotion ? 0 : sc.wallClock * 0.012 * c.depth + sc.t * sc.speed * c.depth * 0.5;
    const x = (((c.x - drift) % 1.3) + 1.3) % 1.3 - 0.15;
    drawCloud(ctx, x * w, c.y * h, c.s * Math.min(w, 900) * 0.11, c.depth);
  }

  // Ruled note lines: the notes of your range
  const notes = scaleNotes(sc.range.low, sc.range.high);
  const near = sc.pitch !== null ? notes.reduce((b, n) => (Math.abs(n - sc.pitch!) < Math.abs(b - sc.pitch!) ? n : b), notes[0]) : null;
  ctx.font = `700 ${Math.max(11, Math.min(14, h * 0.022))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const n of notes) {
    const y = Y(pitchToY(n, sc.range));
    const hot = n === near;
    ctx.strokeStyle = hot ? 'rgba(28,63,148,0.55)' : 'rgba(28,63,148,0.16)';
    ctx.lineWidth = hot ? 1.5 : 1;
    ctx.setLineDash(hot ? [] : [6, 6]);
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = hot ? C.blue : 'rgba(15,30,61,0.55)';
    ctx.fillText(noteName(n), 6, y);
  }
  ctx.setLineDash([]);

  // Practice target ring
  if (sc.target) {
    const ty = Y(pitchToY(sc.target.note, sc.range));
    // Radius = the tolerance in pixels plus room for the plane, so "plane in the ring" is honest.
    const r = Math.max(26, sc.target.half * h + 16);
    const tx = w * 0.62;
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.stroke();
    if (sc.target.hold > 0) {
      ctx.strokeStyle = C.stamp;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(tx, ty, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, sc.target.hold));
      ctx.stroke();
    }
    ctx.fillStyle = C.blue;
    ctx.font = `800 ${Math.round(r * 0.7)}px "Big Shoulders Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(noteName(sc.target.note), tx, ty + 1);
    ctx.textAlign = 'left';
  }

  // Gates
  const colW = Math.max(30, Math.min(54, w * 0.045));
  for (let i = 0; i < sc.gates.length; i++) {
    const gt = sc.gates[i];
    const x = px + (gt.time - sc.t) * speedPx;
    if (x < -colW * 2 || x > w + colW * 2) continue;
    const flash = sc.flash.find((f) => f.gate === i);
    const top = Y(gt.y + gt.half);
    const bot = Y(gt.y - gt.half);
    const fill = flash ? (flash.ok ? C.stamp : C.redDark) : C.red;
    drawStampColumn(ctx, x - colW / 2, -10, colW, top + 10, fill);
    drawStampColumn(ctx, x - colW / 2, bot, colW, h - bot + 10, fill);
    drawPostmark(ctx, x, (top + bot) / 2, Math.min((bot - top) * 0.42, 34), noteName(gt.note), flash);
  }

  // Trail: your hum, as a dashed flight path
  const f = sc.flight;
  if (f && f.trail.length > 1) {
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    // One path per run of humming / gliding, so the dash pattern flows along it.
    const runs: { humming: boolean; pts: [number, number][] }[] = [];
    for (const p of f.trail) {
      // Not clipped at the left edge: each run must keep its first point so its
      // dash pattern stays fixed to the sky as it scrolls.
      const x = px - (sc.t - p.t) * speedPx;
      const last = runs[runs.length - 1];
      if (!last || last.humming !== p.humming) {
        const pts: [number, number][] = last ? [last.pts[last.pts.length - 1]] : [];
        runs.push({ humming: p.humming, pts });
      }
      runs[runs.length - 1].pts.push([x, Y(p.y)]);
    }
    for (const r of runs) {
      if (r.pts.length < 2) continue;
      ctx.strokeStyle = r.humming ? C.blue : 'rgba(28,63,148,0.35)';
      ctx.setLineDash(r.humming ? [10, 7] : [2, 7]);
      ctx.beginPath();
      r.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Plane
  const hurt = f && f.t < f.hurtUntil;
  const blink = hurt && !sc.reduceMotion && Math.floor(sc.wallClock * 12) % 2 === 0;
  if (!blink) {
    const tilt = Math.max(-0.5, Math.min(0.5, -sc.planeVy * 0.9));
    drawPlane(ctx, px, Y(sc.planeY), Math.max(28, Math.min(48, w * 0.038)) * (sc.planeXFrac !== undefined ? 1.7 : 1), tilt);
  }
  if (sc.pitch !== null && f) {
    ctx.fillStyle = C.ink;
    ctx.font = `700 ${Math.max(12, Math.min(15, h * 0.024))}px "Atkinson Hyperlegible", system-ui, sans-serif`;
    ctx.fillText(noteName(sc.pitch), px - 18, Y(sc.planeY) - 30);
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, depth: number): void {
  ctx.save();
  ctx.globalAlpha = 0.55 + depth * 0.6;
  const blob = (dx: number) => {
    ctx.beginPath();
    ctx.ellipse(x + dx, y, s, s * 0.42, 0, 0, Math.PI * 2);
    ctx.ellipse(x + dx + s * 0.55, y - s * 0.22, s * 0.55, s * 0.42, 0, 0, Math.PI * 2);
    ctx.ellipse(x + dx - s * 0.6, y + s * 0.05, s * 0.5, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.fillStyle = 'rgba(28,63,148,0.10)';
  ctx.translate(3, 4);
  blob(0);
  ctx.translate(-3, -4);
  ctx.fillStyle = '#f7faff';
  blob(0);
  ctx.restore();
}

/** A column with perforated (stamp-edge) sides. */
function drawStampColumn(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  if (h <= 0) return;
  const r = Math.max(3, w * 0.09);
  const step = r * 2.6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  for (let cy = y + step / 2; cy < y + h - r; cy += step) {
    ctx.lineTo(x + w, cy - r);
    ctx.arc(x + w, cy, r, -Math.PI / 2, Math.PI / 2, true);
  }
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  const ups: number[] = [];
  for (let cy = y + step / 2; cy < y + h - r; cy += step) ups.push(cy);
  for (const cy of ups.reverse()) {
    ctx.lineTo(x, cy + r);
    ctx.arc(x, cy, r, Math.PI / 2, -Math.PI / 2, true);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(15,30,61,0.18)';
  ctx.save();
  ctx.translate(3, 3);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fill();
  // inner frame, like a stamp's printed border
  ctx.strokeStyle = 'rgba(251,252,254,0.75)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + r + 3, y + 2, w - 2 * r - 6, h - 4);
}

function drawPostmark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, label: string, flash?: { ok: boolean }): void {
  ctx.save();
  ctx.strokeStyle = flash ? (flash.ok ? 'rgba(28,63,148,0.9)' : 'rgba(168,34,44,0.9)') : 'rgba(28,63,148,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = `800 ${Math.round(r * 0.62)}px "Big Shoulders Display", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 1);
  // cancellation waves trailing off to the right
  ctx.lineWidth = 1.5;
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const xx = x + r + 4 + i * 2.2;
      const yy = y + k * r * 0.35 + Math.sin(i * 0.7) * 2;
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** A folded airmail-letter paper plane, side view. */
export function drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tilt: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  // shadow
  ctx.fillStyle = 'rgba(15,30,61,0.16)';
  ctx.beginPath();
  ctx.moveTo(s * 1.05, 6);
  ctx.lineTo(-s * 0.95, -s * 0.38 + 6);
  ctx.lineTo(-s * 0.7, 6 + s * 0.12);
  ctx.closePath();
  ctx.fill();
  // far wing (shaded)
  ctx.fillStyle = C.paperShade;
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.9, -s * 0.5);
  ctx.lineTo(-s * 0.55, -s * 0.05);
  ctx.closePath();
  ctx.fill();
  // body / near wing
  ctx.fillStyle = C.paper;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s, -s * 0.32);
  ctx.lineTo(-s * 0.62, s * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // keel
  ctx.fillStyle = '#dfe7f3';
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.62, s * 0.06);
  ctx.lineTo(-s * 0.7, s * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // airmail stripes on the wing's trailing edge
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 6; i++) {
    const t = 0.12 + i * 0.13;
    const ax = -s + (s * 0.38) * t;
    const ay = -s * 0.32 + (s * 0.38) * t;
    ctx.strokeStyle = i % 2 ? C.blue : C.red;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + s * 0.12, ay - s * 0.02);
    ctx.stroke();
  }
  ctx.restore();
}
