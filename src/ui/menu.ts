// Title, pause and game-over screens, the Goals and Shop panels, plus the
// pause button. Plain DOM over the canvas: real buttons are crisp,
// keyboard-focusable and easy to style, and they swallow taps so menu clicks
// never reach the game.

import { BIOMES, isBiomeUnlocked } from '../biomes';
import { getProfile, persist } from '../profile';
import {
  LEVELS,
  PERKS,
  UPGRADES,
  buyUpgrade,
  goalProgressText,
  goalText,
  isTotalGoal,
  levelName,
  nextPerk,
  skipCost,
  skipGoal,
  levelMultiplier,
  upgradeCost,
  upgradeLevel,
  type UpgradeId,
} from '../sim/meta';

const BEST_KEY = 'yeti-set-go.best';

export type Screen = 'title' | 'pause' | 'over' | 'goals' | 'shop';
type Panel = 'goals' | 'shop';

export interface MenuActions {
  play(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  home(): void;
  /** Returns the new muted state. */
  toggleMute(): boolean;
  /** Returns the new music-on state. */
  toggleMusic(): boolean;
  click(): void;
  /** Bought something in the shop. */
  purchase(): void;
  /** The title-screen picker moved to this biome (locked ones too, as a preview). */
  biome(id: string): void;
}

/** A goal as the game-over screen shows it. */
export interface GoalLine {
  text: string;
  /** "3 / 6" */
  progress: string;
  done: boolean;
  /** Completed during this run. */
  fresh: boolean;
  /** Goals panel only: what skipping it costs, and whether the wallet covers it. */
  skip?: { cost: number; afford: boolean };
}

export interface RunResult {
  score: number;
  metres: number;
  flips: number;
  /** Coins this run, and the wallet after it. */
  coins: number;
  wallet: number;
  bestAir: number;
  best: number;
  newBest: boolean;
  /** "Rode 2 penguins · 3 smashes" ('' for none). */
  rides: string;
  /** Furthest zone reached. */
  zone: number;
  /** The level (and its score multiplier) the run was played at. */
  level: number;
  levelMultiplier: number;
  goals: GoalLine[];
  levelUp: { level: number; multiplier: number; coins: number; finale: boolean; unlocks: { name: string; text: string }[] } | null;
}

/** Ignore Space/Enter this long after the game-over screen appears, so a held jump doesn't skip it, ms. */
const OVER_KEY_DELAY = 700;

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const COIN = '<i class="coin" aria-hidden="true"></i>';

function goalList(goals: GoalLine[]): string {
  return goals
    .map(
      (g, i) => `<li class="goal${g.done ? ' done' : ''}${g.fresh ? ' fresh' : ''}">
        <span class="tick" aria-hidden="true"></span>
        <span class="goal-text">${g.done ? '<span class="sr-only">Done: </span>' : ''}${g.text}</span>
        <span class="goal-side"><span class="goal-count">${g.done ? (g.fresh ? 'New!' : 'Done') : g.progress}</span>${
          g.skip && !g.done
            ? `<button class="btn small skip" data-act="skip" data-index="${i}"${g.skip.afford ? '' : ' disabled'} aria-label="Skip this goal for ${fmt(g.skip.cost)} coins">Skip ${fmt(g.skip.cost)} ${COIN}</button>`
            : ''
        }</span>
      </li>`,
    )
    .join('');
}

/** Pips for levels 1–10 and Legend: done, current, and which ones unlock something. */
function levelPath(level: number): string {
  const pip = (n: number, label: string) => {
    // The Legend pip stays current for every Legend level.
    const state = n > LEVELS.length ? (level >= n ? 'current' : '') : n < level ? 'done' : n === level ? 'current' : '';
    const perk = PERKS.some((k) => k.level === n);
    return `<li><button class="pip ${state}${perk ? ' perk' : ''}" data-act="pip" data-level="${n}" aria-label="${levelName(n)}${state === 'done' ? ', done' : state === 'current' ? ', you are here' : ''}">${label}</button></li>`;
  };
  return LEVELS.map((_, i) => pip(i + 1, String(i + 1))).join('') + pip(LEVELS.length + 1, '★');
}

/** What reaching `level` gives you, for the level path. */
function levelReward(level: number): string {
  const perks = PERKS.filter((k) => k.level === level).map((k) => `${k.name} (${k.text.toLowerCase()})`);
  if (level > LEVELS.length) return `Yeti Legend: random goals from here on${perks.length ? `, plus ${perks.join(', ')}` : ''}`;
  const finale = level === LEVELS.length ? 'The finale' : '';
  return `${levelName(level)}: ` + ([finale, ...perks].filter(Boolean).join(', plus ') || (level === 1 ? 'where it all starts' : 'three new goals'));
}

export class Menu {
  private readonly root: HTMLElement;
  private readonly screens: Record<Screen, HTMLElement>;
  private readonly pauseButton: HTMLButtonElement;
  screen: Screen | null = null;
  private shownAt = 0;
  private biomeIndex: number;
  /** What had focus before a panel opened, to hand it back on close. */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly actions: MenuActions,
    touch: boolean,
    muted: boolean,
    music: boolean,
    biome: string,
  ) {
    const controls = touch ? 'Tap to jump · hold to backflip' : 'Space to jump · hold to backflip · Esc to pause';
    this.root = document.createElement('div');
    this.root.id = 'overlay';
    this.root.innerHTML = `
      <button class="pause-btn" data-act="pause" aria-label="Pause" hidden><span></span><span></span></button>
      <section class="screen title" hidden>
        <h1>Yeti, Set, Go!</h1>
        <p class="tagline">Outrun the avalanche. Flip for points.</p>
        <div class="biome-picker" role="group" aria-label="Mountain">
          <button class="btn small arrow" data-act="biome-prev" aria-label="Previous mountain">‹</button>
          <p class="biome" aria-live="polite"><span class="biome-name"></span><span class="biome-lock"></span></p>
          <button class="btn small arrow" data-act="biome-next" aria-label="Next mountain">›</button>
        </div>
        <button class="btn primary big" data-act="play">Play</button>
        <div class="meta-row">
          <button class="btn small" data-act="goals" aria-haspopup="dialog">Goals <span class="tag goals-tag"></span></button>
          <button class="btn small" data-act="shop" aria-haspopup="dialog">Shop <span class="tag">${COIN}<span class="coins-tag"></span></span></button>
        </div>
        <p class="best"></p>
        <p class="controls">${controls}</p>
        <div class="toggles"><button class="btn small" data-act="mute"></button><button class="btn small" data-act="music"></button></div>
      </section>
      <section class="screen pause" hidden>
        <h2>Paused</h2>
        <div class="card run-goals">
          <p class="card-head"></p>
          <ul class="goal-list"></ul>
        </div>
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="restart">Restart</button>
        <button class="btn" data-act="home">Main menu</button>
        <div class="toggles"><button class="btn small" data-act="mute"></button><button class="btn small" data-act="music"></button></div>
      </section>
      <section class="screen over" hidden>
        <h2>Caught by the avalanche!</h2>
        <div class="over-body">
          <div class="over-main">
            <p class="score"></p>
            <p class="new-best" hidden>New best!</p>
            <p class="stats"></p>
            <p class="rides"></p>
            <p class="coins-line"></p>
            <p class="best"></p>
            <div class="row">
              <button class="btn primary" data-act="play">Play again</button>
              <button class="btn" data-act="home">Main menu</button>
            </div>
          </div>
          <div class="card over-goals">
            <div class="levelup" hidden>
              <p class="levelup-title">Level up!</p>
              <p class="levelup-text"></p>
              <p class="levelup-coins"></p>
              <ul class="unlocks"></ul>
            </div>
            <p class="card-head"></p>
            <ul class="goal-list"></ul>
          </div>
        </div>
      </section>
      <section class="screen panel goals" role="dialog" aria-modal="true" aria-labelledby="goals-heading" hidden>
        <h2 id="goals-heading">Goals</h2>
        <div class="card">
          <p class="card-head"></p>
          <ol class="level-path" aria-label="Levels"></ol>
          <ul class="goal-list"></ul>
          <p class="card-foot"></p>
        </div>
        <button class="btn" data-act="close">Back</button>
      </section>
      <section class="screen panel shop" role="dialog" aria-modal="true" aria-labelledby="shop-heading" hidden>
        <h2 id="shop-heading">Shop</h2>
        <p class="wallet" aria-live="polite"></p>
        <ul class="shop-list">${UPGRADES.map(
          (u) => `<li class="card item">
            <div class="item-info">
              <p class="item-name">${u.name} <span class="pips">${u.costs.map(() => '<i></i>').join('')}</span></p>
              <p class="item-effect"></p>
            </div>
            <button class="btn small buy" data-act="buy" data-id="${u.id}"></button>
          </li>`,
        ).join('')}</ul>
        <button class="btn" data-act="close">Back</button>
      </section>`;
    document.body.append(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.screens = { title: q('.title'), pause: q('.pause'), over: q('.over'), goals: q('.goals'), shop: q('.shop') };
    this.pauseButton = q('.pause-btn');
    this.setMuted(muted);
    this.setMusic(music);
    this.biomeIndex = Math.max(0, BIOMES.findIndex((b) => b.id === biome));
    this.renderBiome();

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      const act = el?.dataset.act;
      if (!act) return;
      if (act === 'buy') return this.buy(el!.dataset.id as UpgradeId);
      if (act === 'skip') return this.skip(Number(el!.dataset.index));
      this.actions.click();
      if (act === 'pip') this.screens.goals.querySelector('.card-foot')!.textContent = levelReward(Number(el!.dataset.level));
      if (act === 'mute') this.setMuted(this.actions.toggleMute());
      else if (act === 'music') this.setMusic(this.actions.toggleMusic());
      else if (act === 'biome-prev' || act === 'biome-next') this.stepBiome(act === 'biome-next' ? 1 : -1);
      else if (act === 'goals' || act === 'shop') this.openPanel(act);
      else if (act === 'close') this.closePanel();
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
    else if ((this.screen === 'goals' || this.screen === 'shop') && e.code === 'Escape') {
      this.actions.click();
      this.closePanel();
    } else if (this.screen === null && back) this.actions.pause();
    else if (this.screen === 'pause' && back) this.actions.resume();
    else if (this.screen === 'title' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      this.actions.click();
      this.stepBiome(e.code === 'ArrowRight' ? 1 : -1);
    } else if (this.screen === 'title' && confirm && isBiomeUnlocked(BIOMES[this.biomeIndex].id)) this.actions.play();
    else if (this.screen === 'over' && confirm && performance.now() - this.shownAt > OVER_KEY_DELAY) this.actions.play();
  }

  private setMuted(muted: boolean): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act="mute"]')) b.textContent = muted ? 'Sound: off' : 'Sound: on';
  }

  private setMusic(on: boolean): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act="music"]')) b.textContent = on ? 'Music: on' : 'Music: off';
  }

  private stepBiome(step: number): void {
    this.biomeIndex = (this.biomeIndex + step + BIOMES.length) % BIOMES.length;
    this.renderBiome();
    this.actions.biome(BIOMES[this.biomeIndex].id);
  }

  /** Name of the picked biome; a locked one says how to unlock it, and can't be played. */
  private renderBiome(): void {
    const b = BIOMES[this.biomeIndex];
    const locked = !isBiomeUnlocked(b.id);
    const el = this.screens.title;
    el.querySelector('.biome-name')!.textContent = b.name;
    const lock = el.querySelector<HTMLElement>('.biome-lock')!;
    lock.hidden = !locked;
    lock.textContent = `Locked · ${b.lockHint}`;
    el.querySelector<HTMLButtonElement>('[data-act="play"]')!.disabled = locked;
  }

  /** The Goals / Shop buttons' little tags: level and goals done, coins. */
  private renderTitleMeta(): void {
    const p = getProfile();
    const el = this.screens.title;
    el.querySelector('.goals-tag')!.textContent = `${levelName(p.level)} · ${p.goals.filter((g) => g.done).length}/${p.goals.length}`;
    el.querySelector('.coins-tag')!.textContent = fmt(p.coins);
  }

  private renderGoals(): void {
    const p = getProfile();
    const el = this.screens.goals;
    el.querySelector('.card-head')!.textContent = `${levelName(p.level)}${p.level === LEVELS.length ? ' · the finale' : ''} · score ×${levelMultiplier(p.level)}`;
    el.querySelector('.level-path')!.innerHTML = levelPath(p.level);
    const skip = { cost: skipCost(p.level), afford: p.coins >= skipCost(p.level) };
    el.querySelector('.goal-list')!.innerHTML = goalList(
      p.goals.map((g) => ({ text: goalText(g), progress: (isTotalGoal(g) ? '' : 'Best ') + goalProgressText(g), done: g.done, fresh: false, skip })),
    );
    const perk = nextPerk(p.level);
    const all = p.goals.every((g) => g.done);
    const next = p.level === LEVELS.length ? 'become a Yeti Legend' : `reach ${levelName(p.level + 1)}`;
    el.querySelector('.card-foot')!.textContent = all
      ? 'All done! Finish a run to level up.'
      : `Finish all three to ${next} (score ×${levelMultiplier(p.level + 1)})` + (perk ? ` · ${levelName(perk.level)}: ${perk.name}` : '');
  }

  private renderShop(): void {
    const p = getProfile();
    this.screens.shop.querySelector('.wallet')!.innerHTML = `${COIN}<span>${fmt(p.coins)}</span><span class="sr-only"> coins</span>`;
    for (const li of this.screens.shop.querySelectorAll<HTMLElement>('.item')) {
      const button = li.querySelector<HTMLButtonElement>('.buy')!;
      const u = UPGRADES.find((u) => u.id === button.dataset.id)!;
      const level = upgradeLevel(p, u.id);
      const cost = upgradeCost(p, u.id);
      li.querySelectorAll('.pips i').forEach((pip, i) => pip.classList.toggle('on', i < level));
      li.querySelector('.pips')!.setAttribute('aria-label', `Level ${level} of ${u.costs.length}`);
      // What the next level does (or, maxed out, what you have).
      li.querySelector('.item-effect')!.textContent = u.effect(cost === null ? level : level + 1);
      li.classList.toggle('maxed', cost === null);
      button.disabled = cost === null || p.coins < cost;
      button.innerHTML = cost === null ? 'Max' : `${fmt(cost)} ${COIN}`;
      button.setAttribute('aria-label', cost === null ? `${u.name}: maxed out` : `Buy ${u.name} level ${level + 1} for ${fmt(cost)} coins`);
    }
  }

  private buy(id: UpgradeId): void {
    if (buyUpgrade(getProfile(), id)) {
      persist();
      this.actions.purchase();
    }
    this.renderShop();
    // A button that just went disabled drops focus: hand it to the next one that works.
    if (document.activeElement === document.body || (document.activeElement as HTMLButtonElement | null)?.disabled) {
      this.screens.shop.querySelector<HTMLElement>('.buy:not(:disabled), [data-act="close"]')?.focus();
    }
  }

  /** Pay to count a goal as done. */
  private skip(index: number): void {
    if (skipGoal(getProfile(), index)) {
      persist();
      this.actions.purchase();
    }
    this.renderGoals();
    this.screens.goals.querySelector<HTMLElement>('.skip:not(:disabled), [data-act="close"]')?.focus();
  }

  private openPanel(panel: Panel): void {
    this.opener = document.activeElement as HTMLElement | null;
    if (panel === 'goals') this.renderGoals();
    else this.renderShop();
    this.show(panel);
    this.screens[panel].querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }

  private closePanel(): void {
    this.renderTitleMeta();
    this.show('title');
    const back = this.opener?.isConnected ? this.opener : this.screens.title.querySelector<HTMLElement>('[data-act="goals"]');
    back?.focus();
  }

  private show(screen: Screen | null): void {
    this.screen = screen;
    this.shownAt = performance.now();
    this.root.classList.toggle('open', screen !== null);
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    this.pauseButton.hidden = screen !== null;
  }

  showTitle(best: number): void {
    const zone = getProfile().bestZone;
    this.screens.title.querySelector('.best')!.textContent = best > 0 ? `Best ${fmt(best)}` + (zone > 1 ? ` · furthest zone ${zone}` : '') : '';
    this.renderBiome();
    this.renderTitleMeta();
    // An open panel stays open while the demo run behind it restarts.
    if (this.screen !== 'goals' && this.screen !== 'shop') this.show('title');
    this.pauseButton.hidden = true;
  }

  /** `goals` with this run counted so far. */
  showPause(level: number, goals: GoalLine[]): void {
    const el = this.screens.pause;
    el.querySelector('.card-head')!.textContent = `Goals · ${levelName(level)}`;
    el.querySelector('.goal-list')!.innerHTML = goalList(goals);
    this.show('pause');
  }

  showGameOver(r: RunResult): void {
    const el = this.screens.over;
    el.querySelector('.score')!.textContent = fmt(r.score);
    (el.querySelector('.new-best') as HTMLElement).hidden = !r.newBest;
    el.querySelector('.stats')!.textContent = `${fmt(r.metres)} m · zone ${r.zone} · ${r.flips} flips · best air ${r.bestAir.toFixed(1)}s`;
    const rides = el.querySelector<HTMLElement>('.rides')!;
    rides.textContent = r.rides;
    rides.hidden = r.rides === '';
    el.querySelector('.coins-line')!.innerHTML = `${COIN}+${fmt(r.coins)} coins · ${fmt(r.wallet)} total`;
    el.querySelector('.best')!.textContent = r.newBest ? '' : `Best ${fmt(r.best)}`;
    el.querySelector('.card-head')!.textContent = `Goals · ${levelName(r.level)}` + (r.levelMultiplier > 1 ? ` · score ×${r.levelMultiplier}` : '');
    el.querySelector('.goal-list')!.innerHTML = goalList(r.goals);
    const up = el.querySelector<HTMLElement>('.levelup')!;
    up.hidden = r.levelUp === null;
    if (r.levelUp) {
      const { level, multiplier, coins, finale } = r.levelUp;
      up.classList.toggle('finale', finale);
      up.querySelector('.levelup-title')!.textContent = finale ? 'Yeti Legend!' : 'Level up!';
      up.querySelector('.levelup-text')!.textContent = finale
        ? `All ${LEVELS.length} levels done · score ×${multiplier} from now on`
        : `${levelName(level)} · score ×${multiplier} from now on`;
      up.querySelector('.levelup-coins')!.innerHTML = `${COIN}+${fmt(coins)} coins`;
      up.querySelector('.unlocks')!.innerHTML = r.levelUp.unlocks.map((u) => `<li><b>Unlocked: ${u.name}</b><span>${u.text}</span></li>`).join('');
    }
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
