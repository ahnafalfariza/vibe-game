import type { SkierEvent } from './skier';
import type { MountKind } from './mounts';

// Trick scoring. Distance gives 1 point per metre (see Run.score); landings
// give trick points on top. Clean flips raise the multiplier, so a streak of
// clean flips snowballs. A sloppy landing or a crash wipes the streak — the
// risk that makes going for the extra flip a real decision.

type Landing = Extract<SkierEvent, { type: 'land' }>;

/** Air time that counts as "big air", s. */
export const BIG_AIR_TIME = 1.1;
const BIG_AIR_POINTS = 50;
const MAX_MULTIPLIER = 10;
/** Points for climbing aboard each mount (× the multiplier). */
export const MOUNT_POINTS: Record<MountKind, number> = { penguin: 100, eagle: 150, snowmobile: 150, bear: 200 };
/** Points for a polar bear smashing a rock or cabin (× the multiplier). */
export const SMASH_POINTS = 150;

export class Score {
  tricks = 0;
  multiplier = 1;

  /** Score one landing. Returns the points awarded (multiplier already applied). */
  land(e: Landing): number {
    if (e.quality === 'crash') {
      this.multiplier = 1;
      return 0;
    }
    if (e.quality === 'sloppy') {
      this.multiplier = 1;
      const points = 50 * e.flips;
      this.tricks += points;
      return points;
    }
    // 1 flip = 100, 2 = 300, 3 = 600: each extra flip is worth more than the last.
    let points = 50 * e.flips * (e.flips + 1);
    if (e.airTime >= BIG_AIR_TIME) points += BIG_AIR_POINTS;
    points *= this.multiplier;
    this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + e.flips);
    this.tricks += points;
    return points;
  }

  /** A bonus (mounting, smashing), × the multiplier. Returns the points awarded. */
  bonus(points: number): number {
    points *= this.multiplier;
    this.tricks += points;
    return points;
  }
}
