import { describe, expect, it } from 'vitest';
import { Run, SIM_DT, type RunEvent } from '../src/sim/run';
import { ALPINE, FORCED_AIR, START_CLEAR, Spawner, type Entity } from '../src/sim/spawner';
import { Terrain, type TemplateKind } from '../src/sim/terrain';
import { createTuning } from '../src/tuning';
import { BIOMES, applyBiome, findBiome, type Biome } from '../src/biomes';
import { PERKS } from '../src/sim/meta';
import { palette } from '../src/render/palette';

/** Every entity the spawner places up to `toX` on a biome's mountain, in order. Mounts are off: these tests are about the obstacles. */
function spawnAll(seed: number, toX: number, biome: Biome): Entity[] {
  const tuning = createTuning({ mountDensity: 0 });
  const terrain = new Terrain(seed, tuning, biome.terrain);
  const spawner = new Spawner(terrain, tuning, seed, true, 0, biome.spawns);
  const seen = new Set<Entity>();
  for (let x = 0; x < toX; x += 400) {
    terrain.ensure(x + 6000);
    spawner.update(x);
    for (const e of spawner.entities) seen.add(e);
    terrain.prune(x - 4000);
    spawner.prune(x - 4000);
  }
  return [...seen];
}

const summary = (es: Entity[]) => es.map((e) => `${e.kind}@${e.x0.toFixed(1)}-${e.x1.toFixed(1)}`).join(' ');

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

function count(biome: Biome) {
  const n = { rock: 0, cabin: 0, ice: 0, iceLen: 0 };
  for (let seed = 1; seed <= 10; seed++) {
    for (const e of spawnAll(seed, 100000, biome)) {
      if (e.kind === 'coin') continue;
      n[e.kind]++;
      if (e.kind === 'ice') n.iceLen += e.x1 - e.x0;
    }
  }
  return n;
}

describe('Biomes', () => {
  it('leave the default biome spawning exactly what it did', () => {
    expect(BIOMES[0].spawns).toBe(ALPINE);
    expect(BIOMES[0].terrain).toEqual({});
    // Recorded when the chute, steps, whoops and gap templates were added.
    for (const [seed, n, hash] of [
      [5, 101, '8f33f4a0'],
      [36, 128, '11daad28'],
    ] as const) {
      const es = spawnAll(seed, 60000, BIOMES[0]);
      expect([es.length, fnv(summary(es))], `seed ${seed}`).toEqual([n, hash]);
    }
  });

  it('twilight has fewer rocks, more cabins and longer ice than alpine', () => {
    const alpine = count(findBiome('alpine')!);
    const twilight = count(findBiome('twilight')!);
    expect(twilight.rock).toBeLessThan(alpine.rock * 0.75);
    expect(twilight.cabin).toBeGreaterThan(alpine.cabin * 1.25);
    expect(twilight.iceLen / twilight.ice).toBeGreaterThan((alpine.iceLen / alpine.ice) * 1.25);
  });

  it('shape their mountains: the favourite template turns up more than on Sunny Slopes', () => {
    const share = (b: Biome, kind: TemplateKind) => {
      let n = 0;
      let all = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const t = new Terrain(seed, createTuning(), b.terrain);
        t.ensure(100000);
        for (const f of t.features) {
          all++;
          if (f.kind === kind) n++;
        }
      }
      return n / all;
    };
    for (const b of BIOMES.slice(1)) {
      const [fav] = Object.entries(b.terrain).sort((p, q) => q[1] - p[1])[0] as [TemplateKind, number];
      expect(share(b, fav), `${b.id} ${fav}`).toBeGreaterThan(share(BIOMES[0], fav) * 1.3);
    }
  });

  it('unlock at the level their lock hint says, one perk each', () => {
    for (const b of BIOMES.slice(1)) {
      const perks = PERKS.filter((p) => p.biome === b.id);
      expect(perks, b.id).toHaveLength(1);
      expect(b.lockHint).toBe(`Reach level ${perks[0].level}`);
    }
  });

  it('repaint the world but never the yeti', () => {
    const yeti = ['fur', 'furShade', 'furLight', 'furLine', 'face', 'eye', 'beanie', 'beanieCuff', 'scarf', 'boots', 'skis'] as const;
    const alpine = { ...palette };
    for (const b of BIOMES) {
      applyBiome(b.id);
      for (const k of yeti) expect(palette[k], `${b.id} ${k}`).toBe(alpine[k]);
    }
    expect(palette.snow).not.toBe(alpine.snow);
    applyBiome('alpine');
    expect(palette).toEqual(alpine);
  });

  for (const biome of BIOMES) {
    describe(biome.name, () => {
      it('spawns deterministically per seed', () => {
        expect(summary(spawnAll(5, 40000, biome))).toBe(summary(spawnAll(5, 40000, biome)));
        expect(summary(spawnAll(5, 40000, biome))).not.toBe(summary(spawnAll(6, 40000, biome)));
      });

      it('places valid obstacles: past the start, spaced out, ice of the right length', () => {
        const [lo, hi] = biome.spawns.iceLen ?? [700, 1300];
        const kinds = new Set<string>();
        for (let seed = 1; seed <= 10; seed++) {
          let prev: Entity | null = null;
          for (const e of spawnAll(seed, 60000, biome)) {
            kinds.add(e.kind);
            if (e.kind === 'coin') continue;
            const where = `seed ${seed} ${e.kind} at ${e.x0.toFixed(0)}`;
            expect(e.x0, where).toBeGreaterThanOrEqual(START_CLEAR);
            expect(e.x1, where).toBeGreaterThan(e.x0);
            if (prev) expect(e.x0 - prev.x1, `${where}: too close to the ${prev.kind} before`).toBeGreaterThanOrEqual(1500);
            if (e.kind === 'ice') {
              expect(e.x1 - e.x0, where).toBeGreaterThanOrEqual(lo);
              expect(e.x1 - e.x0, where).toBeLessThanOrEqual(hi);
            }
            prev = e;
          }
        }
        expect([...kinds].sort()).toEqual(['cabin', 'coin', 'ice', 'rock']);
      });

      it('never makes a rider who just rides come down on a rock or fly into a cabin wall', () => {
        // As in spawner.test.ts: a rider who moves exactly like the idle ghost.
        const tuning = createTuning({ coinClusterBoost: 0, iceFriction: 0.03, iceDrag: 1, mountDensity: 0 });
        for (let seed = 1; seed <= 4; seed++) {
          const run = new Run(seed, tuning, { avalanche: false, obstacles: true, table: biome.spawns, terrain: biome.terrain });
          const sk = run.skier;
          const events: RunEvent[] = [];
          for (let t = 0; t < 60; t += SIM_DT) {
            sk.invulnTimer = Infinity;
            events.length = 0;
            run.step({ held: false, pressed: false }, events);
            const where = `seed ${seed} x=${sk.x.toFixed(0)}`;
            for (const e of events) if (e.type === 'hit') expect(sk.mode, `${where}: flew into a cabin wall`).not.toBe('air');
            if (sk.mode !== 'air' || sk.airTime < FORCED_AIR) continue;
            for (const e of run.spawner.entities) {
              if (e.kind === 'rock') expect(sk.touches(e.x, e.y, e.r), `${where}: landed on a rock`).toBe(false);
            }
          }
        }
      });
    });
  }
});
