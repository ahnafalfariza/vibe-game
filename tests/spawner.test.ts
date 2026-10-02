import { describe, expect, it } from 'vitest';
import { Run, SIM_DT, type RunEvent } from '../src/sim/run';
import { FORCED_AIR, START_CLEAR, Spawner, type Cabin, type Entity } from '../src/sim/spawner';
import { Terrain } from '../src/sim/terrain';
import { createTuning } from '../src/tuning';

const NO_INPUT = { held: false, pressed: false };

// The opening run-up is a straight line, y = 0.3x, up to x = 700: a clean
// test bench for hand-placed obstacles (nothing spawns there by itself).

/** Every entity the spawner places up to `toX`, in order. */
function spawnAll(seed: number, toX: number, obstacles = true): Entity[] {
  const tuning = createTuning();
  const terrain = new Terrain(seed, tuning);
  const spawner = new Spawner(terrain, tuning, seed, obstacles);
  const seen = new Set<Entity>();
  for (let x = 0; x < toX; x += 400) {
    terrain.ensure(x + 6000);
    spawner.update(x);
    for (const e of spawner.entities) seen.add(e);
    terrain.prune(x - 4000);
    spawner.prune(x - 4000);
  }
  return [...seen];
}

const summary = (es: Entity[]) => es.map((e) => `${e.kind}@${e.x0.toFixed(1)}`).join(' ');

function cabinOnRunUp(run: Run, x0 = 300, w = 340): Cabin {
  const h = 134;
  const cabin: Cabin = { kind: 'cabin', x0, x1: x0 + w, y0: run.terrain.height(x0) - h, m: 0.3, h, broken: false };
  run.spawner.add(cabin);
  return cabin;
}

/** Step until `done` (or the time runs out); returns all events. */
function stepUntil(run: Run, seconds: number, done: (events: RunEvent[]) => boolean = () => false, input = NO_INPUT) {
  const events: RunEvent[] = [];
  for (let t = 0; t < seconds && !done(events); t += SIM_DT) run.step(input, events);
  return events;
}

describe('Spawner', () => {
  it('is deterministic for a given seed, and differs between seeds', () => {
    expect(summary(spawnAll(5, 40000))).toBe(summary(spawnAll(5, 40000)));
    expect(summary(spawnAll(5, 40000))).not.toBe(summary(spawnAll(6, 40000)));
  });

  it('leaves the terrain exactly as it was', () => {
    const tuning = createTuning();
    const plain = new Terrain(11, tuning);
    const run = new Run(11, tuning);
    stepUntil(run, 20);
    const x = run.skier.x;
    for (let at = x - 3000; at < x + 8000; at += 37) expect(run.terrain.height(at)).toBe(plain.height(at));
  });

  it('places rocks, cabins, ice and coins', () => {
    const kinds = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) for (const e of spawnAll(seed, 100000)) kinds.add(e.kind);
    expect([...kinds].sort()).toEqual(['cabin', 'coin', 'ice', 'rock']);
  });

  it('keeps the demo run free of obstacles (coins are fine)', () => {
    const es = spawnAll(3, 60000, false);
    expect(es.filter((e) => e.kind !== 'coin')).toEqual([]);
    expect(es.length).toBeGreaterThan(20);
  });
});

describe('Fairness', () => {
  it('puts nothing in the opening run-up, and no obstacle before the start is clear', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const runUpEnd = new Terrain(seed, createTuning()).features[0].x1;
      for (const e of spawnAll(seed, 20000)) {
        expect(e.x0, `seed ${seed} ${e.kind}`).toBeGreaterThan(runUpEnd);
        if (e.kind !== 'coin') expect(e.x0, `seed ${seed} ${e.kind}`).toBeGreaterThanOrEqual(START_CLEAR);
      }
    }
  });

  it('never puts a rock or cabin on a kicker or booter ramp', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const terrain = new Terrain(seed, createTuning());
      terrain.ensure(100000);
      const ramps: [number, number][] = [];
      for (const f of terrain.features) {
        if (f.kind !== 'kicker' && f.kind !== 'booter') continue;
        // The ramp climbs from where the slope turns uphill to the lip, where it rolls over.
        let x = f.x0;
        while (terrain.sample(x).dy >= 0) x += 5;
        const start = x;
        while (terrain.sample(x).dy < 0) x += 5;
        ramps.push([start, x]);
      }
      for (const e of spawnAll(seed, 95000)) {
        if (e.kind !== 'rock' && e.kind !== 'cabin') continue;
        for (const [start, lip] of ramps) {
          expect(e.x1 < start - 100 || e.x0 > lip + 100, `seed ${seed} ${e.kind} at ${e.x0.toFixed(0)} by ramp ${start.toFixed(0)}–${lip.toFixed(0)}`).toBe(true);
        }
      }
    }
  });

  it('never makes a rider who just rides come down on a rock or fly into a cabin wall', () => {
    // A rider who moves exactly like the spawner's idle ghost: never knocked
    // down, no cluster boosts, ice that isn't slick, no mounts to ride. Riding
    // into things on the snow is fine (they were in plain view); landing on
    // them is not.
    const tuning = createTuning({ coinClusterBoost: 0, iceFriction: 0.03, iceDrag: 1, mountDensity: 0 });
    for (let seed = 1; seed <= 8; seed++) {
      const run = new Run(seed, tuning, { avalanche: false, obstacles: true });
      const sk = run.skier;
      const events: RunEvent[] = [];
      for (let t = 0; t < 90; t += SIM_DT) {
        sk.invulnTimer = Infinity;
        events.length = 0;
        run.step(NO_INPUT, events);
        const where = `seed ${seed} x=${sk.x.toFixed(0)}`;
        for (const e of events) if (e.type === 'hit') expect(sk.mode, `${where}: flew into a cabin wall`).not.toBe('air');
        if (sk.mode !== 'air' || sk.airTime < FORCED_AIR) continue;
        for (const e of run.spawner.entities) {
          if (e.kind === 'rock') expect(sk.touches(e.x, e.y, e.r), `${where}: landed on a rock`).toBe(false);
        }
      }
    }
  });
});

describe('Obstacles', () => {
  it('a rock on the snow knocks you down, then you get a moment of invulnerability', () => {
    const run = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    run.scoring.multiplier = 4;
    const rock = (x: number) => ({ kind: 'rock', x0: x - 34, x1: x + 34, x, y: run.terrain.height(x) - 7, r: 34 }) as const;
    run.spawner.add(rock(400));
    const events = stepUntil(run, 3, (es) => es.some((e) => e.type === 'hit'));
    expect(events.find((e) => e.type === 'hit')).toMatchObject({ obstacle: 'rock', crashed: true });
    expect(run.skier.mode).toBe('crash');
    expect(run.stats.crashes).toBe(1);
    expect(run.scoring.multiplier).toBe(1);

    // Get up, and run straight into another rock: no second crash while invulnerable.
    stepUntil(run, 3, (es) => es.some((e) => e.type === 'recover'));
    expect(run.skier.vulnerable).toBe(false);
    run.spawner.add(rock(run.skier.x + 60));
    stepUntil(run, 0.4);
    expect(run.stats.crashes).toBe(1);
    stepUntil(run, run.tuning.hitInvulnTime);
    expect(run.skier.vulnerable).toBe(true);
  });

  it('a rock can be jumped', () => {
    const run = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    run.spawner.add({ kind: 'rock', x0: 566, x1: 634, x: 600, y: run.terrain.height(600) - 7, r: 34 });
    stepUntil(run, 3, () => run.skier.x > 600 - run.skier.speed * 0.3);
    const events = stepUntil(run, 1.5, () => false, { held: false, pressed: true });
    expect(events.some((e) => e.type === 'hit')).toBe(false);
    expect(run.skier.x).toBeGreaterThan(700);
  });

  it('running into a cabin wall crashes and smashes through it', () => {
    const run = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    const cabin = cabinOnRunUp(run);
    const events = stepUntil(run, 3, (es) => es.some((e) => e.type === 'hit'));
    expect(events.find((e) => e.type === 'hit')).toMatchObject({ obstacle: 'cabin', crashed: true });
    expect(run.skier.x).toBeLessThan(cabin.x0);
    expect(cabin.broken).toBe(true);
    expect(run.stats.crashes).toBe(1);
    stepUntil(run, 3);
    expect(run.skier.x).toBeGreaterThan(cabin.x1);
    expect(run.stats.crashes).toBe(1);
  });

  it('flying into a cabin below its roof hits the wall instead of popping up onto the roof', () => {
    const run = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    const cabin = cabinOnRunUp(run);
    const sk = run.skier;
    Object.assign(sk, { mode: 'air', x: 200, y: run.terrain.height(200) - 40, vx: 900, vy: -100 });
    const events = stepUntil(run, 1, (es) => es.some((e) => e.type === 'hit' || e.type === 'land'));
    expect(events.find((e) => e.type === 'hit' || e.type === 'land')).toMatchObject({ type: 'hit', obstacle: 'cabin', crashed: true });
    expect(sk.x).toBeLessThan(cabin.x0);
    expect(sk.y).toBeCloseTo(run.terrain.height(sk.x), 3);
  });

  it('landing on a cabin roof is like landing on the snow: ride it, then roll off the end', () => {
    const run = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    const cabin = cabinOnRunUp(run);
    const roof = (x: number) => cabin.y0 + (x - cabin.x0) * cabin.m;
    const sk = run.skier;
    Object.assign(sk, { mode: 'air', x: 330, y: roof(330) - 60, vx: 500, vy: 0, angle: Math.atan(0.3) });
    let events = stepUntil(run, 1, (es) => es.some((e) => e.type === 'land'));
    expect(events.find((e) => e.type === 'land')).toMatchObject({ quality: 'clean' });
    expect(sk.mode).toBe('ground');
    expect(sk.y).toBeCloseTo(roof(sk.x), 3);
    expect(cabin.broken).toBe(false);

    // Ride along the roof…
    stepUntil(run, 0.1);
    expect(sk.mode).toBe('ground');
    expect(sk.y).toBeCloseTo(roof(sk.x), 3);
    // …and off the end, back down onto the snow.
    events = stepUntil(run, 3, (es) => es.some((e) => e.type === 'land'));
    expect(events.map((e) => e.type)).toContain('takeoff');
    expect(events.find((e) => e.type === 'land')).toMatchObject({ quality: 'clean' });
    expect(sk.x).toBeGreaterThan(cabin.x1);
    expect(run.stats.crashes).toBe(0);
  });

  it('ice is slick: you pick up more speed on it', () => {
    const plain = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    const icy = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    icy.spawner.add({ kind: 'ice', x0: -100, x1: 700 });
    expect(icy.spawner.sample(100).ice).toBe(true);
    expect(plain.spawner.sample(100).ice).toBeUndefined();
    stepUntil(plain, 1);
    stepUntil(icy, 1);
    expect(icy.skier.speed).toBeGreaterThan(plain.skier.speed + 30);
  });
});

describe('Coins', () => {
  function withCoins(xs: number[], lift = 34) {
    const run = new Run(1, createTuning(), { avalanche: false, obstacles: true });
    const cluster = { size: xs.length, got: 0, x1: xs[xs.length - 1] };
    for (const x of xs) run.spawner.add({ kind: 'coin', x0: x - 14, x1: x + 14, x, y: run.terrain.height(x) - lift, cluster, taken: false });
    return run;
  }

  it('are collected by riding through them', () => {
    const run = withCoins([300, 380, 460]);
    const events = stepUntil(run, 3, () => run.skier.x > 600);
    expect(events.filter((e) => e.type === 'coin').map((e) => (e.type === 'coin' ? e.index : -1))).toEqual([0, 1, 2]);
    expect(run.stats.coins).toBe(3);
  });

  it('give a speed boost for the whole cluster, and nothing for a partial one', () => {
    const control = withCoins([300]);
    control.spawner.prune(1e9); // no coins at all
    const full = withCoins([300, 380, 460]);
    const partial = withCoins([300, 380, 460, 540]);
    (partial.spawner.entities.at(-1) as { y: number }).y -= 300; // one out of reach
    const passed = (run: Run) => () => run.skier.x > 600;
    stepUntil(control, 3, passed(control));
    const fullEvents = stepUntil(full, 3, passed(full));
    const partialEvents = stepUntil(partial, 3, passed(partial));

    expect(fullEvents.find((e) => e.type === 'cluster')).toMatchObject({ size: 3 });
    expect(full.stats.clusters).toBe(1);
    expect(full.skier.speed - control.skier.speed).toBeGreaterThan(0.8 * full.tuning.coinClusterBoost);

    expect(partialEvents.some((e) => e.type === 'cluster')).toBe(false);
    expect(partial.stats.coins).toBe(3);
    expect(Math.abs(partial.skier.speed - control.skier.speed)).toBeLessThan(5);
  });
});
