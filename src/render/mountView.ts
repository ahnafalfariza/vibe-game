import Phaser from 'phaser';
import { MOUNTS, type MountEvent, type MountKind, type Mounts, type WildMount } from '../sim/mounts';
import type { Ground } from '../sim/skier';
import { palette } from './palette';
import { SCALE, ell, limb, painter, type Part, type Pt } from './skierView';

// The mounts, drawn in code in the yeti's style: flat fills, one dark indigo
// outline around each silhouette, animated by rotating a few parts (flippers,
// legs, wings) rather than frame by frame. Every mount is a Rig: a container
// whose origin is where it meets the snow (the eagle's: the middle of its
// body), scaled like the yeti.
//
// Three kinds of use: mounts waiting on the slope (pooled, prop layer), the
// stack under the yeti plus the eagle carrying it (actor layer, around the
// yeti), and mounts leaving: knocked off, swapped, out of fuel or let go
// (procedural motion, then back to the pool).

type G = Phaser.GameObjects.Graphics;
/** idle: waiting on the slope · ridden: under the yeti (or carrying it) · run: hurrying off · tumble: knocked flying. */
type Pose = 'idle' | 'ridden' | 'run' | 'tumble';

interface Rig {
  readonly kind: MountKind;
  readonly root: Phaser.GameObjects.Container;
  /** Animate. `t`: its own clock, s. `moving`: walking / sliding / flapping hard (0..1). */
  pose(t: number, pose: Pose, moving: number): void;
}

/** A mount leaving the stack, moving on its own until it's off screen. */
interface Leaver {
  rig: Rig;
  style: 'tumble' | 'run' | 'park' | 'fly';
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  t: number;
}

/** The eagle is drawn bigger than the rest: it has to carry the lot. */
const EAGLE_SCALE = 1.4;
/** The eagle's talons grip this far above the yeti's feet: the top of its beanie, world px. */
const GRIP_UP = 92;
/** …and its body sits this far above the talons, world px. */
const EAGLE_BODY_UP = 29 * SCALE * EAGLE_SCALE;
/** Exhaust pipe on the snowmobile, local px. */
const EXHAUST: Pt = [-60, -20];
/** Show waiting mounts this far beyond the edges of the view, px. */
const MARGIN = 400;
/** Leaving mounts are dropped after this long, s. */
const LEAVE_TIME = 3;

export class MountView {
  private readonly pools: Record<MountKind, Rig[]> = { penguin: [], eagle: [], snowmobile: [], bear: [] };
  private readonly wild = new Map<WildMount, Rig>();
  /** The stack under the yeti (one rig per kind: there's only ever one of each). */
  private readonly ridden: Record<Exclude<MountKind, 'eagle'>, Rig>;
  /** The eagle carrying the yeti. */
  private readonly carrier: Rig;
  private readonly leaving: Leaver[] = [];
  private readonly exhaust: Phaser.GameObjects.Particles.ParticleEmitter;
  private time = 0;
  private puff = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    /** Waiting and leaving mounts: behind the yeti, with the obstacles. */
    private readonly propLayer: Phaser.GameObjects.Layer,
    /** The stack and the carrying eagle: around the yeti. */
    actorLayer: Phaser.GameObjects.Layer,
    private readonly ground: Ground,
  ) {
    const under = (kind: Exclude<MountKind, 'eagle'>) => {
      const rig = RIGS[kind](scene);
      actorLayer.add(rig.root.setDepth(1).setVisible(false));
      return rig;
    };
    this.ridden = { penguin: under('penguin'), snowmobile: under('snowmobile'), bear: under('bear') };
    this.carrier = RIGS.eagle(scene);
    actorLayer.add(this.carrier.root.setDepth(3).setVisible(false));
    // Reuses the dot texture made by SnowSpray.
    this.exhaust = scene.add.particles(0, 0, 'fx-dot', {
      emitting: false,
      tint: palette.exhaust,
      lifespan: { min: 450, max: 800 },
      speed: { min: 30, max: 90 },
      angle: { min: 150, max: 210 },
      scale: { start: 0.45, end: 1.3 },
      alpha: { start: 0.75, end: 0 },
      gravityY: -80,
    });
    actorLayer.add(this.exhaust.setDepth(0.5));
  }

  /**
   * Draw the frame. `x, y, angle`: the skier (interpolated), the bottom of the
   * stack. `speed` drives the exhaust; `flapping`: a carrying eagle beats hard.
   * `left, right`: the view, world x.
   */
  update(
    wild: readonly WildMount[],
    mounts: Mounts,
    x: number,
    y: number,
    angle: number,
    speed: number,
    flapping: boolean,
    left: number,
    right: number,
    dt: number,
  ): void {
    this.time += dt;
    this.updateWild(wild, left, right);

    // The stack: snowmobile → animal → (yeti), all turning with the body.
    const up = (d: number): [number, number] => [x + Math.sin(angle) * d, y - Math.cos(angle) * d];
    let base = 0;
    for (const [kind, rig] of Object.entries(this.ridden) as [Exclude<MountKind, 'eagle'>, Rig][]) {
      const i = mounts.stack.indexOf(kind);
      rig.root.setVisible(i >= 0);
      if (i < 0) continue;
      const below = mounts.stack.slice(0, i).reduce((sum, k) => sum + MOUNTS[k].lift, 0);
      rig.root.setPosition(...up(below)).setRotation(angle);
      rig.pose(this.time, 'ridden', Math.min(1, speed / 1500));
      base = Math.max(base, below + MOUNTS[kind].lift);
    }
    const carried = mounts.state === 'carried';
    this.carrier.root.setVisible(carried);
    if (carried) {
      this.carrier.root.setPosition(...up(base + GRIP_UP + EAGLE_BODY_UP)).setRotation(angle);
      this.carrier.pose(this.time, 'ridden', flapping ? 1 : 0);
    }

    // Exhaust from a running snowmobile: more the faster it goes.
    if (mounts.stack[0] === 'snowmobile') {
      this.puff += dt * (8 + speed / 60);
      const n = Math.floor(this.puff);
      if (n > 0) {
        this.puff -= n;
        const [ex, ey] = local(x, y, angle, EXHAUST);
        this.exhaust.emitParticleAt(ex, ey, n);
      }
    }

    this.updateLeaving(dt);
  }

  /** Something happened to the stack: send off whatever left it. `vx, vy`: the skier's velocity. */
  onEvent(e: MountEvent, mounts: Mounts, vx: number, vy: number): void {
    if (e.type !== 'dismount') return;
    // Where it was: an animal rides on the snowmobile, if there is one; the snowmobile is at the bottom.
    const lift = e.kind !== 'snowmobile' && mounts.stack[0] === 'snowmobile' ? MOUNTS.snowmobile.lift : 0;
    const style = e.reason === 'swap' ? (e.kind === 'snowmobile' ? 'park' : 'run') : e.reason === 'fuel' ? 'park' : e.reason === 'release' ? 'fly' : 'tumble';
    const rig = this.acquire(e.kind);
    const y = e.kind === 'eagle' ? e.y - GRIP_UP - EAGLE_BODY_UP - mounts.lift : e.y - lift;
    const l: Leaver = { rig, style, x: e.x, y, vx, vy, rot: 0, spin: 0, t: 0 };
    if (style === 'tumble') Object.assign(l, { vx: vx * 0.45, vy: Math.min(vy, 0) - 650, spin: -9 });
    else if (style === 'run') Object.assign(l, { vx: vx * 0.25, vy: -420 });
    else if (style === 'fly') Object.assign(l, { vx: vx * 0.6, vy: -300 });
    else if (style === 'park') Object.assign(l, { vx: vx * 0.6 });
    this.leaving.push(l);
  }

  private updateWild(wild: readonly WildMount[], left: number, right: number): void {
    const visible = (m: WildMount) => !m.taken && m.x0 < right + MARGIN && m.x1 > left - MARGIN;
    for (const [m, rig] of this.wild) {
      if (visible(m) && wild.includes(m)) continue;
      this.release(rig);
      this.wild.delete(m);
    }
    for (const m of wild) {
      if (!visible(m)) continue;
      let rig = this.wild.get(m);
      if (!rig) this.wild.set(m, (rig = this.acquire(m.kind)));
      const s = this.ground.sample(m.x);
      rig.root.setPosition(m.x, m.y).setRotation(m.kind === 'eagle' ? 0 : Math.atan(s.dy));
      const moving = m.kind === 'eagle' ? 0.35 : MOUNTS[m.kind].speed * m.t < MOUNTS[m.kind].range && m.t > 0 ? 1 : 0;
      rig.pose(this.time + m.ax * 0.001, 'idle', moving);
    }
  }

  private updateLeaving(dt: number): void {
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.t += dt;
      const g = l.style === 'fly' ? -100 : 1800;
      l.vy += g * dt;
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.rot += l.spin * dt;
      // A dead snowmobile coasts to a stop, coughing smoke.
      if (l.style === 'park') {
        l.vx *= Math.exp(-2 * dt);
        if (l.t < 1.2 && Math.floor(l.t * 8) !== Math.floor((l.t - dt) * 8)) {
          const [ex, ey] = local(l.x, l.y, l.rig.root.rotation, EXHAUST);
          this.exhaust.emitParticleAt(ex, ey, 4);
        }
      }
      const s = this.ground.sample(l.x);
      if (l.style !== 'fly' && l.y > s.y) {
        // Bounce (tumbling) or settle onto the snow.
        l.y = s.y;
        l.vy = l.style === 'tumble' ? -Math.abs(l.vy) * 0.35 : 0;
        if (l.style === 'tumble') l.spin *= 0.6;
        // Runners keep scurrying.
        if (l.style === 'run') l.vx = Math.max(l.vx, 200);
      }
      const onSnow = l.style !== 'tumble' && l.style !== 'fly' && l.y >= s.y - 1;
      l.rig.root.setPosition(l.x, l.y).setRotation(onSnow ? Math.atan(s.dy) : l.style === 'fly' ? -0.25 : l.rot);
      l.rig.pose(l.t, l.style === 'tumble' ? 'tumble' : l.style === 'run' ? 'run' : l.style === 'fly' ? 'ridden' : 'idle', 1);
      // Fade out at the end (a parked snowmobile just stays until it's off screen).
      const fade = l.style === 'park' ? 1 : Math.min(1, (LEAVE_TIME - l.t) / 0.6);
      l.rig.root.setAlpha(Math.max(0, fade));
      if (l.t > LEAVE_TIME && (l.style !== 'park' || l.t > LEAVE_TIME * 3)) {
        this.release(l.rig);
        this.leaving.splice(i, 1);
      }
    }
  }

  private acquire(kind: MountKind): Rig {
    let rig = this.pools[kind].pop();
    if (!rig) {
      rig = RIGS[kind](this.scene);
      this.propLayer.add(rig.root);
    }
    rig.root.setVisible(true).setAlpha(1).setRotation(0);
    return rig;
  }

  private release(rig: Rig): void {
    rig.root.setVisible(false);
    this.pools[rig.kind].push(rig);
  }
}

/** A local point of a rig at (x, y) turned by `angle`, in world px. */
function local(x: number, y: number, angle: number, [lx, ly]: Pt): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x + (lx * c - ly * s) * SCALE, y + (lx * s + ly * c) * SCALE];
}

/** A Graphics drawn once by `draw`, placed at (x, y) inside its rig. */
function part(scene: Phaser.Scene, draw: (g: G) => void, x = 0, y = 0): G {
  const g = scene.add.graphics();
  draw(g);
  return g.setPosition(x, y);
}

function rig(scene: Phaser.Scene, kind: MountKind, parts: G[], pose: Rig['pose'], scale = 1): Rig {
  return { kind, root: scene.add.container(0, 0, parts).setScale(SCALE * scale), pose };
}

/** A limb that tapers from radius `ra` at (ax, ay) to `rb` at (bx, by). */
function taper(ax: number, ay: number, bx: number, by: number, ra: number, rb: number): Pt[] {
  const a = Math.atan2(by - ay, bx - ax);
  const pts: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = a - Math.PI / 2 + (i / 8) * Math.PI;
    pts.push([bx + Math.cos(t) * rb, by + Math.sin(t) * rb]);
  }
  for (let i = 0; i <= 8; i++) {
    const t = a + Math.PI / 2 + (i / 8) * Math.PI;
    pts.push([ax + Math.cos(t) * ra, ay + Math.sin(t) * ra]);
  }
  return pts;
}

// ---- Penguin: belly-sliding, flippers out --------------------------------

/** Shoulder, where the flippers pivot. */
const FLIPPER_AT: Pt = [9, -16];

function penguinRig(scene: Phaser.Scene): Rig {
  const flipper = (color: number) =>
    part(scene, (g) => painter(g).outlined([[color, taper(0, 0, -22, 1, 5.5, 2.4)]]), ...FLIPPER_AT);
  const far = flipper(palette.penguinBack);
  const idle = part(scene, (g) => drawPenguin(g, false));
  const ridden = part(scene, (g) => drawPenguin(g, true));
  const near = flipper(palette.penguinBackLight);
  return rig(scene, 'penguin', [far, idle, ridden, near], (t, pose, moving) => {
    const riding = pose === 'ridden';
    idle.setVisible(!riding);
    ridden.setVisible(riding);
    // Flippers out and flapping when free; swept back when ridden (tucked tight at speed).
    const flap = riding
      ? -0.05 + 0.06 * Math.sin(t * 20)
      : pose === 'tumble'
        ? 1.2 + 0.5 * Math.sin(t * 30)
        : 1.05 + (0.15 + 0.25 * moving) * Math.sin(t * (pose === 'run' ? 18 : 6));
    near.setRotation(flap);
    far.setRotation(flap - 0.3);
    // A gentle rock as it slides.
    idle.setRotation(0.04 * Math.sin(t * 5) * (0.3 + moving));
  });
}

function drawPenguin(g: G, ridden: boolean): void {
  const { fill, outlined } = painter(g);
  // Ridden: head down and forward, streamlined. Free: head up, looking about.
  const [hx, hy]: Pt = ridden ? [28, -15] : [25, -23];
  outlined([
    [palette.penguinFeet, ell(-31, -6, 6.5, 3.4, 0.35, 12)],
    [palette.penguinFeet, ell(-28, -3, 6, 3, 0.1, 12)],
    [palette.penguinBack, [[-26, -14], [-39, -17], [-36, -7]]],
    [palette.penguinBack, ell(-2, -12, 29, 12, -0.05, 28)],
    [palette.penguinBack, limb(14, -16, hx, hy, 8)],
    [palette.penguinBack, ell(hx, hy, 10.5, 10, 0, 22)],
    [palette.penguinBeak, [[hx + 8, hy - 2.5], [hx + 19, hy + 1], [hx + 8, hy + 4.5]]],
  ]);
  // White belly along the snow and a white face; a sheen on the back.
  fill(palette.penguinBelly, ell(3, -7, 25, 6.5, -0.05, 24));
  fill(palette.penguinBelly, ell(hx + 3, hy + 2.5, 6.8, 6.2, 0, 16));
  fill(palette.penguinBackLight, ell(-6, -19, 15, 3.2, -0.05, 16));
  fill(palette.ink, ell(hx + 3.5, hy - 1.5, 2.6, 2.9, 0, 12));
  fill(palette.eye, ell(hx + 4.3, hy - 2.5, 0.9, 0.9, 0, 6));
  // A rosy cheek: it's having fun.
  fill(palette.scarf, ell(hx + 1, hy + 4, 2.2, 1.4, 0, 8), 0.5);
}

// ---- Polar bear: big, cream fur with a cool shade --------------------------

/** Hips and shoulders, where the legs pivot; far legs first. */
const BEAR_LEGS: { at: Pt; far: boolean; phase: number }[] = [
  { at: [-30, -24], far: true, phase: Math.PI },
  { at: [18, -24], far: true, phase: 0 },
  { at: [-20, -22], far: false, phase: 0 },
  { at: [28, -22], far: false, phase: Math.PI },
];

function bearRig(scene: Phaser.Scene): Rig {
  const legs = BEAR_LEGS.map(({ at, far }) =>
    part(
      scene,
      (g) => {
        const len = -at[1] - 4;
        const color = far ? palette.bearShade : palette.bearFur;
        painter(g).outlined([
          [color, taper(0, 0, 0, len, 9, 6.5)],
          [color, ell(2.5, len + 0.5, 8.5, 4, 0, 16)],
        ]);
      },
      ...at,
    ),
  );
  const idle = part(scene, (g) => drawBear(g, false));
  const ridden = part(scene, (g) => drawBear(g, true));
  return rig(scene, 'bear', [legs[0], legs[1], idle, ridden, legs[2], legs[3]], (t, pose, moving) => {
    const riding = pose === 'ridden';
    idle.setVisible(!riding);
    ridden.setVisible(riding);
    // Lumbering walk; a gallop when ridden or running off; flailing when knocked flying.
    const rate = pose === 'tumble' ? 14 : riding ? 6 + 6 * moving : pose === 'run' ? 11 : 4.5;
    const swing = pose === 'tumble' ? 0.8 : riding || pose === 'run' ? 0.45 : 0.3 * moving;
    BEAR_LEGS.forEach(({ phase }, i) => legs[i].setRotation(swing * Math.sin(t * rate + phase)));
    const bob = -Math.abs(Math.sin(t * rate)) * (riding ? 2.5 : 1.5 * moving);
    for (const p of [idle, ridden]) p.setY(bob);
  });
}

function drawBear(g: G, ridden: boolean): void {
  const { fill, outlined } = painter(g);
  // Ridden: head up, roaring. Free: head low, sniffing the snow.
  const [hx, hy]: Pt = ridden ? [46, -47] : [42, -31];
  outlined([
    [palette.bearFur, ell(-47, -38, 5.5, 5.5, 0, 12)],
    [palette.bearFur, ell(-8, -32, 40, 22, 0, 32)],
    [palette.bearFur, ell(15, -37, 21, 19, 0, 24)],
    [palette.bearFur, limb(20, -38, hx - 4, hy, 12)],
    [palette.bearFur, ell(hx - 7, hy - 11, 5, 5, 0, 12)],
    [palette.bearFur, ell(hx + 1, hy - 13, 4.6, 4.6, 0, 12)],
    [palette.bearFur, ell(hx, hy, 14, 12.5, 0, 24)],
    [palette.bearFur, ell(hx + 12, hy + 4, 10.5, 7.5, ridden ? -0.2 : 0.2, 20)],
  ]);
  // Cool shade under the belly, chin and ears, so the white reads on snow.
  fill(palette.bearShade, ell(-8, -15, 33, 6.5, 0, 24));
  fill(palette.bearShade, ell(-35, -26, 9, 9, 0, 16));
  fill(palette.bearShade, ell(hx - 3, hy + 8, 9, 4, 0, 14));
  fill(palette.bearDeep, ell(hx - 7, hy - 11, 2.4, 2.4, 0, 8));
  fill(palette.bearDeep, ell(hx + 1, hy - 13, 2.2, 2.2, 0, 8));
  fill(palette.bearNose, ell(hx + 22, hy + 1.5, 3.8, 3.1, 0, 12));
  fill(palette.ink, ell(hx + 4, hy - 3, 2.2, 2.4, 0, 10));
  fill(palette.eye, ell(hx + 4.7, hy - 3.8, 0.8, 0.8, 0, 6));
  if (ridden) {
    // Mouth open in a roar.
    fill(palette.bearNose, [[hx + 6, hy + 8], [hx + 21, hy + 7], [hx + 10, hy + 16]]);
    fill(palette.bearMouth, [[hx + 9, hy + 10], [hx + 16, hy + 9.5], [hx + 11, hy + 13.5]]);
  } else {
    fill(palette.bearNose, limb(hx + 13, hy + 8, hx + 18, hy + 7.5, 0.9));
  }
}

// ---- Snowmobile: bright and warm, windscreen, ski and a smoky exhaust ------

function snowmobileRig(scene: Phaser.Scene): Rig {
  const body = part(scene, drawSnowmobile);
  const glow = part(scene, (g) => {
    g.fillStyle(palette.headlight, 0.22).fillTriangle(48, -23, 84, -34, 84, -12);
    g.fillStyle(palette.headlight, 0.5).fillEllipse(48, -23, 12, 10);
  });
  return rig(scene, 'snowmobile', [glow, body], (t, pose, moving) => {
    const running = pose === 'ridden';
    glow.setVisible(running);
    // The engine shakes it a little.
    const shake = running ? 0.6 + 0.6 * moving : 0;
    body.setY(shake * Math.sin(t * 70));
  });
}

function drawSnowmobile(g: G): void {
  const { fill, outlined } = painter(g);
  // Ski at the front, on a strut.
  fill(palette.sledMetal, limb(30, -6, 25, -16, 2));
  outlined([[palette.skis, [[-6, -1], [40, -1], [53, -6], [58, -13], [53, -13], [47, -7], [-6, -5]]]]);
  outlined([
    // Track under the seat.
    [palette.sledTrack, limb(-44, -8, -12, -8, 8)],
    // Exhaust pipe.
    [palette.sledMetal, limb(-50, -20, EXHAUST[0], EXHAUST[1], 2.4)],
    // Hull: long and low, a sloped nose with the headlight.
    [palette.sledBody, [[-54, -14], [-8, -13], [30, -14], [49, -19], [51, -25], [36, -30], [14, -31], [-6, -26], [-52, -25]]],
    // Seat.
    [palette.sledSeat, limb(-46, -27, -12, -26, 4.5)],
    // Windscreen.
    [palette.windscreen, [[13, -30], [19, -47], [26, -48], [24, -30]]],
  ]);
  for (const wx of [-44, -28, -12]) fill(palette.sledMetal, ell(wx, -8, 4.2, 4.2, 0, 12));
  // Shade low on the hull, a racing stripe, the headlight.
  fill(palette.sledShade, [[-54, -14], [30, -14], [49, -19], [47, -21], [28, -17.5], [-54, -18]]);
  fill(palette.sledStripe, limb(-46, -21, 26, -22.5, 1.7));
  fill(palette.headlight, ell(47, -23, 3.4, 3, 0, 10));
  fill(palette.eye, [[16, -32], [20, -42], [21.5, -42], [18, -32]], 0.7);
  // Handlebar.
  fill(palette.sledMetal, limb(12, -31, 7, -38, 1.5));
  fill(palette.ink, ell(6.5, -38.5, 2.4, 2.4, 0, 10));
}

// ---- Eagle: big wings flapping, talons to grip with ------------------------

/** Shoulder, where the wings pivot. */
const WING_AT: Pt = [-2, -6];

function eagleRig(scene: Phaser.Scene): Rig {
  const far = part(scene, (g) => drawWing(g, palette.eagleTips), WING_AT[0] + 4, WING_AT[1] - 2);
  const idle = part(scene, (g) => drawEagle(g, false));
  const ridden = part(scene, (g) => drawEagle(g, true));
  const near = part(scene, (g) => drawWing(g, palette.eagleWing), ...WING_AT);
  let phase = 0;
  let last = 0;
  const eagle = rig(scene, 'eagle', [far, idle, ridden, near], (t, pose, moving) => {
    const carrying = pose === 'ridden';
    idle.setVisible(!carrying);
    ridden.setVisible(carrying);
    // Beat the wings: hard when climbing, slow when circling, a glide in between.
    const dt = Math.max(0, Math.min(0.1, t - last));
    last = t;
    phase += dt * (pose === 'tumble' ? 16 : 6 + 9 * moving);
    const glide = carrying && moving < 0.5 ? 0.35 : 1;
    const a = -1.05 + 1.15 * glide * Math.sin(phase);
    near.setRotation(a);
    far.setRotation(a + 0.25);
  }, EAGLE_SCALE);
  return eagle;
}

function drawEagle(g: G, carrying: boolean): void {
  const { fill, outlined } = painter(g);
  outlined([
    // Fanned tail.
    [palette.eagleBody, [[-16, -4], [-40, -9], [-43, -1], [-40, 7], [-16, 5]]],
    [palette.eagleBody, ell(0, 0, 23, 12.5, -0.08, 26)],
    [palette.eagleHead, ell(21, -8, 11, 10, 0, 22)],
    // Hooked beak.
    [palette.eagleBeak, [[28, -11], [37, -10], [40, -6], [37, -2], [35, -5], [29, -3]]],
    // Talons: gripping hard below when carrying, tucked in when not.
    ...(carrying
      ? ([
          [palette.eagleTalon, limb(-4, 8, -6, 26, 3.4)],
          [palette.eagleTalon, limb(6, 8, 6, 26, 3.4)],
        ] as Part[])
      : ([[palette.eagleTalon, ell(2, 11, 6, 3.4, 0, 12)]] as Part[])),
  ]);
  fill(palette.eagleTips, [[-24, -8], [-40, -9], [-43, -1], [-40, 7], [-26, 4]]);
  fill(palette.eagleHead, ell(12, -6, 6, 6.5, 0, 12));
  fill(palette.ink, ell(25, -10.5, 2, 2.2, 0, 10));
  fill(palette.eye, ell(25.6, -11.2, 0.7, 0.7, 0, 6));
  // A stern brow.
  fill(palette.ink, [[21, -14.5], [29, -13.5], [28, -12.3], [21, -13]]);
  if (carrying) {
    for (const cx of [-6, 6]) fill(palette.ink, [[cx - 5, 25], [cx + 5, 25], [cx + 3, 30], [cx - 3, 30]]);
  }
}

/** A wing pointing up from the shoulder at (0, 0), sweeping back to fingered tips. */
function drawWing(g: G, color: number): void {
  const { fill, outlined } = painter(g);
  // Five long primaries fan out at the tip; a scalloped trailing edge below them.
  const fingers: Pt[][] = [
    taper(2, -40, 4, -70, 5, 2.4),
    taper(-3, -40, -4, -72, 5, 2.4),
    taper(-8, -38, -13, -69, 5, 2.4),
    taper(-13, -36, -21, -63, 5, 2.4),
    taper(-17, -32, -28, -55, 5, 2.4),
  ];
  const wing: Pt[] = [
    [8, 4],
    [11, -16],
    [8, -42],
    [-20, -36],
    [-26, -30],
    [-24, -24],
    [-29, -20],
    [-25, -12],
    [-27, -6],
    [-20, -1],
    [-9, 5],
  ];
  outlined([...fingers.map((f): Part => [palette.eagleTips, f]), [color, wing]]);
  // Lighter coverts along the leading edge.
  fill(palette.eagleBody, [[8, 4], [11, -16], [8, -38], [-2, -36], [-6, -14], [-6, 3]]);
}

const RIGS: Record<MountKind, (scene: Phaser.Scene) => Rig> = {
  penguin: penguinRig,
  eagle: eagleRig,
  snowmobile: snowmobileRig,
  bear: bearRig,
};
