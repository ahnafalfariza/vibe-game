import Phaser from 'phaser';
import type { Terrain } from '../sim/terrain';
import { hash01 } from '../sim/rng';
import { palette } from './palette';

// Draws the slope in fixed-width chunks. Each chunk is drawn once when it
// scrolls into view and recycled when it scrolls out (pooling was the
// original game's fix for hitches on an endless slope).

const CHUNK_W = 1024;
const SAMPLE_STEP = 8;
/** How far below the surface the snow is filled, px. */
const FILL_DEPTH = 3200;
/** Layered strata below the surface, Tiny Wings / Alto style. */
const BANDS: { offset: number; color: number }[] = [
  { offset: 0, color: palette.snow },
  { offset: 28, color: palette.snowBand1 },
  { offset: 120, color: palette.snowBand2 },
  { offset: 380, color: palette.snowBand3 },
];

export class TerrainView {
  private readonly chunks = new Map<number, Phaser.GameObjects.Graphics>();
  private readonly pool: Phaser.GameObjects.Graphics[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    private readonly terrain: Terrain,
  ) {}

  /** Make sure chunks covering [left, right] exist; recycle the rest. */
  update(left: number, right: number): void {
    const first = Math.floor(left / CHUNK_W);
    const last = Math.floor(right / CHUNK_W);
    for (const [i, g] of this.chunks) {
      if (i < first - 1 || i > last + 1) {
        g.clear().setVisible(false);
        this.pool.push(g);
        this.chunks.delete(i);
      }
    }
    for (let i = first; i <= last; i++) {
      if (!this.chunks.has(i)) this.chunks.set(i, this.build(i));
    }
  }

  private build(index: number): Phaser.GameObjects.Graphics {
    const g = this.pool.pop() ?? this.layer.add(this.scene.add.graphics()) as Phaser.GameObjects.Graphics;
    g.setVisible(true);

    const x0 = index * CHUNK_W;
    // Overlap neighbours by a couple of px so anti-aliased edges don't leave seams.
    const x1 = x0 + CHUNK_W + 2;
    const top: Phaser.Math.Vector2[] = [];
    let maxY = -Infinity;
    for (let x = x0 - 2; x <= x1; x += SAMPLE_STEP) {
      const y = this.terrain.height(x);
      top.push(new Phaser.Math.Vector2(x, y));
      maxY = Math.max(maxY, y);
    }
    const bottom = maxY + FILL_DEPTH;

    this.drawTrees(g, index, x0);

    for (const band of BANDS) {
      const pts = top.map((p) => new Phaser.Math.Vector2(p.x, p.y + band.offset));
      pts.push(new Phaser.Math.Vector2(x1, bottom), new Phaser.Math.Vector2(x0 - 2, bottom));
      g.fillStyle(band.color, 1);
      g.fillPoints(pts, true);
    }
    g.lineStyle(5, palette.snowRim, 1);
    g.strokePoints(top, false);
    return g;
  }

  /** A few pines per chunk, rooted behind the snow line. Deterministic per chunk. */
  private drawTrees(g: Phaser.GameObjects.Graphics, index: number, x0: number): void {
    const salt = this.terrain.seed * 7919;
    const count = Math.floor(hash01(salt + index * 31) * 4);
    for (let n = 0; n < count; n++) {
      const x = x0 + hash01(salt + index * 131 + n * 17) * CHUNK_W;
      const s = this.terrain.sample(x);
      if (Math.abs(s.dy) > 0.9) continue; // no trees on cliff faces
      const size = 80 + hash01(salt + index * 71 + n * 5) * 90;
      drawPine(g, x, s.y + 14, size);
    }
  }
}

/** A stylised snowy pine with its base at (x, y). */
export function drawPine(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number): void {
  g.fillStyle(palette.trunk, 1);
  g.fillRect(x - size * 0.05, y - size * 0.24, size * 0.1, size * 0.26);
  const tiers = 3;
  for (let k = 0; k < tiers; k++) {
    const base = y - size * 0.16 - k * size * 0.24;
    const half = size * (0.34 - k * 0.075);
    const apex = base - size * 0.38;
    g.fillStyle(palette.pine, 1);
    g.fillTriangle(x - half, base, x + half, base, x, apex);
    g.fillStyle(palette.pineDark, 1);
    g.fillTriangle(x, apex, x + half, base, x, base);
    // Snow resting on the tier.
    g.fillStyle(palette.snow, 1);
    const capH = size * 0.13;
    const capHalf = half * (capH / (base - apex));
    g.fillTriangle(x - capHalf, apex + capH, x + capHalf, apex + capH, x, apex);
    g.fillStyle(palette.snow, 0.9);
    g.fillEllipse(x - half * 0.45, base - size * 0.02, half * 0.7, size * 0.06);
  }
}
