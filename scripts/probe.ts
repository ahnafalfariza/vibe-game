// Headless feel probe: run the simulation with simple bots and print stats.
// Usage: bun run probe
import { Run, SIM_DT } from '../src/sim/run';
import { createTuning } from '../src/tuning';
import type { RunEvent } from '../src/sim/run';

type Bot = (run: Run, t: number) => { held: boolean; pressed: boolean };

const idle: Bot = () => ({ held: false, pressed: false });

// Jumps on flat-ish ground every ~2.5 s and holds for a single backflip.
function flipper(): Bot {
  let next = 1.5;
  let holdUntil = -1;
  return (run, t) => {
    const s = run.skier;
    let pressed = false;
    if (s.mode === 'ground' && t >= next) {
      pressed = true;
      holdUntil = t + 0.78;
      next = t + 2.5;
    }
    return { held: t < holdUntil, pressed };
  };
}

// Jumps right at ramp lips (steep uphill) and holds long enough for flips.
function lipJumper(): Bot {
  let holdUntil = -1;
  return (run, t) => {
    const s = run.skier;
    let pressed = false;
    if (s.mode === 'ground' && s.angle < -0.5) {
      pressed = true;
      holdUntil = t + 0.72;
    }
    return { held: t < holdUntil, pressed };
  };
}

function simulate(name: string, bot: Bot, seed: number, seconds: number) {
  // The avalanche is off here so every bot gets the full time; survive() tests it.
  const run = new Run(seed, createTuning(), false);
  const events: RunEvent[] = [];
  let prevHeld = false;
  let speedSum = 0;
  let steps = 0;
  const takeoffs: number[] = [];
  const kinds = new Map<string, number>();
  const air = new Map<string, number[]>();
  let lastKind = '?';
  for (let t = 0; t < seconds; t += SIM_DT) {
    const input = bot(run, t);
    input.pressed = input.pressed || (input.held && !prevHeld);
    prevHeld = input.held;
    events.length = 0;
    run.step(input, events);
    speedSum += run.skier.velocity;
    steps++;
    for (const e of events) {
      if (e.type === 'takeoff' || e.type === 'jump') {
        takeoffs.push(t);
        lastKind = run.terrain.featureAt(run.skier.x)?.kind ?? '?';
      }
      if (e.type === 'land') {
        const k = `${e.quality}${e.flips ? `+${e.flips}flip` : ''}`;
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        if (e.airTime > 0.25) {
          const a = air.get(lastKind) ?? [];
          a.push(e.airTime);
          air.set(lastKind, a);
        }
      }
    }
  }
  const st = run.stats;
  console.log(
    `${name.padEnd(8)} seed=${seed} dist=${(run.distancePx() / 40).toFixed(0)}m avgSpeed=${(speedSum / steps).toFixed(0)} top=${st.topSpeed.toFixed(0)} ` +
      `bestAir=${st.bestAirTime.toFixed(2)}s takeoffs=${takeoffs.length} landings=${JSON.stringify(Object.fromEntries(kinds))}`,
  );
  if (name !== 'flipper') {
    const rows = [...air].map(([k, v]) => `${k}:n=${v.length},avg=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)},max=${Math.max(...v).toFixed(2)}`);
    console.log('   air>0.25s by feature: ' + rows.join('  '));
  }
}

/** Seconds until the avalanche catches the bot (capped at 5 minutes). */
function survive(bot: Bot, seed: number): string {
  const run = new Run(seed, createTuning());
  let prevHeld = false;
  let minGap = Infinity;
  for (let t = 0; t < 300 && !run.caught; t += SIM_DT) {
    const input = bot(run, t);
    input.pressed = input.pressed || (input.held && !prevHeld);
    prevHeld = input.held;
    run.step(input, []);
    if (t < 10) minGap = Math.min(minGap, run.avalancheGap());
  }
  return Math.round(run.time) + (minGap < 150 ? ` (gap ${minGap.toFixed(0)}px in first 10s!)` : '');
}

for (const seed of [1, 2, 3]) {
  simulate('idle', idle, seed, 60);
  simulate('flipper', flipper(), seed, 60);
  simulate('lipjump', lipJumper(), seed, 60);
}
for (const seed of [1, 2, 3, 4, 5]) {
  console.log(`avalanche seed=${seed} survived: idle ${survive(idle, seed)}s  flipper ${survive(flipper(), seed)}s  lipjump ${survive(lipJumper(), seed)}s`);
}
