// Every number that shapes how the game *feels* lives here, so it can be
// tweaked live from the tuning panel (press T) without touching the code.
// World units are pixels at zoom 1; the skier is ~64px tall (≈ 1.6 m).

export interface Tuning {
  /** Downward acceleration, px/s². */
  gravity: number;
  /** Snow friction as a fraction of the normal force. */
  groundFriction: number;
  /** Quadratic drag on the ground (per px). Sets cruising speed on the average slope. */
  groundDrag: number;
  /** Quadratic drag in the air (per px). */
  airDrag: number;
  /** The skier keeps pushing: ground speed never drops below this, px/s. */
  minSpeed: number;
  maxSpeed: number;
  /** Speed added along the slope normal when jumping, px/s. */
  jumpImpulse: number;
  /** Extra "downforce" before a crest launches you, px/s². Higher = stickier. */
  groundStick: number;
  /** Backflip rotation speed while holding, rad/s. */
  flipSpeed: number;
  /** How quickly rotation spins up to flipSpeed, rad/s². */
  flipAccel: number;
  /** How quickly rotation stops after releasing, 1/s. */
  spinDamping: number;
  /** When not holding, how quickly the skier settles toward a safe landing angle, 1/s. */
  landingAssist: number;
  /** The assist only helps when already within this many degrees of the safe angle. */
  landingAssistDeg: number;
  /** Landing within this angle of the slope is clean, degrees. */
  cleanLandingDeg: number;
  /** Landing beyond this angle is a crash, degrees. Between the two is sloppy. */
  crashLandingDeg: number;
  /** Speed kept after a sloppy landing (0..1). */
  sloppySpeedKeep: number;
  /** Speed added per completed flip on a clean landing, px/s. */
  flipBoost: number;
  /** Speed kept after a crash (0..1). */
  crashSpeedKeep: number;
  /** Seconds spent tumbling before getting back up. */
  crashDuration: number;
  /** Grace period to still jump after running off a lip, s. */
  coyoteTime: number;
  /** A tap this soon before landing jumps on touchdown, s. */
  jumpBuffer: number;
  /** Average downhill gradient of the mountain (dy/dx). */
  mountainSlope: number;
}

export const DEFAULT_TUNING: Readonly<Tuning> = Object.freeze({
  gravity: 2200,
  groundFriction: 0.03,
  groundDrag: 0.00032,
  airDrag: 0.00008,
  minSpeed: 280,
  maxSpeed: 2600,
  jumpImpulse: 860,
  groundStick: 700,
  flipSpeed: 8,
  flipAccel: 60,
  spinDamping: 12,
  landingAssist: 4,
  landingAssistDeg: 40,
  cleanLandingDeg: 28,
  crashLandingDeg: 62,
  sloppySpeedKeep: 0.8,
  flipBoost: 260,
  crashSpeedKeep: 0.35,
  crashDuration: 1.0,
  coyoteTime: 0.08,
  jumpBuffer: 0.1,
  mountainSlope: 0.3,
});

export function createTuning(overrides: Partial<Tuning> = {}): Tuning {
  return { ...DEFAULT_TUNING, ...overrides };
}

/** Pixels per displayed metre. */
export const PX_PER_METRE = 40;
