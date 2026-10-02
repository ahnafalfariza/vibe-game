import type { TerrainSample } from './terrain';
import type { Tuning } from '../tuning';

/** What the skier rides on. Terrain satisfies it; the spawner adds cabin roofs and ice on top. */
export interface Ground {
  sample(x: number): TerrainSample;
  height(x: number): number;
}

export type Obstacle = 'rock' | 'cabin';

/**
 * Asked just before a crash takes effect (`cause`: an obstacle, or a crash
 * landing). 'shield': a mount takes the hit instead and you ride on.
 * 'smash': a mount ploughs straight through the obstacle. null: crash.
 * The mount system (sim/mounts.ts) supplies it; the skier knows nothing of mounts.
 */
export type Guard = (cause: Obstacle | 'landing') => 'shield' | 'smash' | null;

// Custom skier physics — deliberately NOT a rigid-body engine. The terrain is
// a height field, so the skier is either:
//   • on the ground: a bead sliding along the curve (speed along the tangent),
//   • in the air: a projectile with player-controlled rotation,
//   • crashed: tumbling along the ground for a moment.
// Landing compares body angle with slope angle. Everything is deterministic
// for a given seed + input sequence.
//
// Angles follow screen conventions (y down): 0 = level, positive = nose down
// (clockwise). A backflip is a rotation in the negative direction.

export type SkierMode = 'ground' | 'air' | 'crash';
export type LandingQuality = 'clean' | 'sloppy' | 'crash';

export type SkierEvent =
  | { type: 'jump'; x: number; y: number }
  | { type: 'takeoff'; x: number; y: number }
  | {
      type: 'land';
      x: number;
      y: number;
      quality: LandingQuality;
      flips: number;
      airTime: number;
      /** Angle between body and slope at touchdown, degrees. */
      errorDeg: number;
      /** A crash landing a mount took instead (reported as sloppy, no flips). */
      saved?: 'shield';
    }
  | { type: 'recover'; x: number; y: number }
  /**
   * Ran into an obstacle. `crashed` is false if already tumbling, still
   * invulnerable, or `saved` by a mount (a cabin still smashes).
   */
  | { type: 'hit'; x: number; y: number; obstacle: Obstacle; crashed: boolean; saved?: 'shield' | 'smash' };

export interface SkierInput {
  /** Button is currently down. */
  held: boolean;
  /** Button went down since the previous step. */
  pressed: boolean;
}

export const TAU = Math.PI * 2;

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function approach(v: number, target: number, maxDelta: number): number {
  return v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
}

/**
 * How much higher the ground at `next` is than at the previous point (height
 * `prevY`, `dx` back), beyond what its slope explains. ~0 on smooth ground at
 * any speed; about the wall height when crossing into a cabin.
 */
function stepUp(prevY: number, next: TerrainSample, dx: number): number {
  return prevY - (next.y - next.dy * dx);
}

/** How much a jump points straight up vs. along the slope normal (0 = normal, 1 = up). */
const JUMP_UP_BLEND = 0.5;
/** Below this height the landing assist aims for the slope instead of the travel direction, px. */
const ASSIST_GROUND_HEIGHT = 220;
/** Rotation the player must input before the assist stops being unconditional, rad. */
const PLAYER_SPUN_RAD = 0.35;
/** Friction multiplier while tumbling. */
const CRASH_FRICTION = 4;
/**
 * A step up in the ground bigger than this (beyond what the slope explains) is
 * a wall: a cabin side. Smooth terrain never comes close, px.
 */
const WALL_STEP = 30;
/** Clipping a roof edge by this much (plus one step of fall) still lands on it, px. */
const EDGE_GRAB = 10;
/** Carried flight keeps the feet between these heights above the ground, px. */
const FLY_FLOOR = 110;
const FLY_CEILING = 520;
/** How quickly carried flight changes vertical speed, px/s². */
const FLY_VY_ACCEL = 2600;
/** How quickly carried flight eases to its cruising speed, px/s². */
const FLY_VX_ACCEL = 900;
/** Body tilt while carried, at most, rad. */
const FLY_TILT = 0.35;

/**
 * Body hitbox for obstacle and coin overlap: circles along the body, measured
 * up from the feet. The yeti is ~40 px wide and ~75 px tall above the feet.
 */
export const BODY: readonly { up: number; r: number }[] = [
  { up: 20, r: 20 },
  { up: 55, r: 20 },
];

export class Skier {
  mode: SkierMode = 'ground';
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  /** Speed along the slope while on the ground. */
  speed: number;
  angle = 0;
  angVel = 0;
  /** Time since leaving the ground. */
  airTime = 0;
  /** Rotation from player input since leaving the ground (negative = backwards). */
  airRotation = 0;
  crashTimer = 0;
  /** Obstacles can't knock you down while this runs (just after getting up). */
  invulnTimer = 0;
  /**
   * Held aloft (by an eagle): in the air, but hold climbs and release glides
   * instead of flipping, and nothing can knock you down. See grab() / letGo().
   */
  carried = false;
  /** Decides whether a would-be crash is a crash. Null: always is. */
  guard: Guard | null = null;
  /**
   * Riding this far above the snow (on mounts), px. The body hitbox rides up
   * with it, and a block underneath stands in for whatever you're riding.
   */
  lift = 0;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpedThisAir = false;
  /** Ignore a hold carried over from flying until the button is let go once. */
  private holdLatch = false;

  constructor(
    private readonly ground: Ground,
    /** Read every step, so it can be swapped for one with mount modifiers applied. */
    public tuning: Tuning,
    x = 0,
  ) {
    const s = ground.sample(x);
    this.x = x;
    this.y = s.y;
    this.angle = Math.atan(s.dy);
    this.speed = tuning.minSpeed;
  }

  get grounded(): boolean {
    return this.mode !== 'air';
  }

  /** Magnitude of velocity, px/s. */
  get velocity(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Can an obstacle knock you down right now? */
  get vulnerable(): boolean {
    return this.mode !== 'crash' && this.invulnTimer <= 0 && !this.carried;
  }

  /** Height of the feet above the snow (or roof) directly below, px. */
  heightAboveGround(): number {
    return Math.max(0, this.ground.height(this.x) - this.y);
  }

  /** Does a circle at (x, y) with radius r overlap the body hitbox? */
  touches(x: number, y: number, r: number): boolean {
    const ux = Math.sin(this.angle);
    const uy = -Math.cos(this.angle);
    const hit = (up: number, cr: number) => {
      const dx = this.x + ux * up - x;
      const dy = this.y + uy * up - y;
      return dx * dx + dy * dy < (cr + r) * (cr + r);
    };
    for (const c of BODY) if (hit(c.up + this.lift, c.r)) return true;
    return this.lift > 0 && hit(this.lift / 2, Math.max(BODY[0].r, this.lift / 2));
  }

  /**
   * Run into an obstacle: the same tumble as a crash landing, unless already
   * tumbling or invulnerable, or the guard saves you. `x` is where it
   * happened (defaults to here). Returns how a mount saved you, if one did.
   */
  hit(obstacle: Obstacle, events: SkierEvent[], x = this.x): 'shield' | 'smash' | null {
    const t = this.tuning;
    const saved = this.vulnerable ? (this.guard?.(obstacle) ?? null) : null;
    const crashed = this.vulnerable && !saved;
    if (saved) {
      // Ride on, a bit slower; after losing a shield, a moment to recover.
      const keep = saved === 'shield' ? t.sloppySpeedKeep : t.smashSpeedKeep;
      if (this.mode === 'air') {
        this.vx *= keep;
        this.vy *= keep;
      } else this.speed = clamp(this.speed * keep, t.minSpeed, t.maxSpeed);
      if (saved === 'shield') this.invulnTimer = t.hitInvulnTime;
    } else if (crashed) {
      if (this.mode === 'air') {
        // Knocked out of the air: drop onto the snow, keeping the along-slope speed.
        const s = this.ground.sample(this.x);
        const inv = 1 / Math.sqrt(1 + s.dy * s.dy);
        this.speed = this.vx * inv + this.vy * s.dy * inv;
        this.y = s.y;
        this.angle = Math.atan(s.dy);
      }
      this.speed = clamp(this.speed * t.crashSpeedKeep, t.minSpeed, t.maxSpeed);
      this.mode = 'crash';
      this.crashTimer = t.crashDuration;
      this.jumpBufferTimer = 0;
      this.angVel = 0;
    }
    events.push(saved ? { type: 'hit', x, y: this.y, obstacle, crashed, saved } : { type: 'hit', x, y: this.y, obstacle, crashed });
    return saved;
  }

  /** Picked up by an eagle: carried flight until letGo(). */
  grab(): void {
    if (this.mode !== 'air') this.leaveGround(this.x, this.y, this.vx, this.vy);
    this.mode = 'air';
    this.carried = true;
    this.angVel = 0;
    this.airRotation = 0;
    this.jumpBufferTimer = 0;
    this.crashTimer = 0;
  }

  /** Dropped mid-air, level and with a fresh air time: flips count from here. */
  letGo(): void {
    this.carried = false;
    this.airTime = 0;
    this.airRotation = 0;
    this.angVel = 0;
    this.jumpedThisAir = true;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.holdLatch = true;
  }

  /** A burst of speed along the direction of travel (coin cluster bonus), px/s. */
  boost(amount: number): void {
    const max = this.tuning.maxSpeed;
    if (this.mode !== 'air') {
      this.speed = Math.min(max, this.speed + amount);
      return;
    }
    const v = this.velocity;
    const k = v > 0 ? Math.min(max, v + amount) / v : 1;
    this.vx *= k;
    this.vy *= k;
  }

  step(dt: number, input: SkierInput, events: SkierEvent[]): void {
    this.invulnTimer -= dt;
    if (this.holdLatch) {
      if (input.held) input = { held: false, pressed: input.pressed };
      else this.holdLatch = false;
    }
    if (this.carried) this.stepCarried(dt, input);
    else if (this.mode === 'air') this.stepAir(dt, input, events);
    else this.stepGround(dt, input, events);
  }

  /**
   * Carried flight: cruise at the carrier's speed; hold to climb, let go to
   * glide down, relative to the mountainside. Stays between FLY_FLOOR and
   * FLY_CEILING above the ground, and never lands.
   */
  private stepCarried(dt: number, input: SkierInput): void {
    const t = this.tuning;
    this.vx = approach(this.vx, t.eagleSpeed, FLY_VX_ACCEL * dt);
    const s = this.ground.sample(this.x);
    // Follow the mountain's general fall line, not every bump.
    const trend = this.vx * t.mountainSlope;
    this.vy = approach(this.vy, trend + (input.held ? -t.eagleClimb : t.eagleSink), FLY_VY_ACCEL * dt);
    // Soft floor and ceiling: steer back within a fraction of a second.
    const h = s.y - this.y;
    const groundVy = s.dy * this.vx;
    if (h < FLY_FLOOR) this.vy = Math.min(this.vy, groundVy - (FLY_FLOOR - h) * 8);
    if (h > FLY_CEILING) this.vy = Math.max(this.vy, groundVy + (h - FLY_CEILING) * 8);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Lean into the climb or the glide, gently.
    const tilt = clamp(Math.atan2(this.vy - trend, this.vx), -FLY_TILT, FLY_TILT);
    this.angle += wrapAngle(tilt - this.angle) * Math.min(1, 6 * dt);
    this.angVel = 0;
    this.airTime += dt;
  }

  private stepGround(dt: number, input: SkierInput, events: SkierEvent[]): void {
    const t = this.tuning;
    const crashed = this.mode === 'crash';
    const s = this.ground.sample(this.x);
    const inv = 1 / Math.sqrt(1 + s.dy * s.dy);
    const tx = inv;
    const ty = s.dy * inv;

    // Gravity along the slope, minus snow friction and drag. Ice is slick on both counts.
    const friction = (s.ice ? t.iceFriction : t.groundFriction) * (crashed ? CRASH_FRICTION : 1);
    const drag = t.groundDrag * (s.ice ? t.iceDrag : 1);
    const accel = t.gravity * ty - friction * t.gravity * inv - drag * this.speed * Math.abs(this.speed) + t.thrust;
    this.speed = clamp(this.speed + accel * dt, t.minSpeed, t.maxSpeed);

    if (crashed) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        this.mode = 'ground';
        this.crashTimer = 0;
        this.invulnTimer = t.hitInvulnTime;
        events.push({ type: 'recover', x: this.x, y: this.y });
      }
    } else {
      this.jumpBufferTimer -= dt;
      if (input.pressed || this.jumpBufferTimer > 0) {
        this.jump(s, events);
        return;
      }
    }

    const vx = this.speed * tx;
    const vy = this.speed * ty;
    const nx = this.x + vx * dt;
    const next = this.ground.sample(nx);

    // Ran into a wall (a cabin side): stop short of it and crash.
    if (stepUp(this.y, next, nx - this.x) > WALL_STEP) {
      this.hit('cabin', events, nx);
      return;
    }

    // If a free-falling body would end up above the snow, the ground has
    // dropped away faster than gravity can follow: launch. groundStick adds a
    // little extra "downforce" so small bumps don't make you hop. A tumbling
    // skier stays glued to the snow, except off a sheer drop like a roof end.
    const ballisticY = this.y + vy * dt + 0.5 * t.gravity * dt * dt;
    if ((!crashed || next.y - this.y > WALL_STEP) && next.y > ballisticY + 0.5 * t.groundStick * dt * dt) {
      this.leaveGround(nx, ballisticY, vx, vy);
      this.coyoteTimer = t.coyoteTime;
      events.push({ type: 'takeoff', x: this.x, y: this.y });
      return;
    }

    this.x = nx;
    this.y = next.y;
    this.vx = vx;
    this.vy = vy;
    this.angle = Math.atan(next.dy);
    this.angVel = 0;
  }

  private stepAir(dt: number, input: SkierInput, events: SkierEvent[]): void {
    const t = this.tuning;

    if (input.pressed) {
      if (this.coyoteTimer > 0 && !this.jumpedThisAir) {
        // Late jump just after rolling off a lip.
        this.vy = Math.min(this.vy, 0) - t.jumpImpulse;
        this.jumpedThisAir = true;
        events.push({ type: 'jump', x: this.x, y: this.y });
      } else {
        this.jumpBufferTimer = t.jumpBuffer;
      }
    }
    this.coyoteTimer -= dt;
    this.jumpBufferTimer -= dt;

    this.vy += t.gravity * (this.vy > 0 ? t.fallGravity : 1) * dt;
    const drag = Math.max(0, 1 - t.airDrag * this.velocity * dt);
    this.vx *= drag;
    this.vy *= drag;
    const ox = this.x;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (input.held) {
      this.angVel = approach(this.angVel, -t.flipSpeed, t.flipAccel * dt);
    } else {
      this.angVel *= Math.exp(-t.spinDamping * dt);
      // Landing assist: ease toward the travel direction, or toward the slope
      // about to be landed on when close to the snow. Only kicks in near the
      // safe angle, so a botched flip still crashes.
      const ahead = this.ground.sample(this.x + this.vx * 0.08);
      const target =
        ahead.y - this.y < ASSIST_GROUND_HEIGHT ? Math.atan(ahead.dy) : Math.atan2(this.vy, this.vx);
      const error = wrapAngle(target - this.angle);
      // If the player hasn't rotated, always help: you should never crash
      // without doing anything. Once they flip, landing is on them.
      const playerSpun = Math.abs(this.airRotation) > PLAYER_SPUN_RAD;
      if (!playerSpun || Math.abs(error) < (t.landingAssistDeg * Math.PI) / 180) {
        const rate = playerSpun ? t.landingAssist : t.landingAssist * 2;
        this.angle += error * Math.min(1, rate * dt);
      }
    }
    this.angle += this.angVel * dt;
    this.airRotation += this.angVel * dt;
    this.airTime += dt;

    const ground = this.ground.sample(this.x);
    if (this.y >= ground.y) {
      // Crossed into a cabin below its roof: that's the wall, not a teleport
      // onto the roof. Clipping the edge by a hair still counts as landing.
      const below = this.y - ground.y;
      if (below > Math.max(0, this.vy) * dt + EDGE_GRAB && stepUp(this.ground.height(ox), ground, this.x - ox) > WALL_STEP) {
        const wallX = this.x;
        this.x = ox;
        this.hit('cabin', events, wallX);
        // Invulnerable: the cabin smashes and you fly on through.
      } else this.land(ground, events);
    }
  }

  private land(s: TerrainSample, events: SkierEvent[]): void {
    const t = this.tuning;
    const slopeAngle = Math.atan(s.dy);
    const errorDeg = (Math.abs(wrapAngle(this.angle - slopeAngle)) * 180) / Math.PI;
    const inv = 1 / Math.sqrt(1 + s.dy * s.dy);
    // Keep only the part of the velocity that runs along the slope.
    const along = this.vx * inv + this.vy * s.dy * inv;

    let quality: LandingQuality =
      errorDeg <= t.cleanLandingDeg ? 'clean' : errorDeg <= t.crashLandingDeg ? 'sloppy' : 'crash';
    // A mount can take a crash landing for you: then it's merely sloppy, and no flips count.
    const saved = quality === 'crash' && this.guard?.('landing') === 'shield';
    const flips = quality === 'crash' ? 0 : Math.max(0, Math.round(-this.airRotation / TAU));
    if (saved) {
      quality = 'sloppy';
      this.invulnTimer = t.hitInvulnTime;
    }

    let speed = along;
    if (quality === 'clean') speed += t.flipBoost * flips;
    else if (quality === 'sloppy') speed *= t.sloppySpeedKeep;
    else speed *= t.crashSpeedKeep;

    this.speed = clamp(speed, t.minSpeed, t.maxSpeed);
    this.y = s.y;
    this.angVel = 0;
    this.mode = quality === 'crash' ? 'crash' : 'ground';
    if (quality === 'crash') {
      this.crashTimer = t.crashDuration;
      this.jumpBufferTimer = 0;
    } else {
      this.angle = slopeAngle;
    }
    const e = { type: 'land', x: this.x, y: this.y, quality, flips, airTime: this.airTime, errorDeg } as const;
    events.push(saved ? { ...e, saved: 'shield' } : e);
  }

  private jump(s: TerrainSample, events: SkierEvent[]): void {
    const t = this.tuning;
    const inv = 1 / Math.sqrt(1 + s.dy * s.dy);
    // Outward normal (away from the snow) blended with straight up.
    let jx = s.dy * inv * (1 - JUMP_UP_BLEND);
    let jy = -inv * (1 - JUMP_UP_BLEND) - JUMP_UP_BLEND;
    const len = Math.hypot(jx, jy);
    jx /= len;
    jy /= len;
    // Never let a jump push backwards (jumping on a steep uphill face would
    // otherwise bounce you back down the ramp).
    const vx = this.speed * inv + t.jumpImpulse * Math.max(0, jx);
    const vy = this.speed * s.dy * inv + t.jumpImpulse * jy;
    this.leaveGround(this.x, s.y - 0.5, vx, vy);
    this.jumpedThisAir = true;
    this.jumpBufferTimer = 0;
    events.push({ type: 'jump', x: this.x, y: this.y });
  }

  private leaveGround(x: number, y: number, vx: number, vy: number): void {
    this.mode = 'air';
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.airTime = 0;
    this.airRotation = 0;
    this.coyoteTimer = 0;
    this.jumpedThisAir = false;
  }
}
