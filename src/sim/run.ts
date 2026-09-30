import { Terrain } from './terrain';
import { Skier, type SkierEvent, type SkierInput } from './skier';
import type { Tuning } from '../tuning';

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
}

/** One run down the mountain: terrain + skier + bookkeeping. No rendering. */
export class Run {
  readonly terrain: Terrain;
  readonly skier: Skier;
  readonly startX = 0;
  time = 0;
  readonly stats: RunStats = { flips: 0, cleanLandings: 0, crashes: 0, bestAirTime: 0, topSpeed: 0 };

  constructor(
    readonly seed: number,
    readonly tuning: Tuning,
  ) {
    this.terrain = new Terrain(seed, tuning);
    this.skier = new Skier(this.terrain, tuning, this.startX);
  }

  /** Metres travelled horizontally. */
  distancePx(): number {
    return Math.max(0, this.skier.x - this.startX);
  }

  step(input: SkierInput, events: SkierEvent[]): void {
    const firstNew = events.length;
    this.terrain.ensure(this.skier.x + GENERATE_AHEAD);
    this.skier.step(SIM_DT, input, events);
    this.terrain.prune(this.skier.x - KEEP_BEHIND);
    this.time += SIM_DT;

    const st = this.stats;
    st.topSpeed = Math.max(st.topSpeed, this.skier.velocity);
    for (let i = firstNew; i < events.length; i++) {
      const e = events[i];
      if (e.type !== 'land') continue;
      st.bestAirTime = Math.max(st.bestAirTime, e.airTime);
      if (e.quality === 'crash') st.crashes++;
      else {
        st.flips += e.flips;
        if (e.quality === 'clean') st.cleanLandings++;
      }
    }
  }
}
