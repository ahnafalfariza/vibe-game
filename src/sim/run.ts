import { Terrain, type TerrainMix } from './terrain';
import { Skier, type SkierEvent, type SkierInput } from './skier';
import { Spawner, zoneAt, type SpawnEvent, type SpawnTable } from './spawner';
import { Mounts, type MountEvent, type MountKind } from './mounts';
import { MOUNT_POINTS, SMASH_POINTS, Score } from './score';
import { PX_PER_METRE, type Tuning } from '../tuning';

/** Fixed simulation step. Rendering interpolates between steps. */
export const SIM_DT = 1 / 120;

/** How far ahead of the skier terrain is generated, px. */
const GENERATE_AHEAD = 6000;
/** How far behind the skier terrain is kept, px. */
const KEEP_BEHIND = 4000;
/** Points for reaching zone N: this × N (not × the trick multiplier). */
export const ZONE_POINTS = 100;
/** Second wind knocks the avalanche this far back, px (30 m). */
export const SECOND_WIND_PX = 30 * PX_PER_METRE;

export interface RunStats {
  flips: number;
  cleanLandings: number;
  /** Clean landings with at least one flip. */
  cleanFlips: number;
  /** Most flips in one clean landing. */
  bestFlips: number;
  /** Highest trick multiplier reached. */
  topMultiplier: number;
  /** Metres skied before the first wipeout (all of them, if there wasn't one). */
  noCrashMetres: number;
  crashes: number;
  bestAirTime: number;
  topSpeed: number;
  coins: number;
  /** Clusters collected in full. */
  clusters: number;
  /** Times each mount was boarded (a start-of-run mount doesn't count). */
  rides: Record<MountKind, number>;
  /** Metres travelled on each mount (for the eagle: carried by one). */
  ridden: Record<MountKind, number>;
  /** Rocks and cabins a polar bear smashed. */
  smashes: number;
  /** Seconds carried by eagles. */
  eagleTime: number;
  /** Mounts knocked off by taking a hit for you. */
  shieldsLost: number;
  /** Furthest zone reached (1 at the start). */
  zone: number;
}

export interface RunOptions {
  /** Without the avalanche the run never ends (the title-screen backdrop). Default on. */
  avalanche?: boolean;
  /** Rocks, cabins, ice and mounts. Default: only with the avalanche (the demo run has no player to dodge them). */
  obstacles?: boolean;
  /** Start the run already riding this, or these bottom of the stack first (level perks, the shop, ?mount=). */
  startMount?: MountKind | readonly MountKind[];
  /** The whole score is multiplied by this (the level's base multiplier). Default 1. */
  scoreMultiplier?: number;
  /** What goes on the slope (a biome's spawn table). Default: the alpine one. */
  table?: SpawnTable;
  /** Which shapes the mountain favours (a biome's terrain mix). Default: the plain mix. */
  terrain?: TerrainMix;
  /** The trick multiplier never drops below this (Hot start). Default 1. */
  multiplierFloor?: number;
  /** The first time the avalanche catches you it's knocked back instead (Second wind). */
  secondWind?: boolean;
}

/** Points awarded for a landing, mount or smash (pushed right after its event). */
export type RunEvent =
  | SkierEvent
  | SpawnEvent
  | MountEvent
  | { type: 'award'; x: number; y: number; points: number; multiplier: number }
  | { type: 'secondWind'; x: number; y: number }
  | { type: 'zone'; zone: number; x: number; y: number; points: number };

const perKind = (): Record<MountKind, number> => ({ penguin: 0, eagle: 0, snowmobile: 0, bear: 0 });

/** One run down the mountain: terrain + skier + mounts + avalanche + bookkeeping. No rendering. */
export class Run {
  readonly terrain: Terrain;
  /** Rocks, cabins, ice, coins and waiting mounts; also the ground the skier rides on. */
  readonly spawner: Spawner;
  readonly skier: Skier;
  /** What the skier is riding. */
  readonly mounts: Mounts;
  readonly startX = 0;
  readonly avalanche: boolean;
  readonly scoreMultiplier: number;
  time = 0;
  readonly stats: RunStats = {
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
    rides: perKind(),
    ridden: perKind(),
    smashes: 0,
    eagleTime: 0,
    shieldsLost: 0,
    zone: 1,
  };
  readonly scoring: Score;
  /** Second wind still to come this run. */
  secondWind: boolean;
  /** Front edge of the avalanche, world x. */
  avalancheX: number;
  /** The avalanche reached the skier: the run is over and the skier stops. */
  caught = false;

  constructor(
    readonly seed: number,
    readonly tuning: Tuning,
    { avalanche = true, obstacles = avalanche, startMount = [], table, terrain, scoreMultiplier = 1, multiplierFloor = 1, secondWind = false }: RunOptions = {},
  ) {
    this.avalanche = avalanche;
    this.scoreMultiplier = scoreMultiplier;
    this.scoring = new Score(multiplierFloor);
    this.secondWind = secondWind;
    this.terrain = new Terrain(seed, tuning, terrain);
    this.spawner = new Spawner(this.terrain, tuning, seed, obstacles, this.startX, table);
    this.mounts = new Mounts(tuning);
    this.skier = new Skier(this.spawner, this.mounts.tuning, this.startX);
    this.skier.guard = (cause) => this.mounts.absorb(cause, this.skier);
    for (const kind of typeof startMount === 'string' ? [startMount] : startMount) this.mounts.board(kind, this.skier, []);
    this.avalancheX = this.startX - tuning.avalancheStartGap;
  }

  /** Metres travelled horizontally. */
  distancePx(): number {
    return Math.max(0, this.skier.x - this.startX);
  }

  /** 1 point per metre plus trick points, × the score multiplier. */
  get score(): number {
    return Math.floor((Math.floor(this.distancePx() / PX_PER_METRE) + this.scoring.tricks) * this.scoreMultiplier);
  }

  /** Avalanche speed right now, horizontal px/s. */
  avalancheSpeed(): number {
    return this.tuning.avalancheSpeed + this.tuning.avalancheAccel * this.time;
  }

  /** How far the avalanche is behind the skier, px. */
  avalancheGap(): number {
    return this.skier.x - this.avalancheX;
  }

  step(input: SkierInput, events: RunEvent[]): void {
    this.time += SIM_DT;
    if (!this.caught) this.stepSkier(input, events);
    if (this.avalanche) this.stepAvalanche(events);
  }

  private stepSkier(input: SkierInput, events: RunEvent[]): void {
    const firstNew = events.length;
    const sk = this.skier;
    const fromX = sk.x;
    this.terrain.ensure(sk.x + GENERATE_AHEAD);
    this.spawner.update(sk.x);
    sk.step(SIM_DT, input, events as SkierEvent[]);
    this.spawner.collide(sk, events as (SkierEvent | SpawnEvent)[]);
    this.mounts.step(SIM_DT, sk, this.spawner.mounts, this.spawner, events as MountEvent[]);
    this.terrain.prune(sk.x - KEEP_BEHIND);
    this.spawner.prune(sk.x - KEEP_BEHIND);

    const st = this.stats;
    st.topSpeed = Math.max(st.topSpeed, sk.velocity);
    const metres = (sk.x - fromX) / PX_PER_METRE;
    for (const kind of this.mounts.stack) st.ridden[kind] += metres;
    if (sk.carried) {
      st.ridden.eagle += metres;
      st.eagleTime += SIM_DT;
    }
    const award = (i: number, x: number, y: number, points: number, multiplier: number) => {
      if (points > 0) events.splice(i + 1, 0, { type: 'award', x, y, points, multiplier });
      return points > 0 ? i + 1 : i;
    };
    for (let i = firstNew; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'coin') st.coins++;
      else if (e.type === 'cluster') st.clusters++;
      else if (e.type === 'hit') {
        // Running into a cabin smashes it: there's no roof to stand on any more.
        if (e.obstacle === 'cabin') this.spawner.smash(e.x);
        if (e.crashed) {
          st.crashes++;
          this.scoring.reset();
        }
      } else if (e.type === 'land') {
        st.bestAirTime = Math.max(st.bestAirTime, e.airTime);
        if (e.quality === 'crash') st.crashes++;
        else {
          st.flips += e.flips;
          if (e.quality === 'clean') {
            st.cleanLandings++;
            if (e.flips > 0) st.cleanFlips++;
            st.bestFlips = Math.max(st.bestFlips, e.flips);
          }
        }
        const multiplier = e.quality === 'clean' ? this.scoring.multiplier : 1;
        i = award(i, e.x, e.y, this.scoring.land(e), multiplier);
      } else if (e.type === 'mount') {
        st.rides[e.kind]++;
        const multiplier = this.scoring.multiplier;
        i = award(i, e.x, e.y, this.scoring.bonus(MOUNT_POINTS[e.kind]), multiplier);
      } else if (e.type === 'smash') {
        st.smashes++;
        const multiplier = this.scoring.multiplier;
        i = award(i, e.x, e.y, this.scoring.bonus(SMASH_POINTS), multiplier);
      } else if (e.type === 'dismount' && (e.reason === 'rock' || e.reason === 'cabin' || e.reason === 'landing')) {
        // Losing a shield stings like a sloppy landing: the streak is gone.
        st.shieldsLost++;
        this.scoring.reset();
      }
    }
    st.topMultiplier = Math.max(st.topMultiplier, this.scoring.multiplier);
    // Into a new zone: a flat bonus that grows with each one.
    for (const zone = zoneAt(this.distancePx()); st.zone < zone; ) {
      st.zone++;
      const points = ZONE_POINTS * st.zone;
      this.scoring.tricks += points;
      events.push({ type: 'zone', zone: st.zone, x: sk.x, y: sk.y, points });
    }
    if (st.crashes === 0) st.noCrashMetres = this.distancePx() / PX_PER_METRE;
  }

  private stepAvalanche(events: RunEvent[]): void {
    this.avalancheX += this.avalancheSpeed() * SIM_DT;
    if (this.caught) return;
    // Rubber band: however fast you go, it is never far behind.
    this.avalancheX = Math.max(this.avalancheX, this.skier.x - this.tuning.avalancheMaxGap);
    if (this.avalancheX < this.skier.x) return;
    if (this.secondWind) {
      this.secondWind = false;
      this.avalancheX = this.skier.x - SECOND_WIND_PX;
      events.push({ type: 'secondWind', x: this.skier.x, y: this.skier.y });
    } else this.caught = true;
  }
}

