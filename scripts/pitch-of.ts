// Prints the tracked note of a WAV every 0.5 s (used to check the demo video's audio sync).
import { readFileSync } from 'node:fs';
import { analyse } from '../src/pitch/run.ts';
import { noteName } from '../src/pitch/notes.ts';
const b = readFileSync(process.argv[2]);
const off = Number(process.argv[3] ?? 0);
let p = 12; while (b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4);
const n = b.readUInt32LE(p + 4) / 2; const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
const fr = analyse(x, 48000);
for (const t of [3, 6, 9]) { const f = fr.find((q) => q.t >= t); console.log((off + t).toFixed(1), f?.midi != null ? noteName(f.midi) : '-'); }
