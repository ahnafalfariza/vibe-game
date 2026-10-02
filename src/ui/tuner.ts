import GUI from 'lil-gui';
import { DEFAULT_TUNING, type Tuning } from '../tuning';

// Live tuning panel (press T). Tweaks persist in localStorage so a good feel
// survives reloads; "Copy values" puts JSON on the clipboard to paste into
// tuning.ts once you're happy.

const STORAGE_KEY = 'yeti-set-go.tuning';

type Range = [min: number, max: number, step: number];

const RANGES: Record<keyof Tuning, Range> = {
  gravity: [800, 4000, 50],
  groundFriction: [0, 0.2, 0.005],
  groundDrag: [0, 0.001, 0.00001],
  airDrag: [0, 0.0005, 0.00001],
  minSpeed: [0, 800, 10],
  maxSpeed: [800, 5000, 50],
  jumpImpulse: [300, 1600, 10],
  groundStick: [0, 4000, 50],
  flipSpeed: [2, 16, 0.1],
  flipAccel: [5, 200, 1],
  spinDamping: [0, 40, 0.5],
  landingAssist: [0, 20, 0.1],
  landingAssistDeg: [0, 90, 1],
  cleanLandingDeg: [5, 60, 1],
  crashLandingDeg: [20, 120, 1],
  sloppySpeedKeep: [0, 1, 0.01],
  flipBoost: [0, 1000, 10],
  crashSpeedKeep: [0, 1, 0.01],
  crashDuration: [0.2, 3, 0.05],
  coyoteTime: [0, 0.3, 0.01],
  jumpBuffer: [0, 0.3, 0.01],
  mountainSlope: [0.1, 0.7, 0.01],
  avalancheStartGap: [200, 3000, 50],
  avalancheSpeed: [0, 1500, 10],
  avalancheAccel: [0, 30, 0.5],
  avalancheMaxGap: [800, 6000, 100],
};

const GROUPS: [string, (keyof Tuning)[]][] = [
  ['Movement', ['gravity', 'groundFriction', 'groundDrag', 'airDrag', 'minSpeed', 'maxSpeed', 'groundStick']],
  ['Jump & flip', ['jumpImpulse', 'flipSpeed', 'flipAccel', 'spinDamping', 'flipBoost', 'coyoteTime', 'jumpBuffer']],
  ['Landing', ['landingAssist', 'landingAssistDeg', 'cleanLandingDeg', 'crashLandingDeg', 'sloppySpeedKeep', 'crashSpeedKeep', 'crashDuration']],
  ['Mountain (new runs)', ['mountainSlope']],
  ['Avalanche', ['avalancheStartGap', 'avalancheSpeed', 'avalancheAccel', 'avalancheMaxGap']],
];

export function loadSavedTuning(): Partial<Tuning> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Tuning>;
    const clean: Partial<Tuning> = {};
    for (const key of Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]) {
      if (typeof parsed[key] === 'number' && Number.isFinite(parsed[key])) clean[key] = parsed[key];
    }
    return clean;
  } catch {
    return {};
  }
}

function save(tuning: Tuning): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch {
    // Storage unavailable (private mode etc.) — tuning just won't persist.
  }
}

export class Tuner {
  private gui: GUI | null = null;

  constructor(
    private readonly tuning: Tuning,
    private readonly actions: { newRun: () => void },
  ) {}

  get open(): boolean {
    return this.gui !== null;
  }

  toggle(): void {
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
      return;
    }
    const gui = new GUI({ title: 'Feel tuning (T)', width: 300 });
    for (const [name, keys] of GROUPS) {
      const folder = gui.addFolder(name);
      for (const key of keys) {
        const [min, max, step] = RANGES[key];
        folder.add(this.tuning, key, min, max, step).onChange(() => save(this.tuning));
      }
    }
    gui.add(
      {
        copy: () => {
          const json = JSON.stringify(this.tuning, null, 2);
          void navigator.clipboard?.writeText(json).catch(() => undefined);
          console.info('Tuning values:\n' + json);
        },
      },
      'copy',
    ).name('Copy values (JSON)');
    gui.add(
      {
        reset: () => {
          Object.assign(this.tuning, DEFAULT_TUNING);
          save(this.tuning);
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
        },
      },
      'reset',
    ).name('Reset to defaults');
    gui.add({ newRun: () => this.actions.newRun() }, 'newRun').name('New mountain (R)');
    // Keep taps on the panel from reaching the game.
    for (const type of ['pointerdown', 'touchstart', 'mousedown'] as const) {
      gui.domElement.addEventListener(type, (e) => e.stopPropagation());
    }
    this.gui = gui;
  }
}
