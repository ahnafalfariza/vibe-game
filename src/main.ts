import Phaser from 'phaser';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import './style.css';
import { PlayScene, type GameContext } from './scenes/PlayScene';
import { createTuning } from './tuning';
import { Tuner, loadSavedTuning } from './ui/tuner';
import { Menu } from './ui/menu';
import { Sfx } from './audio';
import { MOUNT_KINDS, type MountKind } from './sim/mounts';
import { findBiome, forceBiome, isBiomeUnlocked, loadBiome, saveBiome } from './biomes';
import { resetProfile, topUpCoins } from './profile';

async function main(): Promise<void> {
  // Make sure the UI font is ready before Phaser rasterises any text.
  await Promise.all([document.fonts.load('500 32px Fredoka'), document.fonts.load('600 32px Fredoka')]).catch(() => undefined);

  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  const mountParam = params.get('mount') as MountKind | null;
  const tuning = createTuning(loadSavedTuning());
  // Dev aids: ?profile=reset starts over, ?coins=5000 tops the wallet up to at least that.
  if (params.get('profile') === 'reset') resetProfile();
  const coinsParam = Number(params.get('coins'));
  if (coinsParam > 0) topUpCoins(coinsParam);

  let game: Phaser.Game | null = null;
  const scene = () => game?.scene.getScene('play') as PlayScene | null | undefined;
  const sfx = new Sfx();
  const touch = matchMedia('(pointer: coarse)').matches;
  // ?biome=… forces one (for testing; not remembered, playable at any level), else the last one picked.
  const forced = findBiome(params.get('biome'))?.id;
  if (forced) forceBiome(forced);
  const biome = forced ?? loadBiome();
  const ctx: GameContext = {
    tuning,
    tuner: new Tuner(tuning, { newRun: () => scene()?.newRun() }),
    sfx,
    menu: new Menu(
      {
        play: () => scene()?.newRun(true),
        pause: () => scene()?.pause(),
        resume: () => scene()?.resume(),
        restart: () => scene()?.newRun(true),
        home: () => scene()?.newRun(false),
        toggleMute: () => sfx.toggleMute(),
        toggleMusic: () => sfx.toggleMusic(),
        click: () => sfx.click(),
        purchase: () => sfx.purchase(),
        biome: (id) => {
          ctx.biome = id;
          if (isBiomeUnlocked(id)) saveBiome(id);
          // The demo run behind the title switches right away.
          scene()?.newRun(false);
        },
      },
      touch,
      sfx.muted,
      sfx.musicOn,
      biome,
    ),
    fixedSeed: seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) >>> 0 : null,
    startMount: mountParam !== null && MOUNT_KINDS.includes(mountParam) ? mountParam : null,
    debug: params.has('debug'),
    touch,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    biome,
  };

  // Render at device resolution (capped at 2x) and scale the canvas down with
  // CSS, so everything stays crisp on high-DPI phones.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#d9f0ff',
    width: Math.round(window.innerWidth * dpr),
    height: Math.round(window.innerHeight * dpr),
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    render: { antialias: true },
    input: { activePointers: 3 },
    banner: false,
    scene: [new PlayScene(ctx)],
  });

  const resize = () => {
    game?.scale.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
    game?.scale.setZoom(1 / dpr);
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  if (params.has('tune')) ctx.tuner.toggle();
  // Handy for poking at the game from the console / automated smoke tests.
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

void main();
