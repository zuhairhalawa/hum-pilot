// "What testing changed": one row per tracker version, numbers straight from
// docs/accuracy.json (written by `npm run accuracy`).
import acc from '../docs/accuracy.json';

const WHY: Record<string, string> = {
  v0: 'First try. A hum’s 2nd or 3rd harmonic is often louder than its fundamental, so this jumped an octave on 1 frame in 5.',
  v1: 'Switched to YIN. Octave errors on clean hums went to zero, but the plane shook with every wobble of the voice.',
  v2: 'A median filter steadied it. Still slipped an octave on breathy note starts in noise.',
  v3: 'A jump guard ignores one-frame leaps. Test found it could lock onto the wrong octave for 100 ms instead.',
  v4: 'Fix: a clearly cleaner reading wins at once. Next test: the previous note dragged the start of the next.',
  v5: 'Fix: a breath starts a fresh note. Then a shorter filter cut the delay by a frame.',
  v6: 'Shipped.',
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
