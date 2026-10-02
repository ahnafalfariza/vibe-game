import { describe, expect, it } from 'vitest';
import { Run, SIM_DT, type RunEvent } from '../src/sim/run';
import { ALPINE, FORCED_AIR, START_CLEAR, Spawner, type Entity, type SpawnTable } from '../src/sim/spawner';
import { Terrain } from '../src/sim/terrain';
import { createTuning } from '../src/tuning';
import { BIOMES, applyBiome, findBiome } from '../src/biomes';
import { palette } from '../src/render/palette';

/** Every entity the spawner places up to `toX`, in order. Mounts are off: these tests are about the obstacles. */
function spawnAll(seed: number, toX: number, table: SpawnTable): Entity[] {
  const tuning = createTuning({ mountDensity: 0 });
  const terrain = new Terrain(seed, tuning);
  const spawner = new Spawner(terrain, tuning, seed, true, 0, table);
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

function count(table: SpawnTable) {
  const n = { rock: 0, cabin: 0, ice: 0, iceLen: 0 };
  for (let seed = 1; seed <= 10; seed++) {
    for (const e of spawnAll(seed, 100000, table)) {
      if (e.kind === 'coin') continue;
      n[e.kind]++;
      if (e.kind === 'ice') n.iceLen += e.x1 - e.x0;
    }
  }
  return n;
}

describe('Biomes', () => {
  it('leave the default biome spawning exactly what it did before biomes existed', () => {
    expect(BIOMES[0].spawns).toBe(ALPINE);
    // Recorded on the commit before biomes were added.
    for (const [seed, n, hash] of [
      [5, 93, '9f35da39'],
      [36, 135, 'f89a2ac5'],
    ] as const) {
      const es = spawnAll(seed, 60000, BIOMES[0].spawns);
      expect([es.length, fnv(summary(es))], `seed ${seed}`).toEqual([n, hash]);
    }
  });

  it('twilight has fewer rocks, more cabins and longer ice than alpine', () => {
    const alpine = count(findBiome('alpine')!.spawns);
    const twilight = count(findBiome('twilight')!.spawns);
    expect(twilight.rock).toBeLessThan(alpine.rock * 0.75);
    expect(twilight.cabin).toBeGreaterThan(alpine.cabin * 1.25);
    expect(twilight.iceLen / twilight.ice).toBeGreaterThan((alpine.iceLen / alpine.ice) * 1.25);
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
        expect(summary(spawnAll(5, 40000, biome.spawns))).toBe(summary(spawnAll(5, 40000, biome.spawns)));
        expect(summary(spawnAll(5, 40000, biome.spawns))).not.toBe(summary(spawnAll(6, 40000, biome.spawns)));
      });

      it('places valid obstacles: past the start, spaced out, ice of the right length', () => {
        const [lo, hi] = biome.spawns.iceLen ?? [700, 1300];
        const kinds = new Set<string>();
        for (let seed = 1; seed <= 10; seed++) {
          let prev: Entity | null = null;
          for (const e of spawnAll(seed, 60000, biome.spawns)) {
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
          const run = new Run(seed, tuning, { avalanche: false, obstacles: true, table: biome.spawns });
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
