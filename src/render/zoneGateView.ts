import Phaser from 'phaser';
import { ZONE_METRES } from '../sim/spawner';
import type { Terrain } from '../sim/terrain';
import { PX_PER_METRE } from '../tuning';
import { FONT, css, palette } from './palette';

// A gate on the slope at every zone boundary: two poles with a banner
// strung between them. At most two are ever near the screen, so each is
// built when it comes into view and destroyed when it leaves (no pool).

const SPAN = ZONE_METRES * PX_PER_METRE;
/** Build gates this far beyond the edges of the view, px. */
const MARGIN = 400;
/** Pole spacing and height, banner depth, world px. */
const HALF_WIDTH = 150;
const POLE = 300;
const BANNER = 78;

export class ZoneGateView {
  private readonly gates = new Map<number, Phaser.GameObjects.Container>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    private readonly terrain: Terrain,
    private readonly startX: number,
  ) {}

  /** Show the gates in [left, right] (world x). */
  update(left: number, right: number): void {
    // Zone n starts (n - 1) spans past the start; zone 1 has no gate.
    const first = Math.max(2, Math.ceil((left - MARGIN - this.startX) / SPAN) + 1);
    const last = Math.floor((right + MARGIN - this.startX) / SPAN) + 1;
    for (const [zone, gate] of this.gates) {
      if (zone >= first && zone <= last) continue;
      gate.destroy();
      this.gates.delete(zone);
    }
    for (let zone = first; zone <= last; zone++) if (!this.gates.has(zone)) this.gates.set(zone, this.build(zone));
  }

  private build(zone: number): Phaser.GameObjects.Container {
    const x = this.startX + (zone - 1) * SPAN;
    const x0 = x - HALF_WIDTH;
    const x1 = x + HALF_WIDTH;
    const y0 = this.terrain.height(x0);
    const y1 = this.terrain.height(x1);
    const g = this.scene.add.graphics();
    // Poles, planted in the snow.
    for (const [px, py] of [
      [x0, y0],
      [x1, y1],
    ]) {
      g.fillStyle(palette.ink, 1).fillRoundedRect(px - 8, py - POLE, 16, POLE + 20, 6);
      g.fillStyle(palette.beanie, 1).fillCircle(px, py - POLE, 14);
      g.lineStyle(4, palette.ink, 1).strokeCircle(px, py - POLE, 14);
    }
    // The banner hangs between the pole tops, tilted with the slope.
    const top0 = y0 - POLE + 22;
    const top1 = y1 - POLE + 22;
    const banner = new Phaser.Geom.Polygon([x0, top0, x1, top1, x1, top1 + BANNER, x0, top0 + BANNER]);
    g.fillStyle(palette.boots, 1).fillPoints(banner.points, true);
    g.lineStyle(5, palette.ink, 1).strokePoints(banner.points, true);
    const label = this.scene.add
      .text(x, (top0 + top1) / 2 + BANNER / 2, `ZONE ${zone}`, {
        fontFamily: FONT,
        fontStyle: '700',
        fontSize: '46px',
        color: '#ffffff',
        stroke: css(palette.ink),
        strokeThickness: 8,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setRotation(Math.atan2(top1 - top0, x1 - x0));
    const gate = this.scene.add.container(0, 0, [g, label]);
    this.layer.add(gate);
    return gate;
  }
}
