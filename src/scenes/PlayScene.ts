import Phaser from 'phaser';
import { Run, SIM_DT } from '../sim/run';
import { wrapAngle, type SkierEvent } from '../sim/skier';
import { randomSeed } from '../sim/rng';
import { PX_PER_METRE, type Tuning } from '../tuning';
import { Background } from '../render/background';
import { TerrainView } from '../render/terrainView';
import { SkierView } from '../render/skierView';
import { SnowSpray, Snowfall } from '../render/effects';
import { palette } from '../render/palette';
import { Hud } from '../ui/hud';
import type { Tuner } from '../ui/tuner';

export interface GameContext {
  tuning: Tuning;
  tuner: Tuner;
  /** From ?seed=… — replay the same mountain every run. */
  fixedSeed: number | null;
  debug: boolean;
  touch: boolean;
}

/** World px visible vertically at zoom multiplier 1 (the design height). */
const DESIGN_HEIGHT = 720;
const MIN_ZOOM_MUL = 0.42;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export class PlayScene extends Phaser.Scene {
  private run!: Run;
  private worldCam!: Phaser.Cameras.Scene2D.Camera;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private background!: Background;
  private terrainView!: TerrainView;
  private skierView!: SkierView;
  private spray!: SnowSpray;
  private snowfall!: Snowfall;
  private hud!: Hud;

  // Per-run state (reset in create(): the scene instance is reused on restart).
  private simEvents: SkierEvent[] = [];
  private accumulator = 0;
  private prev = { x: 0, y: 0, angle: 0 };
  private pressed = false;
  private keyHeld = false;
  private pointersDown = new Set<number>();
  private view = { x: 0, y: 0, zoomMul: 1, leadX: 0, leadY: 0 };
  private bgScroll = 0;
  private debugTimer = 0;

  constructor(private readonly ctx: GameContext) {
    super('play');
  }

  create(data: { seed?: number }): void {
    const seed = data.seed ?? this.ctx.fixedSeed ?? randomSeed();
    this.run = new Run(seed, this.ctx.tuning);
    this.simEvents = [];
    this.accumulator = 0;
    this.pressed = false;
    this.keyHeld = false;
    this.pointersDown = new Set();
    this.bgScroll = 0;
    this.debugTimer = 0;
    const sk = this.run.skier;
    this.prev = { x: sk.x, y: sk.y, angle: sk.angle };
    this.view = { x: sk.x, y: sk.y, zoomMul: 1, leadX: 0, leadY: 0 };

    // Three cameras: an un-zoomed backdrop, the zooming world, and crisp UI.
    const { width, height } = this.scale;
    const bgCam = this.cameras.main;
    this.worldCam = this.cameras.add(0, 0, width, height, false, 'world');
    this.uiCam = this.cameras.add(0, 0, width, height, false, 'ui');
    // Layers render in creation order, so terrain chunks created later still
    // stay behind the skier.
    const bgLayer = this.add.layer();
    const terrainLayer = this.add.layer();
    const actorLayer = this.add.layer();
    const uiLayer = this.add.layer();
    bgCam.ignore([terrainLayer, actorLayer, uiLayer]);
    this.worldCam.ignore([bgLayer, uiLayer]);
    this.uiCam.ignore([bgLayer, terrainLayer, actorLayer]);

    this.background = new Background(this, bgLayer);
    this.terrainView = new TerrainView(this, terrainLayer, this.run.terrain);
    this.spray = new SnowSpray(this, actorLayer);
    this.skierView = new SkierView(this, actorLayer);
    this.snowfall = new Snowfall(this, uiLayer);
    this.hud = new Hud(this, uiLayer, this.ctx.touch);

    this.setupInput();
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    this.onResize();
  }

  newRun(): void {
    this.scene.restart({ seed: this.ctx.fixedSeed ?? randomSeed() });
  }

  private setupInput(): void {
    this.input.addPointer(2);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.includes(this.hud.restartButton)) {
        this.newRun();
        return;
      }
      this.pointersDown.add(p.id);
      this.pressed = true;
    });
    const up = (p: Phaser.Input.Pointer) => this.pointersDown.delete(p.id);
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);

    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('SPACE,UP');
      const isJumpKey = (code: string) => code === 'Space' || code === 'ArrowUp' || code === 'KeyW';
      kb.on('keydown', (e: KeyboardEvent) => {
        if ((e.target as HTMLElement | null)?.closest?.('.lil-gui')) return;
        if (isJumpKey(e.code)) {
          if (!e.repeat) this.pressed = true;
          this.keyHeld = true;
        } else if (e.code === 'KeyR') this.newRun();
        else if (e.code === 'KeyT') this.ctx.tuner.toggle();
        else if (e.code === 'KeyD') this.ctx.debug = !this.ctx.debug;
      });
      kb.on('keyup', (e: KeyboardEvent) => {
        if (isJumpKey(e.code)) this.keyHeld = false;
      });
    }
    // Never leave the button "stuck down" when the tab loses focus.
    const release = () => {
      this.keyHeld = false;
      this.pointersDown.clear();
    };
    this.game.events.on('blur', release);
    this.events.once('shutdown', () => this.game.events.off('blur', release));
  }

  private onResize(): void {
    const { width, height } = this.scale;
    for (const cam of [this.cameras.main, this.worldCam, this.uiCam]) cam.setSize(width, height);
    this.background.resize(width, height);
    this.snowfall.resize(width, height);
    this.hud.resize(width, height);
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    const sk = this.run.skier;

    this.accumulator += dt;
    while (this.accumulator >= SIM_DT) {
      this.prev.x = sk.x;
      this.prev.y = sk.y;
      this.prev.angle = sk.angle;
      this.run.step({ held: this.keyHeld || this.pointersDown.size > 0, pressed: this.pressed }, this.simEvents);
      this.pressed = false;
      this.accumulator -= SIM_DT;
    }

    // Render between the last two simulation steps for smooth motion at any refresh rate.
    const a = this.accumulator / SIM_DT;
    const x = lerp(this.prev.x, sk.x, a);
    const y = lerp(this.prev.y, sk.y, a);
    const angle = this.prev.angle + wrapAngle(sk.angle - this.prev.angle) * a;

    const { width, height } = this.scale;
    const prevViewX = this.view.x;
    const prevViewY = this.view.y;
    const zoom = this.updateCamera(x, y, dt);
    this.handleEvents(zoom);

    const halfW = width / zoom / 2;
    this.terrainView.update(this.view.x - halfW, this.view.x + halfW);
    this.skierView.update(x, y, angle, sk.vx, sk.vy, sk.mode === 'crash', dt);
    this.spray.update(x, y, sk.velocity, sk.mode === 'ground', dt);

    this.bgScroll += (this.view.x - prevViewX) * zoom;
    const lift = Math.min(sk.heightAboveGround() * zoom * 0.25, height * 0.12);
    this.background.update(this.bgScroll, lift, dt);
    this.snowfall.update((this.view.x - prevViewX) * zoom, (this.view.y - prevViewY) * zoom, dt);

    this.hud.update({
      metres: this.run.distancePx() / PX_PER_METRE,
      kmh: (sk.velocity / PX_PER_METRE) * 3.6,
      flips: this.run.stats.flips,
      bestAir: this.run.stats.bestAirTime,
    });
    this.updateDebug(dt, zoom);
  }

  /** Frame the skier and the snow below them; zoom out with speed and height. Returns the zoom. */
  private updateCamera(x: number, y: number, dt: number): number {
    const { width, height } = this.scale;
    const sk = this.run.skier;
    const v = this.view;
    const air = sk.heightAboveGround();

    const targetMul = Math.max(MIN_ZOOM_MUL, 1 / (1 + Math.max(0, sk.velocity - 700) / 2200 + air / 1000));
    v.zoomMul = damp(v.zoomMul, targetMul, targetMul < v.zoomMul ? 3 : 1.5, dt);
    const zoom = (height / DESIGN_HEIGHT) * v.zoomMul;
    const viewW = width / zoom;
    const viewH = height / zoom;

    // Keep the skier left of centre (the mountain is ahead), and when airborne
    // aim between the skier and the ground so the landing is visible.
    const targetLeadX = viewW * 0.14 + Math.max(0, sk.vx) * 0.08;
    const targetLeadY = air * 0.5 + viewH * 0.06;
    v.leadX = damp(v.leadX, targetLeadX, 3, dt);
    v.leadY = damp(v.leadY, targetLeadY, 4, dt);
    v.x = x + v.leadX;
    v.y = y + v.leadY;

    this.worldCam.setZoom(zoom);
    this.worldCam.centerOn(v.x, v.y);
    return zoom;
  }

  private handleEvents(zoom: number): void {
    const { width, height } = this.scale;
    const toScreen = (wx: number, wy: number): [number, number] => [
      (wx - this.view.x) * zoom + width / 2,
      (wy - this.view.y) * zoom + height / 2,
    ];
    for (const e of this.simEvents) {
      if (e.type === 'jump') {
        this.spray.burst(e.x, e.y, 6);
        this.hud.dismissHint();
      } else if (e.type === 'land') {
        const [sx, sy] = toScreen(e.x, e.y);
        const popY = sy - 110 * (height / DESIGN_HEIGHT);
        if (e.airTime > 0.15) this.skierView.land(Math.min(1, 0.25 + e.airTime * 0.5));
        if (e.airTime > 0.25) this.spray.burst(e.x, e.y, Math.round(6 + e.airTime * 14));
        if (e.quality === 'crash') {
          this.hud.popup('Wipeout!', sx, popY, palette.scarf, 40);
          this.spray.burst(e.x, e.y, 30);
          this.worldCam.shake(260, 0.006);
        } else if (e.quality === 'sloppy') {
          this.hud.popup(e.flips > 0 ? flipName(e.flips) + ' — sloppy' : 'Sloppy', sx, popY, 0xffd6a5, 26);
        } else if (e.flips > 0) {
          this.hud.popup(flipName(e.flips), sx, popY, palette.beanie, 34 + 6 * Math.min(e.flips, 3));
        } else if (e.airTime > 1.1) {
          this.hud.popup('Big air!', sx, popY, 0xffffff, 28);
        }
      }
    }
    this.simEvents.length = 0;
  }

  private updateDebug(dt: number, zoom: number): void {
    if (!this.ctx.debug) {
      this.hud.setDebug(null);
      return;
    }
    this.debugTimer -= dt;
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.1;
    const sk = this.run.skier;
    const s = this.run.terrain.sample(sk.x);
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0).padStart(4);
    this.hud.setDebug(
      [
        `seed ${this.run.seed}   fps ${this.game.loop.actualFps.toFixed(0)}   zoom ${zoom.toFixed(2)}`,
        `mode ${sk.mode.padEnd(6)} speed ${sk.velocity.toFixed(0).padStart(5)} px/s   air ${sk.airTime.toFixed(2)}s`,
        `body ${deg(sk.angle)}°  slope ${deg(Math.atan(s.dy))}°  spin ${deg(sk.airRotation)}°  h ${sk.heightAboveGround().toFixed(0)}px`,
        `feature ${this.run.terrain.featureAt(sk.x)?.kind ?? '-'}   x ${sk.x.toFixed(0)}`,
      ].join('\n'),
    );
  }
}

function flipName(flips: number): string {
  if (flips === 1) return 'Backflip!';
  if (flips === 2) return 'Double backflip!';
  if (flips === 3) return 'Triple backflip!!';
  return `${flips}× backflip!!!`;
}
