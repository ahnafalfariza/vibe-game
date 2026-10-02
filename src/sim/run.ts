import { Terrain } from './terrain';
import { Skier, type SkierEvent, type SkierInput } from './skier';
import { Spawner, type SpawnEvent, type SpawnTable } from './spawner';
import { Mounts, type MountEvent, type MountKind } from './mounts';
import { MOUNT_POINTS, SMASH_POINTS, Score } from './score';
import { PX_PER_METRE, type Tuning } from '../tuning';

/** Fixed simulation step. Rendering interpolates between steps. */
export const SIM_DT = 1 / 120;

/** How far ahead of the skier terrain is generated, px. */
const GENERATE_AHEAD = 6000;
/** How far behind the skier terrain is kept, px. */
const KEEP_BEHIND = 4000;

export interface RunStats {
  flips: number;
  cleanLandings: number;
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
}

export interface RunOptions {
  /** Without the avalanche the run never ends (the title-screen backdrop). Default on. */
  avalanche?: boolean;
  /** Rocks, cabins, ice and mounts. Default: only with the avalanche (the demo run has no player to dodge them). */
  obstacles?: boolean;
  /** Start the run already riding this (rank perks, the shop, ?mount=). */
  startMount?: MountKind;
  /** What goes on the slope (a biome's spawn table). Default: the alpine one. */
  table?: SpawnTable;
}

/** Points awarded for a landing, mount or smash (pushed right after its event). */
export type RunEvent =
  | SkierEvent
  | SpawnEvent
  | MountEvent
  | { type: 'award'; x: number; y: number; points: number; multiplier: number };

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
  time = 0;
  readonly stats: RunStats = {
    flips: 0,
    cleanLandings: 0,
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
  };
  readonly scoring = new Score();
  /** Front edge of the avalanche, world x. */
  avalancheX: number;
  /** The avalanche reached the skier: the run is over and the skier stops. */
  caught = false;

  constructor(
    readonly seed: number,
    readonly tuning: Tuning,
    { avalanche = true, obstacles = avalanche, startMount, table }: RunOptions = {},
  ) {
    this.avalanche = avalanche;
    this.terrain = new Terrain(seed, tuning);
    this.spawner = new Spawner(this.terrain, tuning, seed, obstacles, this.startX, table);
    this.mounts = new Mounts(tuning);
    this.skier = new Skier(this.spawner, this.mounts.tuning, this.startX);
    this.skier.guard = (cause) => this.mounts.absorb(cause, this.skier);
    if (startMount) this.mounts.board(startMount, this.skier, []);
    this.avalancheX = this.startX - tuning.avalancheStartGap;
  }

  /** Metres travelled horizontally. */
  distancePx(): number {
    return Math.max(0, this.skier.x - this.startX);
  }

  /** 1 point per metre plus trick points. */
  get score(): number {
    return Math.floor(this.distancePx() / PX_PER_METRE) + this.scoring.tricks;
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
    if (this.avalanche) this.stepAvalanche();
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
          this.scoring.multiplier = 1;
        }
      } else if (e.type === 'land') {
        st.bestAirTime = Math.max(st.bestAirTime, e.airTime);
        if (e.quality === 'crash') st.crashes++;
        else {
          st.flips += e.flips;
          if (e.quality === 'clean') st.cleanLandings++;
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
        this.scoring.multiplier = 1;
      }
    }
  }

  private stepAvalanche(): void {
    this.avalancheX += this.avalancheSpeed() * SIM_DT;
    if (this.caught) return;
    // Rubber band: however fast you go, it is never far behind.
    this.avalancheX = Math.max(this.avalancheX, this.skier.x - this.tuning.avalancheMaxGap);
    if (this.avalancheX >= this.skier.x) this.caught = true;
  }
}

