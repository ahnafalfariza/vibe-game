import Phaser from 'phaser';
import { palette } from './palette';
import { currentBiome } from '../biomes';
import { hash01 } from '../sim/rng';

// Screen-space backdrop drawn by its own un-zoomed camera: sky gradient, sun
// (or moon, stars and an aurora at night), clouds and two parallax mountain
// ridges. The ridges are generated as seamless textures (integer-frequency
// waves), one set per biome, and laid side by side as plain images (a
// TileSprite would also wrap vertically and leave a seam line).

const TEX_W = 2048;

interface Ridge {
  tiles: Phaser.GameObjects.Image[];
  /** Solid colour under the ridge, down to the bottom of the screen. */
  fill: Phaser.GameObjects.Rectangle;
  texH: number;
  scale: number;
  /** Fraction of world motion applied. */
  parallax: number;
  /** Where the ridge's bottom sits, as a fraction of screen height. */
  anchor: number;
  /** Visual height as a fraction of screen height. */
  heightFrac: number;
}

interface Cloud {
  image: Phaser.GameObjects.Image;
  /** Normalised position across a strip wider than the screen. */
  u: number;
  v: number;
  scale: number;
  parallax: number;
}

export class Background {
  private readonly sky: Phaser.GameObjects.Graphics;
  /** Redrawn every frame (it sways); null without an aurora. */
  private readonly aurora: Phaser.GameObjects.Graphics | null = null;
  private readonly ridges: Ridge[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly biome = currentBiome();
  private width = 0;
  private height = 0;
  private time = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    // Textures bake in the biome's colours, so each biome gets its own set.
    const b = this.biome;
    const far = `ridge-far-${b.id}`;
    const mid = `ridge-mid-${b.id}`;
    const cloud = `cloud-${b.id}`;
    makeRidgeTexture(scene, far, 560, {
      color: palette.mountainFar,
      cap: palette.mountainFarCap,
      base: 0.25,
      waves: [
        [150, 3, 0.3],
        [90, 7, 1.7],
        [45, 13, 0.9],
      ],
      snowline: 0.42,
    });
    makeRidgeTexture(scene, mid, 420, {
      color: palette.mountainMid,
      cap: palette.mountainMidCap,
      base: 0.35,
      waves: [
        [90, 4, 2.1],
        [60, 9, 0.4],
        [25, 17, 1.2],
      ],
      snowline: 0.5,
      forest: palette.forestMid,
      forestDensity: b.forest,
    });
    makeCloudTexture(scene, cloud);

    this.sky = scene.add.graphics();
    layer.add(this.sky);
    if (b.aurora) {
      this.aurora = scene.add.graphics();
      layer.add(this.aurora);
    }

    for (let i = 0; i < b.clouds; i++) {
      const image = scene.add.image(0, 0, cloud).setAlpha(0.85);
      layer.add(image);
      this.clouds.push({ image, u: i / b.clouds + Math.random() * 0.1, v: 0.08 + Math.random() * 0.25, scale: 0.6 + Math.random() * 0.6, parallax: 0.02 + Math.random() * 0.02 });
    }

    const addRidge = (key: string, texH: number, color: number, parallax: number, anchor: number, heightFrac: number) => {
      const fill = scene.add.rectangle(0, 0, 16, 16, color).setOrigin(0, 0);
      const tiles = [0, 1, 2].map(() => scene.add.image(0, 0, key).setOrigin(0, 1));
      layer.add([fill, ...tiles]);
      this.ridges.push({ tiles, fill, texH, scale: 1, parallax, anchor, heightFrac });
    };
    addRidge(far, 560, palette.mountainFar, 0.04, 0.78, 0.5);
    addRidge(mid, 420, palette.forestMid, 0.1, 0.9, 0.36);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.sky.clear();
    this.sky.fillGradientStyle(palette.skyTop, palette.skyTop, palette.skyBottom, palette.skyBottom, 1);
    this.sky.fillRect(0, 0, width, height);
    if (this.biome.night) this.drawNightSky(width, height);
    else {
      // Soft sun glow.
      const sx = width * 0.8;
      const sy = height * 0.18;
      const r = height * 0.09;
      for (const [mul, alpha] of [[3.2, 0.08], [2.2, 0.12], [1.5, 0.2], [1, 0.9]] as const) {
        this.sky.fillStyle(palette.sun, alpha);
        this.sky.fillCircle(sx, sy, r * mul);
      }
    }
    for (const ridge of this.ridges) {
      ridge.scale = (height * ridge.heightFrac) / ridge.texH;
      // A whole number of px wide, so neighbouring tiles meet exactly: a
      // fractional width left a 1 px seam (glaring on a dark forest).
      for (const tile of ridge.tiles) tile.setScale(Math.ceil(TEX_W * ridge.scale) / TEX_W, ridge.scale);
    }
  }

  /**
   * @param scrollPx how far the world has scrolled horizontally, in screen px
   * @param lift how high the camera has risen above its usual framing, in screen px
   */
  update(scrollPx: number, lift: number, dt: number): void {
    const w = this.width;
    const h = this.height;
    for (const ridge of this.ridges) {
      const tileW = Math.ceil(TEX_W * ridge.scale);
      const offset = -(((scrollPx * ridge.parallax) % tileW) + tileW) % tileW;
      const bottom = h * ridge.anchor + lift * ridge.parallax * 2;
      ridge.tiles.forEach((tile, i) => tile.setPosition(Math.floor(offset + i * tileW), bottom));
      ridge.fill.setPosition(0, bottom - 2).setSize(w, Math.max(0, h - bottom + 2));
    }
    for (const c of this.clouds) {
      c.u -= dt * 0.004;
      const span = w * 1.6;
      const x = ((((c.u * span - scrollPx * c.parallax) % span) + span) % span) - w * 0.3;
      c.image.setPosition(x, h * c.v + lift * c.parallax);
      c.image.setScale((c.scale * h) / 900);
    }
    this.time += dt;
    if (this.aurora) this.drawAurora(this.aurora, w, h);
  }

  /** Stars, then a big pale moon (palette.sun) with a soft halo. */
  private drawNightSky(w: number, h: number): void {
    const g = this.sky;
    const unit = h / 720;
    // Fixed positions (hashed, not random) so a resize doesn't reshuffle them;
    // denser and brighter towards the top.
    const count = Math.round((w * h) / 7000);
    for (let i = 0; i < count; i++) {
      const x = hash01(i * 3 + 1) * w;
      const f = hash01(i * 3 + 2) ** 1.5;
      const r = (0.7 + 1.5 * hash01(i * 3 + 3) ** 4) * unit;
      g.fillStyle(palette.star, 0.9 - 0.7 * f);
      g.fillCircle(x, f * h * 0.6, r);
      if (i % 23 === 0) {
        // A few twinkly ones: a four-point sparkle.
        g.fillEllipse(x, f * h * 0.6, r * 1.2, r * 7);
        g.fillEllipse(x, f * h * 0.6, r * 7, r * 1.2);
      }
    }
    const mx = w * 0.8;
    const my = h * 0.2;
    const r = h * 0.11;
    for (const [mul, alpha] of [[2.6, 0.05], [1.8, 0.08], [1.3, 0.14], [1, 1]] as const) {
      g.fillStyle(palette.sun, alpha);
      g.fillCircle(mx, my, r * mul);
    }
    // Faint maria, tinted with the sky.
    g.fillStyle(palette.skyTop, 0.08);
    for (const [dx, dy, k] of [[-0.3, -0.2, 0.26], [0.32, 0.18, 0.2], [-0.05, 0.45, 0.14], [0.28, -0.42, 0.1]] as const) {
      g.fillCircle(mx + dx * r, my + dy * r, k * r);
    }
  }

  /** Two swaying curtains: a bright lower edge fading upwards, tapering off at both ends. */
  private drawAurora(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
    g.clear();
    const t = this.time;
    const curtain = (color: number, base: number, height: number, phase: number) => {
      const n = 48;
      const foot: Phaser.Math.Vector2[] = [];
      const tall: number[] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const y = h * (base + 0.035 * Math.sin(u * 7 + phase + t * 0.12) + 0.015 * Math.sin(u * 17 - phase - t * 0.2));
        foot.push(new Phaser.Math.Vector2(-w * 0.05 + w * 0.72 * u, y));
        tall.push(h * height * Math.sin(Math.PI * u) * (0.75 + 0.25 * Math.sin(u * 11 + t * 0.3 + phase)));
      }
      // Stacked translucent bands: brightest along the foot, like the real thing.
      for (const [k, alpha] of [[1, 0.05], [0.7, 0.06], [0.45, 0.08], [0.22, 0.1]] as const) {
        const top = foot.map((p, i) => new Phaser.Math.Vector2(p.x, p.y - tall[i] * k));
        g.fillStyle(color, alpha).fillPoints([...top, ...[...foot].reverse()], true);
      }
      g.lineStyle(2 * (h / 720), color, 0.3).strokePoints(foot.slice(n / 6, -n / 6), false);
    };
    curtain(palette.auroraHigh, 0.2, 0.1, 1.7);
    curtain(palette.aurora, 0.3, 0.17, 0);
  }
}

interface RidgeStyle {
  color: number;
  cap: number;
  /** Height of the tallest possible peak, as a fraction of texture height from the top. */
  base: number;
  /** [amplitude px, integer frequency across the texture, phase]. */
  waves: [number, number, number][];
  /** Snowline as a fraction of texture height from the top. */
  snowline: number;
  forest?: number;
  /** 1 = the alpine forest; more is taller, denser and higher up the ridge. */
  forestDensity?: number;
}

function makeRidgeTexture(scene: Phaser.Scene, key: string, texH: number, style: RidgeStyle): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  const step = 8;
  const totalAmp = style.waves.reduce((sum, [a]) => sum + a, 0);
  const profile = (x: number) => {
    // Highest possible peak lands exactly on the baseline.
    let y = texH * style.base + totalAmp;
    for (const [a, k, phase] of style.waves) {
      // 1 - |sin| gives sharp peaks and rounded valleys.
      y -= a * (1 - Math.abs(Math.sin((Math.PI * k * x) / TEX_W + phase)));
    }
    return y;
  };
  // Draw a little past both edges: the profile is periodic, and this keeps
  // anti-aliased polygon edges out of the texture so tiles join invisibly.
  const pad = step * 2;
  const ridge: Phaser.Math.Vector2[] = [];
  for (let x = -pad; x <= TEX_W + pad; x += step) ridge.push(new Phaser.Math.Vector2(x, profile(x)));

  g.fillStyle(style.color, 1);
  g.fillPoints([...ridge, new Phaser.Math.Vector2(TEX_W + pad, texH + pad), new Phaser.Math.Vector2(-pad, texH + pad)], true);

  // Snow caps: the band between the ridge and a wavy snowline.
  const snowline = (x: number) =>
    texH * style.snowline + 14 * Math.sin((2 * Math.PI * 9 * x) / TEX_W) + 8 * Math.sin((2 * Math.PI * 23 * x) / TEX_W);
  const capBottom = ridge.map((p) => new Phaser.Math.Vector2(p.x, Math.max(p.y, snowline(p.x)))).reverse();
  g.fillStyle(style.cap, 1);
  g.fillPoints([...ridge, ...capBottom], true);

  if (style.forest !== undefined) {
    // A band of pine silhouettes along the foot of the ridge.
    g.fillStyle(style.forest, 1);
    const d = style.forestDensity ?? 1;
    const forestTop = texH * (0.72 - 0.08 * (d - 1));
    g.fillRect(-pad, forestTop, TEX_W + 2 * pad, texH - forestTop + pad);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = 0; x < TEX_W; x += (11 + rand() * 10) / d) {
      const h = (30 + rand() * 40) * d;
      const w = h * 0.45;
      for (const dx of [0, TEX_W, -TEX_W]) {
        g.fillTriangle(x + dx - w, forestTop + 6, x + dx + w, forestTop + 6, x + dx, forestTop - h);
      }
    }
  }

  g.generateTexture(key, TEX_W, texH);
  g.destroy();
}

function makeCloudTexture(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(palette.cloud, 1);
  g.fillEllipse(130, 70, 200, 60);
  g.fillCircle(90, 55, 38);
  g.fillCircle(145, 42, 48);
  g.fillCircle(195, 60, 30);
  g.generateTexture(key, 260, 110);
  g.destroy();
}
