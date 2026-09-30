import Phaser from 'phaser';
import { palette } from './palette';

// The skier, drawn from flat shapes. One rigid pose plus procedural motion
// (rotation, squash-and-stretch, tumbling, a fluttering scarf) instead of
// frame-by-frame animation — cheap, crisp at any zoom, and easy to restyle.

/** The body rotates around this point, measured up from the feet, px (before SCALE). */
const PIVOT_UP = 30;
/** Spin speed while tumbling after a crash, rad/s. */
const TUMBLE_SPEED = 13;
/** Drawn a bit larger than life so the skier reads well when the camera zooms out. */
const SCALE = 1.25;

type Pt = [number, number];

export class SkierView {
  readonly container: Phaser.GameObjects.Container;
  private readonly scarf: Phaser.GameObjects.Graphics;
  private squash = 0;
  private tumble = 0;
  private time = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    const body = scene.add.graphics();
    drawSkier(body);
    this.scarf = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.scarf, body]);
    layer.add(this.container);
  }

  /** Squash on landing; `amount` ~ 0..1. */
  land(amount: number): void {
    this.squash = Math.max(this.squash, amount);
  }

  /**
   * @param x feet x @param y feet y @param angle body angle
   * @param vx world velocity, used for the scarf
   */
  update(x: number, y: number, angle: number, vx: number, vy: number, crashed: boolean, dt: number): void {
    this.time += dt;
    // Tumble while crashed; after recovering, finish the current turn instead
    // of snapping upright.
    if (crashed) this.tumble += dt * TUMBLE_SPEED;
    else if (this.tumble !== 0) {
      const upright = Math.ceil(this.tumble / (Math.PI * 2)) * Math.PI * 2;
      this.tumble += dt * TUMBLE_SPEED;
      if (this.tumble >= upright) this.tumble = 0;
    }
    const rotation = angle + this.tumble;

    // Place the container so the body pivots around its middle, not the feet.
    const px = x + Math.sin(angle) * PIVOT_UP * SCALE;
    const py = y - Math.cos(angle) * PIVOT_UP * SCALE;
    this.container.setPosition(px, py);
    this.container.setRotation(rotation);

    this.squash *= Math.exp(-dt * 9);
    const s = this.squash;
    this.container.setScale(SCALE * (1 + 0.18 * s), SCALE * (1 - 0.28 * s));

    this.drawScarf(rotation, vx, vy);
  }

  private drawScarf(rotation: number, vx: number, vy: number): void {
    const g = this.scarf;
    g.clear();
    // Trail opposite to the velocity, expressed in the body's local frame.
    const speed = Math.hypot(vx, vy);
    const worldDir = Math.atan2(-vy, -vx);
    const dir = worldDir - rotation;
    const stretch = Math.min(1, 0.35 + speed / 1400);
    const tails: [number, number][] = [
      [34, 0],
      [24, 1.7],
    ];
    for (const [len, phase] of tails) {
      const n = 7;
      const left: Phaser.Math.Vector2[] = [];
      const right: Phaser.Math.Vector2[] = [];
      // Neck position (feet-relative -2, -48), shifted into pivot space.
      const ox = -2;
      const oy = -48 + PIVOT_UP;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const along = t * len * stretch;
        const wave = Math.sin(this.time * 22 + phase - t * 5) * 4 * t;
        const cx = ox + Math.cos(dir) * along - Math.sin(dir) * wave;
        const cy = oy + Math.sin(dir) * along + Math.cos(dir) * wave;
        const w = 3.2 * (1 - t * 0.55);
        const nx = -Math.sin(dir) * w;
        const ny = Math.cos(dir) * w;
        left.push(new Phaser.Math.Vector2(cx + nx, cy + ny));
        right.push(new Phaser.Math.Vector2(cx - nx, cy - ny));
      }
      g.fillStyle(palette.scarf, 1);
      g.fillPoints([...left, ...right.reverse()], true);
    }
  }
}

/** Draw the skier facing right with the pivot at (0, 0) (feet at y = PIVOT_UP). */
function drawSkier(g: Phaser.GameObjects.Graphics): void {
  const o = PIVOT_UP;
  const poly = (color: number, pts: Pt[]) => {
    g.fillStyle(color, 1);
    g.fillPoints(
      pts.map(([x, y]) => new Phaser.Math.Vector2(x, y + o)),
      true,
    );
  };

  // Pole, trailing behind (drawn first so the arm covers it).
  g.lineStyle(3, palette.pole, 1);
  g.lineBetween(17, -29 + o, -24, -7 + o);
  g.fillStyle(palette.pole, 1);
  g.fillCircle(-24, -7 + o, 3);

  // Skis with an upturned tip.
  poly(palette.skis, [
    [-42, -5],
    [36, -5],
    [44, -10],
    [49, -9],
    [43, -1],
    [-42, -1],
  ]);

  // Boots.
  g.fillStyle(palette.ink, 1);
  g.fillRoundedRect(-9, -13 + o, 17, 9, 3);

  // Legs, knees bent.
  poly(palette.pants, [
    [-9, -11],
    [7, -11],
    [11, -19],
    [4, -28],
    [-9, -27],
    [-12, -19],
  ]);

  // Jacket, leaning forward, with a shaded back.
  poly(palette.jacket, [
    [-10, -26],
    [7, -27],
    [13, -39],
    [5, -47],
    [-8, -46],
    [-13, -36],
  ]);
  poly(palette.jacketShade, [
    [-10, -26],
    [-3, -26],
    [-6, -45],
    [-8, -46],
    [-13, -36],
  ]);

  // Arm reaching forward, mitten.
  poly(palette.jacket, [
    [3, -44],
    [9, -45],
    [19, -31],
    [14, -28],
  ]);
  g.fillStyle(palette.beanie, 1);
  g.fillCircle(17, -29 + o, 4.5);

  // Scarf knot around the neck.
  g.fillStyle(palette.scarf, 1);
  g.fillRoundedRect(-6, -50 + o, 16, 6, 3);

  // Head.
  g.fillStyle(palette.skin, 1);
  g.fillCircle(5, -57 + o, 11);
  g.fillStyle(0xff9e9e, 0.7);
  g.fillCircle(12, -52 + o, 2.6);

  // Beanie: dome, cuff and pompom.
  g.fillStyle(palette.beanie, 1);
  g.slice(4, -59 + o, 12, Math.PI, 0, false);
  g.fillPath();
  g.fillRoundedRect(-8, -62 + o, 25, 6, 3);
  g.fillStyle(palette.pompom, 1);
  g.fillCircle(-1, -72 + o, 5);

  // Goggles.
  g.fillStyle(palette.goggles, 1);
  g.fillRoundedRect(3, -59 + o, 15, 8, 3);
  g.fillStyle(palette.lens, 1);
  g.fillRoundedRect(6, -58 + o, 10, 5.5, 2);
  g.fillStyle(0xffffff, 0.9);
  g.fillRect(8, -57 + o, 3, 1.6);
}
