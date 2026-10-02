import { describe, expect, it } from 'vitest';
import { Run, SIM_DT, type RunEvent, type RunOptions } from '../src/sim/run';
import { EAGLE_HOVER, MOUNTS, effectiveTuning, type MountEvent, type MountKind, type WildMount } from '../src/sim/mounts';
import { MOUNT_TABLE, Spawner, type Cabin, type Rock } from '../src/sim/spawner';
import { Skier, type SkierEvent, type SkierInput } from '../src/sim/skier';
import { Terrain } from '../src/sim/terrain';
import { createTuning } from '../src/tuning';

const NO_INPUT: SkierInput = { held: false, pressed: false };

// The opening run-up is a straight line, y = 0.3x, up to x = 700: a clean
// test bench for hand-placed things (nothing spawns there by itself).

function bench(opts: RunOptions = {}): Run {
  return new Run(1, createTuning(), { avalanche: false, obstacles: true, ...opts });
}

/** Step until `done` (or the time runs out); returns all events. */
function stepUntil(run: Run, seconds: number, done: (events: RunEvent[]) => boolean = () => false, input: (t: number) => SkierInput = () => NO_INPUT) {
  const events: RunEvent[] = [];
  for (let t = 0; t < seconds && !done(events); t += SIM_DT) run.step(input(t), events);
  return events;
}

const has = (type: RunEvent['type']) => (es: RunEvent[]) => es.some((e) => e.type === type);
const find = <T extends RunEvent['type']>(es: RunEvent[], type: T) => es.find((e) => e.type === type) as Extract<RunEvent, { type: T }> | undefined;

function rock(run: Run, x: number): Rock {
  const r: Rock = { kind: 'rock', x0: x - 34, x1: x + 34, x, y: run.terrain.height(x) - 7, r: 34 };
  run.spawner.add(r);
  return r;
}

/** Board `kinds` in order, returning the mount events. */
function board(run: Run, ...kinds: MountKind[]): MountEvent[] {
  const events: MountEvent[] = [];
  for (const k of kinds) run.mounts.board(k, run.skier, events);
  return events;
}

/** Every mount the spawner places up to `toX`. */
function spawnMounts(seed: number, toX: number): WildMount[] {
  const tuning = createTuning();
  const terrain = new Terrain(seed, tuning);
  const spawner = new Spawner(terrain, tuning, seed, true);
  const seen = new Set<WildMount>();
  for (let x = 0; x < toX; x += 400) {
    terrain.ensure(x + 6000);
    spawner.update(x);
    for (const m of spawner.mounts) seen.add(m);
    terrain.prune(x - 4000);
    spawner.prune(x - 4000);
  }
  return [...seen];
}

describe('Mount system', () => {
  it('rides into a penguin on the snow and climbs aboard, for points', () => {
    const run = bench();
    const wild = run.spawner.addMount('penguin', 500);
    const events = stepUntil(run, 4, has('mount'));
    expect(find(events, 'mount')).toMatchObject({ kind: 'penguin' });
    expect(events.at(-1)).toMatchObject({ type: 'award', points: 100 });
    expect(wild.taken).toBe(true);
    expect(run.mounts.stack).toEqual(['penguin']);
    expect(run.mounts.state).toBe('riding');
    expect(run.stats.rides.penguin).toBe(1);
    // It's gone from the slope: riding on doesn't board it again.
    stepUntil(run, 1);
    expect(run.stats.rides.penguin).toBe(1);
    expect(run.stats.ridden.penguin).toBeGreaterThan(5);
  });

  it('stacks: one animal (a new one swaps it), a snowmobile underneath, an eagle carries the lot', () => {
    const run = bench();
    const dismounts = (es: MountEvent[]) => es.filter((e) => e.type === 'dismount').map((e) => e.type === 'dismount' && `${e.kind}:${e.reason}`);

    expect(dismounts(board(run, 'penguin'))).toEqual([]);
    expect(run.mounts.stack).toEqual(['penguin']);
    // A second animal: the first hops off and runs away.
    expect(dismounts(board(run, 'bear'))).toEqual(['penguin:swap']);
    expect(run.mounts.stack).toEqual(['bear']);
    // The snowmobile goes underneath; the bear rides on it.
    expect(dismounts(board(run, 'snowmobile'))).toEqual([]);
    expect(run.mounts.stack).toEqual(['snowmobile', 'bear']);
    expect(run.mounts.fuel).toBe(run.tuning.snowmobileFuel);
    // An animal while on the snowmobile swaps just the animal.
    expect(dismounts(board(run, 'penguin'))).toEqual(['bear:swap']);
    expect(run.mounts.stack).toEqual(['snowmobile', 'penguin']);
    // A fresh snowmobile replaces the old one (a full tank), keeping the penguin.
    run.mounts.fuel = 1;
    expect(dismounts(board(run, 'snowmobile'))).toEqual(['snowmobile:swap']);
    expect(run.mounts.stack).toEqual(['snowmobile', 'penguin']);
    expect(run.mounts.fuel).toBe(run.tuning.snowmobileFuel);
    // On foot, a snowmobile is ridden alone.
    const solo = bench();
    board(solo, 'snowmobile', 'penguin');
    expect(solo.mounts.stack).toEqual(['snowmobile', 'penguin']);
    // The eagle doesn't join the stack: it carries it.
    board(run, 'eagle');
    expect(run.mounts.state).toBe('carried');
    expect(run.mounts.stack).toEqual(['snowmobile', 'penguin']);
    expect(run.skier.carried).toBe(true);
  });

  it('a mount takes a rock hit for you: it tumbles off, you ride on', () => {
    const run = bench();
    board(run, 'penguin');
    run.scoring.multiplier = 4;
    rock(run, 400);
    const events = stepUntil(run, 3, has('hit'));
    stepUntil(run, SIM_DT).forEach((e) => events.push(e));
    expect(find(events, 'hit')).toMatchObject({ obstacle: 'rock', crashed: false, saved: 'shield' });
    expect(find(events, 'dismount')).toMatchObject({ kind: 'penguin', reason: 'rock' });
    const sk = run.skier;
    expect(sk.mode).toBe('ground');
    expect(sk.invulnTimer).toBeGreaterThan(0);
    expect(run.mounts.stack).toEqual([]);
    expect(run.stats).toMatchObject({ crashes: 0, shieldsLost: 1 });
    expect(run.scoring.multiplier).toBe(1);

    // Nothing left to lose: the next rock (once the invulnerability is over) crashes you, as ever.
    stepUntil(run, run.tuning.hitInvulnTime);
    rock(run, sk.x + 80);
    const more = stepUntil(run, 1, has('hit'));
    expect(find(more, 'hit')).toMatchObject({ obstacle: 'rock', crashed: true });
    expect(sk.mode).toBe('crash');
  });

  it('a mount takes a cabin wall for you, and you go through the wreck', () => {
    const run = bench();
    board(run, 'snowmobile', 'penguin');
    const h = 134;
    const cabin: Cabin = { kind: 'cabin', x0: 300, x1: 640, y0: run.terrain.height(300) - h, m: 0.3, h, broken: false };
    run.spawner.add(cabin);
    const events = stepUntil(run, 3, () => run.skier.x > cabin.x1 + 50);
    expect(find(events, 'hit')).toMatchObject({ obstacle: 'cabin', crashed: false, saved: 'shield' });
    expect(find(events, 'dismount')).toMatchObject({ kind: 'penguin', reason: 'cabin' });
    expect(cabin.broken).toBe(true);
    expect(run.mounts.stack).toEqual(['snowmobile']);
    expect(run.stats.crashes).toBe(0);
  });

  it('a mount takes a crash landing for you: it counts as sloppy', () => {
    const run = bench();
    board(run, 'penguin');
    const sk = run.skier;
    Object.assign(sk, { mode: 'air', x: 200, y: run.terrain.height(200) - 30, vx: 800, vy: 300, angle: Math.PI, airRotation: -Math.PI });
    // Hold, so the landing assist doesn't save it first.
    const events = stepUntil(run, 1, has('dismount'), () => ({ held: true, pressed: false }));
    expect(find(events, 'land')).toMatchObject({ quality: 'sloppy', flips: 0, saved: 'shield' });
    expect(find(events, 'dismount')).toMatchObject({ kind: 'penguin', reason: 'landing' });
    expect(sk.mode).toBe('ground');
    expect(run.stats.crashes).toBe(0);
  });

  it('with nothing to ride, there is no shield and the skier reads the plain tuning', () => {
    const run = bench();
    expect(run.skier.tuning).toEqual(run.tuning);
    expect(run.skier.guard?.('rock')).toBeNull();
    expect(effectiveTuning(run.tuning, [], createTuning({ gravity: 1 }))).toEqual(run.tuning);
  });

  it('starts a run already riding with startMount, without counting it as a ride', () => {
    const run = bench({ startMount: 'penguin' });
    expect(run.mounts.stack).toEqual(['penguin']);
    expect(run.stats.rides.penguin).toBe(0);
    expect(run.scoring.tricks).toBe(0);
  });

  it('is deterministic per seed', () => {
    const play = () => {
      const run = new Run(77, createTuning());
      const events: RunEvent[] = [];
      for (let i = 0; i < 120 * 90; i++) run.step({ held: i % 300 < 60, pressed: i % 300 === 0 }, events);
      return JSON.stringify([run.skier.x, run.skier.y, run.stats, run.mounts.stack, events.filter((e) => e.type === 'mount' || e.type === 'dismount')]);
    };
    expect(play()).toBe(play());
    const where = (seed: number) => spawnMounts(seed, 80000).map((m) => `${m.kind}@${m.ax}`).join(' ');
    expect(where(5)).toBe(where(5));
    expect(where(5)).not.toBe(where(6));
  });
});

describe('Mount spawning', () => {
  it('brings each kind in from its own distance, spaced out, and none in the demo run', () => {
    const kinds = new Set<MountKind>();
    for (let seed = 1; seed <= 12; seed++) {
      const ms = spawnMounts(seed, 100000);
      for (const m of ms) {
        expect(m.ax, `seed ${seed} ${m.kind}`).toBeGreaterThanOrEqual(MOUNT_TABLE[m.kind].from);
        kinds.add(m.kind);
      }
      for (let i = 1; i < ms.length; i++) expect(ms[i].ax - ms[i - 1].ax, `seed ${seed}`).toBeGreaterThan(5000);
    }
    expect([...kinds].sort()).toEqual(['bear', 'eagle', 'penguin', 'snowmobile']);
    const tuning = createTuning();
    const terrain = new Terrain(3, tuning);
    const demo = new Spawner(terrain, tuning, 3, false);
    for (let x = 0; x < 60000; x += 400) {
      terrain.ensure(x + 6000);
      demo.update(x);
    }
    expect(demo.mounts).toEqual([]);
  });

  it('puts ground mounts in the way of a rider who just rides, and eagles above them in reach of a jump', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const mounts = spawnMounts(seed, 70000);
      expect(mounts.length, `seed ${seed}`).toBeGreaterThan(1);
      // The spawner's idle ghost, exactly: bare terrain, plain tuning.
      const tuning = createTuning();
      const terrain = new Terrain(seed, tuning);
      const sk = new Skier(terrain, tuning, 0);
      const touched = new Set<string>();
      const spots = mounts.flatMap((m) => {
        const s = MOUNTS[m.kind];
        // Where it starts and where its wander ends.
        return [m.ax, m.ax + s.range].map((x) => ({ m, id: `${m.kind}@${x}`, x, y: m.kind === 'eagle' ? terrain.height(x) - EAGLE_HOVER : terrain.height(x) - s.up, r: s.r }));
      });
      const events: never[] = [];
      while (sk.x < 70000) {
        terrain.ensure(sk.x + 6000);
        sk.step(SIM_DT, NO_INPUT, events);
        for (const p of spots) if (Math.abs(p.x - sk.x) < 200 && sk.touches(p.x, p.y, p.r)) touched.add(p.id);
      }
      for (const p of spots) {
        if (p.m.kind === 'eagle') {
          expect(touched.has(p.id), `seed ${seed} ${p.id}: an eagle you can ride under`).toBe(false);
          // Within a jump: the top of the body reaches above its middle.
          const apex = (tuning.jumpImpulse * tuning.jumpImpulse) / (2 * tuning.gravity) * 0.9;
          expect(apex + 75, `seed ${seed} ${p.id}`).toBeGreaterThan(EAGLE_HOVER);
        } else {
          expect(touched.has(p.id), `seed ${seed} ${p.id}: a rider who just rides bumps into it`).toBe(true);
        }
      }
    }
  });

  it('keeps obstacles clear of mounts', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const tuning = createTuning();
      const terrain = new Terrain(seed, tuning);
      const spawner = new Spawner(terrain, tuning, seed, true);
      const mounts = new Set<WildMount>();
      const obstacles = new Set<Rock | Cabin>();
      for (let x = 0; x < 90000; x += 400) {
        terrain.ensure(x + 6000);
        spawner.update(x);
        for (const m of spawner.mounts) mounts.add(m);
        for (const e of spawner.entities) if (e.kind === 'rock' || e.kind === 'cabin') obstacles.add(e);
        terrain.prune(x - 4000);
        spawner.prune(x - 4000);
      }
      for (const m of mounts) {
        for (const o of obstacles) {
          expect(o.x1 < m.x0 - 300 || o.x0 > m.x1 + 300, `seed ${seed} ${o.kind}@${o.x0.toFixed(0)} by ${m.kind}@${m.ax}`).toBe(true);
        }
      }
    }
  });
});

/** A stand-in ground with a fixed shape. */
function fakeGround(height: (x: number) => number) {
  const h = 0.01;
  return {
    sample: (x: number) => ({ y: height(x), dy: (height(x + h) - height(x - h)) / (2 * h), ddy: 0 }),
    height,
  };
}

/** A skier on the bench ground, riding `stack`. */
function rider(height: (x: number) => number, stack: Parameters<typeof effectiveTuning>[1]): Skier {
  return new Skier(fakeGround(height), effectiveTuning(createTuning(), stack, createTuning()), 0);
}

function ride(sk: Skier, seconds: number, input: (t: number) => SkierInput = () => NO_INPUT) {
  const events: SkierEvent[] = [];
  for (let t = 0; t < seconds; t += SIM_DT) sk.step(SIM_DT, input(t), events);
  return events;
}

describe('Penguin', () => {
  it('cruises faster, flips faster and glides further', () => {
    const base = createTuning();
    const t = effectiveTuning(base, ['penguin'], createTuning());
    expect(t.flipSpeed).toBeCloseTo(base.flipSpeed * base.penguinFlip);
    expect(t.flipAccel).toBeCloseTo(base.flipAccel * base.penguinFlip);

    // Down an even slope: a higher cruising speed.
    const slope = (x: number) => x * 0.3;
    const plain = rider(slope, []);
    const penguin = rider(slope, ['penguin']);
    ride(plain, 30);
    ride(penguin, 30);
    expect(penguin.speed).toBeGreaterThan(plain.speed * 1.2);

    // Off a ledge: further before touching down.
    const flat = () => 0;
    const landedAt = (sk: Skier) => {
      Object.assign(sk, { mode: 'air', x: 0, y: -600, vx: 1200, vy: 0, angle: 0 });
      const events = ride(sk, 2);
      return (events.find((e) => e.type === 'land') as { x: number }).x;
    };
    expect(landedAt(rider(flat, ['penguin']))).toBeGreaterThan(landedAt(rider(flat, [])) + 60);
  });

  it('takes you further down a real mountain', () => {
    let plain = 0;
    let penguin = 0;
    for (const seed of [1, 3, 4, 5]) {
      const a = new Run(seed, createTuning(), { obstacles: false, avalanche: false });
      const b = new Run(seed, createTuning(), { obstacles: false, avalanche: false, startMount: 'penguin' });
      stepUntil(a, 30);
      stepUntil(b, 30);
      plain += a.skier.x;
      penguin += b.skier.x;
      expect(b.stats.ridden.penguin).toBeCloseTo(b.distancePx() / 40, 0);
    }
    expect(penguin).toBeGreaterThan(plain * 1.08);
  });
});

describe('Eagle', () => {
  it('grabs you when you jump into it, carries the whole stack for a while, then lets go mid-air', () => {
    const run = bench();
    const sk = run.skier;
    board(run, 'penguin');
    const eagle = run.spawner.addMount('eagle', 650);
    // Ride under it: out of reach.
    const under = bench();
    under.spawner.addMount('eagle', 650);
    stepUntil(under, 2, () => under.skier.x > 900);
    expect(under.mounts.state).toBe('foot');
    // Even on the tallest stack: only a jump reaches it.
    const tall = bench();
    board(tall, 'snowmobile', 'bear');
    tall.spawner.addMount('eagle', 650);
    stepUntil(tall, 2, () => tall.skier.x > 900);
    expect(tall.mounts.state).toBe('riding');

    // Jump (a tap) into it.
    stepUntil(run, 3, () => sk.x > eagle.x - 160);
    let events = stepUntil(run, 1, has('mount'), (t) => ({ held: false, pressed: t === 0 }));
    expect(find(events, 'mount')).toMatchObject({ kind: 'eagle' });
    expect(run.mounts.state).toBe('carried');
    expect(run.mounts.stack).toEqual(['penguin']);
    expect(sk.carried).toBe(true);

    // Hold to climb, let go to glide; never down on the snow, and rocks below don't matter.
    const heights: number[] = [];
    for (let i = 0; i < 20; i++) rock(run, sk.x + 300 + i * 150);
    events = [];
    for (let t = 0; run.mounts.state === 'carried' && t < 10; t += SIM_DT) {
      run.step({ held: t < 1.5, pressed: false }, events);
      heights.push(sk.heightAboveGround());
    }
    expect(Math.max(...heights.slice(0, 180))).toBeGreaterThan(heights[0] + 150);
    expect(Math.min(...heights)).toBeGreaterThan(60);
    expect(events.some((e) => e.type === 'hit')).toBe(false);

    // Let go after the flight time, in the air, stack intact.
    expect(find(events, 'dismount')).toMatchObject({ kind: 'eagle', reason: 'release' });
    expect(run.stats.eagleTime).toBeCloseTo(run.tuning.eagleTime, 1);
    expect(run.stats.ridden.eagle).toBeGreaterThan(100);
    expect(sk.carried).toBe(false);
    expect(sk.mode).toBe('air');
    expect(sk.airRotation).toBe(0);
    expect(run.mounts.stack).toEqual(['penguin']);
    // Doing nothing, you come down safely.
    events = stepUntil(run, 3, has('land'));
    expect(find(events, 'land')?.quality).not.toBe('crash');
  });

  it('lets you flip after it lets go, once you press again', () => {
    const run = bench({ startMount: 'eagle' });
    const sk = run.skier;
    expect(sk.carried).toBe(true);
    // Hold all through the flight and past the release: that hold doesn't flip you.
    const hold = () => ({ held: true, pressed: false });
    stepUntil(run, run.tuning.eagleTime + 0.01, () => !sk.carried, hold);
    expect(sk.carried).toBe(false);
    stepUntil(run, 0.15, () => false, hold);
    expect(sk.airRotation).toBe(0);
    // Let go, then press and hold: a backflip.
    stepUntil(run, SIM_DT);
    stepUntil(run, 0.3, () => false, (t) => ({ held: true, pressed: t === 0 }));
    expect(sk.airRotation).toBeLessThan(-1);
  });
});

describe('Snowmobile', () => {
  it('is fast and heavy: a higher floor speed, an engine push, slower flips', () => {
    const base = createTuning();
    const t = effectiveTuning(base, ['snowmobile'], createTuning());
    expect(t.minSpeed).toBe(base.snowmobileMinSpeed);
    expect(t.thrust).toBe(base.snowmobileThrust);
    expect(t.maxSpeed).toBeGreaterThan(base.maxSpeed);
    expect(t.flipSpeed).toBeLessThan(base.flipSpeed);
    // A penguin riding on it flips about as usual.
    const both = effectiveTuning(base, ['snowmobile', 'penguin'], createTuning());
    expect(both.flipSpeed).toBeCloseTo(base.flipSpeed * base.snowmobileFlip * base.penguinFlip);

    const slope = (x: number) => x * 0.3;
    const plain = rider(slope, []);
    const sled = rider(slope, ['snowmobile']);
    ride(plain, 20);
    ride(sled, 20);
    expect(sled.speed).toBeGreaterThan(plain.speed * 1.2);
    // On the flat, the engine keeps you going.
    const flat = rider(() => 0, ['snowmobile']);
    ride(flat, 5);
    expect(flat.speed).toBeGreaterThanOrEqual(base.snowmobileMinSpeed);
  });

  it('runs out of fuel: you hop off and keep the animal', () => {
    const run = new Run(2, createTuning(), { avalanche: false, obstacles: false, startMount: 'snowmobile' });
    board(run, 'penguin');
    expect(run.mounts.stack).toEqual(['snowmobile', 'penguin']);
    let events = stepUntil(run, run.tuning.snowmobileFuel - 1);
    expect(events.some((e) => e.type === 'dismount')).toBe(false);
    expect(run.mounts.fuel).toBeCloseTo(1, 1);
    events = stepUntil(run, 2, has('dismount'));
    expect(find(events, 'dismount')).toMatchObject({ kind: 'snowmobile', reason: 'fuel' });
    expect(run.mounts.stack).toEqual(['penguin']);
    expect(run.skier.tuning.thrust).toBe(0);
    expect(run.stats.ridden.snowmobile).toBeGreaterThan(200);
  });

  it("doesn't burn fuel while an eagle does the work", () => {
    const run = bench({ startMount: 'snowmobile' });
    board(run, 'eagle');
    stepUntil(run, 2);
    expect(run.mounts.fuel).toBe(run.tuning.snowmobileFuel);
  });
});

describe('Polar bear', () => {
  it('smashes rocks and cabins instead of crashing, and stays aboard', () => {
    const run = bench({ startMount: 'bear' });
    const sk = run.skier;
    const r = rock(run, 400);
    let events = stepUntil(run, 3, has('smash'));
    stepUntil(run, SIM_DT).forEach((e) => events.push(e));
    expect(find(events, 'hit')).toMatchObject({ obstacle: 'rock', crashed: false, saved: 'smash' });
    expect(find(events, 'smash')).toMatchObject({ obstacle: 'rock' });
    expect(find(events, 'award')).toMatchObject({ points: 150 });
    expect(r.broken).toBe(true);
    expect(sk.mode).toBe('ground');
    expect(run.mounts.stack).toEqual(['bear']);
    expect(run.stats).toMatchObject({ smashes: 1, crashes: 0, shieldsLost: 0 });
    // A smashed rock is gone: riding on over it is fine.
    stepUntil(run, 0.5);
    expect(run.stats.smashes).toBe(1);

    const h = 134;
    const x0 = sk.x + 300;
    const cabin: Cabin = { kind: 'cabin', x0, x1: x0 + 340, y0: run.terrain.height(x0) - h, m: run.terrain.sample(x0).dy, h, broken: false };
    run.spawner.add(cabin);
    events = stepUntil(run, 3, () => sk.x > cabin.x1);
    expect(find(events, 'smash')).toMatchObject({ obstacle: 'cabin' });
    expect(cabin.broken).toBe(true);
    expect(run.mounts.stack).toEqual(['bear']);
    expect(run.stats).toMatchObject({ smashes: 2, crashes: 0 });
  });

  it('is knocked off by a crash landing, like any shield', () => {
    const run = bench({ startMount: 'bear' });
    const sk = run.skier;
    Object.assign(sk, { mode: 'air', x: 200, y: run.terrain.height(200) - 30, vx: 800, vy: 300, angle: Math.PI, airRotation: -Math.PI });
    const events = stepUntil(run, 1, has('dismount'), () => ({ held: true, pressed: false }));
    expect(find(events, 'dismount')).toMatchObject({ kind: 'bear', reason: 'landing' });
    expect(run.mounts.stack).toEqual([]);
  });

  it('is heavy: slower off the mark, and jumps lower', () => {
    const base = createTuning();
    expect(effectiveTuning(base, ['bear'], createTuning()).jumpImpulse).toBeLessThan(base.jumpImpulse);
    const slope = (x: number) => x * 0.3;
    const plain = rider(slope, []);
    const bear = rider(slope, ['bear']);
    ride(plain, 2);
    ride(bear, 2);
    expect(bear.speed).toBeLessThan(plain.speed * 0.95);
    const apex = (sk: Skier) => {
      let top = 0;
      ride(sk, 0.6, (t) => {
        top = Math.max(top, sk.heightAboveGround());
        return { held: false, pressed: t === 0 };
      });
      return top;
    };
    expect(apex(rider(() => 0, ['bear']))).toBeLessThan(apex(rider(() => 0, [])) * 0.8);
  });
});
