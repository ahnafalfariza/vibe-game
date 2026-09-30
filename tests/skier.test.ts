import { describe, expect, it } from 'vitest';
import { Run, SIM_DT } from '../src/sim/run';
import { Skier, TAU, wrapAngle, type SkierEvent, type SkierInput } from '../src/sim/skier';
import { Terrain } from '../src/sim/terrain';
import { createTuning, type Tuning } from '../src/tuning';

const NO_INPUT: SkierInput = { held: false, pressed: false };

/** A terrain stand-in with a fixed shape, for isolated physics checks. */
function fakeTerrain(height: (x: number) => number): Terrain {
  const h = 0.01;
  return {
    sample(x: number) {
      return {
        y: height(x),
        dy: (height(x + h) - height(x - h)) / (2 * h),
        ddy: (height(x + h) - 2 * height(x) + height(x - h)) / (h * h),
      };
    },
    height,
  } as unknown as Terrain;
}

function stepFor(skier: Skier, seconds: number, input: (t: number) => SkierInput = () => NO_INPUT) {
  const events: SkierEvent[] = [];
  for (let t = 0; t < seconds; t += SIM_DT) skier.step(SIM_DT, input(t), events);
  return events;
}

describe('wrapAngle', () => {
  it('wraps into (-π, π]', () => {
    expect(wrapAngle(TAU + 0.5)).toBeCloseTo(0.5);
    expect(wrapAngle(-TAU - 0.5)).toBeCloseTo(-0.5);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe('Skier on the ground', () => {
  it('accelerates down a slope and settles at a cruising speed', () => {
    const tuning = createTuning();
    const skier = new Skier(fakeTerrain((x) => x * 0.3), tuning, 0);
    stepFor(skier, 1);
    const early = skier.speed;
    stepFor(skier, 20);
    expect(early).toBeGreaterThan(tuning.minSpeed);
    expect(skier.speed).toBeGreaterThan(early);
    expect(skier.speed).toBeLessThan(tuning.maxSpeed);
    expect(skier.mode).toBe('ground');
  });

  it('never drops below the minimum speed on flat ground', () => {
    const tuning = createTuning();
    const skier = new Skier(fakeTerrain(() => 0), tuning, 0);
    skier.speed = 1000;
    stepFor(skier, 10);
    expect(skier.speed).toBe(tuning.minSpeed);
  });

  it('launches off a sharp crest when fast, but not when slow', () => {
    // A slope that rolls over from 25° uphill to steep downhill around x = 0.
    const crest = (x: number) => (x < 0 ? x * -0.45 : 0.8 * x * x * 0.01);
    const run = (speed: number) => {
      const tuning: Tuning = createTuning({ minSpeed: 50 });
      const skier = new Skier(fakeTerrain(crest), tuning, -200);
      skier.speed = speed;
      const events = stepFor(skier, 0.35);
      return events.some((e) => e.type === 'takeoff');
    };
    expect(run(1400)).toBe(true);
    expect(run(150)).toBe(false);
  });

  it('jumps on press and never jumps backwards', () => {
    const tuning = createTuning();
    // Steep uphill ramp at minimum speed: the worst case for a backwards bounce.
    const skier = new Skier(fakeTerrain((x) => -x), tuning, 0);
    const events: SkierEvent[] = [];
    skier.step(SIM_DT, { held: true, pressed: true }, events);
    expect(events.map((e) => e.type)).toContain('jump');
    expect(skier.mode).toBe('air');
    expect(skier.vx).toBeGreaterThan(0);
    expect(skier.vy).toBeLessThan(0);
  });
});

describe('Skier landings', () => {
  function airborneOverFlat(angle: number, airRotation: number) {
    const tuning = createTuning();
    const skier = new Skier(fakeTerrain(() => 0), tuning, 0);
    skier.mode = 'air';
    skier.y = -2;
    skier.vx = 800;
    skier.vy = 400;
    skier.angle = angle;
    skier.airRotation = airRotation;
    const events: SkierEvent[] = [];
    // Hold so the landing assist doesn't correct the angle.
    for (let i = 0; i < 10 && skier.mode === 'air'; i++) skier.step(SIM_DT, { held: true, pressed: false }, events);
    return { skier, land: events.find((e) => e.type === 'land') };
  }

  it('is clean when parallel to the slope and counts completed backflips', () => {
    const { land, skier } = airborneOverFlat(0.05, -TAU - 0.1);
    expect(land).toMatchObject({ quality: 'clean', flips: 1 });
    expect(skier.mode).toBe('ground');
  });

  it('crashes when landing upside down', () => {
    const { land, skier } = airborneOverFlat(Math.PI, -Math.PI);
    expect(land).toMatchObject({ quality: 'crash', flips: 0 });
    expect(skier.mode).toBe('crash');
  });

  it('is sloppy in between', () => {
    const tuning = createTuning();
    const mid = ((tuning.cleanLandingDeg + tuning.crashLandingDeg) / 2) * (Math.PI / 180);
    const { land } = airborneOverFlat(-mid, -0.2);
    expect(land).toMatchObject({ quality: 'sloppy' });
  });

  it('recovers from a crash after the crash duration', () => {
    const { skier } = airborneOverFlat(Math.PI, -Math.PI);
    const events = stepFor(skier, createTuning().crashDuration + 0.1);
    expect(events.map((e) => e.type)).toContain('recover');
    expect(skier.mode).toBe('ground');
  });
});

describe('A whole run', () => {
  it('never crashes a player who does nothing', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = new Run(seed, createTuning());
      const events: SkierEvent[] = [];
      for (let t = 0; t < 60; t += SIM_DT) run.step(NO_INPUT, events);
      expect(run.stats.crashes, `seed ${seed}`).toBe(0);
      expect(run.distancePx()).toBeGreaterThan(20000);
    }
  });

  it('is reproducible for the same seed and inputs', () => {
    const play = () => {
      const run = new Run(123, createTuning());
      const events: SkierEvent[] = [];
      for (let i = 0; i < 3000; i++) {
        const held = i % 300 < 80;
        run.step({ held, pressed: i % 300 === 0 }, events);
      }
      return [run.skier.x, run.skier.y, run.stats.flips, events.length];
    };
    expect(play()).toEqual(play());
  });
});
