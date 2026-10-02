import type { Ground, Obstacle, Skier } from './skier';
import type { Tuning } from '../tuning';

// The Safari: animals (and a snowmobile) wait on the slope. Ride into one, or
// land on it, to climb aboard. The yeti rides on top of a small stack, bottom
// to top: [snowmobile?] [animal?] yeti. The eagle is different: it grabs the
// yeti, stack and all, and flies for a while.
//
// State machine (Mounts.state) and what boarding each kind does:
//   foot   + penguin/bear → riding [animal]
//   foot   + snowmobile   → riding [snowmobile]
//   riding + penguin/bear → fills the animal slot; an animal already there hops off and runs away
//   riding + snowmobile   → slides under the stack (an animal keeps riding, now on the
//                           snowmobile); one already there is swapped for the fresh one
//   foot / riding + eagle → carried, the stack comes along
//   carried → riding / foot when the flight time runs out (let go mid-air)
//   riding  → the snowmobile runs dry: hop off it, keeping any animal
//
// Shields: whatever would crash the yeti (a rock, a cabin wall, a crash
// landing) knocks the top of the stack off instead. A polar bear anywhere in
// the stack smashes rocks and cabins outright; only a crash landing costs it.
//
// Every mount changes the feel through tuning modifiers (MODIFIERS), applied to
// the one tuning object the Skier reads. Nothing in skier.ts knows about mounts.

export type MountKind = 'penguin' | 'eagle' | 'snowmobile' | 'bear';
/** What can be in the stack under the yeti. */
export type Ridden = Exclude<MountKind, 'eagle'>;
export type MountState = 'foot' | 'riding' | 'carried';

export const MOUNT_KINDS: readonly MountKind[] = ['penguin', 'eagle', 'snowmobile', 'bear'];

export const MOUNT_NAMES: Record<MountKind, string> = {
  penguin: 'Penguin',
  eagle: 'Eagle',
  snowmobile: 'Snowmobile',
  bear: 'Polar bear',
};

/** A mount waiting on the slope (Spawner.mounts). */
export interface WildMount {
  kind: MountKind;
  /** Where it was put: its idle wander starts here. */
  ax: number;
  /** Feet on the snow; for the eagle, the middle of its body. */
  x: number;
  y: number;
  /** Everything it can reach while idling, for pruning, px. */
  x0: number;
  x1: number;
  /** Idle clock, s. Starts when the skier comes near. */
  t: number;
  /** Ridden away: gone from the slope. */
  taken: boolean;
}

export type MountEvent =
  | { type: 'mount'; kind: MountKind; x: number; y: number }
  /**
   * Off the stack. rock / cabin / landing: knocked off, taking the hit for you.
   * swap: replaced by a fresh one (runs away). fuel: ran dry. release: the eagle let go.
   */
  | { type: 'dismount'; kind: MountKind; x: number; y: number; reason: Obstacle | 'landing' | 'swap' | 'fuel' | 'release' }
  /** A polar bear ploughed through an obstacle. */
  | { type: 'smash'; obstacle: Obstacle; x: number; y: number };

/**
 * Per kind: boarding reach (a circle `r` centred `up` above the feet), the
 * idle wander (`speed` px/s, at most `range` px downhill; the eagle circles
 * instead), and `lift`: how far up it raises whatever rides on it, px.
 */
export const MOUNTS: Record<MountKind, { r: number; up: number; speed: number; range: number; lift: number }> = {
  penguin: { r: 28, up: 15, speed: 120, range: 300, lift: 29 },
  eagle: { r: 44, up: 0, speed: 0, range: 0, lift: 0 },
  snowmobile: { r: 40, up: 24, speed: 0, range: 0, lift: 38 },
  bear: { r: 42, up: 36, speed: 60, range: 180, lift: 66 },
};

/** The eagle circles this high above the snow (middle of its body): in reach of a jump, not of a rider, px. */
export const EAGLE_HOVER = 200;
/** …in a loop this wide and tall, px, at this rate, rad/s. */
const EAGLE_LOOP_X = 70;
const EAGLE_LOOP_Y = 22;
const EAGLE_LOOP_RATE = 1.6;
/** Idle mounts start moving when the skier is this close, px (about when they come into view). */
const WAKE = 2200;

/** How each ridden mount changes the feel. Several apply at once (a penguin on a snowmobile). */
const MODIFIERS: Record<Ridden, (t: Tuning) => void> = {
  penguin: (t) => {
    t.groundDrag *= t.penguinDrag;
    t.flipSpeed *= t.penguinFlip;
    t.flipAccel *= t.penguinFlip;
    t.airDrag *= t.penguinAirDrag;
    t.fallGravity *= t.penguinFallGravity;
  },
  snowmobile: (t) => {
    t.minSpeed = Math.max(t.minSpeed, t.snowmobileMinSpeed);
    t.maxSpeed *= t.snowmobileTopSpeed;
    t.thrust += t.snowmobileThrust;
    t.flipSpeed *= t.snowmobileFlip;
    t.flipAccel *= t.snowmobileFlip;
  },
  bear: (t) => {
    t.groundFriction *= t.bearFriction;
    t.jumpImpulse *= t.bearJump;
  },
};

/** `base` with the modifiers of everything in `stack` applied, written into `out`. */
export function effectiveTuning(base: Readonly<Tuning>, stack: readonly Ridden[], out: Tuning): Tuning {
  Object.assign(out, base);
  for (const kind of stack) MODIFIERS[kind](out);
  return out;
}

/** A fresh mount waiting at `x`. */
export function wildMount(kind: MountKind, x: number, ground: Ground): WildMount {
  const s = MOUNTS[kind];
  const reach = Math.max(s.r, EAGLE_LOOP_X + s.r);
  const m: WildMount = { kind, ax: x, x, y: 0, x0: x - reach, x1: x + s.range + reach, t: 0, taken: false };
  wander(m, ground);
  return m;
}

/** Put an idle mount where its clock says: the penguin belly-slides and the bear lumbers downhill a way, the eagle circles. */
function wander(m: WildMount, ground: Ground): void {
  if (m.kind === 'eagle') {
    const a = m.t * EAGLE_LOOP_RATE;
    m.x = m.ax + Math.sin(a) * EAGLE_LOOP_X;
    m.y = ground.height(m.x) - EAGLE_HOVER + Math.cos(a) * EAGLE_LOOP_Y;
    return;
  }
  const s = MOUNTS[m.kind];
  m.x = m.ax + Math.min(s.range, s.speed * m.t);
  m.y = ground.height(m.x);
}

export class Mounts {
  /** Under the yeti, bottom to top. */
  readonly stack: Ridden[] = [];
  /** Flight left while an eagle carries you, s. */
  eagleTime = 0;
  /** Snowmobile fuel left, s. */
  fuel = 0;
  /** What the skier reads: the base tuning plus the stack's modifiers. */
  readonly tuning: Tuning;
  /** Events raised mid-step by the skier's guard, handed out by the next step(). */
  private readonly pending: MountEvent[] = [];

  constructor(private readonly base: Readonly<Tuning>) {
    this.tuning = { ...base };
  }

  get state(): MountState {
    return this.eagleTime > 0 ? 'carried' : this.stack.length > 0 ? 'riding' : 'foot';
  }

  get top(): Ridden | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** How far up the stack the yeti rides, px. */
  get lift(): number {
    return this.stack.reduce((sum, kind) => sum + MOUNTS[kind].lift, 0);
  }

  /** Climb aboard `kind` (or get grabbed, for an eagle). */
  board(kind: MountKind, skier: Skier, events: MountEvent[]): void {
    const at = { x: skier.x, y: skier.y };
    if (kind === 'eagle') {
      this.eagleTime = this.base.eagleTime;
      skier.grab();
    } else if (kind === 'snowmobile') {
      if (this.stack[0] === 'snowmobile') events.push({ type: 'dismount', kind, ...at, reason: 'swap' });
      else this.stack.unshift(kind);
      this.fuel = this.base.snowmobileFuel;
    } else {
      if (this.top !== undefined && this.top !== 'snowmobile') events.push({ type: 'dismount', kind: this.stack.pop()!, ...at, reason: 'swap' });
      this.stack.push(kind);
    }
    events.push({ type: 'mount', kind, ...at });
    this.sync();
    skier.lift = this.lift;
  }

  /** The skier's guard: a mount takes the hit, or (a polar bear) smashes the obstacle. */
  absorb(cause: Obstacle | 'landing', skier: Skier): 'shield' | 'smash' | null {
    const at = { x: skier.x, y: skier.y };
    if (cause !== 'landing' && this.stack.includes('bear')) {
      this.pending.push({ type: 'smash', obstacle: cause, ...at });
      return 'smash';
    }
    const lost = this.stack.pop();
    if (!lost) return null;
    if (lost === 'snowmobile') this.fuel = 0;
    this.pending.push({ type: 'dismount', kind: lost, ...at, reason: cause });
    this.sync();
    return 'shield';
  }

  /**
   * After the skier's step: hand out the guard's events, run the eagle and
   * fuel timers, let idle mounts wander, and board any the skier touches.
   */
  step(dt: number, skier: Skier, wild: readonly WildMount[], ground: Ground, events: MountEvent[]): void {
    events.push(...this.pending);
    this.pending.length = 0;
    const at = () => ({ x: skier.x, y: skier.y });

    if (this.eagleTime > 0) {
      this.eagleTime -= dt;
      if (this.eagleTime <= 0) {
        this.eagleTime = 0;
        skier.letGo();
        events.push({ type: 'dismount', kind: 'eagle', ...at(), reason: 'release' });
      }
    } else if (this.stack[0] === 'snowmobile') {
      // The engine only burns fuel while it's doing the work.
      this.fuel -= dt;
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.stack.shift();
        events.push({ type: 'dismount', kind: 'snowmobile', ...at(), reason: 'fuel' });
      }
    }

    for (const m of wild) {
      if (m.taken) continue;
      if (m.t > 0 || m.x - skier.x < WAKE) {
        m.t += dt;
        wander(m, ground);
      }
      if (skier.mode === 'crash' || skier.carried || Math.abs(m.x - skier.x) > 200) continue;
      // Only a jump reaches an eagle: a tall stack riding underneath doesn't.
      if (m.kind === 'eagle' && skier.mode !== 'air') continue;
      const s = MOUNTS[m.kind];
      if (skier.touches(m.x, m.y - s.up, s.r)) {
        m.taken = true;
        this.board(m.kind, skier, events);
      }
    }
    this.sync();
    skier.lift = this.lift;
  }

  /** Re-derive the skier's tuning: the base can change live (tuning panel). */
  sync(): void {
    effectiveTuning(this.base, this.stack, this.tuning);
  }
}
