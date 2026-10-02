// Title, pause and game-over screens, plus the pause button. Plain DOM over
// the canvas: real buttons are crisp, keyboard-focusable and easy to style,
// and they swallow taps so menu clicks never reach the game.

const BEST_KEY = 'yeti-set-go.best';

export type Screen = 'title' | 'pause' | 'over';

export interface MenuActions {
  play(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  home(): void;
  /** Returns the new muted state. */
  toggleMute(): boolean;
  click(): void;
}

export interface RunResult {
  score: number;
  metres: number;
  flips: number;
  bestAir: number;
  best: number;
  newBest: boolean;
}

/** Ignore Space/Enter this long after the game-over screen appears, so a held jump doesn't skip it, ms. */
const OVER_KEY_DELAY = 700;

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

export class Menu {
  private readonly root: HTMLElement;
  private readonly screens: Record<Screen, HTMLElement>;
  private readonly pauseButton: HTMLButtonElement;
  screen: Screen | null = null;
  private shownAt = 0;

  constructor(
    private readonly actions: MenuActions,
    touch: boolean,
    muted: boolean,
  ) {
    const controls = touch ? 'Tap to jump · hold to backflip' : 'Space to jump · hold to backflip · Esc to pause';
    this.root = document.createElement('div');
    this.root.id = 'overlay';
    this.root.innerHTML = `
      <button class="pause-btn" data-act="pause" aria-label="Pause" hidden><span></span><span></span></button>
      <section class="screen title" hidden>
        <h1>Yeti, Set, Go!</h1>
        <p class="tagline">Outrun the avalanche. Flip for points.</p>
        <button class="btn primary big" data-act="play">Play</button>
        <p class="best"></p>
        <p class="controls">${controls}</p>
        <button class="btn small" data-act="mute"></button>
      </section>
      <section class="screen pause" hidden>
        <h2>Paused</h2>
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="restart">Restart</button>
        <button class="btn" data-act="home">Main menu</button>
        <button class="btn small" data-act="mute"></button>
      </section>
      <section class="screen over" hidden>
        <h2>Caught by the avalanche!</h2>
        <p class="score"></p>
        <p class="new-best" hidden>New best!</p>
        <p class="stats"></p>
        <p class="best"></p>
        <button class="btn primary" data-act="play">Play again</button>
        <button class="btn" data-act="home">Main menu</button>
      </section>`;
    document.body.append(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.screens = { title: q('.title'), pause: q('.pause'), over: q('.over') };
    this.pauseButton = q('.pause-btn');
    this.setMuted(muted);

    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act) return;
      this.actions.click();
      if (act === 'mute') this.setMuted(this.actions.toggleMute());
      else if (act === 'play' || act === 'pause' || act === 'resume' || act === 'restart' || act === 'home') this.actions[act]();
    });
    // Keep presses on the overlay from also counting as a jump.
    for (const type of ['pointerdown', 'touchstart', 'mousedown'] as const) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat || (e.target as HTMLElement | null)?.closest?.('.lil-gui')) return;
    // A focused button handles Space/Enter itself.
    const onButton = (document.activeElement as HTMLElement | null)?.closest?.('#overlay button') != null;
    const confirm = (e.code === 'Space' || e.code === 'Enter') && !onButton;
    const back = e.code === 'Escape' || e.code === 'KeyP';
    if (e.code === 'KeyM') this.setMuted(this.actions.toggleMute());
    else if (this.screen === null && back) this.actions.pause();
    else if (this.screen === 'pause' && back) this.actions.resume();
    else if (this.screen === 'title' && confirm) this.actions.play();
    else if (this.screen === 'over' && confirm && performance.now() - this.shownAt > OVER_KEY_DELAY) this.actions.play();
  }

  private setMuted(muted: boolean): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act="mute"]')) b.textContent = muted ? 'Sound: off' : 'Sound: on';
  }

  private show(screen: Screen | null): void {
    this.screen = screen;
    this.shownAt = performance.now();
    this.root.classList.toggle('open', screen !== null);
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    this.pauseButton.hidden = screen !== null;
  }

  showTitle(best: number): void {
    this.screens.title.querySelector('.best')!.textContent = best > 0 ? `Best ${fmt(best)}` : '';
    this.show('title');
    this.pauseButton.hidden = true;
  }

  showPause(): void {
    this.show('pause');
  }

  showGameOver(r: RunResult): void {
    const el = this.screens.over;
    el.querySelector('.score')!.textContent = fmt(r.score);
    (el.querySelector('.new-best') as HTMLElement).hidden = !r.newBest;
    el.querySelector('.stats')!.textContent = `${fmt(r.metres)} m · ${r.flips} flips · best air ${r.bestAir.toFixed(1)}s`;
    el.querySelector('.best')!.textContent = r.newBest ? '' : `Best ${fmt(r.best)}`;
    this.show('over');
  }

  /** In play: no screen, pause button showing. */
  hide(): void {
    this.show(null);
  }

  /** In play but between screens (e.g. while the avalanche swallows you): nothing at all. */
  hideAll(): void {
    this.show(null);
    this.pauseButton.hidden = true;
  }
}

export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(Math.floor(score)));
  } catch {
    // Storage unavailable: the best score just won't persist.
  }
}
