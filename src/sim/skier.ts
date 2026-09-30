import type { Terrain, TerrainSample } from './terrain';
import type { Tuning } from '../tuning';

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
    }
  | { type: 'recover'; x: number; y: number };

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

/** How much a jump points straight up vs. along the slope normal (0 = normal, 1 = up). */
const JUMP_UP_BLEND = 0.5;
/** Below this height the landing assist aims for the slope instead of the travel direction, px. */
const ASSIST_GROUND_HEIGHT = 220;
/** Rotation the player must input before the assist stops being unconditional, rad. */
const PLAYER_SPUN_RAD = 0.35;
/** Friction multiplier while tumbling. */
const CRASH_FRICTION = 4;

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
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpedThisAir = false;

  constructor(
    private readonly terrain: Terrain,
    private readonly tuning: Tuning,
    x = 0,
  ) {
    const s = terrain.sample(x);
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

  /** Height of the feet above the snow directly below, px. */
  heightAboveGround(): number {
    return Math.max(0, this.terrain.height(this.x) - this.y);
  }

  step(dt: number, input: SkierInput, events: SkierEvent[]): void {
    if (this.mode === 'air') this.stepAir(dt, input, events);
    else this.stepGround(dt, input, events);
  }

  private stepGround(dt: number, input: SkierInput, events: SkierEvent[]): void {
    const t = this.tuning;
    const crashed = this.mode === 'crash';
    const s = this.terrain.sample(this.x);
    const inv = 1 / Math.sqrt(1 + s.dy * s.dy);
    const tx = inv;
    const ty = s.dy * inv;

    // Gravity along the slope, minus snow friction and drag.
    const friction = t.groundFriction * (crashed ? CRASH_FRICTION : 1);
    const accel = t.gravity * ty - friction * t.gravity * inv - t.groundDrag * this.speed * Math.abs(this.speed);
    this.speed = clamp(this.speed + accel * dt, t.minSpeed, t.maxSpeed);

    if (crashed) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        this.mode = 'ground';
        this.crashTimer = 0;
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
    const next = this.terrain.sample(nx);

    // If a free-falling body would end up above the snow, the ground has
    // dropped away faster than gravity can follow: launch. groundStick adds a
    // little extra "downforce" so small bumps don't make you hop.
    const ballisticY = this.y + vy * dt + 0.5 * t.gravity * dt * dt;
    if (!crashed && next.y > ballisticY + 0.5 * t.groundStick * dt * dt) {
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

    this.vy += t.gravity * dt;
    const drag = Math.max(0, 1 - t.airDrag * this.velocity * dt);
    this.vx *= drag;
    this.vy *= drag;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (input.held) {
      this.angVel = approach(this.angVel, -t.flipSpeed, t.flipAccel * dt);
    } else {
      this.angVel *= Math.exp(-t.spinDamping * dt);
      // Landing assist: ease toward the travel direction, or toward the slope
      // about to be landed on when close to the snow. Only kicks in near the
      // safe angle, so a botched flip still crashes.
      const ahead = this.terrain.sample(this.x + this.vx * 0.08);
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

    const ground = this.terrain.sample(this.x);
    if (this.y >= ground.y) this.land(ground, events);
  }

  private land(s: TerrainSample, events: SkierEvent[]): void {
    const t = this.tuning;
    const slopeAngle = Math.atan(s.dy);
    const errorDeg = (Math.abs(wrapAngle(this.angle - slopeAngle)) * 180) / Math.PI;
    const inv = 1 / Math.sqrt(1 + s.dy * s.dy);
    // Keep only the part of the velocity that runs along the slope.
    const along = this.vx * inv + this.vy * s.dy * inv;

    const quality: LandingQuality =
      errorDeg <= t.cleanLandingDeg ? 'clean' : errorDeg <= t.crashLandingDeg ? 'sloppy' : 'crash';
    const flips = quality === 'crash' ? 0 : Math.max(0, Math.round(-this.airRotation / TAU));

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
    events.push({ type: 'land', x: this.x, y: this.y, quality, flips, airTime: this.airTime, errorDeg });
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
