// The landing page (index.html). Numbers on it come from the game itself, so
// they stay true when the game is retuned: landing angles from the tuning,
// ranks and shop prices from the meta rules.

import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './landing.css';
import { DEFAULT_TUNING, PX_PER_METRE } from './tuning';
import { PERKS, UPGRADES } from './sim/meta';
import { Score } from './sim/score';

const $ = (id: string) => document.getElementById(id)!;
const root = document.documentElement;
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// ---- HUD: the page is the slope. Score (metres + the yeti's tricks), metres
// down it and scroll speed, in game units.

/** Seconds without scrolling before the avalanche starts creeping in. */
const IDLE_GRACE = 6;
/** Avalanche reach gained per idle second, and lost per scrolling second (0..1). */
const CREEP = 0.05;
const RETREAT = 1.5;
/** How far away the avalanche is when it first shows up, m. */
const AVALANCHE_START = 40;

const hudScore = $('hud-score');
const hudM = $('hud-m');
const hudKmh = $('hud-kmh');
const hudWarn = $('hud-warn');
let lastY = scrollY;
let lastT = performance.now();
let kmh = 0;
let idle = 0;
let aval = 0;
const score = new Score();

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastT) / 1000) || 1 / 60;
  lastT = now;
  const y = scrollY;
  const speed = Math.abs(y - lastY) / dt;
  lastY = y;

  kmh += ((speed / PX_PER_METRE) * 3.6 - kmh) * Math.min(1, dt * 5);
  const metres = Math.round(y / PX_PER_METRE);
  setText(hudScore, (metres + score.tricks).toLocaleString('en-US'));
  setText(hudM, String(metres));
  setText(hudKmh, String(Math.round(kmh)));
  root.classList.toggle('past-summit', y > innerHeight * 0.75);

  if (speed > 30) {
    idle = 0;
    aval = Math.max(0, aval - dt * RETREAT);
  } else if ((idle += dt) > IDLE_GRACE && !calm.matches) {
    aval = Math.min(1, aval + dt * CREEP);
  }
  root.style.setProperty('--aval', aval.toFixed(3));
  setText(
    hudWarn,
    aval >= 1 ? 'Buried! Scroll to dig out' : aval > 0.02 ? `Avalanche! ${Math.ceil((1 - aval) * AVALANCHE_START)} m` : '',
  );
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- The hero yeti, in the air off the kicker: hold to keep backflipping, let
// go to land on the next whole turn. Scored by the game's own rules.

/** As PlayScene's popups say it. */
const FLIP_NAMES = ['', 'Backflip!', 'Double backflip!', 'Triple backflip!!'];
const yeti = document.querySelector<HTMLButtonElement>('.hero-yeti')!;
const trick = $('trick');
let held = false;
let flips = 0;

function land(n: number): void {
  yeti.classList.remove('flip');
  const points = score.land({ type: 'land', x: 0, y: 0, quality: 'clean', flips: n, airTime: 0, errorDeg: 0 });
  trick.textContent = `${FLIP_NAMES[n] ?? `${n}× backflip!!!`} +${points}`;
  trick.classList.remove('show');
  void trick.offsetWidth; // restart the popup animation
  trick.classList.add('show');
}

function press(): void {
  held = true;
  if (calm.matches) return land(1);
  if (yeti.classList.contains('flip')) return;
  flips = 0;
  yeti.classList.add('flip');
}

yeti.addEventListener('pointerdown', press);
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) yeti.addEventListener(type, () => (held = false));
// Keyboard (Enter / Space) clicks have no pointer behind them: one flip.
yeti.addEventListener('click', (e) => {
  if (e.detail > 0) return;
  press();
  held = false;
});
yeti.addEventListener('animationiteration', (e) => {
  if (e.animationName !== 'backflip') return;
  flips++;
  if (!held) land(flips);
});

// ---- The landing judge: the game's own clean / sloppy / crash angles.

const { cleanLandingDeg: CLEAN, crashLandingDeg: CRASH, sloppySpeedKeep, crashSpeedKeep } = DEFAULT_TUNING;
/** Radius of the angle zones, svg units. */
const R = 140;

/** A pie slice from `a0` to `a1` degrees, measured clockwise from straight up. */
function wedge(a0: number, a1: number): string {
  const at = (a: number) => {
    const r = (a * Math.PI) / 180;
    return `${(R * Math.sin(r)).toFixed(1)} ${(-R * Math.cos(r)).toFixed(1)}`;
  };
  return `M0 0L${at(a0)}A${R} ${R} 0 0 1 ${at(a1)}Z`;
}

$('zone-clean').setAttribute('d', wedge(-CLEAN, CLEAN));
$('zone-sloppy').setAttribute('d', wedge(-CRASH, CRASH));
$('zone-crash').setAttribute('r', String(R));

const VERDICTS = {
  clean: ['Clean', 'Every flip you landed turns into a burst of speed, and the multiplier climbs.'],
  sloppy: ['Sloppy', `You keep ${sloppySpeedKeep * 100}% of your speed. Your multiplier drops back to ×1.`],
  crash: ['Wipeout', `Face, meet snow. You keep ${crashSpeedKeep * 100}% of your speed and the avalanche gains on you.`],
} as const;

const judge = document.querySelector<HTMLElement>('.judge')!;
const tilt = $('tilt') as HTMLInputElement;
function judgeLanding(): void {
  const a = Number(tilt.value);
  const off = Math.abs(a);
  const q = off <= CLEAN ? 'clean' : off <= CRASH ? 'sloppy' : 'crash';
  $('judge-yeti').setAttribute('transform', `rotate(${a})`);
  setText($('tilt-out'), `${off}°`);
  setText($('verdict'), VERDICTS[q][0]);
  setText($('verdict-note'), VERDICTS[q][1]);
  judge.dataset.q = q;
}
tilt.addEventListener('input', judgeLanding);
judgeLanding();

// ---- Twilight Pines: the rank perks and the shop, straight from the rules.

$('perks').innerHTML = PERKS.map(
  (p) =>
    `<li><div class="chair${p.biome ? ' unlock' : ''}"><span class="chair-rank">Rank ${p.rank}</span><b>${p.name}</b><span>${p.text}</span></div></li>`,
).join('');

$('shop').innerHTML = [...UPGRADES]
  .sort((a, b) => a.costs[0] - b.costs[0])
  .map(
    (u) =>
      `<li><b>${u.name}</b><span class="effect">${u.effect(1)}</span>` +
      `<span class="price"><i class="coin" aria-hidden="true"></i>${u.costs[0]}<span class="sr-only"> coins</span>` +
      `<small>${u.costs.length > 1 ? `${u.costs.length} levels` : 'one level'}</small></span></li>`,
  )
  .join('');
