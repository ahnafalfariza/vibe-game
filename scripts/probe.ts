// Headless feel probe: run the simulation with simple bots and print stats.
// Usage: bun run probe   (BIOME=twilight bun run probe for another biome's spawns)
import { Run, SIM_DT } from '../src/sim/run';
import { createTuning } from '../src/tuning';
import type { RunEvent } from '../src/sim/run';
import type { Cluster } from '../src/sim/spawner';
import { BIOMES, findBiome } from '../src/biomes';

const spawns = (findBiome(process.env.BIOME ?? null) ?? BIOMES[0]).spawns;

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

/** How long before reaching it the hopper jumps a rock, or onto a cabin roof, s. */
const HOP_LEAD = { rock: 0.3, cabin: 0.45 };

// The lip jumper, plus: hops (no flip) over rocks and onto cabins it sees coming.
function hopper(): Bot {
  const lip = lipJumper();
  return (run, t) => {
    const input = lip(run, t);
    const s = run.skier;
    if (s.mode !== 'ground' || input.pressed) return input;
    for (const e of run.spawner.entities) {
      if (e.kind !== 'rock' && (e.kind !== 'cabin' || e.broken)) continue;
      const d = e.x0 - s.x;
      if (d > 0 && d < s.velocity * HOP_LEAD[e.kind]) return { held: false, pressed: true };
    }
    return input;
  };
}

const BOTS: [string, () => Bot][] = [
  ['idle', () => idle],
  ['flipper', flipper],
  ['lipjump', lipJumper],
  ['hopper', hopper],
];

function simulate(name: string, bot: Bot, seed: number, seconds: number) {
  // The avalanche is off here so every bot gets the full time; survive() tests it.
  const run = new Run(seed, createTuning(), false, true, spawns);
  const events: RunEvent[] = [];
  let prevHeld = false;
  let speedSum = 0;
  let steps = 0;
  const takeoffs: number[] = [];
  const kinds = new Map<string, number>();
  const air = new Map<string, number[]>();
  const hits = { rock: 0, cabin: 0, airborne: 0, roofs: 0 };
  const clusters = new Set<Cluster>();
  let lastKind = '?';
  for (let t = 0; t < seconds; t += SIM_DT) {
    const input = bot(run, t);
    input.pressed = input.pressed || (input.held && !prevHeld);
    prevHeld = input.held;
    events.length = 0;
    const wasAir = run.skier.mode === 'air';
    run.step(input, events);
    speedSum += run.skier.velocity;
    steps++;
    for (const e of run.spawner.entities) if (e.kind === 'coin') clusters.add(e.cluster);
    for (const e of events) {
      if (e.type === 'takeoff' || e.type === 'jump') {
        takeoffs.push(t);
        lastKind = run.terrain.featureAt(run.skier.x)?.kind ?? '?';
      }
      if (e.type === 'hit' && e.crashed) {
        hits[e.obstacle]++;
        if (wasAir) hits.airborne++;
      }
      if (e.type === 'land') {
        if (run.terrain.height(e.x) - e.y > 50) hits.roofs++;
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
  const passed = [...clusters].filter((c) => c.x1 < run.skier.x).length;
  console.log(
    `${name.padEnd(8)} seed=${seed} dist=${(run.distancePx() / 40).toFixed(0)}m avgSpeed=${(speedSum / steps).toFixed(0)} top=${st.topSpeed.toFixed(0)} ` +
      `bestAir=${st.bestAirTime.toFixed(2)}s takeoffs=${takeoffs.length} landings=${JSON.stringify(Object.fromEntries(kinds))}`,
  );
  console.log(
    `   hits rock=${hits.rock} cabin=${hits.cabin} (from the air ${hits.airborne})  roof landings=${hits.roofs}  coins=${st.coins}  clusters ${st.clusters}/${passed}` +
      (passed ? ` (${Math.round((100 * st.clusters) / passed)}%)` : ''),
  );
  if (name === 'idle' || name === 'lipjump') {
    const rows = [...air].map(([k, v]) => `${k}:n=${v.length},avg=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)},max=${Math.max(...v).toFixed(2)}`);
    console.log('   air>0.25s by feature: ' + rows.join('  '));
  }
  return { hits: hits.rock + hits.cabin, coins: st.coins, clusters: st.clusters, passed };
}

/** Seconds until the avalanche catches the bot (capped at 5 minutes). */
function survive(bot: Bot, seed: number): string {
  const run = new Run(seed, createTuning(), true, true, spawns);
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

const totals = new Map<string, { hits: number; coins: number; clusters: number; passed: number }>();
for (const seed of [1, 2, 3]) {
  for (const [name, make] of BOTS) {
    const r = simulate(name, make(), seed, 60);
    const t = totals.get(name) ?? { hits: 0, coins: 0, clusters: 0, passed: 0 };
    for (const k of Object.keys(r) as (keyof typeof r)[]) t[k] += r[k];
    totals.set(name, t);
  }
}
console.log('per bot over 3 × 60 s:');
for (const [name, t] of totals) {
  console.log(`   ${name.padEnd(8)} obstacle crashes ${t.hits}  coins ${t.coins}  full clusters ${t.clusters}/${t.passed} (${Math.round((100 * t.clusters) / Math.max(1, t.passed))}%)`);
}
const survival = new Map<string, number[]>();
for (const seed of [1, 2, 3, 4, 5]) {
  const row = BOTS.map(([name, make]) => {
    const s = survive(make(), seed);
    survival.set(name, [...(survival.get(name) ?? []), parseInt(s)]);
    return `${name} ${s}s`;
  });
  console.log(`avalanche seed=${seed} survived: ${row.join('  ')}`);
}
console.log('avalanche mean survival: ' + [...survival].map(([n, v]) => `${n} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(0)}s`).join('  '));
