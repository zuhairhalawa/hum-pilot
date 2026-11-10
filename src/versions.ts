// "What testing changed": one row per tracker version, numbers straight from
// docs/accuracy.json (written by `npm run accuracy`).
import acc from '../docs/accuracy.json';

const WHY: Record<string, string> = {
  v0: 'First try. A hum’s 2nd or 3rd harmonic is often louder than its fundamental, so this jumped an octave on more than 1 frame in 5.',
  v1: 'Switched to YIN. Octave errors on clean hums went to zero.',
  v2: 'A median filter took a little vibrato out of the steering (wobble 17 → 15 cents) and added two frames of delay.',
  v3: 'A jump guard ignores one-frame leaps. The test found it could lock onto the wrong octave for about 100 ms after a breathy note start.',
  v4: 'Fix: a clearly cleaner reading wins at once. The next test found the previous note dragging the start of the next one.',
  v5: 'Fix: a breath starts a fresh note.',
  v6: 'Shipped. A 3-frame median instead of 5 cut the delay back to 76 ms.',
};

interface Ctl {
  gross: number;
}
interface Ver {
  label: string;
  control: Record<string, Ctl>;
  latency: { medianMs: number };
}

export function renderVersions(el: HTMLElement): void {
  const versions = (acc as unknown as { versions: Record<string, Ver> }).versions;
  const ids = Object.keys(versions);
  const maxWrong = Math.max(...ids.map((id) => Math.max(versions[id].control.clean.gross, versions[id].control.snr10.gross)));
  const maxLat = Math.max(...ids.map((id) => versions[id].latency.medianMs));
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  el.innerHTML = ids
    .map((id) => {
      const v = versions[id];
      const shipped = id === ids[ids.length - 1];
      const bar = (label: string, value: number, max: number, text: string, cls = '') =>
        `<div class="barrow"><span>${label}</span><span class="track"><span class="fill ${cls}" style="width:${Math.max(0.5, (100 * value) / max)}%"></span></span><b>${text}</b></div>`;
      return `<div class="ver${shipped ? ' shipped' : ''}">
        <h3>Version ${id.slice(1)}<small>${v.label.replace(' (shipped)', '')}</small></h3>
        <div class="bars">
          ${bar('Wrong notes, quiet room', v.control.clean.gross, maxWrong, pct(v.control.clean.gross))}
          ${bar('Wrong notes, noisy room', v.control.snr10.gross, maxWrong, pct(v.control.snr10.gross))}
          ${bar('Delay to a new note', v.latency.medianMs, maxLat, `${Math.round(v.latency.medianMs)} ms`, 'lat')}
        </div>
        <p class="changed">${WHY[id] ?? ''}</p>
      </div>`;
    })
    .join('');
}
