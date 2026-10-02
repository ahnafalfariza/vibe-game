import type { RunStats } from './run';
import { MOUNT_KINDS, type MountKind, type Ridden } from './mounts';
import { MOUNT_TABLE } from './spawner';
import { Rng } from './rng';
import { PX_PER_METRE, type Tuning } from '../tuning';

// Meta progression, Ski Safari style: three goals on screen at a time; finish
// all three and you rank up at the end of the run, three fresh goals are drawn,
// and the rank raises the base score multiplier and unlocks perks. Coins buy
// upgrades in the shop. Pure rules: no Phaser, no DOM, no storage (profile.ts
// keeps the Profile in localStorage).

// ---- Profile ----

/** Stored profile shape. Bump when it changes, and migrate in normalizeProfile(). */
export const PROFILE_VERSION = 1;

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
  rank: number;
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
  /** Displayed score (rank multiplier included). */
  score: number;
  /** Seconds since the start. */
  seconds: number;
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
  measure: (r: RunProgress) => number;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const FLIP_WORDS = ['', 'single', 'double', 'triple', 'quadruple'];
const kinds = (r: RunProgress) => MOUNT_KINDS.filter((k) => r.stats.rides[k] > 0).length;

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
  { id: 'survive', family: 'distance', text: (n) => `Outrun the avalanche for ${n} s`, targets: [40, 55, 70, 85, 100], measure: (r) => r.seconds },
  { id: 'score', text: (n) => `Score ${fmt(n)} in one run`, targets: [2000, 4000, 7000, 11000, 16000], measure: (r) => r.score },
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

/** A brand-new player's first three: one of each basic skill. */
const FIRST_GOALS = ['flips', 'coins', 'distance'];

/** Mount goals wait until the best run reaches this far past where the mount first turns up, m. */
const MOUNT_MARGIN = 150;

/** Difficulty tier for a rank: 0 at ranks 1–2, one up every two ranks after. */
export function tierFor(rank: number, tiers = 5): number {
  return Math.min(tiers - 1, Math.floor((rank - 1) / 2));
}

/** Is the player likely to meet this mount on their runs (best run past its first appearance)? */
export function canMeet(kind: MountKind, bestMetres: number): boolean {
  return bestMetres >= MOUNT_TABLE[kind].from / PX_PER_METRE + MOUNT_MARGIN;
}

function makeGoal(def: GoalDef, rank: number): Goal {
  return { id: def.id, target: def.targets[tierFor(rank, def.targets.length)], progress: 0, done: false };
}

/**
 * Three goals for `rank`, from different families, at most one counting
 * across runs and at most one needing a mount (and only mounts the player can
 * meet). Avoids the ids in `avoid` (the set just finished) when it can.
 */
export function drawGoals(rank: number, bestMetres: number, rng: Rng, avoid: readonly string[] = []): Goal[] {
  const ok = (d: GoalDef) => !d.mount || canMeet(d.mount, bestMetres);
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
  return picked.map((d) => makeGoal(d, rank));
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

/** A blank profile: rank 1 with the starter goals. */
export function newProfile(coins = 0): Profile {
  return {
    version: PROFILE_VERSION,
    coins,
    rank: 1,
    goals: FIRST_GOALS.map((id) => makeGoal(goalDef(id)!, 1)),
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
  // Version 1 is the first: nothing to migrate yet. Later versions convert older shapes here.
  p.coins = Math.floor(num(o.coins, 0, 0));
  p.rank = Math.floor(num(o.rank, 1, 1));
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
  if (goals.length === 3) p.goals = goals.map(({ id, target, progress, done }) => ({ id, target, progress, done: done === true }));
  else if (p.rank > 1) p.goals = drawGoals(p.rank, p.bestMetres, new Rng(p.rank));
  return p;
}

// ---- Ranks ----

/** Rank N multiplies the whole run score by 1 + 0.25·(N − 1): rank 5 doubles it. */
export function rankMultiplier(rank: number): number {
  return 1 + 0.25 * (rank - 1);
}

export interface Perk {
  rank: number;
  name: string;
  text: string;
  /** Unlocks this biome. */
  biome?: string;
  /** Every run starts riding this. */
  start?: Ridden;
  /** Changes the run's tuning. */
  apply?: (t: Tuning) => void;
}

export const PERKS: readonly Perk[] = [
  { rank: 2, name: 'Penguin start', text: 'Every run starts on a penguin', start: 'penguin' },
  { rank: 3, name: 'Twilight Pines', text: 'A new mountain to ski', biome: 'twilight' },
  { rank: 5, name: 'Safari season', text: 'Mounts turn up more often', apply: (t) => (t.mountDensity *= 1.5) },
  { rank: 7, name: 'Thick fur', text: 'Back on your feet 30% faster after a wipeout', apply: (t) => (t.crashDuration *= 0.7) },
];

export function perksAt(rank: number): Perk[] {
  return PERKS.filter((p) => p.rank <= rank);
}

export function nextPerk(rank: number): Perk | undefined {
  return PERKS.find((p) => p.rank > rank);
}

/** A biome no perk mentions is always open. */
export function biomeUnlocked(id: string, rank: number): boolean {
  return (PERKS.find((p) => p.biome === id)?.rank ?? 1) <= rank;
}

// ---- One run ----

/** What a run gave and changed, for the game-over screen. */
export interface RunSummary {
  coins: number;
  wallet: number;
  /** The goals that were active during the run, as they stand after it. */
  goals: (Goal & { fresh: boolean })[];
  rankUp: { rank: number; multiplier: number; perks: Perk[] } | null;
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

  /** The run is over: bank totals and coins, and rank up if every goal is done. */
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
      rankUp: null,
    };
    if (goals.every((g) => g.done)) {
      p.rank++;
      p.goals = drawGoals(p.rank, p.bestMetres, this.rng(), goals.map((g) => g.id));
      summary.rankUp = { rank: p.rank, multiplier: rankMultiplier(p.rank), perks: PERKS.filter((k) => k.rank === p.rank) };
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
}

/**
 * The tuning, start mounts and score multiplier a run gets from upgrades and
 * rank perks. The title screen's demo run gets none of it.
 */
export function runSetup(p: Profile, base: Readonly<Tuning>, demo: boolean): RunSetup {
  const tuning = { ...base };
  if (demo) return { tuning, startMount: [], scoreMultiplier: 1 };
  for (const u of UPGRADES) {
    const level = upgradeLevel(p, u.id);
    if (level > 0) u.apply?.(tuning, level);
  }
  const perks = perksAt(p.rank);
  for (const perk of perks) perk.apply?.(tuning);
  // Head start brings a snowmobile (and at level 2 a polar bear, which takes the penguin's seat).
  const head = upgradeLevel(p, 'headStart');
  const animal: Ridden | undefined = head >= 2 ? 'bear' : perks.find((k) => k.start)?.start;
  const startMount: Ridden[] = [...(head >= 1 ? (['snowmobile'] as const) : []), ...(animal ? [animal] : [])];
  return { tuning, startMount, scoreMultiplier: rankMultiplier(p.rank) };
}
