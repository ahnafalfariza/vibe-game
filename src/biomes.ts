import { GOLDEN_FUR, applyPalette, type PaletteKey } from './render/palette';
import { ALPINE, type SpawnKind, type SpawnTable } from './sim/spawner';
import type { FeatureKind, TerrainMix } from './sim/terrain';
import { biomeUnlocked, perksAt } from './sim/meta';
import { getProfile } from './profile';

// Biomes: the same game on a different mountain. A biome repaints the world
// (palette overrides; the yeti keeps its own colours), dresses the backdrop,
// shapes the slope (a terrain mix) and changes what turns up on it (a spawn
// table). applyBiome() swaps it in before a scene builds its views; the views
// read `palette` and currentBiome() as they draw.

export interface Biome {
  id: string;
  name: string;
  /** Shown on the title screen while isBiomeUnlocked() says no. */
  lockHint: string;
  /** Palette overrides. */
  colors: Partial<Record<PaletteKey, number>>;
  /** Moon (drawn in palette.sun) and stars instead of the sun; lamplit cabin windows. */
  night: boolean;
  /** Aurora curtains across the sky (palette.aurora, auroraHigh). */
  aurora: boolean;
  /** How many clouds drift across the sky. */
  clouds: number;
  /** Pine density, 1 = alpine: trees on the slope and the forest on the backdrop ridge. */
  forest: number;
  /** Falling snow density, 1 = alpine. Falls in palette.flake: petals, embers… */
  snowfall: number;
  /** Which shapes the mountain favours. */
  terrain: TerrainMix;
  spawns: SpawnTable;
}

/**
 * `base` (feature rows only, no iceLen) with some kinds made more or less
 * likely wherever they can go. Kinds added to ALPINE later come along.
 */
function reweigh(base: SpawnTable, scale: Partial<Record<SpawnKind, number>>): SpawnTable {
  const out = { ...base };
  for (const f of Object.keys(base) as FeatureKind[]) {
    out[f] = Object.fromEntries(
      Object.entries(base[f]).map(([kind, [easy, hard]]) => {
        const s = scale[kind as SpawnKind] ?? 1;
        return [kind, [easy * s, hard * s]];
      }),
    );
  }
  return out;
}

export const BIOMES: readonly Biome[] = [
  {
    id: 'alpine',
    name: 'Sunny Slopes',
    lockHint: '',
    colors: {},
    night: false,
    aurora: false,
    clouds: 5,
    forest: 1,
    snowfall: 1,
    terrain: {},
    spawns: ALPINE,
  },
  {
    // Dusk turning to night: a big pale moon, an aurora, dark pine forests.
    // Fewer rocks, more cabins (their windows glow) and long frozen streams.
    id: 'twilight',
    name: 'Twilight Pines',
    lockHint: 'Reach level 3',
    colors: {
      skyTop: 0x161a45,
      skyBottom: 0x6b58a8,
      sun: 0xf6f1d8,
      mountainFar: 0x41438a,
      mountainFarCap: 0x9a9cd8,
      mountainMid: 0x30336e,
      mountainMidCap: 0x7d82c0,
      forestMid: 0x1c2250,
      cloud: 0x4b4a8c,
      warning: 0xff9db0,
      star: 0xfff8e0,

      snow: 0xaab5e6,
      snowRim: 0xdde2ff,
      snowBand1: 0x8f9bd6,
      snowBand2: 0x7480c2,
      snowBand3: 0x5d68aa,
      pine: 0x1e4652,
      pineDark: 0x163541,
      trunk: 0x3f2c2c,
      flake: 0xe6eaff,

      rock: 0x5c6690,
      rockShade: 0x414870,
      rockLight: 0x8590bd,
      logWall: 0x8a5a40,
      logShade: 0x5e3b2a,
      logEnd: 0xb88a64,
      roof: 0x5a3029,
      roofShade: 0x40211c,
      chimney: 0x5f6585,
      door: 0x4a2a20,
      windowGlow: 0xffcf5c,
      ice: 0x9fe3ff,
      iceDeep: 0x4a9fe0,
      iceShine: 0xf0fbff,
    },
    night: true,
    aurora: true,
    clouds: 3,
    forest: 1.6,
    snowfall: 0.6,
    // Winding forest trails: bowls and bumps, fewer big plunges.
    terrain: { bowl: 1.5, rollers: 1.3, whoops: 1.5, chute: 0.6, booter: 0.7 },
    spawns: { ...reweigh(ALPINE, { rock: 0.35, cabin: 3, ice: 1.3 }), iceLen: [1000, 1700] },
  },
  {
    // Spring thaw: cherry blossom in the pines and petals on the breeze. A
    // bouncy mountain of whoops, rollers and kickers, with coins everywhere.
    id: 'blossom',
    name: 'Blossom Ridge',
    lockHint: 'Reach level 4',
    colors: {
      skyTop: 0x7fbcf2,
      skyBottom: 0xffe1ee,
      sun: 0xfff3d1,
      mountainFar: 0xc7c1ee,
      mountainFarCap: 0xf8f4ff,
      mountainMid: 0xa99bdc,
      mountainMidCap: 0xeee8ff,
      forestMid: 0xe08fbb,
      cloud: 0xfff7fb,

      snow: 0xfffafd,
      snowBand1: 0xf6e4ef,
      snowBand2: 0xebcde1,
      snowBand3: 0xdab3d0,
      pine: 0xf59cc6,
      pineDark: 0xdc77a6,
      trunk: 0x7a4f45,
      flake: 0xffa9cf,

      roof: 0xc4566c,
      roofShade: 0x9c3f54,
    },
    night: false,
    aurora: false,
    clouds: 6,
    forest: 1.3,
    snowfall: 0.7,
    terrain: { whoops: 3, rollers: 2, kicker: 1.5, chute: 0.4, steps: 0.6, booter: 0.6 },
    spawns: reweigh(ALPINE, { rock: 0.6, cabin: 1.5, coinLine: 1.3, coinArc: 1.3 }),
  },
  {
    // A bright, bitter day in a blue-ice gorge: gaps to clear, steep chutes
    // and long sheets of ice.
    id: 'glacier',
    name: 'Glacier Gorge',
    lockHint: 'Reach level 6',
    colors: {
      skyTop: 0x2b86d6,
      skyBottom: 0xc9f3ff,
      sun: 0xffffff,
      mountainFar: 0x9bd3ea,
      mountainFarCap: 0xf0fdff,
      mountainMid: 0x63afd3,
      mountainMidCap: 0xdaf5ff,
      forestMid: 0x3f86ad,

      snow: 0xf3fdff,
      snowBand1: 0xd0f0f8,
      snowBand2: 0x9edcee,
      snowBand3: 0x6cc2df,
      pine: 0x2a6c80,
      pineDark: 0x1f5667,
      flake: 0xe8fbff,

      rock: 0x5b7f9c,
      rockShade: 0x3e5d78,
      rockLight: 0x8fb4cf,
      ice: 0x98efff,
      iceDeep: 0x34b6e6,
    },
    night: false,
    aurora: false,
    clouds: 2,
    forest: 0.5,
    snowfall: 0.4,
    terrain: { chute: 2, gap: 2.5, bowl: 1.5, rollers: 0.5, whoops: 0.5, cruise: 0.6 },
    spawns: { ...reweigh(ALPINE, { ice: 2, cabin: 0.5 }), iceLen: [1000, 1800] },
  },
  {
    // A volcano at sunset: ash-dusted snow, charred pines, embers drifting
    // down. Ledges, cliffs and booters: the biggest air, and the most rocks.
    id: 'ember',
    name: 'Ember Peak',
    lockHint: 'Reach level 8',
    colors: {
      skyTop: 0x3b1d4a,
      skyBottom: 0xff9a5c,
      sun: 0xffc46b,
      mountainFar: 0x7a4868,
      mountainFarCap: 0xd48d9c,
      mountainMid: 0x55304d,
      mountainMidCap: 0xa66c85,
      forestMid: 0x37203a,
      cloud: 0xffb48f,
      warning: 0xffd166,

      snow: 0xf3e6e3,
      snowRim: 0xfff5f0,
      snowBand1: 0xdccaca,
      snowBand2: 0xbaa1a8,
      snowBand3: 0x8f7585,
      pine: 0x4a3a40,
      pineDark: 0x382b31,
      trunk: 0x2e2226,
      flake: 0xff9f5a,

      rock: 0x3d3442,
      rockShade: 0x27212c,
      rockLight: 0x62566b,
      chimney: 0x5d5466,
    },
    night: false,
    aurora: false,
    clouds: 4,
    forest: 0.5,
    snowfall: 0.8,
    terrain: { steps: 3, drop: 2.5, booter: 2, cruise: 0.5, whoops: 0.4, rollers: 0.6 },
    spawns: reweigh(ALPINE, { rock: 1.6, cabin: 0.4, ice: 0.3 }),
  },
];

let active = BIOMES[0];

/** The biome the current scene was built with. */
export function currentBiome(): Biome {
  return active;
}

export function findBiome(id: string | null): Biome | undefined {
  return BIOMES.find((b) => b.id === id);
}

/** Switch biome (unknown ids fall back to the first). Call before building views. */
export function applyBiome(id: string): Biome {
  active = findBiome(id) ?? BIOMES[0];
  // A Yeti Legend skis in golden fur, on every mountain.
  const golden = perksAt(getProfile().level).some((k) => k.golden);
  applyPalette({ ...active.colors, ...(golden ? GOLDEN_FUR : {}) });
  return active;
}

/** Biome forced by ?biome= (for testing): playable whatever the level. */
let forced: string | null = null;

export function forceBiome(id: string): void {
  forced = id;
}

/** Can this biome be played? Level perks unlock them (sim/meta.ts PERKS). */
export function isBiomeUnlocked(id: string): boolean {
  return findBiome(id) !== undefined && (id === forced || biomeUnlocked(id, getProfile().level));
}

const BIOME_KEY = 'yeti-set-go.biome';

/** The last biome picked on the title screen, if it's still playable. */
export function loadBiome(): string {
  try {
    const id = localStorage.getItem(BIOME_KEY);
    if (id !== null && isBiomeUnlocked(id)) return id;
  } catch {
    // Storage unavailable: start on the first biome.
  }
  return BIOMES[0].id;
}

export function saveBiome(id: string): void {
  try {
    localStorage.setItem(BIOME_KEY, id);
  } catch {
    // Storage unavailable: the choice just won't persist.
  }
}
