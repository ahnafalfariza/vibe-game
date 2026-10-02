import { Terrain } from './terrain';
import { Skier, type SkierEvent, type SkierInput } from './skier';
import { Spawner, type SpawnEvent } from './spawner';
import { Score } from './score';
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
}

/** Trick points awarded for a landing (pushed right after its 'land' event). */
export type RunEvent = SkierEvent | SpawnEvent | { type: 'award'; x: number; y: number; points: number; multiplier: number };

/** One run down the mountain: terrain + skier + avalanche + bookkeeping. No rendering. */
export class Run {
  readonly terrain: Terrain;
  /** Rocks, cabins, ice and coins; also the ground the skier rides on. */
  readonly spawner: Spawner;
  readonly skier: Skier;
  readonly startX = 0;
  time = 0;
  readonly stats: RunStats = { flips: 0, cleanLandings: 0, crashes: 0, bestAirTime: 0, topSpeed: 0, coins: 0, clusters: 0 };
  readonly scoring = new Score();
  /** Front edge of the avalanche, world x. */
  avalancheX: number;
  /** The avalanche reached the skier: the run is over and the skier stops. */
  caught = false;

  constructor(
    readonly seed: number,
    readonly tuning: Tuning,
    /** Without the avalanche the run never ends (the title-screen backdrop). */
    readonly avalanche = true,
    /** Rocks, cabins and ice. By default only in real runs: the demo run has no player to dodge them. */
    obstacles = avalanche,
  ) {
    this.terrain = new Terrain(seed, tuning);
    this.spawner = new Spawner(this.terrain, tuning, seed, obstacles, this.startX);
    this.skier = new Skier(this.spawner, tuning, this.startX);
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
    this.terrain.ensure(sk.x + GENERATE_AHEAD);
    this.spawner.update(sk.x);
    sk.step(SIM_DT, input, events as SkierEvent[]);
    this.spawner.collide(sk, events as (SkierEvent | SpawnEvent)[]);
    this.terrain.prune(sk.x - KEEP_BEHIND);
    this.spawner.prune(sk.x - KEEP_BEHIND);

    const st = this.stats;
    st.topSpeed = Math.max(st.topSpeed, sk.velocity);
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
        const points = this.scoring.land(e);
        if (points > 0) events.splice(++i, 0, { type: 'award', x: e.x, y: e.y, points, multiplier });
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
