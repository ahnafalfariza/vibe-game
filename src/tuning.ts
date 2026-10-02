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
  /** How far behind the skier the avalanche starts, px. */
  avalancheStartGap: number;
  /** Avalanche speed at the start of a run, horizontal px/s. */
  avalancheSpeed: number;
  /** How quickly the avalanche speeds up, px/s². */
  avalancheAccel: number;
  /** The avalanche is never further behind than this, px — you can't escape it for good. */
  avalancheMaxGap: number;
  /** Snow friction on an ice patch (replaces groundFriction there). */
  iceFriction: number;
  /** Ground drag on ice, as a fraction of normal drag. */
  iceDrag: number;
  /** Speed added for grabbing every coin in a cluster, px/s. */
  coinClusterBoost: number;
  /** After getting back up from a crash, obstacles can't hit you for this long, s. */
  hitInvulnTime: number;
  /** Scales how often rocks, cabins and ice are placed (0 = none). */
  obstacleDensity: number;
  /** Gravity multiplier while falling (moving down). Mounts change it; 1 = plain. */
  fallGravity: number;
  /** Engine push along the ground, px/s². Mounts change it; 0 = none. */
  thrust: number;
  /** Speed kept when ploughing through an obstacle (a polar bear's smash) (0..1). */
  smashSpeedKeep: number;

  // ---- Mounts (sim/mounts.ts). Multipliers apply on top of the values above. ----
  /** Scales how often mounts turn up (0 = none). */
  mountDensity: number;
  /** Penguin: × ground drag (lower = faster cruising). */
  penguinDrag: number;
  /** Penguin: × flip speed and spin-up. */
  penguinFlip: number;
  /** Penguin: × air drag (lower = glides further). */
  penguinAirDrag: number;
  /** Penguin: × gravity while falling. */
  penguinFallGravity: number;
  /** Eagle: how long it carries you, s. */
  eagleTime: number;
  /** Eagle: cruising speed while carrying you, horizontal px/s. */
  eagleSpeed: number;
  /** Eagle: climb rate while holding, relative to the mountainside, px/s. */
  eagleClimb: number;
  /** Eagle: glide sink rate when released, relative to the mountainside, px/s. */
  eagleSink: number;
  /** Snowmobile: seconds of fuel. */
  snowmobileFuel: number;
  /** Snowmobile: the engine never lets you drop below this, px/s. */
  snowmobileMinSpeed: number;
  /** Snowmobile: engine push along the ground, px/s². */
  snowmobileThrust: number;
  /** Snowmobile: × top speed. */
  snowmobileTopSpeed: number;
  /** Snowmobile: × flip speed and spin-up (heavy). */
  snowmobileFlip: number;
  /** Polar bear: × snow friction (heavy: slower to pick up speed). */
  bearFriction: number;
  /** Polar bear: × jump impulse (heavy: jumps lower). */
  bearJump: number;
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
  avalancheStartGap: 350,
  avalancheSpeed: 500,
  avalancheAccel: 6,
  avalancheMaxGap: 2400,
  iceFriction: 0.003,
  iceDrag: 0.4,
  coinClusterBoost: 300,
  hitInvulnTime: 0.8,
  obstacleDensity: 1,
  fallGravity: 1,
  thrust: 0,
  smashSpeedKeep: 0.9,
  mountDensity: 1,
  penguinDrag: 0.5,
  penguinFlip: 1.3,
  penguinAirDrag: 0.5,
  penguinFallGravity: 0.85,
  eagleTime: 5,
  eagleSpeed: 1300,
  eagleClimb: 520,
  eagleSink: 380,
  snowmobileFuel: 15,
  snowmobileMinSpeed: 750,
  snowmobileThrust: 450,
  snowmobileTopSpeed: 1.15,
  snowmobileFlip: 0.75,
  bearFriction: 2.5,
  bearJump: 0.8,
});

export function createTuning(overrides: Partial<Tuning> = {}): Tuning {
  return { ...DEFAULT_TUNING, ...overrides };
}

/** Pixels per displayed metre. */
export const PX_PER_METRE = 40;
