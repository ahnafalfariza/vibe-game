import Phaser from 'phaser';
import { Run, SIM_DT, type RunEvent } from '../sim/run';
import { wrapAngle } from '../sim/skier';
import { BIG_AIR_TIME } from '../sim/score';
import { Rng, randomSeed } from '../sim/rng';
import { RunGoals, goalProgressText, goalText, goalValue, rideSummary, runSetup, type RunProgress } from '../sim/meta';
import { PX_PER_METRE, type Tuning } from '../tuning';
import { Background } from '../render/background';
import { TerrainView } from '../render/terrainView';
import { SkierView } from '../render/skierView';
import { SnowSpray, Snowfall } from '../render/effects';
import { AvalancheView } from '../render/avalancheView';
import { ObstacleView } from '../render/obstacleView';
import { MountView } from '../render/mountView';
import { ZoneGateView } from '../render/zoneGateView';
import { ZONE_METRES } from '../sim/spawner';
import { MOUNT_NAMES, type MountKind } from '../sim/mounts';
import { palette } from '../render/palette';
import { applyBiome, currentBiome } from '../biomes';
import { Hud } from '../ui/hud';
import type { Tuner } from '../ui/tuner';
import { loadBest, saveBest, type Menu } from '../ui/menu';
import { getProfile, persist } from '../profile';
import type { Sfx } from '../audio';

export interface GameContext {
  tuning: Tuning;
  tuner: Tuner;
  menu: Menu;
  sfx: Sfx;
  /** From ?seed=… — replay the same mountain every run. */
  fixedSeed: number | null;
  /** From ?mount=… — start every run riding this (instead of what perks and the shop give). */
  startMount: MountKind | null;
  debug: boolean;
  touch: boolean;
  /** OS "reduce motion" setting: no camera shake or flicker. */
  reducedMotion: boolean;
  /** Biome id for the next run (title-screen picker, ?biome=…). */
  biome: string;
}

/** World px visible vertically at zoom multiplier 1 (the design height). */
const DESIGN_HEIGHT = 720;
const MIN_ZOOM_MUL = 0.42;
/** Space kept above the skier's feet when framing a jump: body height plus margin, world px. */
const SKIER_HEADROOM = 140;
/** The avalanche rumble starts when it is this close, px. */
const DANGER_PX = 40 * PX_PER_METRE;
/** Once the avalanche is this close the camera keeps it in shot, px. */
const AVALANCHE_FRAME_PX = 1100;
/** Room left of the avalanche's foot, so its leaning face is in shot too, px. */
const AVALANCHE_MARGIN = 400;
/** With the avalanche in shot the skier may sit up to this far across the screen (0..1). */
const AVALANCHE_SKIER_POS = 0.7;
/** Time between being caught and the game-over screen, s. */
const CAUGHT_DELAY = 1.3;
/** Extra headroom when an eagle is carrying the yeti: the eagle is above it, world px. */
const EAGLE_HEADROOM = 110;
/** Wing beats while climbing, s apart. */
const FLAP_EVERY = 0.4;
/** Popup colour per mount. */
const MOUNT_COLOR: Record<MountKind, number> = {
  penguin: 0xbfe3ff,
  eagle: palette.eagleBeak,
  snowmobile: palette.sledBody,
  bear: palette.bearFur,
};

/** menu: title screen over a demo run · playing · paused · over: caught, then the game-over screen. */
type State = 'menu' | 'playing' | 'paused' | 'over';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export class PlayScene extends Phaser.Scene {
  private run!: Run;
  /** The title screen's demo run: no upgrades, perks or goals. */
  private demo = true;
  /** The profile's goals as this run sees them (null for the demo). */
  private goals: RunGoals | null = null;
  /** How the run stood when the avalanche caught it. */
  private final: RunProgress | null = null;
  private worldCam!: Phaser.Cameras.Scene2D.Camera;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private background!: Background;
  private terrainView!: TerrainView;
  private skierView!: SkierView;
  private spray!: SnowSpray;
  private snowfall!: Snowfall;
  private hud!: Hud;
  private avalancheView!: AvalancheView;
  private obstacleView!: ObstacleView;
  private mountView!: MountView;
  private zoneView!: ZoneGateView;

  // Per-run state (reset in create(): the scene instance is reused on restart).
  private state: State = 'menu';
  private best = 0;
  private overTimer = 0;
  private simEvents: RunEvent[] = [];
  private accumulator = 0;
  private prev = { x: 0, y: 0, angle: 0 };
  private pressed = false;
  private keyHeld = false;
  private pointersDown = new Set<number>();
  private view = { x: 0, y: 0, zoomMul: 1, leadX: 0, leadY: 0 };
  private bgScroll = 0;
  private debugTimer = 0;
  private flapTimer = 0;

  constructor(private readonly ctx: GameContext) {
    super('play');
  }

  create(data: { seed?: number; play?: boolean }): void {
    const seed = data.seed ?? this.ctx.fixedSeed ?? randomSeed();
    const play = data.play ?? false;
    this.state = play ? 'playing' : 'menu';
    this.best = loadBest();
    this.overTimer = 0;
    // Repaint before any view is built: they read the palette as they draw.
    const biome = applyBiome(this.ctx.biome);
    const profile = getProfile();
    this.demo = !play;
    const setup = runSetup(profile, this.ctx.tuning, this.demo);
    this.run = new Run(seed, setup.tuning, {
      avalanche: play,
      startMount: play && this.ctx.startMount ? this.ctx.startMount : setup.startMount,
      table: biome.spawns,
      terrain: biome.terrain,
      scoreMultiplier: setup.scoreMultiplier,
      multiplierFloor: setup.multiplierFloor,
      secondWind: setup.secondWind,
    });
    this.goals = play ? new RunGoals(profile, () => new Rng(randomSeed())) : null;
    this.final = null;
    this.simEvents = [];
    this.accumulator = 0;
    this.pressed = false;
    this.keyHeld = false;
    this.pointersDown = new Set();
    this.bgScroll = 0;
    this.debugTimer = 0;
    this.flapTimer = 0;
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
    const propLayer = this.add.layer();
    const actorLayer = this.add.layer();
    const avalancheLayer = this.add.layer();
    const uiLayer = this.add.layer();
    bgCam.ignore([terrainLayer, propLayer, actorLayer, avalancheLayer, uiLayer]);
    this.worldCam.ignore([bgLayer, uiLayer]);
    this.uiCam.ignore([bgLayer, terrainLayer, propLayer, actorLayer, avalancheLayer]);

    this.background = new Background(this, bgLayer);
    this.terrainView = new TerrainView(this, terrainLayer, this.run.terrain);
    this.spray = new SnowSpray(this, actorLayer);
    this.zoneView = new ZoneGateView(this, propLayer, this.run.terrain, this.run.startX);
    this.obstacleView = new ObstacleView(this, propLayer, this.run.spawner, this.run.terrain);
    this.mountView = new MountView(this, propLayer, actorLayer, this.run.spawner);
    // Depths in the actor layer: spray, the stack under the yeti, the yeti, an eagle carrying it.
    this.skierView = new SkierView(this, actorLayer);
    this.skierView.container.setDepth(2);
    this.avalancheView = new AvalancheView(this, avalancheLayer, this.run.terrain);
    this.snowfall = new Snowfall(this, uiLayer);
    this.hud = new Hud(this, uiLayer, this.ctx.touch);
    this.hud.setVisible(play);
    this.ctx.sfx.setPaused(false);
    if (play) this.ctx.menu.hide();
    else this.ctx.menu.showTitle(this.best);

    this.setupInput();
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    this.onResize();
  }

  /** A fresh mountain; keeps playing unless on the title screen (or `play` says otherwise). */
  newRun(play = this.state !== 'menu'): void {
    this.bank();
    this.scene.restart({ seed: this.ctx.fixedSeed ?? randomSeed(), play });
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.releaseInput();
    this.scene.pause();
    this.ctx.sfx.setPaused(true);
    const r = this.progress();
    this.ctx.menu.showPause(
      getProfile().level,
      (this.goals?.profile.goals ?? []).map((g) => ({
        text: goalText(g),
        progress: goalProgressText({ ...g, progress: goalValue(g, r) }),
        done: g.done,
        fresh: this.goals!.completed.has(g),
      })),
    );
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.scene.resume();
    this.ctx.sfx.setPaused(false);
    this.ctx.menu.hide();
  }

  /** Keep what a run left early earned: coins, goal progress, best distance. No-op once banked. */
  private bank(): void {
    if (!this.goals) return;
    this.goals.finish(this.final ?? this.progress());
    persist();
  }

  private releaseInput(): void {
    this.pressed = false;
    this.keyHeld = false;
    this.pointersDown.clear();
  }

  private setupInput(): void {
    this.input.addPointer(2);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
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
    // Never leave the button "stuck down" when the tab loses focus, and
    // don't let the avalanche get you while you're away.
    const away = () => {
      this.releaseInput();
      this.pause();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, away);
    this.game.events.on(Phaser.Core.Events.HIDDEN, away);
    // Closing the tab or swiping the app away is quitting too.
    const leave = () => this.bank();
    window.addEventListener('pagehide', leave);
    this.events.once('shutdown', () => {
      window.removeEventListener('pagehide', leave);
      this.game.events.off(Phaser.Core.Events.BLUR, away);
      this.game.events.off(Phaser.Core.Events.HIDDEN, away);
    });
  }

  private onResize(): void {
    const { width, height } = this.scale;
    for (const cam of [this.cameras.main, this.worldCam, this.uiCam]) cam.setSize(width, height);
    this.background.resize(width, height);
    this.snowfall.resize(width, height);
    this.hud.resize(width, height);
  }

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    const sk = this.run.skier;
    // The tuning panel edits the base tuning: carry it over live, upgrades and all.
    if (this.ctx.tuner.open) Object.assign(this.run.tuning, runSetup(getProfile(), this.ctx.tuning, this.demo).tuning);

    this.accumulator += dt;
    while (this.accumulator >= SIM_DT) {
      this.prev.x = sk.x;
      this.prev.y = sk.y;
      this.prev.angle = sk.angle;
      const live = this.state === 'playing';
      this.run.step({ held: live && (this.keyHeld || this.pointersDown.size > 0), pressed: live && this.pressed }, this.simEvents);
      this.pressed = false;
      this.accumulator -= SIM_DT;
    }
    if (this.state === 'playing') this.checkGoals();
    if (this.state === 'playing' && this.run.caught) this.onCaught();
    if (this.state === 'over' && this.overTimer > 0 && (this.overTimer -= dt) <= 0) this.showGameOver();

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
    this.zoneView.update(this.view.x - halfW, this.view.x + halfW);
    this.obstacleView.update(this.view.x - halfW, this.view.x + halfW, dt);
    const mounts = this.run.mounts;
    const held = this.state === 'playing' && (this.keyHeld || this.pointersDown.size > 0);
    this.mountView.update(this.run.spawner.mounts, mounts, x, y, angle, sk.velocity, held, this.view.x - halfW, this.view.x + halfW, dt);
    this.skierView.ride(sk.lift);
    this.skierView.update(x, y, angle, sk.vx, sk.vy, sk.mode === 'crash', dt);
    // Wing beats while an eagle climbs.
    if (mounts.state === 'carried' && held && (this.flapTimer -= dt) <= 0) {
      this.flapTimer = FLAP_EVERY;
      this.ctx.sfx.flap();
    }
    // Flicker while obstacles can't knock you down (just after getting up);
    // a steady fade instead with reduced motion.
    const invuln = sk.invulnTimer > 0 && sk.mode !== 'crash';
    this.skierView.container.setAlpha(!invuln ? 1 : this.ctx.reducedMotion ? 0.6 : Math.floor(time / 70) % 2 ? 0.35 : 1);
    // No snow kicked up on ice: the skis go quiet and slick (you can still jump as normal).
    const onIce = sk.mode === 'ground' && this.run.spawner.sample(sk.x).ice === true;
    this.spray.update(x, y, sk.velocity, sk.mode === 'ground' && !onIce && !this.run.caught, dt);
    if (this.run.avalanche) {
      const avSpeed = this.run.avalancheSpeed();
      // Interpolated like the skier, so the two don't jitter against each other.
      this.avalancheView.update(this.run.avalancheX - avSpeed * SIM_DT * (1 - a), this.view.x - halfW, avSpeed, dt);
    }

    this.bgScroll += (this.view.x - prevViewX) * zoom;
    const lift = Math.min(sk.heightAboveGround() * zoom * 0.25, height * 0.12);
    this.background.update(this.bgScroll, lift, dt);
    this.snowfall.update((this.view.x - prevViewX) * zoom, (this.view.y - prevViewY) * zoom, dt);

    const gap = this.run.avalanche ? this.run.avalancheGap() : Infinity;
    const danger = this.state === 'playing' ? Math.max(0, Math.min(1, 1 - gap / DANGER_PX)) : 0;
    this.hud.update(
      {
        score: this.run.score,
        multiplier: this.run.scoring.multiplier,
        metres: this.run.distancePx() / PX_PER_METRE,
        kmh: (sk.velocity / PX_PER_METRE) * 3.6,
        best: this.best,
        avalancheM: gap / PX_PER_METRE,
        coins: this.run.stats.coins,
        stack: [...mounts.stack, ...(mounts.state === 'carried' ? (['eagle'] as const) : [])].map((k) => MOUNT_NAMES[k]),
        eagle: mounts.state === 'carried' ? mounts.eagleTime / this.run.tuning.eagleTime : null,
        fuel: mounts.stack[0] === 'snowmobile' ? mounts.fuel / this.run.tuning.snowmobileFuel : null,
        level: getProfile().level,
        levelMultiplier: this.run.scoreMultiplier,
      },
      dt,
    );
    this.ctx.sfx.ambience({
      speed: this.run.caught ? 0 : sk.velocity,
      grounded: sk.mode !== 'air' && !this.run.caught,
      danger,
      playing: this.state !== 'menu',
      caught: this.run.caught,
      engine: mounts.stack[0] === 'snowmobile' && !this.run.caught ? sk.velocity : 0,
    });
    this.updateDebug(dt, zoom);
  }

  private shake(ms: number, intensity: number): void {
    if (!this.ctx.reducedMotion) this.worldCam.shake(ms, intensity);
  }

  private progress(): RunProgress {
    return { stats: this.run.stats, metres: this.run.distancePx() / PX_PER_METRE, score: this.run.score, seconds: this.run.time, biome: currentBiome().id };
  }

  /** Goals met mid-run: a toast and a chime, saved straight away. */
  private checkGoals(): void {
    if (!this.goals) return;
    const done = this.goals.check(this.progress());
    for (const g of done) {
      const all = this.goals.profile.goals.every((x) => x.done);
      this.hud.toast(all ? 'All 3 goals done! Level up at the finish' : 'Goal complete!', goalText(g));
      this.ctx.sfx.goal();
    }
    if (done.length) persist();
  }

  private onCaught(): void {
    this.final = this.progress();
    this.state = 'over';
    this.overTimer = CAUGHT_DELAY;
    this.releaseInput();
    this.skierView.container.setVisible(false);
    const sk = this.run.skier;
    this.spray.burst(sk.x, sk.y, 40);
    this.shake(500, 0.012);
    this.ctx.sfx.caught();
    this.ctx.menu.hideAll();
  }

  private showGameOver(): void {
    const score = this.run.score;
    const newBest = score > this.best;
    if (newBest) saveBest(score);
    const st = this.run.stats;
    const level = getProfile().level;
    const summary = this.goals!.finish(this.final ?? this.progress());
    persist();
    if (summary.levelUp) this.ctx.sfx.levelUp();
    this.hud.setVisible(false);
    this.ctx.menu.showGameOver({
      score,
      metres: this.run.distancePx() / PX_PER_METRE,
      flips: st.flips,
      coins: summary.coins,
      wallet: summary.wallet,
      bestAir: st.bestAirTime,
      best: Math.max(score, this.best),
      newBest,
      rides: rideSummary(st),
      zone: st.zone,
      level,
      levelMultiplier: this.run.scoreMultiplier,
      goals: summary.goals.map((g) => ({ text: goalText(g), progress: goalProgressText(g), done: g.done, fresh: g.fresh })),
      levelUp: summary.levelUp && {
        level: summary.levelUp.level,
        multiplier: summary.levelUp.multiplier,
        coins: summary.levelUp.coins,
        finale: summary.levelUp.finale,
        unlocks: summary.levelUp.perks.map(({ name, text }) => ({ name, text })),
      },
    });
  }

  /**
   * Frame the skier and, in the air, where they're going to land (you need to
   * see the landing to time a flip). Zoom out with speed. Returns the zoom.
   */
  private updateCamera(x: number, y: number, dt: number): number {
    const { width, height } = this.scale;
    const sk = this.run.skier;
    const v = this.view;
    const baseZoom = height / DESIGN_HEIGHT;

    // Box that must stay on screen: the skier, plus apex and landing spot when airborne.
    const airborne = sk.mode === 'air';
    let right = x;
    let top = y;
    let bottom = y;
    if (airborne) {
      const land = this.predictLanding();
      right = Math.max(x, land.x);
      bottom = Math.max(y, land.y);
      const apex = sk.vy < 0 && !sk.carried ? y - (sk.vy * sk.vy) / (2 * this.ctx.tuning.gravity) : y;
      top = apex - SKIER_HEADROOM - sk.lift - (sk.carried ? EAGLE_HEADROOM : 0);
    }
    // Keep a close avalanche in shot: seeing what's chasing you is the tension.
    // It's uphill, so the box grows upwards as well as backwards.
    const gap = this.run.avalanche && !this.run.caught ? x - this.run.avalancheX : Infinity;
    const behind = gap < AVALANCHE_FRAME_PX ? Math.max(0, gap) + AVALANCHE_MARGIN : 0;
    if (behind > 0) top = Math.min(top, this.run.terrain.height(this.run.avalancheX) - 350);
    const fitMul = Math.min(
      width / (baseZoom * ((right - x) / 0.62 + 200)),
      width / (baseZoom * (behind / AVALANCHE_SKIER_POS)),
      height / (baseZoom * ((bottom - top) / 0.7 + 220)),
    );
    const speedMul = 1 / (1 + Math.max(0, sk.velocity - 700) / 2200);
    const targetMul = Math.max(MIN_ZOOM_MUL, Math.min(1, speedMul, fitMul));
    v.zoomMul = damp(v.zoomMul, targetMul, targetMul < v.zoomMul ? 4 : 1.5, dt);
    const zoom = baseZoom * v.zoomMul;
    const viewW = width / zoom;
    const viewH = height / zoom;

    // Keep the skier left of centre (the mountain is ahead) and centre the box.
    let targetLeadX = Math.max(viewW * 0.14 + Math.max(0, sk.vx) * 0.08, (right - x) * 0.5);
    // Slide the skier right to make room, but never far past centre (the zoom catches up).
    if (behind > 0) targetLeadX = Math.max(viewW * (0.5 - AVALANCHE_SKIER_POS), Math.min(targetLeadX, viewW / 2 - behind));
    const targetLeadY = (top + bottom) / 2 - y + (airborne ? 0 : viewH * 0.06);
    v.leadX = damp(v.leadX, targetLeadX, behind > 0 ? 6 : 3, dt);
    v.leadY = damp(v.leadY, targetLeadY, airborne ? 8 : 4, dt);
    v.x = x + v.leadX;
    v.y = y + v.leadY;

    this.worldCam.setZoom(zoom);
    this.worldCam.centerOn(v.x, v.y);
    return zoom;
  }

  /** Where a drag-free projectile from the skier's current state meets the snow. */
  private predictLanding(): { x: number; y: number } {
    const sk = this.run.skier;
    const g = this.ctx.tuning.gravity;
    const step = 1 / 30;
    let { x, y, vx, vy } = sk;
    for (let i = 0; i < 150; i++) {
      vy += g * step;
      x += vx * step;
      y += vy * step;
      const ground = this.run.spawner.height(x);
      if (y >= ground) return { x, y: ground };
    }
    return { x, y };
  }

  private handleEvents(zoom: number): void {
    const { width, height } = this.scale;
    const toScreen = (wx: number, wy: number): [number, number] => [
      (wx - this.view.x) * zoom + width / 2,
      (wy - this.view.y) * zoom + height / 2,
    ];
    const u = height / DESIGN_HEIGHT;
    // The title screen's demo run is silent apart from the ambience.
    const sfx = this.state === 'playing' ? this.ctx.sfx : null;
    for (const e of this.simEvents) {
      if (e.type === 'jump') {
        this.spray.burst(e.x, e.y, 6);
        sfx?.jump();
        this.hud.dismissHint();
      } else if (e.type === 'land') {
        const [sx, sy] = toScreen(e.x, e.y);
        const popY = sy - 150 * u;
        if (e.airTime > 0.15) this.skierView.land(Math.min(1, 0.25 + e.airTime * 0.5));
        if (e.airTime > 0.25) this.spray.burst(e.x, e.y, Math.round(6 + e.airTime * 14));
        sfx?.land(Math.min(1, e.airTime * 0.7));
        if (e.quality === 'crash') {
          this.hud.popup('Wipeout!', sx, popY, palette.scarf, 40);
          this.spray.burst(e.x, e.y, 30);
          this.shake(260, 0.006);
          sfx?.crash();
        } else if (e.quality === 'sloppy') {
          this.hud.popup(e.flips > 0 ? flipName(e.flips) + ' — sloppy' : 'Sloppy', sx, popY, 0xffd6a5, 26);
          sfx?.sloppy();
        } else if (e.flips > 0) {
          this.hud.popup(flipName(e.flips), sx, popY, palette.beanie, 34 + 6 * Math.min(e.flips, 3));
          sfx?.trick(e.flips, this.run.scoring.multiplier);
        } else if (e.airTime > BIG_AIR_TIME) {
          this.hud.popup('Big air!', sx, popY, 0xffffff, 28);
        }
      } else if (e.type === 'award' && this.state === 'playing') {
        const [sx, sy] = toScreen(e.x, e.y);
        this.hud.popup(`+${e.points}` + (e.multiplier > 1 ? ` ×${e.multiplier}` : ''), sx, sy - 108 * u, 0xffffff, 24);
      } else if (e.type === 'hit') {
        const [sx, sy] = toScreen(e.x, e.y);
        this.obstacleView.hit(e.x, e.y, e.obstacle, e.saved === 'smash');
        this.spray.burst(e.x, e.y, e.obstacle === 'cabin' ? 36 : 20);
        sfx?.thud(e.obstacle);
        if (e.crashed) {
          this.hud.popup('Wipeout!', sx, sy - 150 * u, palette.scarf, 40);
          this.shake(320, 0.009);
          sfx?.crash();
        } else {
          this.shake(200, 0.005);
        }
      } else if (e.type === 'mount') {
        const [sx, sy] = toScreen(e.x, e.y);
        this.spray.burst(e.x, e.y, 14);
        if (sfx) this.hud.popup(`${MOUNT_NAMES[e.kind]}!`, sx, sy - 190 * u, MOUNT_COLOR[e.kind], 36);
        sfx?.mount(e.kind);
      } else if (e.type === 'dismount') {
        const [sx, sy] = toScreen(e.x, e.y);
        this.mountView.onEvent(e, this.run.mounts, this.run.skier.vx, this.run.skier.vy);
        if (e.reason === 'rock' || e.reason === 'cabin' || e.reason === 'landing') {
          // A shield gone: it took the hit for you.
          if (sfx) this.hud.popup(`Lost the ${MOUNT_NAMES[e.kind].toLowerCase()}!`, sx, sy - 170 * u, 0xffd6a5, 30);
          this.spray.burst(e.x, e.y, 24);
          this.shake(260, 0.007);
          sfx?.shieldBreak();
        } else if (e.reason === 'fuel') {
          if (sfx) this.hud.popup('Out of fuel!', sx, sy - 170 * u, 0xffd6a5, 28);
          sfx?.sputter();
        } else if (e.reason === 'release') {
          sfx?.flap();
        }
      } else if (e.type === 'zone') {
        if (sfx) this.hud.toast(`Zone ${e.zone}!`, `${((e.zone - 1) * ZONE_METRES).toLocaleString('en-US')} m · +${e.points} points`);
        sfx?.zone();
      } else if (e.type === 'secondWind') {
        this.hud.toast('Second wind!', 'The avalanche fell back 30 m');
        this.spray.burst(e.x, e.y, 40);
        this.shake(400, 0.01);
        sfx?.secondWind();
      } else if (e.type === 'smash') {
        const [sx, sy] = toScreen(e.x, e.y);
        if (sfx) this.hud.popup('Smash!', sx, sy - 200 * u, palette.bearFur, 40);
        this.shake(300, 0.01);
        sfx?.roar();
      } else if (e.type === 'coin') {
        this.obstacleView.collect(e.x, e.y);
        sfx?.coin(e.index);
      } else if (e.type === 'cluster') {
        const [sx, sy] = toScreen(e.x, e.y);
        this.obstacleView.collect(e.x, e.y, true);
        if (sfx) this.hud.popup(`All ${e.size} coins! Boost!`, sx, sy - 130 * u, palette.coin, 30);
        sfx?.coinCluster();
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
    const s = this.run.spawner.sample(sk.x);
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0).padStart(4);
    const counts: Record<string, number> = { rock: 0, cabin: 0, ice: 0, coin: 0 };
    let next = '-';
    let nextD = Infinity;
    for (const e of this.run.spawner.entities) {
      counts[e.kind]++;
      const d = e.x0 - sk.x;
      if (e.kind !== 'coin' && d > 0 && d < nextD) {
        nextD = d;
        next = `${e.kind} in ${d.toFixed(0)}px (${(d / Math.max(1, sk.vx)).toFixed(2)}s)`;
      }
    }
    this.hud.setDebug(
      [
        `seed ${this.run.seed}   fps ${this.game.loop.actualFps.toFixed(0)}   zoom ${zoom.toFixed(2)}`,
        `mode ${sk.mode.padEnd(6)} speed ${sk.velocity.toFixed(0).padStart(5)} px/s   air ${sk.airTime.toFixed(2)}s` +
          (sk.invulnTimer > 0 ? `   invuln ${sk.invulnTimer.toFixed(2)}s` : ''),
        `body ${deg(sk.angle)}°  slope ${deg(Math.atan(s.dy))}°  spin ${deg(sk.airRotation)}°  h ${sk.heightAboveGround().toFixed(0)}px${s.ice ? '  ICE' : ''}`,
        `feature ${this.run.terrain.featureAt(sk.x)?.kind ?? '-'}   x ${sk.x.toFixed(0)}`,
        `entities rock ${counts.rock}  cabin ${counts.cabin}  ice ${counts.ice}  coin ${counts.coin}   next ${next}`,
        `ride ${this.run.mounts.state} [${this.run.mounts.stack.join(' > ') || '-'}]  lift ${sk.lift}` +
          (this.run.mounts.eagleTime > 0 ? `  eagle ${this.run.mounts.eagleTime.toFixed(1)}s` : '') +
          (this.run.mounts.stack[0] === 'snowmobile' ? `  fuel ${this.run.mounts.fuel.toFixed(1)}s` : '') +
          `   waiting ${this.run.spawner.mounts.filter((m) => !m.taken && m.x > sk.x).map((m) => `${m.kind}+${(m.x - sk.x).toFixed(0)}`).join(' ') || '-'}`,
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
