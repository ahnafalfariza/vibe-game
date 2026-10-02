// Smoke test: load the built game in headless Chromium, play a few seconds
// (jump + hold for a flip), take screenshots, and fail on console errors.
// Usage: bun run build && node scripts/smoke.mjs [url]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const outDir = 'screenshots';
mkdirSync(outDir, { recursive: true });

let server = null;
let url = process.argv[2];
if (!url) {
  const port = process.env.PORT ?? '4173';
  server = spawn('bunx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
  url = `http://localhost:${port}/?seed=7`;
  await new Promise((r) => setTimeout(r, 2500));
}

const executablePath = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  for (const [name, viewport, scale] of [
    ['desktop', { width: 1280, height: 720 }, 1],
    ['phone', { width: 844, height: 390 }, 2],
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    page.on('response', (r) => r.status() >= 400 && errors.push(`[${name}] HTTP ${r.status()} ${r.url()}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.scene?.getScene('play')?.run, null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${outDir}/${name}-0-title.png` });
    // Title screen → play.
    await page.click('#overlay [data-act="play"]');
    await page.waitForFunction(() => window.__game.scene.getScene('play').state === 'playing', null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/${name}-1-start.png` });
    // Jump and hold for a backflip.
    await page.keyboard.down('Space');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${outDir}/${name}-2-flip.png` });
    await page.waitForTimeout(350);
    await page.keyboard.up('Space');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${outDir}/${name}-3-later.png` });
    const state = await page.evaluate(() => {
      const run = window.__game.scene.getScene('play').run;
      return { x: Math.round(run.skier.x), simTime: +run.time.toFixed(2), mode: run.skier.mode, stats: run.stats };
    });
    console.log(name, JSON.stringify(state));
    // Headless Chromium renders on the CPU and runs slower than real time, so
    // judge progress against simulated time, not wall-clock time.
    const minX = state.simTime * 250;
    if (!(state.simTime > 0.2 && state.x > minX)) errors.push(`[${name}] skier did not move (x=${state.x}, simTime=${state.simTime})`);
    // Restart twice: the scene must rebuild cleanly (three cameras, fresh run).
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('play');
      return { cameras: scene.cameras.cameras.length, simTime: scene.run.time };
    });
    if (after.cameras !== 3 || after.simTime > 5) errors.push(`[${name}] bad restart ${JSON.stringify(after)}`);
    // Pause freezes the sim; restart from the pause menu starts a fresh run.
    const scene = () => page.evaluate(() => {
      const s = window.__game.scene.getScene('play');
      return { state: s.state, simTime: s.run.time, screen: document.querySelector('#overlay .screen:not([hidden])')?.className ?? null };
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const paused = await scene();
    await page.waitForTimeout(500);
    const stillPaused = await scene();
    await page.screenshot({ path: `${outDir}/${name}-4-paused.png` });
    if (paused.state !== 'paused' || stillPaused.simTime !== paused.simTime) errors.push(`[${name}] pause did not freeze ${JSON.stringify([paused, stillPaused])}`);
    await page.click('#overlay .pause [data-act="restart"]');
    await page.waitForTimeout(800);
    const restarted = await scene();
    if (restarted.state !== 'playing' || restarted.simTime > 2 || restarted.screen !== null) errors.push(`[${name}] bad restart from pause ${JSON.stringify(restarted)}`);
    // Let the avalanche catch the skier: game-over screen, then back to the title.
    await page.evaluate(() => {
      const run = window.__game.scene.getScene('play').run;
      run.avalancheX = run.skier.x + 10;
    });
    await page.waitForFunction(() => document.querySelector('#overlay .over:not([hidden])'), null, { timeout: 15000 });
    await page.screenshot({ path: `${outDir}/${name}-5-over.png` });
    await page.click('#overlay .over [data-act="home"]');
    await page.waitForTimeout(800);
    const home = await scene();
    if (home.state !== 'menu' || !home.screen?.includes('title')) errors.push(`[${name}] bad return to title ${JSON.stringify(home)}`);
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
if (errors.length) {
  console.error('FAILED:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`OK — screenshots in ${outDir}/`);
