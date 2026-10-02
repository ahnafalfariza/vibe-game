import { applyPalette, type PaletteKey } from './render/palette';
import { ALPINE, type SpawnKind, type SpawnTable } from './sim/spawner';
import type { FeatureKind } from './sim/terrain';

// Biomes: the same game on a different mountain. A biome repaints the world
// (palette overrides; the yeti keeps its own colours), dresses the backdrop,
// and changes what turns up on the slope (a spawn table). applyBiome() swaps
// it in before a scene builds its views; the views read `palette` and
// currentBiome() as they draw.

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
  /** Falling snow density, 1 = alpine. */
  snowfall: number;
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
    spawns: ALPINE,
  },
  {
    // Dusk turning to night: a big pale moon, an aurora, dark pine forests.
    // Fewer rocks, more cabins (their windows glow) and long frozen streams.
    id: 'twilight',
    name: 'Twilight Pines',
    lockHint: 'Reach rank 3',
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
    spawns: { ...reweigh(ALPINE, { rock: 0.35, cabin: 3, ice: 1.3 }), iceLen: [1000, 1700] },
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
  applyPalette(active.colors);
  return active;
}

/** Can this biome be played? Every biome is open for now; ranks will gate them here. */
export function isBiomeUnlocked(id: string): boolean {
  return findBiome(id) !== undefined;
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
