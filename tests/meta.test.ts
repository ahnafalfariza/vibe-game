import { describe, expect, it } from 'vitest';
import {
  GOALS,
  LEVELS,
  PERKS,
  RunGoals,
  UPGRADES,
  biomeUnlocked,
  buyUpgrade,
  canMeet,
  drawGoals,
  goalText,
  goalsFor,
  levelName,
  levelUpCoins,
  newProfile,
  normalizeProfile,
  levelMultiplier,
  rideSummary,
  runSetup,
  skipCost,
  skipGoal,
  tierFor,
  upgradeCost,
  type Goal,
  type Profile,
  type RunProgress,
} from '../src/sim/meta';
import { Run, SIM_DT, type RunStats } from '../src/sim/run';
import { Rng } from '../src/sim/rng';
import { MOUNT_TABLE } from '../src/sim/spawner';
import { OLD_WALLET_KEY, PROFILE_KEY, loadProfile, saveProfile, type Store } from '../src/profile';
import { DEFAULT_TUNING, PX_PER_METRE, createTuning } from '../src/tuning';

const def = (id: string) => GOALS.find((g) => g.id === id)!;

function stats(over: Partial<RunStats> = {}): RunStats {
  const kinds = () => ({ penguin: 0, eagle: 0, snowmobile: 0, bear: 0 });
  return {
    flips: 0,
    cleanLandings: 0,
    cleanFlips: 0,
    bestFlips: 0,
    topMultiplier: 1,
    noCrashMetres: 0,
    crashes: 0,
    bestAirTime: 0,
    topSpeed: 0,
    coins: 0,
    clusters: 0,
    rides: kinds(),
    ridden: kinds(),
    smashes: 0,
    eagleTime: 0,
    shieldsLost: 0,
    zone: 1,
    ...over,
  };
}

const progress = (over: Partial<RunStats> = {}, metres = 100): RunProgress => ({ stats: stats(over), metres, score: metres, seconds: 30 });

/** A profile whose goals are exactly these (id, target). */
function withGoals(...goals: (readonly [string, number])[]): Profile {
  const p = newProfile();
  p.goals = goals.map(([id, target]): Goal => ({ id, target, progress: 0, done: false }));
  return p;
}

const rng = () => new Rng(42);

/** A Storage stand-in. */
function fakeStore(init: Record<string, string> = {}): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('Goals', () => {
  it('has a pool of 25–35 goals with valid tiers', () => {
    expect(GOALS.length).toBeGreaterThanOrEqual(25);
    expect(GOALS.length).toBeLessThanOrEqual(35);
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    const totals = GOALS.filter((g) => g.total).length;
    expect(totals).toBeGreaterThan(2);
    expect(totals).toBeLessThan(GOALS.length / 3);
    for (const g of GOALS) {
      expect(g.targets.length, g.id).toBe(5);
      for (let i = 1; i < g.targets.length; i++) expect(g.targets[i], g.id).toBeGreaterThanOrEqual(g.targets[i - 1]);
      expect(g.text(g.targets[0]), g.id).not.toMatch(/undefined|NaN/);
    }
  });

  it('completes a single-run goal live, once, the moment the run meets it', () => {
    const p = withGoals(['flips', 3], ['coins', 25], ['distance', 600]);
    const goals = new RunGoals(p, rng);
    expect(goals.check(progress({ flips: 2 }))).toEqual([]);
    const done = goals.check(progress({ flips: 3 }));
    expect(done.map((g) => g.id)).toEqual(['flips']);
    expect(p.goals[0].done).toBe(true);
    expect(goals.check(progress({ flips: 5 }))).toEqual([]);
    // A single-run goal only counts what one run does: the best run is kept for show.
    const s = goals.finish(progress({ coins: 20 }, 400));
    expect(p.goals[1]).toMatchObject({ done: false, progress: 20 });
    expect(p.goals[2]).toMatchObject({ done: false, progress: 400 });
    expect(s.goals.map((g) => g.fresh)).toEqual([true, false, false]);
    new RunGoals(p, rng).finish(progress({ coins: 10 }, 100));
    expect(p.goals[1].progress).toBe(20);
  });

  it('banks a run once, however many times it is finished (quit, then the page closes)', () => {
    const p = withGoals(['totalCoins', 100], ['flips', 3], ['distance', 600]);
    const run = new RunGoals(p, rng);
    run.finish(progress({ coins: 30 }));
    run.finish(progress({ coins: 30 }));
    expect(p.coins).toBe(30);
    expect(p.goals[0].progress).toBe(30);
  });

  it('adds cumulative goals up across runs', () => {
    const p = withGoals(['totalCoins', 100], ['flips', 3], ['distance', 600]);
    new RunGoals(p, rng).finish(progress({ coins: 60 }));
    expect(p.goals[0]).toMatchObject({ progress: 60, done: false });
    const run2 = new RunGoals(p, rng);
    expect(run2.check(progress({ coins: 39 }))).toEqual([]);
    // Completes mid-run, counting what's banked plus this run so far.
    expect(run2.check(progress({ coins: 40 })).map((g) => g.id)).toEqual(['totalCoins']);
    run2.finish(progress({ coins: 45 }));
    expect(p.goals[0].progress).toBe(105);
  });

  it('measures what the run tracks', () => {
    const r = progress(
      { cleanFlips: 2, bestFlips: 2, topMultiplier: 4, bestAirTime: 2.1, topSpeed: 2500, noCrashMetres: 333, smashes: 2, eagleTime: 4.5, shieldsLost: 1, rides: { penguin: 1, eagle: 1, snowmobile: 0, bear: 0 }, ridden: { penguin: 150, eagle: 0, snowmobile: 0, bear: 0 } },
      900,
    );
    const m = (id: string) => def(id).measure(r);
    expect([m('cleanFlips'), m('bigFlip'), m('multiplier'), m('air'), m('speed'), m('noCrash'), m('smashes'), m('eagleTime'), m('shields'), m('penguinMetres'), m('variety'), m('distance'), m('survive')]).toEqual([
      2, 2, 4, 2.1, 225, 333, 2, 4.5, 1, 150, 2, 900, 30,
    ]);
  });

  it('draws three deterministically from the rng: different families, at most one total and one mount goal', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = drawGoals(5, 5000, new Rng(seed));
      expect(a).toEqual(drawGoals(5, 5000, new Rng(seed)));
      expect(a).toHaveLength(3);
      const defs = a.map((g) => def(g.id));
      expect(new Set(defs.map((d) => d.family ?? d.id)).size).toBe(3);
      expect(defs.filter((d) => d.total).length).toBeLessThanOrEqual(1);
      expect(defs.filter((d) => d.mount).length).toBeLessThanOrEqual(1);
      for (const g of a) expect(g).toMatchObject({ progress: 0, done: false, target: def(g.id).targets[tierFor(5)] });
    }
    expect(drawGoals(5, 5000, new Rng(1))).not.toEqual(drawGoals(5, 5000, new Rng(2)));
  });

  it('scales difficulty with level', () => {
    expect([1, 2, 3, 4, 5, 9, 40].map((r) => tierFor(r))).toEqual([0, 0, 1, 1, 2, 4, 4]);
    const easy = withGoals(['flips', def('flips').targets[tierFor(1)]]).goals[0].target;
    const hard = drawGoals(9, 0, new Rng(1)).map((g) => g.target / def(g.id).targets[0]);
    expect(easy).toBe(3);
    for (const ratio of hard) expect(ratio).toBeGreaterThanOrEqual(1);
  });

  it('only offers a mount goal once the player has got far enough to meet that mount', () => {
    const seen = (bestMetres: number) => {
      const kinds = new Set<string>();
      for (let seed = 1; seed <= 300; seed++) for (const g of drawGoals(3, bestMetres, new Rng(seed))) if (def(g.id).mount) kinds.add(def(g.id).mount!);
      return [...kinds].sort();
    };
    expect(seen(0)).toEqual([]);
    expect(seen(450)).toEqual(['penguin']);
    expect(seen(900)).toEqual(['eagle', 'penguin']);
    expect(seen(5000)).toEqual(['bear', 'eagle', 'penguin', 'snowmobile']);
    expect(canMeet('bear', 1000)).toBe(false);
  });

  it('starts a new player on three basic goals', () => {
    expect(newProfile().goals.map((g) => goalText(g))).toEqual(['Land 3 backflips in one run', 'Collect 25 coins in one run', 'Ski 600 m in one run']);
  });
});

describe('Levels', () => {
  it('level up when all three goals are done, onto the next level\'s goals', () => {
    const p = withGoals(['flips', 3], ['coins', 25], ['distance', 600]);
    p.bestMetres = 5000;
    const run1 = new RunGoals(p, rng);
    expect(run1.finish(progress({ flips: 3, coins: 30 })).levelUp).toBeNull();
    expect(p.level).toBe(1);
    const old = p.goals.map((g) => g.id);
    const s = new RunGoals(p, rng).finish(progress({}, 700));
    expect(s.goals.every((g) => g.done)).toBe(true);
    expect(s.goals.map((g) => g.fresh)).toEqual([false, false, true]);
    expect(s.levelUp).toMatchObject({ level: 2, multiplier: 1.25 });
    expect(s.levelUp!.perks.map((k) => k.name)).toEqual(['Penguin start']);
    expect(p.level).toBe(2);
    expect(p.goals).toEqual(goalsFor(2, 0, rng()));
    expect(p.goals.filter((g) => old.includes(g.id))).toEqual([]);
  });

  it('banks coins, the best distance and the furthest zone at the end of a run', () => {
    const p = newProfile(10);
    const s = new RunGoals(p, rng).finish(progress({ coins: 33, zone: 2 }, 812));
    expect([s.coins, s.wallet, p.coins, p.bestMetres, p.bestZone]).toEqual([33, 43, 43, 812, 2]);
    new RunGoals(p, rng).finish(progress({ zone: 1 }, 100));
    expect(p.bestZone).toBe(2);
  });

  it('multiplies the whole score by the level multiplier', () => {
    expect([1, 2, 5, 9].map(levelMultiplier)).toEqual([1, 1.25, 2, 3]);
    const p = newProfile();
    p.level = 3;
    expect(runSetup(p, DEFAULT_TUNING, false).scoreMultiplier).toBe(1.5);
    const tuning = createTuning({ obstacleDensity: 0, mountDensity: 0 });
    const plain = new Run(4, tuning, { avalanche: false });
    const levelled = new Run(4, tuning, { avalanche: false, scoreMultiplier: 1.5 });
    const idle = { held: false, pressed: false };
    for (let t = 0; t < 8; t += SIM_DT) {
      plain.step(idle, []);
      levelled.step(idle, []);
    }
    expect(plain.score).toBeGreaterThan(100);
    expect(levelled.score).toBe(Math.floor(plain.score * 1.5));
  });

  it('unlocks Twilight Pines at level 3, and perks by level', () => {
    expect(biomeUnlocked('alpine', 1)).toBe(true);
    expect(biomeUnlocked('twilight', 2)).toBe(false);
    expect(biomeUnlocked('twilight', 3)).toBe(true);
    expect(PERKS.find((k) => k.biome === 'twilight')?.level).toBe(3);
    const p = newProfile();
    expect(runSetup(p, DEFAULT_TUNING, false).startMount).toEqual([]);
    p.level = 2;
    expect(runSetup(p, DEFAULT_TUNING, false).startMount).toEqual(['penguin']);
    p.level = 7;
    const t = runSetup(p, DEFAULT_TUNING, false).tuning;
    expect(t.mountDensity).toBeGreaterThan(DEFAULT_TUNING.mountDensity);
    expect(t.crashDuration).toBeLessThan(DEFAULT_TUNING.crashDuration);
  });
});

describe('Designed levels', () => {
  const metresGoal = (id: string) => id === 'distance' || def(id).biome !== undefined;

  it('has ten levels of three goals: real ids, different families, at most one total', () => {
    expect(LEVELS).toHaveLength(10);
    LEVELS.forEach((set, i) => {
      const defs = set.map(([id]) => def(id));
      expect(defs.every(Boolean), `level ${i + 1}`).toBe(true);
      expect(new Set(defs.map((d) => d.family ?? d.id)).size, `level ${i + 1}`).toBe(3);
      expect(defs.filter((d) => d.total).length, `level ${i + 1}`).toBeLessThanOrEqual(1);
      for (const [id, target] of set) expect(def(id).text(target), id).not.toMatch(/undefined|NaN/);
    });
  });

  it('brings a mount only after a level that skis past it, and each biome right after it unlocks', () => {
    LEVELS.forEach((set, i) => {
      const before = LEVELS.slice(0, i).flat().filter(([id]) => metresGoal(id));
      const furthest = Math.max(0, ...before.map(([, target]) => target));
      for (const [id] of set) {
        const d = def(id);
        if (d.mount) expect(furthest, `level ${i + 1} ${id}`).toBeGreaterThanOrEqual(MOUNT_TABLE[d.mount].from / PX_PER_METRE);
        if (d.biome) expect([biomeUnlocked(d.biome, i), biomeUnlocked(d.biome, i + 1)], `level ${i + 1} ${id}`).toEqual([false, true]);
      }
    });
    for (const perk of PERKS.filter((k) => k.biome)) expect(LEVELS[perk.level - 1].map(([id]) => id)).toContain(`${perk.biome}Metres`);
  });

  it('counts biome goals only on their biome', () => {
    const m = (biome?: string) => def('twilightMetres').measure({ ...progress({}, 900), biome });
    expect([m('twilight'), m('alpine'), m()]).toEqual([900, 0, 0]);
    expect(goalText({ id: 'emberMetres', target: 1200, progress: 0, done: false })).toBe('Ski 1,200 m on Ember Peak in one run');
  });

  it('only draws biome goals for biomes the level has unlocked', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) for (const g of drawGoals(3, 5000, new Rng(seed))) if (def(g.id).biome) seen.add(def(g.id).biome!);
    expect([...seen]).toEqual(['twilight']);
  });

  it('draws random goals at the top tier once level 10 is done', () => {
    const p = withGoals(...LEVELS[9]);
    p.level = 10;
    p.bestMetres = 5000;
    const s = new RunGoals(p, rng).finish(progress({ topMultiplier: 1, noCrashMetres: 1200 }, 2000));
    expect(s.levelUp).toBeNull();
    for (const g of p.goals) g.done = true;
    const up = new RunGoals(p, rng).finish(progress()).levelUp;
    expect(up).toMatchObject({ level: 11, multiplier: 3.5, coins: 500, finale: true });
    expect(up!.perks.map((k) => k.name)).toEqual(['Golden fur']);
    expect(p.goals).toHaveLength(3);
    for (const g of p.goals) expect(g.target, g.id).toBe(def(g.id).targets[4]);
    expect(p.goals).not.toEqual(goalsFor(10, 0, rng()));
  });

  it('gives second wind from level 9 and hot start from level 10', () => {
    const p = newProfile();
    const at = (level: number) => {
      p.level = level;
      const { secondWind, multiplierFloor } = runSetup(p, DEFAULT_TUNING, false);
      return [secondWind, multiplierFloor];
    };
    expect([at(8), at(9), at(10), at(14)]).toEqual([[false, 1], [true, 1], [true, 2], [true, 2]]);
  });

  it('skips a goal for 50 coins a level, and the skip survives a reload', () => {
    const p = normalizeProfile({ version: 2, coins: 250, level: 4 });
    expect(skipCost(4)).toBe(200);
    expect(skipGoal(p, 1)).toBe(true);
    expect([p.coins, p.goals[1].done]).toEqual([50, true]);
    expect(skipGoal(p, 1)).toBe(false); // already done
    expect(skipGoal(p, 0)).toBe(false); // can't pay
    expect(skipGoal(p, 7)).toBe(false);
    expect(p.coins).toBe(50);
    expect(normalizeProfile(JSON.parse(JSON.stringify(p))).goals[1].done).toBe(true);
    // Skipping all three still levels up at the end of the next run.
    p.coins = 1000;
    skipGoal(p, 0);
    skipGoal(p, 2);
    expect(new RunGoals(p, rng).finish(progress()).levelUp).toMatchObject({ level: 5 });
  });

  it('pays coins for each level-up, and names the levels past 10 Legend', () => {
    expect([2, 5, 10, 11, 30].map(levelUpCoins)).toEqual([100, 250, 500, 500, 500]);
    expect([1, 10, 11, 13].map(levelName)).toEqual(['Level 1', 'Level 10', 'Legend 1', 'Legend 3']);
    const p = withGoals(['flips', 3], ['coins', 25], ['distance', 600]);
    p.coins = 7;
    for (const g of p.goals) g.done = true;
    const s = new RunGoals(p, rng).finish(progress({ coins: 20 }));
    expect(s.levelUp).toMatchObject({ level: 2, coins: 100, finale: false });
    expect([s.coins, s.wallet, p.coins]).toEqual([20, 127, 127]);
  });

  it('moves a rank-N save onto level N\'s goals, keeping progress where the goal matches', () => {
    const p = normalizeProfile({
      version: 1,
      coins: 10,
      rank: 4,
      goals: [
        { id: 'multiplier', target: 3, progress: 3, done: true }, // the target went up: not done any more
        { id: 'eagleRides', target: 1, progress: 0, done: true }, // done mid-run before the quit banked it: still done
        { id: 'air', target: 2, progress: 2.2, done: true }, // not on level 4: dropped
      ],
      upgrades: {},
      bestMetres: 900,
    });
    expect([p.version, p.level, p.coins]).toEqual([2, 4, 10]);
    expect(p.goals).toEqual([
      { id: 'eagleRides', target: 1, progress: 0, done: true },
      { id: 'multiplier', target: 4, progress: 3, done: false },
      { id: 'blossomMetres', target: 1000, progress: 0, done: false },
    ]);
    // Past the designed levels a save keeps its own goals.
    const legend = [{ id: 'air', target: 3.5, progress: 1, done: false }, { id: 'coins', target: 100, progress: 100, done: true }, { id: 'eagleTime', target: 15, progress: 0, done: false }];
    expect(normalizeProfile({ version: 1, rank: 12, goals: legend }).goals).toEqual(legend);
  });
});

describe('Shop', () => {
  it('sells levels at rising prices, only when you can pay', () => {
    const p = newProfile(120);
    expect(upgradeCost(p, 'magnet')).toBe(100);
    expect(buyUpgrade(p, 'avalanche')).toBe(false); // 150
    expect(buyUpgrade(p, 'magnet')).toBe(true);
    expect([p.coins, p.upgrades.magnet, upgradeCost(p, 'magnet')]).toEqual([20, 1, 250]);
    expect(buyUpgrade(p, 'magnet')).toBe(false);
    p.coins = 1e6;
    while (buyUpgrade(p, 'magnet'));
    expect([p.upgrades.magnet, upgradeCost(p, 'magnet')]).toEqual([3, null]);
    for (const u of UPGRADES) for (let i = 1; i < u.costs.length; i++) expect(u.costs[i], u.id).toBeGreaterThan(u.costs[i - 1]);
  });

  it('prices the first upgrade at a few runs and the whole shop at many (~45 coins a run)', () => {
    const cheapest = Math.min(...UPGRADES.map((u) => u.costs[0]));
    const all = UPGRADES.reduce((n, u) => n + u.costs.reduce((a, b) => a + b, 0), 0);
    expect(cheapest / 45).toBeGreaterThan(1.5);
    expect(cheapest / 45).toBeLessThan(4);
    expect(all / 45).toBeGreaterThan(80);
    expect(UPGRADES.length).toBeGreaterThanOrEqual(5);
    expect(UPGRADES.length).toBeLessThanOrEqual(7);
  });

  it('turns upgrades into tuning overrides and start mounts', () => {
    const p = newProfile();
    p.upgrades = { magnet: 2, cluster: 1, avalanche: 3, eagle: 1, fuel: 2, landing: 1, headStart: 1 };
    const { tuning: t, startMount } = runSetup(p, DEFAULT_TUNING, false);
    expect(t.coinPickup).toBeCloseTo(DEFAULT_TUNING.coinPickup * 1.9);
    expect(t.coinClusterBoost).toBeCloseTo(DEFAULT_TUNING.coinClusterBoost * 1.35);
    expect(t.avalancheAccel).toBeCloseTo(DEFAULT_TUNING.avalancheAccel * 0.7);
    expect(t.eagleTime).toBe(DEFAULT_TUNING.eagleTime + 1.5);
    expect(t.snowmobileFuel).toBe(DEFAULT_TUNING.snowmobileFuel + 8);
    expect(t.cleanLandingDeg).toBe(DEFAULT_TUNING.cleanLandingDeg + 3);
    expect(startMount).toEqual(['snowmobile']);
    // With the level-2 perk the penguin rides on the snowmobile; head start 2 brings a bear instead.
    p.level = 2;
    expect(runSetup(p, DEFAULT_TUNING, false).startMount).toEqual(['snowmobile', 'penguin']);
    p.upgrades.headStart = 2;
    const setup = runSetup(p, DEFAULT_TUNING, false);
    expect(setup.startMount).toEqual(['snowmobile', 'bear']);
    const run = new Run(1, setup.tuning, { avalanche: false, obstacles: false, startMount: setup.startMount });
    expect(run.mounts.stack).toEqual(['snowmobile', 'bear']);
    expect(run.mounts.fuel).toBe(DEFAULT_TUNING.snowmobileFuel + 8);
    expect(run.stats.rides.snowmobile).toBe(0);
  });

  it('never boosts the title-screen demo run', () => {
    const p = newProfile(500);
    p.level = 9;
    p.upgrades = { magnet: 3, cluster: 3, avalanche: 3, eagle: 3, fuel: 3, landing: 3, headStart: 2 };
    const demo = runSetup(p, DEFAULT_TUNING, true);
    expect(demo).toEqual({ tuning: { ...DEFAULT_TUNING }, startMount: [], scoreMultiplier: 1, multiplierFloor: 1, secondWind: false });
    expect(demo.tuning).not.toBe(DEFAULT_TUNING);
  });
});

describe('Profile storage', () => {
  it('round-trips through storage', () => {
    const store = fakeStore();
    const p = newProfile(77);
    p.level = 4;
    p.goals = goalsFor(4, 0, rng());
    p.upgrades = { landing: 2 };
    p.goals[1].progress = 2;
    p.goals[2].done = true;
    p.bestMetres = 1234.5;
    saveProfile(p, store);
    expect(loadProfile(store)).toEqual(p);
  });

  it('migrates the old coin wallet into a new profile, once', () => {
    const store = fakeStore({ [OLD_WALLET_KEY]: '1234' });
    const p = loadProfile(store);
    expect(p.coins).toBe(1234);
    expect(p.level).toBe(1);
    expect(store.data.has(OLD_WALLET_KEY)).toBe(false);
    expect(JSON.parse(store.data.get(PROFILE_KEY)!).coins).toBe(1234);
    expect(loadProfile(store).coins).toBe(1234);
  });

  it('keeps the old wallet if the profile could not be saved', () => {
    const store = fakeStore({ [OLD_WALLET_KEY]: '50' });
    store.setItem = () => {
      throw new Error('quota');
    };
    expect(loadProfile(store).coins).toBe(50);
    expect(store.data.get(OLD_WALLET_KEY)).toBe('50');
  });

  it('survives broken or missing storage', () => {
    expect(loadProfile(null)).toEqual(newProfile());
    expect(loadProfile(fakeStore({ [PROFILE_KEY]: '{not json' }))).toEqual(newProfile());
    const p = normalizeProfile({ version: 1, coins: -5, level: 'x', goals: [{ id: 'nope', target: 1, progress: 0 }], upgrades: { magnet: 99, bogus: 2 }, bestMetres: NaN });
    expect(p).toEqual({ ...newProfile(), upgrades: { magnet: 3 } });
    // Lost goals: a designed level gets its own back, past the last level three are drawn.
    expect(normalizeProfile({ version: 2, coins: 5, level: 6, goals: [], upgrades: {}, bestMetres: 0 }).goals).toEqual(goalsFor(6, 0, rng()));
    const q = normalizeProfile({ version: 2, coins: 5, level: 12, goals: [], upgrades: {}, bestMetres: 0 });
    expect(q.goals).toHaveLength(3);
    expect(q.goals.every((g) => g.target === def(g.id).targets[tierFor(12)])).toBe(true);
  });
});

describe('Run stats for goals', () => {
  it('tracks metres before the first wipeout', () => {
    const run = new Run(3, createTuning({ obstacleDensity: 0, mountDensity: 0 }), { avalanche: false });
    for (let t = 0; t < 5; t += SIM_DT) run.step({ held: false, pressed: false }, []);
    expect(run.stats.noCrashMetres).toBeCloseTo(run.distancePx() / 40);
    expect(run.stats.topMultiplier).toBe(1);
  });

  it('sums up the rides for the game-over screen', () => {
    expect(rideSummary(stats())).toBe('');
    expect(rideSummary(stats({ rides: { penguin: 2, eagle: 0, snowmobile: 0, bear: 1 }, smashes: 3 }))).toBe('Rode 2 penguins, 1 polar bear · 3 smashes');
    expect(rideSummary(stats({ rides: { penguin: 0, eagle: 1, snowmobile: 0, bear: 0 }, smashes: 1 }))).toBe('Rode 1 eagle · 1 smash');
  });
});
