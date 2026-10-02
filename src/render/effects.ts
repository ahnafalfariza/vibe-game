import Phaser from 'phaser';
import { palette } from './palette';
import { currentBiome } from '../biomes';

// Snow spray from the skis, landing puffs, and screen-space falling snow.

const DOT = 'fx-dot';

export class SnowSpray {
  private readonly spray: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly puff: Phaser.GameObjects.Particles.ParticleEmitter;
  private carry = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    if (!scene.textures.exists(DOT)) {
      const g = scene.make.graphics({}, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 8);
      g.generateTexture(DOT, 16, 16);
      g.destroy();
    }
    this.spray = scene.add.particles(0, 0, DOT, {
      emitting: false,
      lifespan: { min: 300, max: 600 },
      speed: { min: 80, max: 260 },
      angle: { min: 195, max: 250 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.95, end: 0 },
      gravityY: 900,
    });
    this.puff = scene.add.particles(0, 0, DOT, {
      emitting: false,
      lifespan: { min: 350, max: 750 },
      speed: { min: 120, max: 420 },
      angle: { min: 180, max: 360 },
      scale: { start: 1.4, end: 0 },
      alpha: { start: 0.95, end: 0 },
      gravityY: 700,
    });
    layer.add([this.spray, this.puff]);
  }

  /** Continuous spray at the tail of the skis, scaled by speed. */
  update(x: number, y: number, speed: number, grounded: boolean, dt: number): void {
    if (!grounded || speed < 450) {
      this.carry = 0;
      return;
    }
    this.carry += dt * Math.min(90, (speed - 450) * 0.07);
    const n = Math.floor(this.carry);
    if (n > 0) {
      this.carry -= n;
      this.spray.emitParticleAt(x - 30, y - 4, n);
    }
  }

  burst(x: number, y: number, count: number): void {
    this.puff.explode(count, x, y - 4);
  }
}

interface Flake {
  x: number;
  y: number;
  r: number;
  depth: number;
  drift: number;
}

/** Falling snow in screen space, with parallax from camera motion. */
export class Snowfall {
  private readonly g: Phaser.GameObjects.Graphics;
  private flakes: Flake[] = [];
  private width = 0;
  private height = 0;
  private time = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.g = scene.add.graphics();
    layer.add(this.g);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const count = Math.round(((width * height) / 22000) * currentBiome().snowfall);
    const unit = height / 720;
    this.flakes = Array.from({ length: count }, () => {
      const depth = 0.3 + Math.random() * 0.7;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        r: (1 + depth * 2.4) * unit,
        depth,
        drift: Math.random() * Math.PI * 2,
      };
    });
  }

  /** `camDx/camDy`: how far the view moved this frame, in screen px. */
  update(camDx: number, camDy: number, dt: number): void {
    this.time += dt;
    const { width: w, height: h, g } = this;
    const unit = h / 720;
    g.clear();
    for (const f of this.flakes) {
      f.x += (-camDx * f.depth * 0.6 + Math.sin(this.time * 1.3 + f.drift) * 12 * unit * dt) - 20 * unit * dt;
      f.y += (-camDy * f.depth * 0.6) + 60 * f.depth * unit * dt;
      f.x = ((f.x % w) + w) % w;
      f.y = ((f.y % h) + h) % h;
      g.fillStyle(palette.flake, 0.35 + f.depth * 0.5);
      g.fillCircle(f.x, f.y, f.r);
    }
  }
}
