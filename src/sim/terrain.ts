import { Rng } from './rng';
import type { Tuning } from '../tuning';

// The mountain is a height field y = h(x) (screen coordinates: y grows
// downward, so "downhill" means h increases with x).
//
// Rather than raw noise, the slope is stitched together from hand-shaped
// templates (rollers, kickers, drops...) chosen at random. Knots carry a
// position AND a gradient, and are joined with cubic Hermite curves, so the
// surface is C1-continuous: no kinks for the skier to snag on. Every template
// starts and ends on an invisible "trend line" that always descends, which
// guarantees the mountain keeps going down however templates are combined.

export interface Knot {
  x: number;
  y: number;
  /** Gradient dy/dx at this knot. */
  m: number;
}

export interface TerrainSample {
  y: number;
  /** First derivative dy/dx. */
  dy: number;
  /** Second derivative d²y/dx². Positive on crests (y-down coordinates). */
  ddy: number;
  /** Slick ice underfoot (set by the spawner's ground overlay, never by Terrain). */
  ice?: boolean;
}

export type FeatureKind = 'start' | 'cruise' | 'rollers' | 'kicker' | 'drop' | 'bowl' | 'booter';

export interface Feature {
  kind: FeatureKind;
  x0: number;
  x1: number;
}

/** One template step: advance `dx`, sit `offset` px below the trend line, with gradient trend + `mRel`. */
type Step = [dx: number, offset: number, mRel: number];

type Template = (r: Rng, difficulty: number, slope: number) => Step[];

const TEMPLATES: Record<Exclude<FeatureKind, 'start'>, Template> = {
  // A long, even run: a breather that lets speed build.
  cruise: (r) => [[r.range(500, 1000), 0, 0]],

  // Rolling bumps. Big enough ones launch you at speed.
  rollers: (r, d) => {
    const n = r.int(2, 4);
    const w = r.range(460, 720);
    const a = r.range(40, 75) * (1 + 0.5 * d);
    const steps: Step[] = [];
    for (let i = 0; i < n; i++) {
      steps.push([w / 2, -a, 0], [w / 2, a * 0.35, 0]);
    }
    steps.push([w / 2, 0, 0]);
    return steps;
  },

  // Short steep ramp to a lip, then a landing hill that falls away. Little
  // climbing, so you keep your speed; most of the air comes from the drop.
  kicker: (r, d) => {
    const lip = r.range(40, 70) * (1 + 0.5 * d);
    const land = r.range(150, 260) * (1 + 0.5 * d);
    return [
      [r.range(300, 450), 50, 0.2],
      [r.range(130, 180), -lip, -0.95 - 0.2 * d],
      [60, -lip + 15, 0.8],
      [r.range(600, 850), land, 0.7],
      [r.range(600, 900), 0, 0],
    ];
  },

  // A flat shelf that ends in a steep face: you sail off the edge.
  drop: (r, d, slope) => {
    const h = r.range(200, 340) * (1 + 0.5 * d);
    return [
      [r.range(480, 680), -h, -slope],
      [60, -h + 20, 0.6],
      [r.range(380, 500), h * 0.5, 1.2],
      [r.range(420, 560), 0, 0.1],
      [r.range(500, 800), 0, 0],
    ];
  },

  // Down into a hollow and back up: carry momentum through, pop off the rim.
  bowl: (r, d) => {
    const depth = r.range(110, 190) * (1 + 0.4 * d);
    const w = r.range(700, 1000);
    return [
      [w * 0.45, depth, 0],
      [w * 0.45, -depth * 0.35, -0.6],
      [80, -depth * 0.25, 0.6],
      [420, 0, 0],
    ];
  },

  // The big one: fast run-in, steep kicker, long landing far below.
  booter: (r, d) => {
    const lip = r.range(60, 90) * (1 + 0.5 * d);
    const land = r.range(320, 460) * (1 + 0.5 * d);
    return [
      [700, 80, 0.45],
      [180, -lip, -1.15],
      [60, -lip + 15, 0.8],
      [r.range(1100, 1500), land, 0.95],
      [r.range(900, 1200), 0, 0],
    ];
  },
};

const BASE_WEIGHTS: Record<Exclude<FeatureKind, 'start'>, number> = {
  cruise: 1.5,
  rollers: 3,
  kicker: 2.5,
  drop: 1.5,
  bowl: 2,
  booter: 1,
};

/** Distance (px) over which difficulty ramps from 0 to 1. */
export const DIFFICULTY_RAMP = 60000;

export class Terrain {
  readonly features: Feature[] = [];
  private readonly rng: Rng;
  private knots: Knot[] = [];
  /** Trend-line y at the last knot. */
  private trendY = 0;
  private lastKind: FeatureKind = 'start';
  /** Cached segment index: queries are mostly for nearby, increasing x. */
  private cursor = 0;

  constructor(
    readonly seed: number,
    private readonly tuning: Pick<Tuning, 'mountainSlope'>,
    startX = -2400,
  ) {
    this.rng = new Rng(seed);
    const s = this.tuning.mountainSlope;
    this.trendY = startX * s;
    this.knots.push({ x: startX, y: this.trendY, m: s });
    // A plain run-up so the first seconds are predictable.
    this.append('start', [[-startX + 700, 0, 0]]);
  }

  get startX(): number {
    return this.knots[0].x;
  }

  get endX(): number {
    return this.knots[this.knots.length - 1].x;
  }

  /** Generate terrain until it reaches at least `x`. */
  ensure(x: number): void {
    while (this.endX < x) this.appendRandom();
  }

  /** Forget knots entirely left of `x` to keep memory flat on long runs. */
  prune(x: number): void {
    let drop = 0;
    while (drop < this.knots.length - 2 && this.knots[drop + 1].x < x) drop++;
    if (drop > 0) {
      this.knots.splice(0, drop);
      this.cursor = Math.max(0, this.cursor - drop);
    }
    while (this.features.length > 1 && this.features[0].x1 < x) this.features.shift();
  }

  height(x: number): number {
    return this.sample(x).y;
  }

  sample(x: number): TerrainSample {
    if (x >= this.endX) this.ensure(x + 1);
    const k = this.knots;
    if (x <= k[0].x) {
      // Extrapolate along the first knot's tangent.
      return { y: k[0].y + (x - k[0].x) * k[0].m, dy: k[0].m, ddy: 0 };
    }
    const i = this.segmentIndex(x);
    const a = k[i];
    const b = k[i + 1];
    const w = b.x - a.x;
    const t = (x - a.x) / w;
    const t2 = t * t;
    const t3 = t2 * t;
    const ma = a.m * w;
    const mb = b.m * w;
    const y = (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * mb;
    const dy = ((6 * t2 - 6 * t) * a.y + (3 * t2 - 4 * t + 1) * ma + (-6 * t2 + 6 * t) * b.y + (3 * t2 - 2 * t) * mb) / w;
    const ddy = ((12 * t - 6) * a.y + (6 * t - 4) * ma + (-12 * t + 6) * b.y + (6 * t - 2) * mb) / (w * w);
    return { y, dy, ddy };
  }

  /** Which template is under `x` (for debugging). */
  featureAt(x: number): Feature | undefined {
    return this.features.find((f) => x >= f.x0 && x < f.x1);
  }

  private segmentIndex(x: number): number {
    const k = this.knots;
    let i = Math.min(this.cursor, k.length - 2);
    if (k[i].x <= x && x < k[i + 1].x) return i;
    // Short hop forward covers the common case of the skier moving right.
    if (x >= k[i + 1].x && i + 2 < k.length && x < k[i + 2].x) {
      this.cursor = i + 1;
      return i + 1;
    }
    let lo = 0;
    let hi = k.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (k[mid].x <= x) lo = mid;
      else hi = mid - 1;
    }
    this.cursor = lo;
    return lo;
  }

  private appendRandom(): void {
    const difficulty = Math.min(1, Math.max(0, this.endX / DIFFICULTY_RAMP));
    const weights = { ...BASE_WEIGHTS };
    weights.kicker += difficulty;
    weights.drop += difficulty;
    weights.booter += difficulty;
    if (this.lastKind !== 'start') weights[this.lastKind] *= 0.25;
    const kind = this.rng.weighted(weights);
    this.append(kind, TEMPLATES[kind](this.rng, difficulty, this.tuning.mountainSlope));
  }

  private append(kind: FeatureKind, steps: Step[]): void {
    const slope = this.tuning.mountainSlope;
    const x0 = this.endX;
    for (const [dx, offset, mRel] of steps) {
      this.trendY += slope * dx;
      this.knots.push({ x: this.endX + dx, y: this.trendY + offset, m: slope + mRel });
    }
    this.features.push({ kind, x0, x1: this.endX });
    this.lastKind = kind;
  }
}
