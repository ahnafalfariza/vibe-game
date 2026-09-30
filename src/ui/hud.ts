import Phaser from 'phaser';
import { FONT, css, palette } from '../render/palette';

// Screen-space UI, drawn by the un-zoomed UI camera. All sizes scale with
// screen height (designed at 720px tall).

export interface HudStats {
  metres: number;
  kmh: number;
  flips: number;
  bestAir: number;
}

export class Hud {
  private readonly distance: Phaser.GameObjects.Text;
  private readonly speed: Phaser.GameObjects.Text;
  private readonly stats: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly keys: Phaser.GameObjects.Text;
  private readonly debug: Phaser.GameObjects.Text;
  readonly restartButton: Phaser.GameObjects.Text;
  private unit = 1;
  private width = 0;
  private height = 0;
  private hintShown = true;

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
    this.distance = add('0 m', { fontStyle: '600' });
    this.speed = add('', { fontStyle: '500' });
    this.stats = add('', { fontStyle: '500' }).setOrigin(1, 0);
    this.hint = add(touch ? 'Tap to jump  ·  hold to backflip' : 'Space / click to jump  ·  hold to backflip', { fontStyle: '600' }).setOrigin(0.5, 1);
    this.keys = add(touch ? '' : 'R  new run   ·   T  tune feel   ·   D  debug', { fontStyle: '500' }).setOrigin(1, 1).setAlpha(0.8);
    this.debug = add('', { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: css(palette.ink) }).setOrigin(0, 1);
    this.debug.setVisible(false);
    this.restartButton = add('↻', { fontStyle: '600' }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.restartButton.setVisible(touch);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const u = (this.unit = height / 720);
    const outline = (t: Phaser.GameObjects.Text, size: number, stroke = 6) =>
      t.setFontSize(Math.round(size * u)).setStroke(css(palette.ink), stroke * u);
    outline(this.distance, 46, 8).setPosition(24 * u, 16 * u);
    outline(this.speed, 22, 5).setPosition(26 * u, 70 * u);
    outline(this.stats, 22, 5).setPosition(width - 24 * u, 18 * u);
    outline(this.hint, 28, 6).setPosition(width / 2, height - 28 * u);
    outline(this.keys, 17, 4).setPosition(width - 20 * u, height - 16 * u);
    this.debug.setFontSize(Math.round(14 * u)).setPosition(16 * u, height - 64 * u);
    outline(this.restartButton, 44, 7).setPosition(width - 22 * u, 52 * u);
    if (this.restartButton.visible) this.stats.setPosition(width - 24 * u, 14 * u);
  }

  update(s: HudStats): void {
    this.distance.setText(`${Math.floor(s.metres)} m`);
    this.speed.setText(`${Math.round(s.kmh)} km/h`);
    this.stats.setText(`Flips ${s.flips}   ·   Best air ${s.bestAir.toFixed(1)}s`);
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
