// One palette for the whole game. Cool, airy blues for the world so the
// warm-coloured skier always pops. Keep new colours here, not inline.

export const palette = {
  skyTop: 0x5fa8e8,
  skyBottom: 0xd9f0ff,
  sun: 0xfff4d6,

  mountainFar: 0xb8d1ef,
  mountainFarCap: 0xeef5fd,
  mountainMid: 0x93b6e0,
  mountainMidCap: 0xe4eefb,
  forestMid: 0x6f96c4,

  cloud: 0xffffff,

  snow: 0xf7fbff,
  snowRim: 0xffffff,
  snowBand1: 0xe3edf9,
  snowBand2: 0xc9daf1,
  snowBand3: 0xadc4e6,

  pine: 0x2f6f67,
  pineDark: 0x245a54,
  pineFar: 0x7ea7c9,
  trunk: 0x6b4a3a,

  // The yeti. Cool lavender fur with a dark outline so it reads on white
  // snow; warm accents (beanie, scarf, boots) for what the player tracks.
  fur: 0xd2d3f5,
  furShade: 0xa9a9df,
  furLight: 0xf0f0ff,
  furLine: 0x4c4f8c,
  face: 0x5d6198,
  eye: 0xffffff,
  beanie: 0xffc93c,
  beanieCuff: 0xf5ad2a,
  scarf: 0xef476f,
  boots: 0xff7a45,
  skis: 0x34466b,

  ink: 0x243049,
  flake: 0xffffff,

  // ---- Obstacles & pickups (render/obstacleView.ts) ----
  rock: 0x6a7b9c,
  rockShade: 0x48566f,
  rockLight: 0x95a7c6,
  logWall: 0xb07a52,
  logShade: 0x87583a,
  logEnd: 0xe0b182,
  roof: 0x7a4535,
  roofShade: 0x5e3328,
  chimney: 0x8d93a8,
  windowGlow: 0xffd66e,
  door: 0x6b4232,
  ice: 0xb4ecff,
  iceDeep: 0x6ac4f2,
  iceShine: 0xffffff,
  coin: 0xffcf3f,
  coinRim: 0xe2961c,
  coinShine: 0xfff6cf,
} as const;

/** CSS hex string for text styles. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const FONT = 'Fredoka, "Trebuchet MS", system-ui, sans-serif';
