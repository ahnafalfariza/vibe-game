import { describe, expect, it } from 'vitest';
import { Run, SECOND_WIND_PX, type RunEvent } from '../src/sim/run';
import { Score } from '../src/sim/score';
import type { LandingQuality } from '../src/sim/skier';
import { createTuning } from '../src/tuning';

const land = (quality: LandingQuality, flips = 0, airTime = 0.5) =>
  ({ type: 'land', x: 0, y: 0, quality, flips, airTime, errorDeg: 0 }) as const;

describe('Score', () => {
  it('pays more for each extra flip and builds a multiplier from clean flips', () => {
    const s = new Score();
    expect(s.land(land('clean', 1))).toBe(100);
    expect(s.multiplier).toBe(2);
    expect(s.land(land('clean', 2))).toBe(600); // 300 × 2
    expect(s.multiplier).toBe(4);
    expect(s.land(land('clean', 0, 2))).toBe(200); // big air 50 × 4
    expect(s.multiplier).toBe(4);
    expect(s.tricks).toBe(900);
  });

  it('wipes the multiplier on a sloppy landing or a crash', () => {
    const s = new Score();
    s.land(land('clean', 3));
    expect(s.land(land('sloppy', 1))).toBe(50);
    expect(s.multiplier).toBe(1);
    s.land(land('clean', 2));
    expect(s.land(land('crash'))).toBe(0);
    expect(s.multiplier).toBe(1);
  });

  it('never drops below its floor (Hot start)', () => {
    const s = new Score(2);
    expect(s.multiplier).toBe(2);
    expect(s.land(land('clean', 1))).toBe(200);
    expect(s.multiplier).toBe(3);
    s.land(land('crash'));
    expect(s.multiplier).toBe(2);
    s.land(land('clean', 1));
    s.land(land('sloppy'));
    expect(s.multiplier).toBe(2);
    const run = new Run(1, createTuning(), { avalanche: false, multiplierFloor: 2 });
    expect(run.scoring.multiplier).toBe(2);
  });

  it('caps the multiplier', () => {
    const s = new Score();
    for (let i = 0; i < 10; i++) s.land(land('clean', 3));
    expect(s.multiplier).toBe(10);
  });
});

describe('Avalanche', () => {
  const idle = { held: false, pressed: false };

  it('catches a skier who stops, and the run freezes', () => {
    const run = new Run(1, createTuning({ minSpeed: 0, maxSpeed: 0 }));
    const events: RunEvent[] = [];
    for (let i = 0; i < 120 * 10 && !run.caught; i++) run.step(idle, events);
    expect(run.caught).toBe(true);
    const x = run.skier.x;
    for (let i = 0; i < 120; i++) run.step(idle, events);
    expect(run.skier.x).toBe(x);
  });

  it('knocks the avalanche back once with second wind, then catches you', () => {
    const run = new Run(1, createTuning({ minSpeed: 0, maxSpeed: 0 }), { secondWind: true });
    const events: RunEvent[] = [];
    for (let i = 0; i < 120 * 10 && !events.some((e) => e.type === 'secondWind'); i++) run.step(idle, events);
    expect(events.filter((e) => e.type === 'secondWind')).toHaveLength(1);
    expect(run.caught).toBe(false);
    expect(run.avalancheGap()).toBeGreaterThan(SECOND_WIND_PX - 50);
    for (let i = 0; i < 120 * 10 && !run.caught; i++) run.step(idle, events);
    expect(run.caught).toBe(true);
    expect(events.filter((e) => e.type === 'secondWind')).toHaveLength(1);
  });

  it('is never further behind than the max gap', () => {
    const tuning = createTuning({ avalancheSpeed: 0, avalancheAccel: 0 });
    const run = new Run(1, tuning);
    for (let i = 0; i < 120 * 20; i++) run.step(idle, []);
    expect(run.avalancheGap()).toBeLessThanOrEqual(tuning.avalancheMaxGap);
    expect(run.caught).toBe(false);
  });

  it('eventually catches a skier who does nothing, but not straight away', () => {
    for (const seed of [1, 2, 3]) {
      const run = new Run(seed, createTuning());
      for (let i = 0; i < 120 * 300 && !run.caught; i++) run.step(idle, []);
      expect(run.caught, `seed ${seed}`).toBe(true);
      expect(run.time, `seed ${seed}`).toBeGreaterThan(30);
    }
  });

  it('is off in a run without one', () => {
    const run = new Run(1, createTuning({ minSpeed: 0, maxSpeed: 0 }), { avalanche: false });
    // A live avalanche reaches a skier standing still in well under a second.
    for (let i = 0; i < 120 * 3; i++) run.step(idle, []);
    expect(run.caught).toBe(false);
  });
});
