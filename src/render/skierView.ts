import Phaser from 'phaser';
import { palette } from './palette';

// The player: a yeti on skis, drawn from flat shapes. One rigid pose plus
// procedural motion (rotation, squash-and-stretch, tumbling, a fluttering
// scarf) instead of frame-by-frame animation — cheap, crisp at any zoom, and
// easy to restyle.

/** The body rotates around this point, measured up from the feet, px (before SCALE). */
const PIVOT_UP = 30;
/** Spin speed while tumbling after a crash, rad/s. */
const TUMBLE_SPEED = 13;
/** Drawn a bit larger than life so the yeti reads well when the camera zooms out. Mounts match it. */
export const SCALE = 1.25;
/** Outline width around the yeti's silhouette, px. Pale fur needs it on pale snow. */
const LINE = 2.2;
/** Where the scarf tails leave the knot, feet-relative px. */
const NECK: Pt = [-6, -41];
/** Riding on something: the boots rest on it (no skis), knees bent a little. */
const SIT_SQUASH = 0.9;

export type Pt = [number, number];
export type Part = [color: number, pts: Pt[]];

export class SkierView {
  readonly container: Phaser.GameObjects.Container;
  private readonly scarf: Phaser.GameObjects.Graphics;
  private readonly skis: Phaser.GameObjects.Graphics;
  private squash = 0;
  private tumble = 0;
  private time = 0;
  private lift = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    const body = scene.add.graphics();
    drawYeti(body);
    this.skis = scene.add.graphics();
    drawSkis(this.skis);
    this.scarf = scene.add.graphics();
    this.container = scene.add.container(0, 0, [this.scarf, this.skis, body]);
    layer.add(this.container);
  }

  /** Squash on landing; `amount` ~ 0..1. */
  land(amount: number): void {
    this.squash = Math.max(this.squash, amount);
  }

  /**
   * Ride on top of a mount stack `lift` world px tall (0: on your own skis).
   * The yeti stands that far up its body axis, skis off, knees bent.
   */
  ride(lift: number): void {
    this.lift = lift;
    this.skis.setVisible(lift === 0);
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
    // Riding, the boots (4 px above the ski soles) rest on top of the stack.
    const sit = this.lift > 0 ? SIT_SQUASH : 1;
    const up = this.lift > 0 ? this.lift + (PIVOT_UP - 4) * SCALE * sit : PIVOT_UP * SCALE;
    this.container.setPosition(x + Math.sin(angle) * up, y - Math.cos(angle) * up);
    this.container.setRotation(rotation);

    this.squash *= Math.exp(-dt * 9);
    const s = this.squash;
    this.container.setScale(SCALE * (1 + 0.18 * s) * (2 - sit), SCALE * (1 - 0.28 * s) * sit);

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
      [36, 0],
      [26, 1.7],
    ];
    for (const [len, phase] of tails) {
      const n = 7;
      const left: Phaser.Math.Vector2[] = [];
      const right: Phaser.Math.Vector2[] = [];
      // Knot position, shifted into pivot space.
      const ox = NECK[0];
      const oy = NECK[1] + PIVOT_UP;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const along = t * len * stretch;
        const wave = Math.sin(this.time * 22 + phase - t * 5) * 4 * t;
        const cx = ox + Math.cos(dir) * along - Math.sin(dir) * wave;
        const cy = oy + Math.sin(dir) * along + Math.cos(dir) * wave;
        const w = 3.4 * (1 - t * 0.55);
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

/** Ellipse (or circle) as a polygon, optionally rotated, feet-relative. */
export function ell(cx: number, cy: number, rx: number, ry = rx, rot = 0, n = 20): Pt[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

/** A rounded limb from (ax, ay) to (bx, by), radius r. */
export function limb(ax: number, ay: number, bx: number, by: number, r: number): Pt[] {
  const a = Math.atan2(by - ay, bx - ax);
  const pts: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = a - Math.PI / 2 + (i / 8) * Math.PI;
    pts.push([bx + Math.cos(t) * r, by + Math.sin(t) * r]);
  }
  for (let i = 0; i <= 8; i++) {
    const t = a + Math.PI / 2 + (i / 8) * Math.PI;
    pts.push([ax + Math.cos(t) * r, ay + Math.sin(t) * r]);
  }
  return pts;
}

/** A pointed fur tuft, base centred on (x, y), `w` wide, pointing at angle `a` (y down). */
function tuft(x: number, y: number, a: number, len = 7, w = 4): Pt[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [x - s * w, y + c * w],
    [x + c * len, y + s * len],
    [x + s * w, y - c * w],
  ];
}

/** Tufts sticking out of an ellipse at the given angles, degrees (y down, 180 = back). */
function tufts(cx: number, cy: number, rx: number, ry: number, degs: number[], len = 7, w = 4): Part[] {
  return degs.map((d) => {
    const a = (d * Math.PI) / 180;
    return [palette.fur, tuft(cx + Math.cos(a) * rx * 0.8, cy + Math.sin(a) * ry * 0.8, a, len, w)];
  });
}

/**
 * Flat fills and outlined groups, in the yeti's style, drawn `oy` px lower
 * (so a drawing made feet-relative can pivot elsewhere). Mounts use it too.
 */
export function painter(g: Phaser.GameObjects.Graphics, oy = 0, line = palette.furLine) {
  const vec = (pts: Pt[]) => pts.map(([x, y]) => new Phaser.Math.Vector2(x, y + oy));
  const fill = (color: number, pts: Pt[], alpha = 1) => {
    g.fillStyle(color, alpha);
    g.fillPoints(vec(pts), true);
  };
  // A group of parts sharing one outline: stroke every part first, then fill
  // them all, so the line only shows around the group's silhouette.
  const outlined = (parts: Part[]) => {
    g.lineStyle(LINE * 2, line, 1);
    g.fillStyle(line, 1);
    for (const [, pts] of parts) {
      const v = vec(pts);
      g.strokePoints(v, true);
      // WebGL strokes have no joins; round off the corners of sharp polygons.
      if (v.length < 18) for (const p of v) g.fillCircle(p.x, p.y, LINE);
    }
    for (const [color, pts] of parts) fill(color, pts);
  };
  return { fill, outlined };
}

/** Skis with an upturned tip, pivot-relative like the body. */
function drawSkis(g: Phaser.GameObjects.Graphics): void {
  painter(g, PIVOT_UP).fill(palette.skis, [
    [-42, -5],
    [36, -5],
    [44, -10],
    [49, -9],
    [43, -1],
    [-42, -1],
  ]);
}

/** Draw the yeti facing right with the pivot at (0, 0) (feet at y = PIVOT_UP). */
function drawYeti(g: Phaser.GameObjects.Graphics): void {
  const { fill, outlined } = painter(g, PIVOT_UP);

  // Far arm, swung back.
  outlined([
    [palette.furShade, limb(-5, -40, -18, -28, 5)],
    [palette.furShade, tuft(-12, -31, 2.2, 6, 4)],
    [palette.face, ell(-20, -26, 4.5)],
  ]);

  // Body: big boots, shaggy legs, a round furry torso, a big head on top.
  outlined([
    [palette.boots, [[-12, -4], [16, -4], [19, -8], [15, -13], [-11, -14], [-13, -9]]],
    [palette.fur, limb(-3, -24, 1, -16, 8.5)],
    [palette.fur, [[-12, -20], [12, -20], [13, -14], [10, -10], [7, -14], [4, -10], [1, -14], [-2, -10], [-5, -14], [-8, -10], [-11, -14]]],
    ...tufts(-2, -31, 17, 18, [125, 150, 175, 200, 225], 7, 5),
    [palette.fur, ell(-2, -31, 17, 18, -0.15, 24)],
    ...tufts(8, -56, 17, 15.5, [150, 178, 206], 7, 4.5),
    [palette.fur, ell(8, -56, 17, 15.5)],
  ]);

  // Pale belly.
  fill(palette.furLight, ell(5, -28, 9, 10.5, -0.15));

  // Face: dark patch, big eyes, a toothy grin.
  fill(palette.face, ell(13.5, -53, 10.5, 8.5));
  for (const ex of [9.5, 17.5]) {
    fill(palette.eye, ell(ex, -54.5, 3.6, 4.3, 0, 14));
    fill(palette.ink, ell(ex + 1, -54, 2.2, 2.4, 0, 12));
    fill(palette.eye, ell(ex + 1.7, -55.2, 0.9, 0.9, 0, 8));
  }
  fill(palette.ink, [
    [10.5, -50.3],
    [18.5, -50.3],
    [17, -48],
    [12, -48],
  ]);
  fill(palette.eye, [
    [12, -50.3],
    [14, -50.3],
    [13, -48.7],
  ]);

  // Scarf knot; beanie with a pompom to match the scarf.
  outlined([[palette.scarf, limb(-7, -41, 14, -41, 3.4)]]);
  outlined([
    [palette.beanie, ell(8, -63, 17, 10, 0, 24).filter(([, y]) => y <= -63 + 0.01)],
    [palette.beanieCuff, limb(-9, -63, 25, -63, 3.6)],
    [palette.scarf, ell(1, -74, 4.5)],
  ]);

  // Near arm reaching forward, with shaggy fur at the wrist and a dark paw.
  outlined([
    [palette.fur, limb(4, -36, 17, -25, 5)],
    [palette.fur, tuft(13, -24, 1.9, 6, 4)],
    [palette.fur, tuft(18, -22, 1.4, 5, 3)],
    [palette.face, ell(21, -22, 4.5)],
  ]);
}
