import Phaser from 'phaser';
import type { Terrain } from '../sim/terrain';
import { palette } from './palette';

// The avalanche: a churning cloud of snow that leans back like a breaking
// wave. Its front touches the slope at the sim's avalancheX, so what you see
// is what catches you. Redrawn every frame (a few dozen shapes); puffs roll
// up the face and along the top by advancing a phase.

/** Height of the wall above the slope, px. */
const WALL_H = 900;
/** How far the top of the face leans back behind its foot, px. */
const LEAN = 320;
const FACE_PUFFS = 12;
/** Spacing of the puffs along the top edge, px. */
const TOP_STEP = 170;
/** Spacing of the dimmer puffs inside the wall, px. */
const INNER_STEP = 210;

export class AvalancheView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly spray: Phaser.GameObjects.Particles.ParticleEmitter;
  private time = 0;
  private carry = 0;

  constructor(
    scene: Phaser.Scene,
    layer: Phaser.GameObjects.Layer,
    private readonly terrain: Terrain,
  ) {
    this.g = scene.add.graphics();
    // Reuses the dot texture made by SnowSpray.
    this.spray = scene.add.particles(0, 0, 'fx-dot', {
      emitting: false,
      lifespan: { min: 400, max: 900 },
      speed: { min: 150, max: 500 },
      angle: { min: 280, max: 340 },
      scale: { start: 2.2, end: 0 },
      alpha: { start: 0.9, end: 0 },
      gravityY: 500,
    });
    layer.add([this.g, this.spray]);
  }

  /** `left` is the left edge of the view in world px; nothing is drawn while the front is off screen. */
  update(frontX: number, left: number, speed: number, dt: number): void {
    this.time += dt;
    const g = this.g.clear();
    if (frontX < left - 200) {
      this.carry = 0;
      return;
    }

    // Puffs bulge ~40% of their radius past their centre line, so the face
    // line sits a little behind the sim's front.
    const faceX = frontX - 40;
    const groundY = this.terrain.height(frontX);
    const back = Math.min(left, faceX - LEAN) - 300;
    const face = (f: number): [number, number] => [faceX - LEAN * f * f, groundY - WALL_H * f];
    const topY = (x: number) => groundY - WALL_H + (faceX - LEAN - x) * 0.15;

    // Solid body: slope from the back to the foot, up the face, back along the top.
    const pts: Phaser.Math.Vector2[] = [];
    for (let x = back; x < faceX; x += 64) pts.push(new Phaser.Math.Vector2(x, this.terrain.height(x) + 80));
    for (let i = 0; i <= 10; i++) pts.push(new Phaser.Math.Vector2(...face(i / 10)));
    pts.push(new Phaser.Math.Vector2(back, topY(back)));
    g.fillStyle(palette.snowBand3, 1);
    g.fillPoints(pts, true);

    // A puff with a shadow under it: the flat-cartoon cloud look.
    const puff = (x: number, y: number, r: number, light: number, shadow: number = palette.snowBand2) => {
      g.fillStyle(shadow, 1);
      g.fillCircle(x - r * 0.2, y + r * 0.25, r);
      g.fillStyle(light, 1);
      g.fillCircle(x, y, r * 0.88);
    };

    // Churning inside: dimmer puffs in rows, so the mass doesn't read as more slope.
    for (let row = 0; row < 3; row++) {
      const f = 0.2 + row * 0.27;
      const rowX = face(f)[0] - 140;
      const dir = row % 2 ? 1 : -1;
      const phase = (((this.time * 90 * dir) % INNER_STEP) + INNER_STEP) % INNER_STEP;
      for (let x = rowX - phase, n = 0; x > back; x -= INNER_STEP, n++) {
        const k = n + row * 7;
        const y = this.terrain.height(x) - WALL_H * f + 30 * Math.sin(this.time * 1.5 + k);
        puff(x, y, 100 + 20 * Math.sin(k * 2.3), palette.snowBand1, palette.snowBand3);
      }
    }

    // Along the top, drifting forward.
    const drift = (this.time * 120) % TOP_STEP;
    for (let x = faceX - LEAN - TOP_STEP + drift; x > back; x -= TOP_STEP) {
      const k = Math.floor(x / TOP_STEP);
      puff(x, topY(x) + 20 * Math.sin(this.time * 2 + k), 85 + 25 * Math.sin(k * 1.7), palette.snow);
    }
    // Up the face, rolling upward: smaller at the foot, bigger at the top.
    for (let i = 0; i < FACE_PUFFS; i++) {
      const f = (((i + this.time * 1.2) / FACE_PUFFS) % 1 + 1) % 1;
      const [x, y] = face(f);
      const r = 60 + 50 * f + 12 * Math.sin(this.time * 4 + i * 2.1);
      puff(x - r * 0.5, y, r, i % 3 === 0 ? palette.snow : palette.snowRim);
    }
    // The curl at the foot, right where it'll hit you.
    const curl = 95 + 12 * Math.sin(this.time * 7);
    puff(frontX - curl, groundY - curl * 0.75, curl, palette.snowRim);

    // Spray flung forward off the foot, more the faster it goes.
    this.carry += dt * Math.min(60, 10 + speed * 0.02);
    const n = Math.floor(this.carry);
    if (n > 0) {
      this.carry -= n;
      this.spray.emitParticleAt(frontX - 40, groundY - 30, n);
    }
  }
}
