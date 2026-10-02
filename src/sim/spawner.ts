import { Rng } from './rng';
import { Skier, type Ground, type SkierEvent } from './skier';
import { DIFFICULTY_RAMP, type Feature, type FeatureKind, type Terrain, type TerrainSample } from './terrain';
import { MOUNT_KINDS, MOUNTS, wildMount, type MountKind, type WildMount } from './mounts';
import { PX_PER_METRE, type Tuning } from '../tuning';

// Everything that sits on the slope: rocks, cabins, ice patches and coins,
// and the mounts waiting to be ridden (kept apart in `mounts`: they move).
//
// Placement is per terrain feature, from a weighted spawn table (like the
// terrain templates), and deterministic per seed. It has its own Rng so the
// mountain itself is identical with or without it.
//
// Fairness comes from "ghost" skiers: invisible skiers running ahead on the
// bare terrain. The idle ghost rides like a player who never presses anything:
// wherever it gets launched is a landing zone you are forced into, so
// obstacles stay out of the whole flight, the lip just before it and the
// reaction distance after it (which also covers anyone slower taking off from
// the same crest). Other ghosts stand in for a rider just back up after a
// crash, one carrying flip boosts, and one who jumps at every lip; obstacles
// stay off their touchdowns too. What's left is snow you're riding on with the
// obstacle in plain view, or under the middle of a flight. Riders at other
// speeds can still come down on something now and then (scripts/probe.ts
// counts it); covering every possible speed would leave almost no room on
// this jump-heavy mountain. The idle ghost's flights also give coin arcs a
// real ballistic path to follow.
//
// The spawner doubles as the ground the player skis on (`Ground`): the
// terrain, plus cabin roofs to ride and ice to slide on.

export interface Rock {
  kind: 'rock';
  x0: number;
  x1: number;
  /** Centre and radius of the boulder (the hit circle is a bit smaller). */
  x: number;
  y: number;
  r: number;
  /** Smashed to bits by a polar bear: gone. */
  broken?: boolean;
}

export interface Cabin {
  kind: 'cabin';
  /** The roof spans [x0, x1]; its walls rise at x0 (and x1). */
  x0: number;
  x1: number;
  /** Roof line: y = y0 + (x - x0) * m. Parallel to the slope, rideable like ground. */
  y0: number;
  m: number;
  /** Roof height above the snow, px. */
  h: number;
  /** Smashed by running into its wall: no roof any more. */
  broken: boolean;
}

export interface Ice {
  kind: 'ice';
  x0: number;
  x1: number;
}

export interface Cluster {
  size: number;
  got: number;
  /** x of the last coin, to tell when a cluster has been passed. */
  x1: number;
}

export interface Coin {
  kind: 'coin';
  x0: number;
  x1: number;
  x: number;
  y: number;
  cluster: Cluster;
  taken: boolean;
}

export type Entity = Rock | Cabin | Ice | Coin;

export type SpawnEvent =
  /** `index`: how many of its cluster had been taken before this one. */
  | { type: 'coin'; x: number; y: number; index: number; size: number }
  | { type: 'cluster'; x: number; y: number; size: number };

export type SpawnKind = 'rock' | 'cabin' | 'ice' | 'coinLine' | 'coinArc' | 'mount' | 'none';

/**
 * What can go on each kind of feature: weight at difficulty 0 and at 1. A
 * second biome supplies its own table. 'mount' only takes part once one is due
 * (see MOUNT_GAP); which mount comes from MOUNT_TABLE.
 */
export type SpawnTable = Record<FeatureKind, Partial<Record<SpawnKind, [easy: number, hard: number]>>> & {
  /** Ice patch length range, px (default ICE_LEN). */
  iceLen?: [number, number];
};

export const ALPINE: SpawnTable = {
  start: {},
  // Cabins need a long, even stretch: cruises, and the runouts of drops and booters.
  cruise: { cabin: [6, 6], rock: [2, 3], ice: [1, 1.5], coinLine: [1.5, 1], mount: [10, 10], none: [1, 0.5] },
  rollers: { rock: [3, 4], coinLine: [1.5, 1], coinArc: [1, 1], mount: [6, 6], none: [2, 1] },
  kicker: { rock: [2, 3], ice: [1, 1], coinArc: [3, 3], mount: [4, 4], none: [1.5, 1] },
  drop: { rock: [2, 3], cabin: [2, 2], coinArc: [2.5, 2.5], mount: [5, 5], none: [1.5, 1] },
  bowl: { rock: [1.5, 2], ice: [2, 2], coinLine: [1.5, 1.5], coinArc: [1.5, 1.5], mount: [6, 6], none: [1.5, 1] },
  booter: { rock: [2, 3], cabin: [1, 1], coinArc: [3, 3], mount: [4, 4], none: [1.5, 1] },
};

/** Which mount, once one is due: from how far down the mountain (px), and how common. */
export const MOUNT_TABLE: Record<MountKind, { from: number; weight: number }> = {
  penguin: { from: 250 * PX_PER_METRE, weight: 4 },
  eagle: { from: 700 * PX_PER_METRE, weight: 2.5 },
  snowmobile: { from: 1000 * PX_PER_METRE, weight: 2 },
  bear: { from: 1400 * PX_PER_METRE, weight: 2 },
};
/** A kind not seen yet this run is this much likelier: everyone gets to meet each mount. */
const NEW_MOUNT_BOOST = 4;
/** Slope between one mount and the earliest the next may go, px (plus however long placing it takes). */
const MOUNT_GAP = 21000;
/** …or this fraction of it for a kind's first appearance, so each turns up near its `from`. */
const NEW_MOUNT_GAP = 0.5;
/** Clear snow between an obstacle and a mount, either way round, px. */
const MOUNT_CLEAR = 900;
/** Snow before a mount the idle rider must be on: to ride into it, or (eagle) to jump for it, px. */
const MOUNT_RUNUP = { ground: 200, eagle: 400 };

const OBSTACLES: ReadonlySet<SpawnKind> = new Set(['rock', 'cabin', 'ice']);

/** Same as the run's fixed step. */
const GHOST_DT = 1 / 120;
/**
 * Ghost riders. `idle` never presses anything, on plain tuning; `slow` is a
 * rider just back up after a crash, `fast` one carrying flip boosts, and `lip`
 * jumps at every ramp lip. Speed bands px/s. `whole`: keep its whole flights
 * clear, not just where it touches down.
 */
const GHOSTS = [
  { name: 'idle', min: 0, max: Infinity, whole: true },
  { name: 'slow', min: 0, max: 700, whole: true },
  { name: 'fast', min: 1500, max: Infinity, whole: false },
  { name: 'lip', min: 0, max: Infinity, whole: false },
] as const;
/** "At the lip": on a ramp steeper than this (body angle, rad, negative = uphill). */
const LIP_ANGLE = -0.5;
/** Ghosts (and so spawning) run this far ahead of the skier, px. */
const SPAWN_AHEAD = 4500;
/** No obstacles before this x: room to get going and build a lead on the avalanche. */
export const START_CLEAR = 5000;
/** A ghost flight at least this long is a forced landing zone, s (shorter ones are hops). */
export const FORCED_AIR = 0.25;
/** Riders sailing past a cabin wall must clear its roof by this much, px (slower riders fly lower). */
const ROOF_CLEAR = 20;
/** Keep obstacles this far before a forced takeoff: the kicker run-in and lip, px. */
const LIP_CLEAR = 300;
/** Landings scatter this far short of a ghost's touchdown (riders a bit slower), px. */
const LAND_SPREAD = 200;
/** After any landing, leave this long at the landing speed to react, s (at least MIN_REACT px). */
const REACT_TIME = 0.25;
const MIN_REACT = 250;
/** Clear snow between obstacles (and ice): land one, see the next, jump it, px. */
const OBSTACLE_GAP = 1500;
/** Extra clear run-up before a cabin wall: you must already be on your way up when you reach it, px. */
const CABIN_RUNUP = 400;
/** Rolling off a cabin roof lands you in this stretch after it, px. */
const CABIN_RUNOFF = 900;
/** One spawn roll per this much feature length, px. */
const ROLL_LENGTH = 1200;
/** Candidate spots are tried this far apart, px. */
const SCAN_STEP = 40;
/** Only flights at least this long get a coin arc, s. */
const ARC_MIN_AIR = 0.5;
/** Which part of the flight (fractions of its length) the arc covers. */
const ARC_SPAN: [number, number] = [0.08, 0.5];
/** Hit circle as a fraction of the drawn rock: brushing the edge is forgiven. */
const ROCK_HIT = 0.8;
/** Drawn coin radius, px. */
export const COIN_R = 14;
const COIN_SPACING = 80;
/** Coins float at the body's middle so riding (or flying) through them collects them, px. */
const COIN_LIFT = 34;
const CABIN_W: [number, number] = [300, 380];
const ICE_LEN: [number, number] = [700, 1300];

interface Flight {
  ghost: (typeof GHOSTS)[number];
  x0: number;
  x1: number;
  /** Speed on landing, px/s. */
  speed: number;
  /** Air time, s. */
  air: number;
  /** Flight path as [x, y, x, y, …]. */
  path: number[];
  /** Started with a jump (the lip ghost's), not just rolling off a crest. */
  jumped: boolean;
  /** A coin arc already follows it. */
  arced: boolean;
}

interface Ghost {
  skier: Skier;
  flight: Flight | null;
  spec: (typeof GHOSTS)[number];
}

export class Spawner implements Ground {
  /** Everything on the slope near the skier, roughly in x order. */
  readonly entities: Entity[] = [];
  /** Mounts waiting to be ridden (sim/mounts.ts moves them and boards them). */
  readonly mounts: WildMount[] = [];
  /** Cabins and ice: the bits of entities that change the ground. */
  private readonly surfaces: (Cabin | Ice)[] = [];
  private readonly flights: Flight[] = [];
  private readonly ghosts: Ghost[];
  private readonly rng: Rng;
  private readonly scratch: SkierEvent[] = [];
  /** Features up to here have been populated. Tracked by x: terrain.prune shifts the array. */
  private doneX = -Infinity;
  /** Right edge of the last obstacle's keep-clear zone, px. */
  private lastObstacleEnd = -Infinity;
  private lastCoinEnd = -Infinity;
  /** Where the last mount was put, px. */
  private lastMountX = -Infinity;
  /** Kinds put on the slope so far. */
  private readonly metMounts = new Set<MountKind>();

  constructor(
    private readonly terrain: Terrain,
    private readonly tuning: Tuning,
    seed: number,
    /** Rocks, cabins and ice. Off for the title screen's demo run (coins only). */
    readonly obstacles = true,
    /** Where the skier (and so the ghosts) start. */
    startX = 0,
    private readonly table: SpawnTable = ALPINE,
  ) {
    this.rng = new Rng((seed ^ 0x5eed5) + 1);
    this.ghosts = GHOSTS.map((spec) => {
      const minSpeed = Math.max(tuning.minSpeed, spec.min);
      const skier = new Skier(terrain, { ...tuning, minSpeed, maxSpeed: Math.max(minSpeed, Math.min(tuning.maxSpeed, spec.max)) }, startX);
      skier.speed = minSpeed;
      return { skier, flight: null, spec };
    });
  }

  // ---- Ground: the terrain plus cabin roofs and ice ----

  sample(x: number): TerrainSample {
    let ice = false;
    for (const e of this.surfaces) {
      if (x < e.x0 || x > e.x1) continue;
      if (e.kind === 'cabin') {
        if (!e.broken) return { y: e.y0 + (x - e.x0) * e.m, dy: e.m, ddy: 0 };
      } else ice = true;
    }
    const s = this.terrain.sample(x);
    if (ice) s.ice = true;
    return s;
  }

  height(x: number): number {
    return this.sample(x).y;
  }

  // ---- Streaming ----

  /** Populate the slope ahead of the skier. */
  update(skierX: number): void {
    const target = skierX + SPAWN_AHEAD;
    let ready = Infinity;
    for (const g of this.ghosts) {
      // Capped, in case tuning stops a ghost dead (minSpeed 0 on the flat).
      for (let i = 0; i < 4000 && g.skier.x < target; i++) this.stepGhost(g);
      // A feature is ready once no ghost can still take off on or just after it.
      ready = Math.min(ready, (g.flight?.x0 ?? g.skier.x) - LIP_CLEAR);
    }
    for (const f of this.terrain.features) {
      if (f.x1 <= this.doneX) continue;
      if (f.x1 > ready) break;
      this.populate(f);
      this.doneX = f.x1;
    }
  }

  /** Forget everything entirely left of `x`. */
  prune(x: number): void {
    const keep = <T extends { x1: number }>(list: T[]) => {
      let n = 0;
      for (const e of list) if (e.x1 >= x) list[n++] = e;
      list.length = n;
    };
    keep(this.entities);
    keep(this.surfaces);
    keep(this.flights);
    keep(this.mounts);
  }

  /** Put something on the slope (the spawner does; so can tests). */
  add(e: Entity): void {
    this.entities.push(e);
    if (e.kind === 'cabin' || e.kind === 'ice') this.surfaces.push(e);
  }

  /** Put a mount on the slope at `x` (the spawner does; so can tests and ?mount= tours). */
  addMount(kind: MountKind, x: number): WildMount {
    const m = wildMount(kind, x, this);
    this.mounts.push(m);
    return m;
  }

  /** The cabin whose roof spans `x` is smashed (someone ran into its wall). */
  smash(x: number): void {
    for (const e of this.surfaces) if (e.kind === 'cabin' && !e.broken && x >= e.x0 - 1 && x <= e.x1) e.broken = true;
  }

  /** Rocks knock the skier down; coins get collected. Cabin walls are handled by the skier's ground step. */
  collide(skier: Skier, events: (SkierEvent | SpawnEvent)[]): void {
    for (const e of this.entities) {
      if (e.x0 > skier.x + 120 || e.x1 < skier.x - 120) continue;
      if (e.kind === 'rock') {
        if (!e.broken && skier.vulnerable && skier.touches(e.x, e.y, e.r * ROCK_HIT) && skier.hit('rock', events as SkierEvent[], e.x) === 'smash') {
          e.broken = true;
        }
      } else if (e.kind === 'coin' && !e.taken && skier.touches(e.x, e.y, this.tuning.coinPickup)) {
        e.taken = true;
        const c = e.cluster;
        events.push({ type: 'coin', x: e.x, y: e.y, index: c.got, size: c.size });
        if (++c.got === c.size) {
          skier.boost(this.tuning.coinClusterBoost);
          events.push({ type: 'cluster', x: e.x, y: e.y, size: c.size });
        }
      }
    }
  }

  // ---- Ghosts ----

  private stepGhost(g: Ghost): void {
    const s = g.skier;
    this.scratch.length = 0;
    const jump = g.spec.name === 'lip' && s.mode === 'ground' && s.angle < LIP_ANGLE;
    s.step(GHOST_DT, { held: false, pressed: jump }, this.scratch);
    if (s.mode === 'air') {
      g.flight ??= { ghost: g.spec, x0: s.x, x1: s.x, speed: 0, air: 0, path: [], jumped: jump, arced: false };
      g.flight.path.push(s.x, s.y);
    } else if (g.flight) {
      g.flight.x1 = s.x;
      g.flight.speed = s.speed;
      g.flight.air = s.airTime;
      this.flights.push(g.flight);
      g.flight = null;
    }
  }

  /** Where a ghost flight lands, plus room to react afterwards. */
  private landingZone(f: Flight): [number, number] {
    return [f.x1 - LAND_SPREAD, f.x1 + Math.max(MIN_REACT, REACT_TIME * f.speed)];
  }

  /**
   * Is [a, b] safe for a rock? Clear of whole forced flights of the idle and
   * slow ghosts (with the lip before and reaction room after), and of every
   * ghost's touchdown. With `margins` off: is an idle rider simply on the snow
   * all along [a, b]?
   */
  private clearOfFlights(a: number, b: number, margins = true): boolean {
    for (const f of this.flights) {
      let [lo, hi] = [f.x0, f.x1];
      if (margins) {
        [lo, hi] = this.landingZone(f);
        if (f.ghost.whole && f.air >= FORCED_AIR) lo = f.x0 - LIP_CLEAR;
      } else if (f.ghost.name !== 'idle') continue;
      if (a < hi && b > lo) return false;
    }
    return true;
  }

  /**
   * Can a cabin's wall stand at `a` (roof up to `b`, roof line `roofY`)? Unlike
   * a rock, landing on it is fine (that's the roof), so each ghost must either
   * ride up to the wall on the snow with room to jump, or sail past it well
   * above the roof; never come down just in front of it. The slow ghost (a
   * rider who just got up) must not be in the air around it at all.
   */
  private cabinFits(a: number, b: number, roofY: number): boolean {
    const runUp = a - CABIN_RUNUP;
    if (runUp < START_CLEAR || runUp - this.lastObstacleEnd < OBSTACLE_GAP || this.coinsOverlap(a - 100, b + 100)) return false;
    // Ride up to it, and roll off the roof onto, plain downhill snow: no ramps.
    for (let x = runUp; x < a; x += 50) if (this.terrain.sample(x).dy < 0.05) return false;
    for (let x = b; x < b + CABIN_RUNOFF / 2; x += 50) if (this.terrain.sample(x).dy < 0.05) return false;
    for (const f of this.flights) {
      if (f.ghost.name === 'slow') {
        if (runUp < this.landingZone(f)[1] && b > f.x0 - LIP_CLEAR) return false;
      } else if (f.x1 >= runUp && f.x1 < a) {
        return false;
      } else if (f.x0 <= a && f.x1 >= a && pathY(f.path, a) > roofY - ROOF_CLEAR) {
        return false;
      }
    }
    return true;
  }

  // ---- Placement ----

  private populate(f: Feature): void {
    const entries = Object.entries(this.table[f.kind]) as [SpawnKind, [number, number]][];
    if (entries.length === 0) return;
    const d = Math.min(1, Math.max(0, f.x0 / DIFFICULTY_RAMP));
    const density = this.obstacles ? this.tuning.obstacleDensity : 0;
    // Mounts come with the obstacles, and only once one is due.
    const mountDue = this.obstacles && MOUNT_KINDS.some((k) => f.x1 > this.mountDue(k));
    const mounts = mountDue ? this.tuning.mountDensity : 0;
    const weights = {} as Record<SpawnKind, number>;
    for (const [kind, [easy, hard]] of entries) {
      const w = (easy + (hard - easy) * d) * (OBSTACLES.has(kind) ? density : kind === 'mount' ? mounts : 1);
      if (w > 0) weights[kind] = w;
    }
    if (Object.keys(weights).length === 0) return;
    const rolls = Math.max(1, Math.round((f.x1 - f.x0) / ROLL_LENGTH));
    const picks = Array.from({ length: rolls }, () => this.rng.weighted(weights));
    // Obstacles claim their spots first, then mounts; coins fill in around them.
    const order = (k: SpawnKind) => (OBSTACLES.has(k) ? 0 : k === 'mount' ? 1 : 2);
    picks.sort((p, q) => order(p) - order(q));
    for (const kind of picks) this.place(kind, f);
  }

  /** The earliest x the next `kind` may go. A kind's first appearance comes sooner. */
  private mountDue(kind: MountKind): number {
    const gap = this.metMounts.has(kind) ? MOUNT_GAP : MOUNT_GAP * NEW_MOUNT_GAP;
    return Math.max(MOUNT_TABLE[kind].from, this.lastMountX + gap);
  }

  /** A random x in [f.x0, f.x1) where `ok(x)` holds, or null if there's none. */
  private spot(f: Feature, ok: (x: number) => boolean): number | null {
    const xs: number[] = [];
    for (let x = f.x0; x < f.x1; x += SCAN_STEP) if (ok(x)) xs.push(x);
    return xs.length > 0 ? xs[this.rng.int(0, xs.length - 1)] : null;
  }

  /** Put one `kind` somewhere valid on feature `f`, if there is anywhere. */
  private place(kind: SpawnKind, f: Feature): void {
    const r = this.rng;
    switch (kind) {
      case 'none':
        return;
      case 'rock': {
        const size = r.range(30, 40);
        const x = this.spot(f, (x) => {
          const dy = this.terrain.sample(x).dy;
          return dy > 0.05 && dy < 0.9 && this.obstacleFits(x - size, x + size);
        });
        if (x === null) return;
        // Bedded in the snow: about 1.2 radii stick out, 36–48 px.
        this.addObstacle({ kind: 'rock', x0: x - size, x1: x + size, x, y: this.terrain.height(x) - size * 0.2, r: size }, x + size);
        return;
      }
      case 'cabin': {
        const w = r.range(...CABIN_W);
        const h = this.cabinHeight();
        const a = this.spot(f, (x) => this.straight(x, x + w) && this.cabinFits(x, x + w, this.terrain.height(x) - h));
        if (a === null) return;
        const b = a + w;
        const y0 = this.terrain.height(a) - h;
        const cabin: Cabin = { kind: 'cabin', x0: a, x1: b, y0, m: (this.terrain.height(b) - h - y0) / w, h, broken: false };
        this.addObstacle(cabin, b + CABIN_RUNOFF);
        // Half the time, a line of coins along the roof rewards getting up there.
        if (r.chance(0.5)) this.addCoins(range(a + 40, b - 30, COIN_SPACING).map((cx) => [cx, y0 + (cx - a) * cabin.m - COIN_LIFT]));
        return;
      }
      case 'ice': {
        const len = r.range(...(this.table.iceLen ?? ICE_LEN));
        // Only where you're on the snow, on a downhill stretch. Ice can't knock
        // you down, so it may run right up to a kicker lip.
        const a = this.spot(
          f,
          (x) => this.terrain.height(x + len) - this.terrain.height(x) > 0.1 * len && this.obstacleFits(x, x + len, false),
        );
        if (a === null) return;
        const ice: Ice = { kind: 'ice', x0: a, x1: a + len };
        this.addObstacle(ice, a + len);
        return;
      }
      case 'coinLine': {
        const len = (r.int(5, 12) - 1) * COIN_SPACING;
        const a = this.spot(f, (x) => this.coinsFit(x, x + len) && this.clearOfFlights(x - 100, x + len + 100, false));
        if (a === null) return;
        this.addCoins(range(a, a + len + 1, COIN_SPACING).map((cx) => [cx, this.terrain.height(cx) - COIN_LIFT]));
        return;
      }
      case 'mount': {
        const weights = {} as Record<MountKind, number>;
        for (const k of MOUNT_KINDS) if (f.x1 > this.mountDue(k)) weights[k] = MOUNT_TABLE[k].weight * (this.metMounts.has(k) ? 1 : NEW_MOUNT_BOOST);
        if (Object.keys(weights).length === 0) return;
        const kind = r.weighted(weights);
        const due = this.mountDue(kind);
        const [before, after] = kind === 'eagle' ? [MOUNT_RUNUP.eagle, 100] : [MOUNT_RUNUP.ground, MOUNTS[kind].range + 150];
        const x = this.spot(f, (x) => x >= due && this.mountFits(x - before, x + after));
        if (x === null) return;
        const m = this.addMount(kind, x);
        this.metMounts.add(kind);
        this.lastMountX = x;
        // Obstacles keep their distance after it too: board, then see what's coming.
        this.lastObstacleEnd = Math.max(this.lastObstacleEnd, m.x1 + MOUNT_CLEAR - OBSTACLE_GAP);
        return;
      }
      case 'coinArc': {
        // Follow a longer flight from a takeoff on this feature: the idle
        // ghost's (ride the jump to get them) or a jump at the lip (a higher
        // arc that you only get by jumping).
        const options = this.flights.filter(
          (fl) =>
            (fl.ghost.name === 'idle' || fl.jumped) &&
            !fl.arced &&
            fl.x0 >= f.x0 &&
            fl.x0 < f.x1 &&
            fl.air >= ARC_MIN_AIR &&
            this.coinsFit(fl.x0, fl.x1),
        );
        if (options.length === 0) return;
        const flight = options[r.int(0, options.length - 1)];
        // From just past the lip to a bit beyond the apex: paths at different
        // speeds share the lip's takeoff angle and only fan out further on.
        const len = flight.x1 - flight.x0;
        const a = flight.x0 + len * ARC_SPAN[0];
        const b = flight.x0 + len * ARC_SPAN[1];
        const n = Math.max(5, Math.min(12, Math.round((b - a) / COIN_SPACING) + 1));
        const pts: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const cx = a + ((b - a) * i) / (n - 1);
          pts.push([cx, pathY(flight.path, cx) - COIN_LIFT]);
        }
        flight.arced = true;
        this.addCoins(pts);
        return;
      }
    }
  }

  /** Roof height: comfortably below the top of a jump on the current tuning, px. */
  private cabinHeight(): number {
    const t = this.tuning;
    const apex = (t.jumpImpulse * t.jumpImpulse) / (2 * t.gravity);
    return Math.max(70, Math.min(150, apex * 0.8));
  }

  /** Past the start, spaced from the last obstacle, clear of coins and (with `margins`) of landing zones. */
  private obstacleFits(a: number, b: number, margins = true): boolean {
    return (
      a >= START_CLEAR &&
      a - this.lastObstacleEnd >= OBSTACLE_GAP &&
      this.clearOfFlights(a, b, margins) &&
      !this.coinsOverlap(a - 150, b + 150)
    );
  }

  private coinsFit(a: number, b: number): boolean {
    if (a - this.lastCoinEnd < 300) return false;
    for (const e of this.entities) if (e.kind !== 'coin' && e.kind !== 'ice' && a < e.x1 + 200 && b > e.x0 - 200) return false;
    for (const m of this.mounts) if (a < m.x1 + 200 && b > m.x0 - 200) return false;
    return true;
  }

  /**
   * Can a mount's zone [a, b] go here? Clear of obstacles and coins, and an
   * idle rider is on the snow all along it (nothing it could fly over unseen),
   * on no steep climb: a ground mount is in the way, an eagle in reach of a jump.
   */
  private mountFits(a: number, b: number): boolean {
    if (a - this.lastObstacleEnd < MOUNT_CLEAR || this.coinsOverlap(a - 150, b + 150)) return false;
    // Little hops over rollers are fine: you still bump into it.
    for (const f of this.flights) if (f.ghost.name === 'idle' && f.air >= FORCED_AIR && a < f.x1 && b > f.x0) return false;
    for (let x = a; x <= b; x += 50) {
      const dy = this.terrain.sample(x).dy;
      if (dy < -0.5 || dy > 1) return false;
    }
    return true;
  }

  private coinsOverlap(a: number, b: number): boolean {
    return this.entities.some((e) => e.kind === 'coin' && a < e.x1 && b > e.x0);
  }

  /** Is the terrain over [a, b] near enough straight for a cabin, and gently downhill? */
  private straight(a: number, b: number): boolean {
    for (let i = 0; i <= 4; i++) {
      const s = this.terrain.sample(a + ((b - a) * i) / 4);
      // 1e-3 bends a 380 px span by at most ~18 px.
      if (Math.abs(s.ddy) > 1e-3 || s.dy < 0.05 || s.dy > 0.6) return false;
    }
    return true;
  }

  private addObstacle(e: Rock | Cabin | Ice, keepClearTo: number): void {
    this.add(e);
    this.lastObstacleEnd = keepClearTo;
  }

  private addCoins(pts: [number, number][]): void {
    const cluster: Cluster = { size: pts.length, got: 0, x1: pts[pts.length - 1][0] };
    for (const [x, y] of pts) this.add({ kind: 'coin', x0: x - COIN_R, x1: x + COIN_R, x, y, cluster, taken: false });
    this.lastCoinEnd = cluster.x1;
  }
}

/** Height of a flight path ([x, y, x, y, …], x increasing) at `x`, interpolated. */
function pathY(p: number[], x: number): number {
  let j = 0;
  while (j < p.length - 4 && p[j + 2] < x) j += 2;
  if (p.length < 4) return p[1];
  const t = (x - p[j]) / (p[j + 2] - p[j] || 1);
  return p[j + 1] + (p[j + 3] - p[j + 1]) * t;
}

/** a, a + step, … while < b. */
function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let x = a; x < b; x += step) out.push(x);
  return out;
}
