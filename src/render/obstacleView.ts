import Phaser from 'phaser';
import { COIN_R, type Cabin, type Entity, type Ice, type Rock, type Spawner } from '../sim/spawner';
import type { Terrain } from '../sim/terrain';
import type { Obstacle } from '../sim/skier';
import { hash01 } from '../sim/rng';
import { palette } from './palette';

// Rocks, cabins, ice and coins, in the same flat style as the slope. Like the
// terrain chunks, each is drawn once when it scrolls into view and its
// Graphics goes back to a pool when it scrolls out. Coins have their own pool
// (drawn once, never redrawn) and spin by squashing scaleX.

/** Show things this far beyond the edges of the view, px. */
const MARGIN = 300;
/** Coin spin speed, rad/s. */
const SPIN = 5;

type V = Phaser.Math.Vector2;
const v = (x: number, y: number): V => new Phaser.Math.Vector2(x, y);

export class ObstacleView {
  private readonly live = new Map<Entity, Phaser.GameObjects.Graphics>();
  private readonly pool: Phaser.GameObjects.Graphics[] = [];
  private readonly coinPool: Phaser.GameObjects.Graphics[] = [];
  /** Cabins currently drawn as rubble. */
  private readonly drawnBroken = new WeakSet<Cabin>();
  private readonly sparkle: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly chips: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly splinters: Phaser.GameObjects.Particles.ParticleEmitter;
  private time = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    private readonly spawner: Spawner,
    private readonly terrain: Terrain,
  ) {
    // Reuses the dot texture made by SnowSpray.
    const burst = (tint: number, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) =>
      scene.add.particles(0, 0, 'fx-dot', { emitting: false, tint, ...cfg });
    this.sparkle = burst(palette.coin, {
      lifespan: { min: 300, max: 600 },
      speed: { min: 90, max: 260 },
      scale: { start: 0.7, end: 0 },
      gravityY: 250,
    });
    this.chips = burst(palette.rockShade, {
      lifespan: { min: 400, max: 750 },
      speed: { min: 160, max: 420 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.8, end: 0.2 },
      gravityY: 1100,
    });
    this.splinters = burst(palette.logWall, {
      lifespan: { min: 500, max: 900 },
      speed: { min: 200, max: 520 },
      angle: { min: 200, max: 340 },
      scale: { start: 1.2, end: 0.3 },
      gravityY: 1000,
    });
    layer.add([this.sparkle, this.chips, this.splinters]);
  }

  /** Show what's in [left, right] (world x); recycle the rest. */
  update(left: number, right: number, dt: number): void {
    this.time += dt;
    const visible = (e: Entity) => e.x1 > left - MARGIN && e.x0 < right + MARGIN && !(e.kind === 'coin' && e.taken);
    for (const [e, g] of this.live) {
      if (visible(e)) continue;
      g.clear().setVisible(false);
      (e.kind === 'coin' ? this.coinPool : this.pool).push(g);
      this.live.delete(e);
    }
    for (const e of this.spawner.entities) {
      if (!visible(e)) continue;
      let g = this.live.get(e);
      if (!g) {
        g = this.acquire(e);
        this.live.set(e, g);
      } else if (e.kind === 'cabin' && e.broken && !this.drawnBroken.has(e)) {
        this.drawCabin(g.clear(), e);
      }
      if (e.kind === 'coin') {
        const c = Math.cos(this.time * SPIN + e.x * 0.013);
        g.setScale(Math.max(0.12, Math.abs(c)), 1);
      }
    }
  }

  /** Coin pickup: a little golden burst. Bigger for finishing a cluster. */
  collect(x: number, y: number, big = false): void {
    this.sparkle.explode(big ? 28 : 7, x, y);
  }

  /** Something got hit: rock chips, or cabin splinters. */
  hit(x: number, y: number, obstacle: Obstacle): void {
    if (obstacle === 'rock') this.chips.explode(14, x, y - 20);
    else this.splinters.explode(28, x, y - 60);
  }

  private acquire(e: Entity): Phaser.GameObjects.Graphics {
    const fresh = () => this.layer.add(this.scene.add.graphics()) as Phaser.GameObjects.Graphics;
    if (e.kind === 'coin') {
      let g = this.coinPool.pop();
      if (!g) {
        g = fresh();
        drawCoin(g);
      }
      return g.setPosition(e.x, e.y).setVisible(true);
    }
    const g = (this.pool.pop() ?? fresh()).setPosition(0, 0).setVisible(true);
    // Ice lies on the snow, under everything else.
    g.setDepth(e.kind === 'ice' ? -1 : 0);
    if (e.kind === 'rock') this.drawRock(g, e);
    else if (e.kind === 'cabin') this.drawCabin(g, e);
    else this.drawIce(g, e);
    return g;
  }

  private drawRock(g: Phaser.GameObjects.Graphics, e: Rock): void {
    // Drawn a bit bigger and higher than the sim's boulder, so it reads at
    // gameplay zoom; brushing the drawn edge is forgiven anyway.
    const { x } = e;
    const r = e.r * 1.2;
    const y = e.y - e.r * 0.15;
    const ground = (px: number) => this.terrain.height(px);
    const seed = Math.floor(x);
    // An irregular boulder, flattened where it sinks into the snow.
    const outline: V[] = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const k = 0.86 + 0.22 * hash01(seed + i * 7);
      const px = x + Math.cos(a) * r * k * 1.12;
      outline.push(v(px, Math.min(y + Math.sin(a) * r * k, ground(px) + 8)));
    }
    g.fillStyle(palette.rockShade, 1).fillPoints(outline, true);
    // Lit upper-left face.
    g.fillStyle(palette.rock, 1).fillPoints(
      outline.map((p) => v(x + (p.x - x) * 0.82 - r * 0.14, y + (p.y - y) * 0.8 - r * 0.16)),
      true,
    );
    g.fillStyle(palette.rockLight, 1).fillTriangle(x - r * 0.62, y - r * 0.22, x - r * 0.15, y - r * 0.72, x - r * 0.05, y - r * 0.3);
    // Snow cap, and a drift seating it in the slope.
    const top = Math.min(...outline.map((p) => p.y));
    g.fillStyle(palette.snow, 1);
    g.fillEllipse(x - r * 0.08, top + r * 0.2, r * 1.25, r * 0.48);
    g.fillCircle(x - r * 0.5, top + r * 0.32, r * 0.2);
    g.fillCircle(x + r * 0.38, top + r * 0.34, r * 0.16);
    this.drift(g, x - r * 1.4, x + r * 1.4, r * 0.14);
  }

  private drawCabin(g: Phaser.GameObjects.Graphics, c: Cabin): void {
    const roof = (x: number) => c.y0 + (x - c.x0) * c.m;
    const ground = (x: number) => this.terrain.height(x);
    const w = c.x1 - c.x0;
    const eave = c.h * 0.4;
    const wx0 = c.x0 + 16;
    const wx1 = c.x1 - 16;
    // A quadrilateral following the slope: top edge `top(x)`, bottom edge `bottom(x)`.
    const band = (x0: number, x1: number, top: (x: number) => number, bottom: (x: number) => number) => [
      v(x0, top(x0)),
      v(x1, top(x1)),
      v(x1, bottom(x1)),
      v(x0, bottom(x0)),
    ];

    if (c.broken) {
      this.drawnBroken.add(c);
      // Rubble: a heap of logs and the chimney stump, half buried in snow.
      const cx = c.x0 + w * 0.68;
      g.fillStyle(palette.chimney, 1).fillPoints(band(cx, cx + 26, (x) => ground(x) - 46, (x) => ground(x) + 6), true);
      for (let i = 0; i < 6; i++) {
        const lx = c.x0 + w * (0.08 + 0.14 * i);
        const ly = ground(lx) - 10 - 14 * hash01(i * 13 + Math.floor(c.x0));
        const tilt = (hash01(i * 31 + Math.floor(c.x0)) - 0.5) * 50;
        g.lineStyle(12, i % 2 ? palette.logShade : palette.logWall, 1).lineBetween(lx - 34, ly + tilt * 0.3, lx + 34, ly - tilt * 0.3);
        g.fillStyle(palette.logEnd, 1).fillCircle(lx + 34, ly - tilt * 0.3, 6);
      }
      this.drift(g, c.x0 - 30, c.x1 + 30, 22);
      return;
    }
    this.drawnBroken.delete(c);

    // Chimney, behind the roof.
    const chx = c.x0 + w * 0.7;
    g.fillStyle(palette.chimney, 1).fillPoints(band(chx, chx + 26, (x) => roof(x) - 38, (x) => roof(x) + 30), true);
    g.fillStyle(palette.snow, 1).fillEllipse(chx + 13, roof(chx + 13) - 40, 36, 12);

    // Log walls.
    const wallTop = (x: number) => roof(x) + eave;
    g.fillStyle(palette.logWall, 1).fillPoints(band(wx0, wx1, wallTop, (x) => ground(x) + 10), true);
    const logH = 14;
    const logs = Math.ceil((c.h - eave) / logH);
    for (let k = 1; k <= logs; k++) {
      const yo = (x: number) => wallTop(x) + k * logH;
      g.lineStyle(3, palette.logShade, 1).lineBetween(wx0, yo(wx0), wx1, yo(wx1));
      // Log ends sticking out at the corners.
      g.fillStyle(palette.logEnd, 1);
      g.fillCircle(wx0 - 4, yo(wx0) - logH / 2, 6.5);
      g.fillCircle(wx1 + 4, yo(wx1) - logH / 2, 6.5);
    }

    // A warm window and a door.
    const winX = c.x0 + w * 0.27;
    const winY = wallTop(winX) + (c.h - eave) * 0.22;
    g.fillStyle(palette.logShade, 1).fillRect(winX - 22, winY - 4, 44, 40);
    g.fillStyle(palette.windowGlow, 1).fillRect(winX - 17, winY + 1, 34, 30);
    g.lineStyle(3, palette.logShade, 1).lineBetween(winX, winY + 1, winX, winY + 31).lineBetween(winX - 17, winY + 16, winX + 17, winY + 16);
    const doorX = c.x0 + w * 0.6;
    const doorH = (c.h - eave) * 0.72;
    g.fillStyle(palette.door, 1).fillPoints(band(doorX, doorX + 34, (x) => ground(x) - doorH, (x) => ground(x) + 4), true);
    g.fillStyle(palette.windowGlow, 1).fillCircle(doorX + 27, ground(doorX + 27) - doorH * 0.45, 3);

    // Roof: overhanging boards under a thick cap of snow. The top of the snow
    // is exactly the sim's roof line, so feet land on it.
    g.fillStyle(palette.roof, 1).fillPoints(band(c.x0 - 14, c.x1 + 14, (x) => roof(x) + 10, (x) => wallTop(x) + 6), true);
    g.fillStyle(palette.roofShade, 1).fillPoints(band(c.x0 - 14, c.x1 + 14, (x) => wallTop(x) - 4, (x) => wallTop(x) + 6), true);
    const cap: V[] = [];
    for (let x = c.x0 - 12; x <= c.x1 + 12; x += 12) cap.push(v(x, roof(x) + (x < c.x0 || x > c.x1 ? 7 : 0)));
    for (let x = c.x1 + 12; x >= c.x0 - 12; x -= 12) {
      // Lumpy underside, with a few drips.
      const lump = 15 + 5 * Math.sin(x * 0.11) + (hash01(Math.floor(x)) > 0.85 ? 8 : 0);
      cap.push(v(x, roof(x) + lump));
    }
    g.fillStyle(palette.snow, 1).fillPoints(cap, true);
    g.lineStyle(3, palette.snowRim, 1).lineBetween(c.x0, roof(c.x0), c.x1, roof(c.x1));

    this.drift(g, c.x0 - 30, c.x1 + 30, 16);
  }

  private drawIce(g: Phaser.GameObjects.Graphics, e: Ice): void {
    const ground = (x: number) => this.terrain.height(x);
    const top: V[] = [];
    const bottom: V[] = [];
    const taper = 70;
    for (let x = e.x0; ; x = Math.min(x + 14, e.x1)) {
      // Thin at the ends so it melts into the snow.
      const k = Math.min(1, (x - e.x0) / taper, (e.x1 - x) / taper);
      top.push(v(x, ground(x) - 3 * k));
      bottom.push(v(x, ground(x) + 4 + 18 * k));
      if (x >= e.x1) break;
    }
    // Translucent body, darker below, lighter in the top half.
    const mid = top.map((p, i) => v(p.x, (p.y + bottom[i].y) / 2 + 2));
    g.fillStyle(palette.iceDeep, 0.55).fillPoints([...top, ...[...bottom].reverse()], true);
    g.fillStyle(palette.ice, 0.85).fillPoints([...top, ...[...mid].reverse()], true);
    // Glossy top edge and a few slanted glints.
    g.lineStyle(3, palette.iceShine, 0.95).strokePoints(top.slice(2, -2), false);
    for (let x = e.x0 + 60; x < e.x1 - 60; x += 110) {
      const y = ground(x);
      g.lineStyle(3, palette.iceShine, 0.8).lineBetween(x, y + 5, x + 16, y + 13);
      g.lineStyle(2, palette.iceShine, 0.6).lineBetween(x + 10, y + 4, x + 20, y + 9);
    }
  }

  /** A low mound of snow along the slope, hiding where something meets the ground. */
  private drift(g: Phaser.GameObjects.Graphics, x0: number, x1: number, height: number): void {
    const pts: V[] = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const u = (i / n) * 2 - 1;
      pts.push(v(x, this.terrain.height(x) - height * Math.sqrt(1 - u * u)));
    }
    for (let i = n; i >= 0; i--) {
      const x = x0 + ((x1 - x0) * i) / n;
      pts.push(v(x, this.terrain.height(x) + 18));
    }
    g.fillStyle(palette.snow, 1).fillPoints(pts, true);
  }
}

/** A gold coin with a rim, an inner ring and a shine, centred on (0, 0). */
function drawCoin(g: Phaser.GameObjects.Graphics): void {
  const r = COIN_R;
  g.fillStyle(palette.ink, 0.25).fillCircle(1.5, 2, r);
  g.fillStyle(palette.coinRim, 1).fillCircle(0, 0, r);
  g.fillStyle(palette.coin, 1).fillCircle(0, 0, r - 3);
  g.lineStyle(2, palette.coinRim, 0.8).strokeCircle(0, 0, r - 7);
  g.fillStyle(palette.coinShine, 0.95).fillEllipse(-r * 0.32, -r * 0.34, r * 0.38, r * 0.62);
}
