import type { RunStats } from './run';
import { MOUNT_KINDS, type MountKind, type Ridden } from './mounts';
import { MOUNT_TABLE } from './spawner';
import { Rng } from './rng';
import { PX_PER_METRE, type Tuning } from '../tuning';

// Meta progression, Ski Safari style: three goals on screen at a time; finish
// all three and you level up at the end of the run. Levels 1–10 have designed
// goals (LEVELS); past those, goals are drawn at random. The level raises the
// base score multiplier and unlocks perks. Coins buy upgrades in the shop.
// Pure rules: no Phaser, no DOM, no storage (profile.ts keeps the Profile in
// localStorage).

// ---- Profile ----

/** Stored profile shape. Bump when it changes, and migrate in normalizeProfile(). */
export const PROFILE_VERSION = 2;

/** One active goal. `target` is fixed when it's drawn, so its text never shifts. */
export interface Goal {
  id: string;
  target: number;
  /** Single-run goals: the best run so far. Cumulative goals: the running total. */
  progress: number;
  done: boolean;
}

export interface Profile {
  version: number;
  /** Coin wallet: every run's coins land here; the shop spends them. */
  coins: number;
  level: number;
  /** The three active goals. */
  goals: Goal[];
  /** Shop levels bought (0 when missing). */
  upgrades: Partial<Record<UpgradeId, number>>;
  /** Furthest run, m. Mount goals wait until you've gone far enough to meet that mount. */
  bestMetres: number;
}

/** What a run has done so far: everything goals are measured from. */
export interface RunProgress {
  stats: RunStats;
  metres: number;
  /** Displayed score (level multiplier included). */
  score: number;
  /** Seconds since the start. */
  seconds: number;
  /** Id of the biome the run is on. */
  biome?: string;
}

// ---- Goals ----

export interface GoalDef {
  id: string;
  /** Never two goals of one family at once (e.g. single-run and total flips). Default: the id. */
  family?: string;
  text: (n: number) => string;
  /** Target per difficulty tier (see tierFor). */
  targets: readonly number[];
  /** Counts across runs instead of within one. */
  total?: boolean;
  /** Only offered once the player gets far enough down the mountain to meet this mount. */
  mount?: MountKind;
  /** Only counts runs on this biome, and is only drawn once it's unlocked. */
  biome?: string;
  measure: (r: RunProgress) => number;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const FLIP_WORDS = ['', 'single', 'double', 'triple', 'quadruple'];
const kinds = (r: RunProgress) => MOUNT_KINDS.filter((k) => r.stats.rides[k] > 0).length;
/** "Ski N m on <biome> in one run": the distance goal for one biome. */
const onBiome = (biome: string, name: string): GoalDef => ({
  id: `${biome}Metres`,
  family: 'distance',
  biome,
  text: (n) => `Ski ${fmt(n)} m on ${name} in one run`,
  targets: [800, 1000, 1200, 1500, 1800],
  measure: (r) => (r.biome === biome ? r.metres : 0),
});

export const GOALS: readonly GoalDef[] = [
  // Tricks
  { id: 'flips', text: (n) => `Land ${plural(n, 'backflip')} in one run`, targets: [3, 6, 10, 15, 22], measure: (r) => r.stats.flips },
  { id: 'cleanFlips', text: (n) => `Land ${plural(n, 'clean backflip')} in one run`, targets: [2, 4, 7, 10, 15], measure: (r) => r.stats.cleanFlips },
  { id: 'bigFlip', text: (n) => `Land a clean ${FLIP_WORDS[n] ?? `${n}×`} backflip`, targets: [2, 2, 3, 3, 4], measure: (r) => r.stats.bestFlips },
  { id: 'multiplier', text: (n) => `Reach a ×${n} trick multiplier`, targets: [3, 4, 6, 8, 10], measure: (r) => r.stats.topMultiplier },
  { id: 'air', text: (n) => `Stay in the air ${n} s in one jump`, targets: [1.5, 2, 2.5, 3, 3.5], measure: (r) => r.stats.bestAirTime },
  { id: 'speed', text: (n) => `Hit ${n} km/h`, targets: [200, 220, 240, 260, 280], measure: (r) => (r.stats.topSpeed / PX_PER_METRE) * 3.6 },
  // Coins
  { id: 'coins', text: (n) => `Collect ${plural(n, 'coin')} in one run`, targets: [25, 40, 60, 80, 100], measure: (r) => r.stats.coins },
  { id: 'clusters', text: (n) => `Grab ${plural(n, 'full coin cluster')} in one run`, targets: [2, 3, 5, 7, 9], measure: (r) => r.stats.clusters },
  // Going the distance
  { id: 'distance', text: (n) => `Ski ${fmt(n)} m in one run`, targets: [600, 1000, 1500, 2000, 2500], measure: (r) => r.metres },
  { id: 'noCrash', text: (n) => `Ski ${fmt(n)} m without a wipeout`, targets: [300, 500, 800, 1100, 1500], measure: (r) => r.stats.noCrashMetres },
  { id: 'survive', family: 'distance', text: (n) => `Outrun the avalanche for ${n} s`, targets: [40, 50, 60, 75, 90], measure: (r) => r.seconds },
  { id: 'score', text: (n) => `Score ${fmt(n)} in one run`, targets: [2000, 4000, 7000, 11000, 16000], measure: (r) => r.score },
  // Biomes
  onBiome('twilight', 'Twilight Pines'),
  onBiome('blossom', 'Blossom Ridge'),
  onBiome('glacier', 'Glacier Gorge'),
  onBiome('ember', 'Ember Peak'),
  // Mounts
  { id: 'penguinRides', family: 'penguin', mount: 'penguin', text: (n) => `Ride ${n === 1 ? 'a penguin' : `${n} penguins`} in one run`, targets: [1, 2, 2, 3, 3], measure: (r) => r.stats.rides.penguin },
  { id: 'penguinMetres', family: 'penguin', mount: 'penguin', text: (n) => `Ride penguins for ${fmt(n)} m in one run`, targets: [150, 300, 500, 700, 1000], measure: (r) => r.stats.ridden.penguin },
  { id: 'shields', mount: 'penguin', text: (n) => `Let mounts take ${plural(n, 'hit')} for you in one run`, targets: [1, 2, 3, 4, 5], measure: (r) => r.stats.shieldsLost },
  { id: 'eagleRides', family: 'eagle', mount: 'eagle', text: (n) => (n === 1 ? 'Get picked up by an eagle' : `Get picked up by ${n} eagles in one run`), targets: [1, 1, 2, 2, 3], measure: (r) => r.stats.rides.eagle },
  { id: 'eagleTime', family: 'eagle', mount: 'eagle', text: (n) => `Fly with eagles for ${n} s in one run`, targets: [4, 6, 9, 12, 15], measure: (r) => r.stats.eagleTime },
  { id: 'variety', mount: 'eagle', text: (n) => `Ride ${n} different mounts in one run`, targets: [2, 2, 2, 3, 3], measure: kinds },
  { id: 'sledRides', family: 'sled', mount: 'snowmobile', text: (n) => (n === 1 ? 'Ride a snowmobile' : `Ride ${n} snowmobiles in one run`), targets: [1, 1, 2, 2, 3], measure: (r) => r.stats.rides.snowmobile },
  { id: 'sledMetres', family: 'sled', mount: 'snowmobile', text: (n) => `Drive snowmobiles ${fmt(n)} m in one run`, targets: [200, 400, 600, 900, 1200], measure: (r) => r.stats.ridden.snowmobile },
  { id: 'bearRides', family: 'bear', mount: 'bear', text: (n) => (n === 1 ? 'Ride a polar bear' : `Ride ${n} polar bears in one run`), targets: [1, 1, 2, 2, 3], measure: (r) => r.stats.rides.bear },
  { id: 'bearMetres', family: 'bear', mount: 'bear', text: (n) => `Ride polar bears for ${fmt(n)} m in one run`, targets: [150, 300, 500, 700, 900], measure: (r) => r.stats.ridden.bear },
  { id: 'smashes', family: 'bear', mount: 'bear', text: (n) => `Smash ${plural(n, 'rock or cabin', 'rocks or cabins')} with a polar bear`, targets: [1, 2, 3, 5, 7], measure: (r) => r.stats.smashes },
  // Across runs
  { id: 'totalFlips', family: 'flips', total: true, text: (n) => `Land ${plural(n, 'backflip')} in total`, targets: [15, 30, 60, 100, 150], measure: (r) => r.stats.flips },
  { id: 'totalCoins', family: 'coins', total: true, text: (n) => `Collect ${plural(n, 'coin')} in total`, targets: [100, 200, 400, 700, 1000], measure: (r) => r.stats.coins },
  { id: 'totalClusters', family: 'clusters', total: true, text: (n) => `Grab ${plural(n, 'full coin cluster')} in total`, targets: [6, 12, 20, 30, 45], measure: (r) => r.stats.clusters },
  { id: 'totalMetres', family: 'distance', total: true, text: (n) => `Ski ${fmt(n)} m in total`, targets: [3000, 6000, 10000, 16000, 25000], measure: (r) => r.metres },
  { id: 'totalPenguins', family: 'penguin', total: true, mount: 'penguin', text: (n) => `Ride ${n} penguins in total`, targets: [3, 5, 8, 12, 16], measure: (r) => r.stats.rides.penguin },
  { id: 'totalEagle', family: 'eagle', total: true, mount: 'eagle', text: (n) => `Fly with eagles for ${n} s in total`, targets: [10, 20, 35, 50, 70], measure: (r) => r.stats.eagleTime },
  { id: 'totalSmashes', family: 'bear', total: true, mount: 'bear', text: (n) => `Smash ${n} rocks or cabins with polar bears in total`, targets: [3, 6, 10, 15, 20], measure: (r) => r.stats.smashes },
];

const goalDef = (id: string) => GOALS.find((g) => g.id === id);

/**
 * The designed levels: three goals each, as [goal id, target]. Each teaches
 * one new thing; a mount goal comes after a level that takes you past that
 * mount, a biome goal right after the level that unlocks it. Past the last
 * level, goals are drawn at random (drawGoals).
 */
export const LEVELS: readonly (readonly [string, number])[][] = [
  [['flips', 3], ['coins', 25], ['distance', 600]],
  [['penguinRides', 1], ['cleanFlips', 2], ['clusters', 2]],
  [['twilightMetres', 1000], ['air', 2], ['totalCoins', 100]],
  [['eagleRides', 1], ['multiplier', 4], ['blossomMetres', 1000]],
  [['sledRides', 1], ['bigFlip', 2], ['score', 6000]],
  [['shields', 2], ['glacierMetres', 1500], ['clusters', 5]],
  [['bearRides', 1], ['speed', 240], ['noCrash', 800]],
  [['smashes', 3], ['variety', 3], ['emberMetres', 1200]],
  [['bigFlip', 3], ['multiplier', 8], ['distance', 2000]],
  [['score', 16000], ['survive', 90], ['noCrash', 1200]],
];

/** Mount goals wait until the best run reaches this far past where the mount first turns up, m. */
const MOUNT_MARGIN = 150;

/** Difficulty tier for a level: 0 at levels 1–2, one up every two levels after. */
export function tierFor(level: number, tiers = 5): number {
  return Math.min(tiers - 1, Math.floor((level - 1) / 2));
}

/** Is the player likely to meet this mount on their runs (best run past its first appearance)? */
export function canMeet(kind: MountKind, bestMetres: number): boolean {
  return bestMetres >= MOUNT_TABLE[kind].from / PX_PER_METRE + MOUNT_MARGIN;
}

function makeGoal(def: GoalDef, level: number): Goal {
  return { id: def.id, target: def.targets[tierFor(level, def.targets.length)], progress: 0, done: false };
}

/**
 * Three random goals for `level`, from different families, at most one
 * counting across runs and at most one needing a mount (and only mounts the
 * player can meet, on biomes they've unlocked). Avoids the ids in `avoid` (the
 * set just finished) when it can.
 */
export function drawGoals(level: number, bestMetres: number, rng: Rng, avoid: readonly string[] = []): Goal[] {
  const ok = (d: GoalDef) => (!d.mount || canMeet(d.mount, bestMetres)) && (!d.biome || biomeUnlocked(d.biome, level));
  let pool = GOALS.filter((d) => ok(d) && !avoid.includes(d.id));
  if (pool.length < 6) pool = GOALS.filter(ok);
  const picked: GoalDef[] = [];
  while (picked.length < 3) {
    const fits = pool.filter(
      (d) =>
        !picked.includes(d) &&
        !picked.some((p) => (p.family ?? p.id) === (d.family ?? d.id)) &&
        !(d.total && picked.some((p) => p.total)) &&
        !(d.mount && picked.some((p) => p.mount)),
    );
    if (fits.length === 0) break;
    picked.push(fits[rng.int(0, fits.length - 1)]);
  }
  return picked.map((d) => makeGoal(d, level));
}

/** The goals for `level`: from LEVELS, or drawn at random past the last one. */
export function goalsFor(level: number, bestMetres: number, rng: Rng, avoid: readonly string[] = []): Goal[] {
  const set = LEVELS[level - 1];
  if (!set) return drawGoals(level, bestMetres, rng, avoid);
  return set.map(([id, target]) => ({ id, target, progress: 0, done: false }));
}

export function goalText(g: Goal): string {
  return goalDef(g.id)?.text(g.target) ?? g.id;
}

/** Counts across runs (vs. "in one run"). */
export function isTotalGoal(g: Goal): boolean {
  return goalDef(g.id)?.total === true;
}

/** Where `g` stands, counting the run in progress if there is one. */
export function goalValue(g: Goal, r?: RunProgress): number {
  const def = goalDef(g.id);
  if (!def || !r) return g.progress;
  const now = def.measure(r);
  return def.total ? g.progress + now : Math.max(g.progress, now);
}

/** "3 / 6", "1.4 / 2.5". */
export function goalProgressText(g: Goal): string {
  const v = Math.min(g.target, g.progress);
  const show = (n: number) => (Number.isInteger(g.target) ? fmt(n) : (Math.floor(n * 10) / 10).toFixed(1));
  return `${show(v)} / ${show(g.target)}`;
}

/** A blank profile: level 1 with its goals. */
export function newProfile(coins = 0): Profile {
  return {
    version: PROFILE_VERSION,
    coins,
    level: 1,
    goals: goalsFor(1, 0, new Rng(1)),
    upgrades: {},
    bestMetres: 0,
  };
}

/** Anything read from storage, made into a valid Profile (unknown or broken fields fall back). */
export function normalizeProfile(raw: unknown): Profile {
  const p = newProfile();
  if (!raw || typeof raw !== 'object') return p;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback);
  // Version 1 called the level a rank, and drew every rank's goals at random.
  p.coins = Math.floor(num(o.coins, 0, 0));
  p.level = Math.floor(num(o.level ?? o.rank, 1, 1));
  p.bestMetres = num(o.bestMetres, 0, 0);
  if (o.upgrades && typeof o.upgrades === 'object') {
    for (const u of UPGRADES) {
      const level = (o.upgrades as Record<string, unknown>)[u.id];
      if (typeof level === 'number' && level > 0) p.upgrades[u.id] = Math.min(u.costs.length, Math.floor(level));
    }
  }
  const goals = (Array.isArray(o.goals) ? o.goals : []).filter(
    (g): g is Goal => !!g && typeof g === 'object' && goalDef(g.id) !== undefined && num(g.target, 0, -1) > 0 && num(g.progress, 0, -1) >= 0,
  );
  const set = LEVELS[p.level - 1];
  if (set) {
    // The table is the source of truth for designed levels: a stored goal with
    // the same id keeps its progress, and stays done unless its target went up.
    p.goals = set.map(([id, target]) => {
      const old = goals.find((g) => g.id === id);
      const progress = old?.progress ?? 0;
      return { id, target, progress, done: progress >= target || (old?.done === true && old.target >= target) };
    });
  } else if (goals.length === 3) p.goals = goals.map(({ id, target, progress, done }) => ({ id, target, progress, done: done === true }));
  else p.goals = drawGoals(p.level, p.bestMetres, new Rng(p.level));
  return p;
}

// ---- Levels ----

/** Level N multiplies the whole run score by 1 + 0.25·(N − 1): level 5 doubles it. */
export function levelMultiplier(level: number): number {
  return 1 + 0.25 * (level - 1);
}

/** "Level 7", or past the designed levels "Legend 2". */
export function levelName(level: number): string {
  return level > LEVELS.length ? `Legend ${level - LEVELS.length}` : `Level ${level}`;
}

/** Coins for reaching `level`: 50 a level, so 500 for every Legend level. */
export function levelUpCoins(level: number): number {
  return 50 * Math.min(level, LEVELS.length);
}

/** Price of skipping one goal at `level`. */
export function skipCost(level: number): number {
  return 50 * level;
}

/** Pay to count the goal at `index` as done. False if it's done already or the wallet can't cover it. */
export function skipGoal(p: Profile, index: number): boolean {
  const g = p.goals[index];
  const cost = skipCost(p.level);
  if (!g || g.done || p.coins < cost) return false;
  p.coins -= cost;
  g.done = true;
  return true;
}

export interface Perk {
  level: number;
  name: string;
  text: string;
  /** Unlocks this biome. */
  biome?: string;
  /** Every run starts riding this. */
  start?: Ridden;
  /** Changes the run's tuning. */
  apply?: (t: Tuning) => void;
  /** The trick multiplier never drops below this. */
  multiplierFloor?: number;
  /** Once a run, the avalanche is knocked back instead of catching you. */
  secondWind?: true;
  /** The yeti's fur turns gold. */
  golden?: true;
}

export const PERKS: readonly Perk[] = [
  { level: 2, name: 'Penguin start', text: 'Every run starts on a penguin', start: 'penguin' },
  { level: 3, name: 'Twilight Pines', text: 'A new mountain to ski', biome: 'twilight' },
  { level: 4, name: 'Blossom Ridge', text: 'A bouncy spring mountain', biome: 'blossom' },
  { level: 5, name: 'Safari season', text: 'Mounts turn up more often', apply: (t) => (t.mountDensity *= 1.5) },
  { level: 6, name: 'Glacier Gorge', text: 'Steep chutes and gaps to clear', biome: 'glacier' },
  { level: 7, name: 'Thick fur', text: 'Back on your feet 30% faster after a wipeout', apply: (t) => (t.crashDuration *= 0.7) },
  { level: 8, name: 'Ember Peak', text: 'Cliffs and ledges on a volcano', biome: 'ember' },
  { level: 9, name: 'Second wind', text: 'Once a run, the avalanche gets knocked back when it catches you', secondWind: true },
  { level: 10, name: 'Hot start', text: 'Your trick multiplier never drops below ×2', multiplierFloor: 2 },
  { level: LEVELS.length + 1, name: 'Golden fur', text: 'Your yeti turns gold', golden: true },
];

export function perksAt(level: number): Perk[] {
  return PERKS.filter((p) => p.level <= level);
}

export function nextPerk(level: number): Perk | undefined {
  return PERKS.find((p) => p.level > level);
}

/** A biome no perk mentions is always open. */
export function biomeUnlocked(id: string, level: number): boolean {
  return (PERKS.find((p) => p.biome === id)?.level ?? 1) <= level;
}

// ---- One run ----

/** What a run gave and changed, for the game-over screen. */
export interface RunSummary {
  coins: number;
  wallet: number;
  /** The goals that were active during the run, as they stand after it. */
  goals: (Goal & { fresh: boolean })[];
  /** `coins`: the level-up bonus, already in `wallet`. `finale`: that was the last designed level. */
  levelUp: { level: number; multiplier: number; perks: Perk[]; coins: number; finale: boolean } | null;
}

/** One run's view of the profile's goals: checked live, settled at the end. */
export class RunGoals {
  /** Goals completed during this run. */
  readonly completed = new Set<Goal>();
  private finished = false;

  constructor(
    readonly profile: Profile,
    private readonly rng: () => Rng,
  ) {}

  /** Mark goals the run has met so far. Returns the newly completed ones. */
  check(r: RunProgress): Goal[] {
    if (this.finished) return [];
    const fresh: Goal[] = [];
    for (const g of this.profile.goals) {
      if (g.done || goalValue(g, r) < g.target) continue;
      g.done = true;
      this.completed.add(g);
      fresh.push(g);
    }
    return fresh;
  }

  /** The run is over: bank totals and coins, and level up if every goal is done. */
  finish(r: RunProgress): RunSummary {
    this.check(r);
    const p = this.profile;
    const goals = p.goals;
    if (!this.finished) {
      for (const g of goals) g.progress = goalValue(g, r);
      p.coins += Math.max(0, Math.floor(r.stats.coins));
      p.bestMetres = Math.max(p.bestMetres, r.metres);
    }
    this.finished = true;
    const summary: RunSummary = {
      coins: r.stats.coins,
      wallet: p.coins,
      goals: goals.map((g) => ({ ...g, fresh: this.completed.has(g) })),
      levelUp: null,
    };
    if (goals.every((g) => g.done)) {
      p.level++;
      const coins = levelUpCoins(p.level);
      p.coins += coins;
      summary.wallet = p.coins;
      p.goals = goalsFor(p.level, p.bestMetres, this.rng(), goals.map((g) => g.id));
      summary.levelUp = {
        level: p.level,
        multiplier: levelMultiplier(p.level),
        perks: PERKS.filter((k) => k.level === p.level),
        coins,
        finale: p.level === LEVELS.length + 1,
      };
    }
    return summary;
  }
}

/** "Rode 2 penguins, 1 polar bear · 3 smashes" ('' if nothing to tell). */
export function rideSummary(st: RunStats): string {
  const names: Record<MountKind, [string, string]> = {
    penguin: ['penguin', 'penguins'],
    eagle: ['eagle', 'eagles'],
    snowmobile: ['snowmobile', 'snowmobiles'],
    bear: ['polar bear', 'polar bears'],
  };
  const rode = MOUNT_KINDS.filter((k) => st.rides[k] > 0).map((k) => plural(st.rides[k], ...names[k]));
  const parts = [rode.length ? `Rode ${rode.join(', ')}` : '', st.smashes > 0 ? plural(st.smashes, 'smash', 'smashes') : ''];
  return parts.filter(Boolean).join(' · ');
}

// ---- Shop ----

export type UpgradeId = 'headStart' | 'magnet' | 'cluster' | 'avalanche' | 'eagle' | 'fuel' | 'landing';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  /** Price of each level, in order. */
  costs: readonly number[];
  /** What owning `level` (≥ 1) does. */
  effect: (level: number) => string;
  apply?: (t: Tuning, level: number) => void;
}

// Priced against ~45 coins a run (bun run probe): the first level of the
// cheap ones takes 2–3 runs, the whole shop well over a hundred.
export const UPGRADES: readonly Upgrade[] = [
  {
    id: 'headStart',
    name: 'Head start',
    costs: [400, 1200],
    effect: (n) => (n === 1 ? 'Start every run on a snowmobile' : 'Start on a snowmobile with a polar bear aboard'),
  },
  {
    id: 'magnet',
    name: 'Coin magnet',
    costs: [100, 250, 500],
    effect: (n) => `Grab coins from ${45 * n}% further away`,
    apply: (t, n) => (t.coinPickup *= 1 + 0.45 * n),
  },
  {
    id: 'cluster',
    name: 'Cluster boost',
    costs: [100, 250, 500],
    effect: (n) => `Full coin clusters boost you ${35 * n}% more`,
    apply: (t, n) => (t.coinClusterBoost *= 1 + 0.35 * n),
  },
  {
    id: 'avalanche',
    name: 'Avalanche delay',
    costs: [150, 350, 700],
    effect: (n) => `The avalanche speeds up ${10 * n}% slower`,
    apply: (t, n) => (t.avalancheAccel *= 1 - 0.1 * n),
  },
  {
    id: 'eagle',
    name: 'Eagle wings',
    costs: [80, 200, 400],
    effect: (n) => `Eagles carry you ${1.5 * n} s longer`,
    apply: (t, n) => (t.eagleTime += 1.5 * n),
  },
  {
    id: 'fuel',
    name: 'Bigger tank',
    costs: [80, 200, 400],
    effect: (n) => `Snowmobiles run ${4 * n} s longer`,
    apply: (t, n) => (t.snowmobileFuel += 4 * n),
  },
  {
    id: 'landing',
    name: 'Sturdy landings',
    costs: [150, 350, 700],
    effect: (n) => `Clean landings forgive ${3 * n}° more tilt`,
    apply: (t, n) => (t.cleanLandingDeg += 3 * n),
  },
];

export function upgradeLevel(p: Profile, id: UpgradeId): number {
  return p.upgrades[id] ?? 0;
}

/** Price of the next level, or null when maxed out. */
export function upgradeCost(p: Profile, id: UpgradeId): number | null {
  const u = UPGRADES.find((u) => u.id === id);
  return u?.costs[upgradeLevel(p, id)] ?? null;
}

/** Buy the next level if there is one and the wallet covers it. */
export function buyUpgrade(p: Profile, id: UpgradeId): boolean {
  const cost = upgradeCost(p, id);
  if (cost === null || p.coins < cost) return false;
  p.coins -= cost;
  p.upgrades[id] = upgradeLevel(p, id) + 1;
  return true;
}

// ---- What a run starts with ----

export interface RunSetup {
  tuning: Tuning;
  /** Ride these from the start, bottom of the stack first. */
  startMount: Ridden[];
  scoreMultiplier: number;
  multiplierFloor: number;
  secondWind: boolean;
}

/**
 * The tuning, start mounts and score multiplier a run gets from upgrades and
 * level perks. The title screen's demo run gets none of it.
 */
export function runSetup(p: Profile, base: Readonly<Tuning>, demo: boolean): RunSetup {
  const tuning = { ...base };
  if (demo) return { tuning, startMount: [], scoreMultiplier: 1, multiplierFloor: 1, secondWind: false };
  for (const u of UPGRADES) {
    const level = upgradeLevel(p, u.id);
    if (level > 0) u.apply?.(tuning, level);
  }
  const perks = perksAt(p.level);
  for (const perk of perks) perk.apply?.(tuning);
  // Head start brings a snowmobile (and at level 2 a polar bear, which takes the penguin's seat).
  const head = upgradeLevel(p, 'headStart');
  const animal: Ridden | undefined = head >= 2 ? 'bear' : perks.find((k) => k.start)?.start;
  const startMount: Ridden[] = [...(head >= 1 ? (['snowmobile'] as const) : []), ...(animal ? [animal] : [])];
  return {
    tuning,
    startMount,
    scoreMultiplier: levelMultiplier(p.level),
    multiplierFloor: Math.max(1, ...perks.map((k) => k.multiplierFloor ?? 1)),
    secondWind: perks.some((k) => k.secondWind),
  };
}
