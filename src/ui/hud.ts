import Phaser from 'phaser';
import { FONT, css, palette } from '../render/palette';

// Screen-space UI, drawn by the un-zoomed UI camera. All sizes scale with
// screen height (designed at 720px tall). Menus live in the DOM (menu.ts).

export interface HudStats {
  score: number;
  multiplier: number;
  metres: number;
  kmh: number;
  best: number;
  /** Metres to the avalanche. */
  avalancheM: number;
  /** Coins this run. */
  coins: number;
  /** What the yeti is riding, bottom to top (an eagle carrying it last). */
  stack: string[];
  /** Eagle flight left (0..1), while carried. */
  eagle: number | null;
  /** Snowmobile fuel left (0..1), while on one. */
  fuel: number | null;
}

/** Show the avalanche distance below this many metres. */
const WARN_METRES = 40;

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

export class Hud {
  private readonly items: { setVisible(visible: boolean): unknown }[];
  private readonly score: Phaser.GameObjects.Text;
  private readonly coins: Phaser.GameObjects.Text;
  private readonly coinIcon: Phaser.GameObjects.Graphics;
  private lastCoins = 0;
  private readonly multiplier: Phaser.GameObjects.Text;
  private readonly speed: Phaser.GameObjects.Text;
  private readonly warning: Phaser.GameObjects.Text;
  private readonly best: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly keys: Phaser.GameObjects.Text;
  private readonly debug: Phaser.GameObjects.Text;
  /** The mount stack, and timer bars for eagle flight and snowmobile fuel. */
  private readonly ride: Phaser.GameObjects.Text;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly barLabels: Phaser.GameObjects.Text[];
  private lastStack = '';
  private unit = 1;
  private width = 0;
  private height = 0;
  private hintShown = true;
  private lastMultiplier = 1;
  private time = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    touch: boolean,
  ) {
    const add = (text: string, style: Phaser.Types.GameObjects.Text.TextStyle) => {
      const t = scene.add.text(0, 0, text, { fontFamily: FONT, color: '#ffffff', ...style });
      layer.add(t);
      return t;
    };
    this.score = add('0', { fontStyle: '600' });
    this.multiplier = add('', { fontStyle: '600', color: css(palette.beanie) }).setOrigin(0, 0.5);
    this.speed = add('', { fontStyle: '500' });
    this.warning = add('', { fontStyle: '600', color: css(palette.warning) });
    this.best = add('', { fontStyle: '500' }).setOrigin(1, 0.5);
    this.hint = add(touch ? 'Tap to jump  ·  hold to backflip' : 'Space / click to jump  ·  hold to backflip', { fontStyle: '600' }).setOrigin(0.5, 1);
    this.keys = add(touch ? '' : 'Esc  pause   ·   R  new run   ·   T  tune feel   ·   D  debug', { fontStyle: '500' }).setOrigin(1, 1).setAlpha(0.8);
    this.debug = add('', { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: css(palette.ink) }).setOrigin(0, 1);
    this.debug.setVisible(false);
    this.coins = add('0', { fontStyle: '600', color: css(palette.coin) }).setOrigin(1, 0.5);
    this.coinIcon = scene.add.graphics();
    layer.add(this.coinIcon);
    this.ride = add('', { fontStyle: '600' }).setOrigin(0, 0.5);
    this.bars = scene.add.graphics();
    layer.add(this.bars);
    this.barLabels = [add('', { fontStyle: '600' }).setOrigin(0, 0.5), add('', { fontStyle: '600' }).setOrigin(0, 0.5)];
    this.items = [this.score, this.multiplier, this.speed, this.warning, this.best, this.hint, this.keys, this.coins, this.coinIcon, this.ride, this.bars, ...this.barLabels];
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const u = (this.unit = height / 720);
    const outline = (t: Phaser.GameObjects.Text, size: number, stroke = 6) =>
      t.setFontSize(Math.round(size * u)).setStroke(css(palette.ink), stroke * u);
    outline(this.score, 46, 8).setPosition(24 * u, 16 * u);
    outline(this.multiplier, 34, 7);
    outline(this.speed, 22, 5).setPosition(26 * u, 70 * u);
    outline(this.warning, 24, 6).setPosition(26 * u, 100 * u);
    // Left of the (DOM) pause button.
    outline(this.best, 22, 5).setPosition(width - 96 * u, 46 * u);
    // Coins under it: a little coin, its count to the left.
    const iconX = width - 124 * u;
    const iconY = 82 * u;
    outline(this.coins, 24, 6).setPosition(iconX - 20 * u, iconY);
    this.coinIcon.clear().setPosition(iconX, iconY);
    this.coinIcon.fillStyle(palette.ink, 1).fillCircle(0, 0, 13 * u);
    this.coinIcon.fillStyle(palette.coinRim, 1).fillCircle(0, 0, 10 * u);
    this.coinIcon.fillStyle(palette.coin, 1).fillCircle(0, 0, 7.5 * u);
    this.coinIcon.fillStyle(palette.coinShine, 1).fillEllipse(-3 * u, -3.5 * u, 3 * u, 5 * u);
    outline(this.ride, 22, 5).setPosition(26 * u, 136 * u);
    for (const t of this.barLabels) outline(t, 17, 4);
    outline(this.hint, 28, 6).setPosition(width / 2, height - 28 * u);
    outline(this.keys, 17, 4).setPosition(width - 20 * u, height - 16 * u);
    this.debug.setFontSize(Math.round(14 * u)).setPosition(16 * u, height - 64 * u);
  }

  setVisible(visible: boolean): void {
    for (const item of this.items) item.setVisible(visible);
    if (visible && !this.hintShown) this.hint.setVisible(false);
  }

  update(s: HudStats, dt: number): void {
    this.time += dt;
    const u = this.unit;
    this.score.setText(fmt(s.score));
    this.speed.setText(`${fmt(s.metres)} m   ${Math.round(s.kmh)} km/h`);
    this.best.setText(s.best > 0 ? `Best ${fmt(Math.max(s.best, s.score))}` : '');

    this.multiplier.setText(s.multiplier > 1 ? `×${s.multiplier}` : '');
    this.multiplier.setPosition(this.score.x + this.score.width + 12 * u, this.score.y + this.score.height * 0.55);
    if (s.multiplier > this.lastMultiplier) {
      this.scene.tweens.add({ targets: this.multiplier, scale: { from: 1.6, to: 1 }, duration: 260, ease: 'Back.Out' });
    }
    this.lastMultiplier = s.multiplier;

    if (s.coins !== this.lastCoins) {
      this.coins.setText(String(s.coins));
      if (s.coins > this.lastCoins) this.scene.tweens.add({ targets: this.coinIcon, scale: { from: 1.35, to: 1 }, duration: 180, ease: 'Quad.Out' });
      this.lastCoins = s.coins;
    }

    // What you're riding, popping in when it changes; timer bars under it.
    const stack = s.stack.join(' + ');
    if (stack !== this.lastStack) {
      this.ride.setText(stack ? `Riding: ${stack}` : '');
      if (stack) this.scene.tweens.add({ targets: this.ride, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.Out' });
      this.lastStack = stack;
    }
    this.bars.clear();
    const timers = [
      ['Flight', s.eagle, palette.eagleBeak],
      ['Fuel', s.fuel, palette.sledBody],
    ] as const;
    let row = 0;
    for (const [label, left, color] of timers) {
      const text = this.barLabels[row];
      if (left === null) continue;
      const y = (164 + 26 * row) * u;
      text.setText(label).setPosition(26 * u, y).setVisible(true);
      const x0 = 26 * u + 64 * u;
      const w = 150 * u;
      const h = 12 * u;
      // Flash when nearly out.
      const low = left < 0.25 && Math.sin(this.time * 14) > 0;
      this.bars.fillStyle(palette.ink, 0.75).fillRoundedRect(x0 - 3 * u, y - h / 2 - 3 * u, w + 6 * u, h + 6 * u, 6 * u);
      this.bars.fillStyle(low ? 0xffffff : color, 1).fillRoundedRect(x0, y - h / 2, Math.max(h, w * left), h, 4 * u);
      row++;
    }
    for (let i = row; i < this.barLabels.length; i++) this.barLabels[i].setVisible(false);

    const warn = s.avalancheM < WARN_METRES;
    this.warning.setText(warn ? `Avalanche! ${Math.max(0, Math.floor(s.avalancheM))} m` : '');
    this.warning.setAlpha(0.75 + 0.25 * Math.sin(this.time * 12));
  }

  dismissHint(): void {
    if (!this.hintShown) return;
    this.hintShown = false;
    this.scene.tweens.add({ targets: this.hint, alpha: 0, duration: 800, delay: 1500 });
  }

  setDebug(text: string | null): void {
    this.debug.setVisible(text !== null);
    if (text !== null) this.debug.setText(text);
  }

  /** Floating callout ("BACKFLIP!") at a screen position. */
  popup(text: string, x: number, y: number, color: number, size = 34): void {
    const u = this.unit;
    const t = this.scene.add
      .text(x, y, text, { fontFamily: FONT, fontStyle: '600', color: css(color) })
      .setFontSize(Math.round(size * u))
      .setStroke(css(palette.ink), 7 * u)
      .setOrigin(0.5)
      .setScale(0.6);
    this.layer.add(t);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.Out' });
    this.scene.tweens.add({
      targets: t,
      y: y - 70 * u,
      alpha: 0,
      delay: 450,
      duration: 650,
      ease: 'Quad.In',
      onComplete: () => t.destroy(),
    });
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
