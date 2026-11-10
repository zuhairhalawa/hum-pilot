// Pitch helpers: Hz <-> MIDI note numbers (A4 = 440 Hz = 69) and note names.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Difference between two frequencies in cents (1200 cents = one octave). */
export function centsBetween(hz: number, refHz: number): number {
  return 1200 * Math.log2(hz / refHz);
}

export function noteName(midi: number): string {
  const n = Math.round(midi);
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Major pentatonic offsets: every note in it sounds fine next to every other. */
export const PENTATONIC = [0, 2, 4, 7, 9];

/** Notes of the major pentatonic scale rooted on `low`, from low to high inclusive. */
export function scaleNotes(low: number, high: number): number[] {
  const out: number[] = [];
  for (let n = Math.round(low); n <= Math.round(high); n++) {
    const deg = (((n - Math.round(low)) % 12) + 12) % 12;
    if (PENTATONIC.includes(deg)) out.push(n);
  }
  return out;
}
