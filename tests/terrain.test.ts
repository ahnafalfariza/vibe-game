import { describe, expect, it } from 'vitest';
import { Terrain, type TemplateKind } from '../src/sim/terrain';
import { Run, SIM_DT } from '../src/sim/run';
import { createTuning } from '../src/tuning';

const tuning = createTuning();

describe('Terrain', () => {
  it('is deterministic for a given seed', () => {
    const a = new Terrain(42, tuning);
    const b = new Terrain(42, tuning);
    for (let x = 0; x < 50000; x += 137) {
      expect(a.height(x)).toBe(b.height(x));
    }
  });

  it('differs between seeds', () => {
    const a = new Terrain(1, tuning);
    const b = new Terrain(2, tuning);
    let diff = 0;
    for (let x = 2000; x < 20000; x += 100) diff += Math.abs(a.height(x) - b.height(x));
    expect(diff).toBeGreaterThan(1000);
  });

  it('is smooth: height and gradient are continuous (C1)', () => {
    const t = new Terrain(7, tuning);
    const h = 0.01;
    for (let x = -2000; x < 60000; x += 3.7) {
      const s0 = t.sample(x);
      const s1 = t.sample(x + h);
      expect(Math.abs(s1.y - s0.y)).toBeLessThan(0.1);
      expect(Math.abs(s1.dy - s0.dy)).toBeLessThan(0.01);
    }
  });

  it('analytic gradient matches finite differences', () => {
    const t = new Terrain(3, tuning);
    const h = 0.001;
    for (let x = 0; x < 30000; x += 91) {
      const numeric = (t.height(x + h) - t.height(x - h)) / (2 * h);
      expect(t.sample(x).dy).toBeCloseTo(numeric, 3);
    }
  });

  it('always trends downhill', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const t = new Terrain(seed, tuning);
      // Features can sit up to ~900px off the trend line, so over any 10000px
      // window the mountain must still drop by at least half the trend.
      for (let x = 0; x < 80000; x += 2500) {
        const drop = t.height(x + 10000) - t.height(x);
        expect(drop).toBeGreaterThan(10000 * tuning.mountainSlope * 0.5);
      }
    }
  });

  it('keeps working after old knots are pruned', () => {
    const t = new Terrain(9, tuning);
    const before = t.height(30000);
    t.ensure(40000);
    t.prune(25000);
    expect(t.height(30000)).toBe(before);
    expect(Number.isFinite(t.height(90000))).toBe(true);
  });

  // One mountain made of a single template, repeated: every shape on its own.
  const KINDS: TemplateKind[] = ['cruise', 'rollers', 'kicker', 'drop', 'bowl', 'booter', 'chute', 'steps', 'whoops', 'gap'];
  const only = (kind: TemplateKind) => Object.fromEntries(KINDS.map((k) => [k, k === kind ? 1 : 0]));

  for (const kind of KINDS) {
    it(`${kind}: smooth, downhill, and never crashes a rider who does nothing`, () => {
      for (const seed of [1, 2, 3]) {
        const t = new Terrain(seed, tuning, only(kind));
        t.ensure(70000);
        expect(t.features.slice(1).every((f) => f.kind === kind && f.x1 > f.x0)).toBe(true);
        for (let x = 0; x < 60000; x += 4.3) {
          const s0 = t.sample(x);
          const s1 = t.sample(x + 0.01);
          expect(Math.abs(s1.y - s0.y), `seed ${seed} x=${x}`).toBeLessThan(0.1);
          expect(Math.abs(s1.dy - s0.dy), `seed ${seed} x=${x}`).toBeLessThan(0.01);
        }
        for (let x = 0; x < 60000; x += 2500) expect(t.height(x + 10000) - t.height(x)).toBeGreaterThan(10000 * tuning.mountainSlope * 0.5);

        const run = new Run(seed, tuning, { avalanche: false, obstacles: false, terrain: only(kind) });
        for (let s = 0; s < 40; s += SIM_DT) run.step({ held: false, pressed: false }, []);
        expect(run.stats.crashes, `seed ${seed}`).toBe(0);
      }
    });
  }
});
