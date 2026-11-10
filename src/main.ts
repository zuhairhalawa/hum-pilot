import '@fontsource/big-shoulders-display/700';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/atkinson-hyperlegible/400';
import '@fontsource/atkinson-hyperlegible/700';
import '@fontsource/atkinson-hyperlegible/400-italic';
import './styles.css';
import { Mic, Sfx, type MicFrame } from './audio/mic.ts';
import { Calibrator } from './game/calibrate.ts';
import { makeLevel, hashSeed, practiceTargets, pitchToY, yToPitch, semitoneHeight, type Gate, type Range } from './game/level.ts';
import { Flight, type Pass } from './game/flight.ts';
import { render, C } from './game/draw.ts';
import { noteName, midiToHz, scaleNotes } from './pitch/notes.ts';
import { mulberry32 } from './synth/hum.ts';
import { renderVersions } from './versions.ts';

type Mode = 'title' | 'warmup' | 'ready' | 'flying' | 'result' | 'practice' | 'practiceDone';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('sky');
const ctx = canvas.getContext('2d')!;
const panel = $('panel');
const hud = $('hud');
const announcer = $('announcer');
const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const mic = new Mic();
const sfx = new Sfx(() => mic.ctx ?? fallbackCtx());
let spareCtx: AudioContext | null = null;
function fallbackCtx(): AudioContext {
  spareCtx ??= new AudioContext();
  return spareCtx;
}

const DEFAULT_RANGE: Range = { low: 48, high: 60 };
const SPEED = 0.2; // screen widths per second
const GATES = Math.max(4, Math.min(40, Number(params.get('gates')) || 20));

let mode: Mode = 'title';
let range: Range = DEFAULT_RANGE;
let haveRange = false;
let afterWarmup: 'fly' | 'practice' = 'fly';
let keyboard = false;
let keyY = 0.5;
const keysDown = new Set<string>();
const cal = new Calibrator(1.5);
let gates: Gate[] = [];
let flight: Flight | null = null;
let flashes: { gate: number; ok: boolean; at: number }[] = [];
let curMidi: number | null = null;
let lastFrame: MicFrame | null = null;
let planeY = 0.5;
let planeVy = 0;
let wall = 0;
let silentFor = 0;
let readySilence = 0;
let flightLog: { t: number; midi: number | null }[] = [];
let detectMs: number[] = [];
let runs = 0;
let practiceRuns = 0;

// ---------- practice state ----------
interface Practice {
  targets: number[];
  i: number;
  hold: number;
  holdCents: number[];
  started: number;
  results: { note: number; matched: boolean; cents: number | null }[];
  pauseUntil: number;
}
let practice: Practice | null = null;
const TOL = 40; // cents: inside the practice ring

// ---------- canvas sizing ----------
let W = 0;
let H = 0;
function resize(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---------- panels ----------
function show(html: string, corner = false, title = false): void {
  panel.hidden = false;
  panel.classList.toggle('corner', corner);
  panel.classList.toggle('title', title);
  panel.innerHTML = html;
  const first = panel.querySelector<HTMLElement>('[data-focus]');
  first?.focus({ preventScroll: true });
}
function hidePanel(): void {
  panel.hidden = true;
}
function say(text: string): void {
  announcer.textContent = text;
}

function titlePanel(): void {
  mode = 'title';
  hud.hidden = true;
  show(`
    <h1>Hum Pilot</h1>
    <p class="rules">Hum higher to climb. Hum lower to dive. Go quiet to glide.</p>
    <p>First, a ten-second warm-up finds your lowest and highest comfortable notes, so the sky fits your voice.</p>
    <div class="actions">
      <button class="btn" data-act="fly" data-focus>Start flying</button>
      <button class="btn ghost" data-act="practice">Practice notes</button>
    </div>
    <p class="small" style="margin-top:14px">Uses your microphone. Nothing is recorded or uploaded.
    No microphone? <button class="linkish" data-act="keys" style="text-decoration:underline;color:var(--blue)">Fly with the arrow keys</button>.</p>
  `, false, true);
}

function warmupPanel(): void {
  const step = cal.step;
  const cur = cal.current;
  const lowNote = step === 'high' || step === 'done' ? (cal.result?.low ?? lowGuess) : null;
  show(
    `
    <h2>Warm-up</h2>
    ${cal.error ? `<p class="err">${cal.error}</p>` : ''}
    <ol class="steps">
      <li class="${step === 'low' ? 'now' : 'done'}"><span>${step === 'low' ? 'Hum your lowest comfortable note and hold it' : 'Lowest note'}</span>
        <span class="note" id="low-note">${step === 'low' ? (cur !== null ? noteName(cur) : '') : lowNote !== null ? noteName(lowNote) : ''}</span>
        ${step === 'low' ? '<span class="meter"><span id="cal-meter"></span></span>' : ''}</li>
      <li class="${step === 'high' ? 'now' : ''}"><span>${step === 'high' ? 'Take a breath, then hum your highest comfortable note' : 'Highest note'}</span>
        <span class="note" id="high-note">${step === 'high' && cur !== null ? noteName(cur) : ''}</span>
        ${step === 'high' ? '<span class="meter"><span id="cal-meter"></span></span>' : ''}</li>
    </ol>
    <p class="small" id="cal-hint">${lastFrame?.voiced ? 'Hearing you.' : 'Listening… hum an “mmm”, mouth closed.'}</p>
    <div class="actions"><button class="btn ghost" data-act="restart-warmup">Start over</button></div>
  `,
    true,
  );
}
let lowGuess: number | null = null;
let warmupShownStep = '';
let warmupShownError: string | null = null;
function updateWarmup(): void {
  if (cal.step !== warmupShownStep || cal.error !== warmupShownError) {
    warmupShownStep = cal.step;
    warmupShownError = cal.error;
    warmupPanel();
  }
  const m = panel.querySelector<HTMLElement>('#cal-meter');
  if (m) m.style.width = `${Math.round(cal.progress * 100)}%`;
  const cur = cal.current;
  const el = panel.querySelector<HTMLElement>(cal.step === 'low' ? '#low-note' : '#high-note');
  if (el && cur !== null) el.textContent = noteName(cur);
  const hint = panel.querySelector<HTMLElement>('#cal-hint');
  if (hint) hint.textContent = lastFrame?.voiced ? 'Hearing you. Hold it steady.' : 'Listening… hum an “mmm”, mouth closed.';
}

function readyPanel(): void {
  mode = 'ready';
  readySilence = 0;
  const n = scaleNotes(range.low, range.high).length;
  hud.hidden = true;
  if (afterWarmup === 'practice') {
    startPractice();
    return;
  }
  show(
    `
    <h2>Ready</h2>
    <p>${keyboard ? 'Hold ↑ to climb and ↓ to dive (or drag on the sky).' : `Your range is <b>${noteName(range.low)}</b> to <b>${noteName(range.high)}</b>. Every gap sits on one of its ${n} notes.`}</p>
    <p class="rules">${keyboard ? 'Press space to take off.' : 'Go quiet for a moment, then hum any note to take off.'}</p>
    ${keyboard ? '' : '<div class="actions"><button class="btn ghost" data-act="rewarm">Redo the warm-up</button></div>'}
  `,
    true,
  );
}

function takeOff(): void {
  const seed = params.get('seed') ?? `${Date.now()}`;
  gates = makeLevel(range, runs === 0 ? seed : `${seed}-${runs}`, { gates: GATES });
  runs++;
  flight = new Flight(gates, range, planeY);
  flashes = [];
  flightLog = [];
  mode = 'flying';
  hidePanel();
  const r = $('play').getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) $('play').scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  hud.hidden = false;
  $('hud-total').textContent = String(gates.length);
  updateHud();
  say('Take-off.');
}

function updateHud(): void {
  if (!flight) return;
  $('hud-count').textContent = String(flight.threaded);
  const lives = $('hud-lives');
  lives.innerHTML = [0, 1, 2].map((i) => `<i class="${i < flight!.lives ? '' : 'lost'}"></i>`).join('');
  lives.setAttribute('aria-label', `${flight.lives} tries left`);
  $('hud-hint').textContent = silentFor > 1.2 && !keyboard ? 'Gliding. Hum to steer.' : '';
}

function resultPanel(): void {
  mode = 'result';
  hud.hidden = true;
  const f = flight!;
  const ok = f.passes.filter((p) => p.ok);
  const cents = ok.filter((p) => p.centsOff !== null).map((p) => Math.abs(p.centsOff!));
  const avg = cents.length ? Math.round(cents.reduce((a, b) => a + b, 0) / cents.length) : null;
  const all = f.next >= gates.length && f.lives > 0;
  const distinct = new Set(ok.map((p) => gates[p.gate].note)).size;
  const head = all ? (ok.length === gates.length ? 'Perfect delivery' : 'Delivered') : 'Crash-landed';
  show(`
    <h2>${head}</h2>
    <div class="stats">
      <div><b>${ok.length}/${gates.length}</b><span>gates threaded</span></div>
      ${keyboard ? `<div><b>${Math.round(f.t)} s</b><span>in the air</span></div>` : `<div><b>${avg !== null ? avg : '–'}</b><span>cents off the note, on average</span></div>`}
      <div><b>${distinct}</b><span>${distinct === 1 ? 'note' : 'different notes'} ${keyboard ? 'flown through' : 'hummed'}</span></div>
    </div>
    <canvas class="flightlog" id="flightlog" aria-label="Your flight path through the gates"></canvas>
    <p class="small">Your flight, start to finish. The dashed line is your hum.</p>
    <div class="actions">
      <button class="btn" data-act="again" data-focus>Fly again</button>
      <button class="btn ghost" data-act="practice">Practice notes</button>
      ${keyboard ? '' : '<button class="btn ghost" data-act="rewarm">Redo warm-up</button>'}
    </div>
  `);
  drawFlightLog($<HTMLCanvasElement>('flightlog'), f);
  say(`${head}. ${ok.length} of ${gates.length} gates.`);
}

function drawFlightLog(cv: HTMLCanvasElement, f: Flight): void {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = r.width * dpr;
  cv.height = r.height * dpr;
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const T = Math.max(f.t, gates[gates.length - 1].time + 0.5);
  const X = (t: number) => 8 + (t / T) * (r.width - 16);
  const Y = (y: number) => r.height * (1 - y);
  gates.forEach((g, i) => {
    const pass = f.passes.find((p) => p.gate === i);
    c.fillStyle = pass ? (pass.ok ? C.stamp : C.red) : 'rgba(210,52,62,0.35)';
    c.fillRect(X(g.time) - 2, 0, 4, Y(g.y + g.half));
    c.fillRect(X(g.time) - 2, Y(g.y - g.half), 4, r.height);
  });
  c.strokeStyle = C.blue;
  c.lineWidth = 2;
  c.setLineDash([6, 4]);
  c.beginPath();
  f.trail.forEach((p, i) => (i ? c.lineTo(X(p.t), Y(p.y)) : c.moveTo(X(p.t), Y(p.y))));
  c.stroke();
}

// ---------- practice ----------
function startPractice(): void {
  const ps = params.get('pseed');
  const rnd = mulberry32(ps ? hashSeed(`${ps}-${practiceRuns++}`) : Date.now() & 0xffff);
  const targets = practiceTargets(range, rnd);
  practice = { targets, i: 0, hold: 0, holdCents: [], started: wall, results: [], pauseUntil: 0 };
  mode = 'practice';
  hud.hidden = true;
  practicePanel();
}

function practicePanel(): void {
  const p = practice!;
  const note = p.targets[p.i];
  show(
    `
    <h2>Note ${p.i + 1} of ${p.targets.length}</h2>
    <p>Hum <b>${noteName(note)}</b> and hold the plane in the ring for one second.</p>
    <div class="live"><b id="pr-you">–</b><span id="pr-off" class="small">Listening…</span></div>
    <div class="actions">
      <button class="btn" data-act="play-note" data-focus>Play the note</button>
      <button class="btn ghost" data-act="skip">Skip</button>
      <button class="btn ghost" data-act="stop-practice">Stop</button>
    </div>
  `,
    true,
  );
}

function practiceStep(dt: number): void {
  const p = practice!;
  if (wall < p.pauseUntil) return;
  const note = p.targets[p.i];
  const m = keyboard ? yToPitch(keyY, range) : curMidi;
  const you = panel.querySelector<HTMLElement>('#pr-you');
  const off = panel.querySelector<HTMLElement>('#pr-off');
  if (m !== null) {
    const cents = Math.round((m - note) * 100);
    if (you) you.textContent = noteName(m);
    if (off)
      off.textContent =
        Math.abs(cents) <= TOL
          ? `In the ring (${cents >= 0 ? '+' : ''}${cents} cents)`
          : Math.abs(cents) <= 150
            ? `${Math.abs(cents)} cents ${cents > 0 ? 'high: a little lower' : 'low: a little higher'}`
            : cents > 0
              ? 'Too high: hum lower'
              : 'Too low: hum higher';
    if (Math.abs(cents) <= TOL) {
      p.hold += dt;
      p.holdCents.push(cents);
    } else p.hold = Math.max(0, p.hold - dt * 0.5);
  } else {
    p.hold = Math.max(0, p.hold - dt * 0.5);
    if (off) off.textContent = 'Listening…';
  }
  const timedOut = wall - p.started > 12;
  if (p.hold >= 1 || timedOut) {
    const matched = p.hold >= 1;
    const cs = p.holdCents.slice(-60);
    p.results.push({ note, matched, cents: matched ? Math.round(cs.reduce((a, b) => a + Math.abs(b), 0) / cs.length) : null });
    if (matched) sfx.pass();
    say(matched ? `${noteName(note)} matched.` : `${noteName(note)} skipped.`);
    nextPracticeNote(matched ? 0.6 : 0);
  }
}

function nextPracticeNote(pause: number): void {
  const p = practice!;
  p.i++;
  p.hold = 0;
  p.holdCents = [];
  p.started = wall + pause;
  p.pauseUntil = wall + pause;
  if (p.i >= p.targets.length) {
    practiceDonePanel();
    return;
  }
  setTimeout(() => mode === 'practice' && practicePanel(), pause * 1000);
}

function practiceDonePanel(): void {
  mode = 'practiceDone';
  const r = practice!.results;
  const ok = r.filter((x) => x.matched);
  const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b.cents!, 0) / ok.length) : null;
  show(`
    <h2>${ok.length} of ${r.length} notes matched</h2>
    <p>${avg !== null ? `While in the ring you were on average <b>${avg} cents</b> off the note (100 cents is one semitone).` : 'No notes matched this time. Try “Play the note” first, then hum along.'}</p>
    <p class="small">${r.map((x) => `${noteName(x.note)} ${x.matched ? '✓' : '✗'}`).join('&nbsp;&nbsp; ')}</p>
    <div class="actions">
      <button class="btn" data-act="practice" data-focus>Practice again</button>
      <button class="btn ghost" data-act="fly-now">Go flying</button>
    </div>
  `);
}

// ---------- actions ----------
async function needMic(): Promise<boolean> {
  if (keyboard) return true;
  try {
    await mic.start();
    return true;
  } catch (e) {
    const name = (e as DOMException)?.name;
    show(`
      <h2>No microphone</h2>
      <p>${name === 'NotAllowedError' ? 'The microphone is blocked for this page. Allow it from the icon in the address bar, then try again.' : name === 'NotFoundError' ? 'No microphone was found. Plug one in, then try again.' : 'The microphone could not be started.'}</p>
      <div class="actions">
        <button class="btn" data-act="fly" data-focus>Try again</button>
        <button class="btn ghost" data-act="keys">Fly with the arrow keys</button>
      </div>
    `);
    return false;
  }
}

function startWarmup(): void {
  cal.restart();
  lowGuess = null;
  warmupShownStep = '';
  mode = 'warmup';
  updateWarmup();
}

panel.addEventListener('click', async (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (!act) return;
  switch (act) {
    case 'fly':
    case 'practice':
      afterWarmup = act === 'fly' ? 'fly' : 'practice';
      if (!(await needMic())) return;
      if (haveRange || keyboard) readyPanel();
      else startWarmup();
      break;
    case 'fly-now':
      afterWarmup = 'fly';
      readyPanel();
      break;
    case 'keys':
      keyboard = true;
      range = DEFAULT_RANGE;
      haveRange = true;
      afterWarmup = 'fly';
      readyPanel();
      break;
    case 'restart-warmup':
    case 'rewarm':
      if (!(await needMic())) return;
      haveRange = false;
      startWarmup();
      break;
    case 'again':
      afterWarmup = 'fly';
      readyPanel();
      break;
    case 'play-note':
      if (practice) {
        const hz = midiToHz(practice.targets[practice.i]);
        sfx.tone(hz, 1);
        mic.muteUntil = performance.now() + 1150;
        practice.started = wall + 1.2; // don't count listening time against the clock
      }
      break;
    case 'skip':
      if (practice) {
        practice.results.push({ note: practice.targets[practice.i], matched: false, cents: null });
        nextPracticeNote(0);
      }
      break;
    case 'stop-practice':
      titlePanel();
      break;
  }
});

$('sound').addEventListener('click', (e) => {
  sfx.enabled = !sfx.enabled;
  const b = e.currentTarget as HTMLButtonElement;
  b.setAttribute('aria-pressed', String(sfx.enabled));
  b.textContent = sfx.enabled ? 'Sound on' : 'Sound off';
});

addEventListener('keydown', (e) => {
  if (!keyboard) return;
  if (['ArrowUp', 'ArrowDown', 'w', 's', ' '].includes(e.key)) {
    if (e.key === ' ' && mode === 'ready') takeOff();
    if (mode === 'flying' || mode === 'practice' || mode === 'ready') e.preventDefault();
    keysDown.add(e.key);
  }
});
addEventListener('keyup', (e) => keysDown.delete(e.key));
canvas.addEventListener('pointerdown', (e) => {
  if (!keyboard) return;
  canvas.setPointerCapture(e.pointerId);
  pointerY(e);
  if (mode === 'ready') takeOff();
});
canvas.addEventListener('pointermove', (e) => keyboard && e.buttons && pointerY(e));
function pointerY(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect();
  keyY = Math.max(0.03, Math.min(0.97, 1 - (e.clientY - r.top) / r.height));
}

// ---------- main loop ----------
let last = performance.now();
let lastDetect = 0;
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  wall += dt;

  // Pitch detection at about 60 per second, whatever the display rate.
  let frame: MicFrame | null = null;
  let detDt = 0;
  if (mic.running && now - lastDetect >= 15.5) {
    detDt = lastDetect ? Math.min(0.05, (now - lastDetect) / 1000) : 1 / 60;
    lastDetect = now;
    frame = mic.read();
    if (frame) {
      lastFrame = frame;
      curMidi = frame.midi;
      detectMs.push(frame.ms);
      if (detectMs.length > 600) detectMs.shift();
    }
  }
  if (keyboard) {
    if (keysDown.has('ArrowUp') || keysDown.has('w')) keyY = Math.min(0.97, keyY + 0.9 * dt);
    if (keysDown.has('ArrowDown') || keysDown.has('s')) keyY = Math.max(0.03, keyY - 0.9 * dt);
    curMidi = mode === 'flying' || mode === 'practice' || mode === 'ready' ? yToPitch(keyY, range) : null;
  }
  const humming = curMidi !== null;
  silentFor = humming ? 0 : silentFor + dt;

  switch (mode) {
    case 'warmup':
      if (frame) {
        cal.push(frame.midi, detDt);
        if (cal.step === 'high' && lowGuess === null) lowGuess = cal.lowNote;
        updateWarmup();
        if (cal.result) {
          range = { low: cal.result.low, high: cal.result.high };
          haveRange = true;
          say(`Your range is ${noteName(range.low)} to ${noteName(range.high)}.`);
          readyPanel();
        }
      }
      break;
    case 'ready':
      if (!keyboard) {
        if (!humming) readySilence += dt;
        else if (readySilence > 0.3) takeOff();
      }
      break;
    case 'flying': {
      const f = flight!;
      const pass: Pass | null = f.step(dt, keyboard ? null : curMidi, keyboard ? keyY : null);
      flightLog.push({ t: f.t, midi: curMidi });
      if (pass) {
        flashes.push({ gate: pass.gate, ok: pass.ok, at: wall });
        if (pass.ok) sfx.pass();
        else {
          sfx.crash();
          say(`Missed. ${f.lives} tries left.`);
        }
        updateHud();
      } else if (Math.floor(wall * 4) !== Math.floor((wall - dt) * 4)) updateHud();
      planeY = f.y;
      planeVy = f.vy;
      if (f.done) resultPanel();
      break;
    }
    case 'practice':
      practiceStep(dt);
      break;
  }

  // Plane outside a flight: idle bob on the title, follow your voice otherwise.
  if (mode !== 'flying') {
    const target = mode === 'title' || mode === 'result' || mode === 'practiceDone' ? 0.52 + (reduceMotion ? 0 : Math.sin(wall * 1.3) * 0.03) : curMidi !== null ? pitchToY(curMidi, range) : null;
    const prev = planeY;
    if (target !== null) planeY += (target - planeY) * (1 - Math.exp(-dt / 0.12));
    else planeY = Math.max(0.05, planeY - 0.02 * dt);
    planeVy = (planeY - prev) / Math.max(dt, 1e-6);
  }

  const showGates = mode === 'flying' || mode === 'result';
  render(ctx, W, H, {
    t: flight && showGates ? flight.t : 0,
    range: haveRange ? range : DEFAULT_RANGE,
    gates: showGates ? gates : [],
    flight: showGates ? flight : null,
    planeY,
    planeVy,
    pitch: mode === 'title' ? null : curMidi,
    speed: SPEED,
    reduceMotion,
    flash: flashes,
    wallClock: wall,
    planeXFrac: mode === 'title' && W >= 900 ? 0.76 : undefined,
    target:
      mode === 'practice' && practice && practice.i < practice.targets.length
        ? { note: practice.targets[practice.i], half: semitoneHeight(range) * (TOL / 100), hold: practice.hold }
        : null,
  });
  requestAnimationFrame(loop);
}

// Test and debugging hook (read-only snapshot).
Object.defineProperty(window, '__hum', {
  get: () => ({
    mode,
    range: haveRange ? range : null,
    calibStep: cal.step,
    gates: gates.map((g) => ({ note: g.note, time: g.time })),
    passes: flight?.passes ?? [],
    threaded: flight?.threaded ?? 0,
    lives: flight?.lives ?? null,
    flightT: flight?.t ?? 0,
    midi: curMidi,
    frame: lastFrame,
    detectMsMedian: detectMs.length ? [...detectMs].sort((a, b) => a - b)[detectMs.length >> 1] : null,
    baseLatency: mic.ctx?.baseLatency ?? null,
    sampleRate: mic.ctx?.sampleRate ?? null,
    flightLog,
    practice: practice ? { i: practice.i, results: practice.results } : null,
  }),
});

renderVersions($('versions'));
titlePanel();
requestAnimationFrame(loop);
