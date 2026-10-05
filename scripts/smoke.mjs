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
  url = `http://localhost:${port}/play/?seed=7`;
  await new Promise((r) => setTimeout(r, 2500));
}

const executablePath = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  // The landing page, one level up from the game: loads clean, its widgets render.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.on('console', (m) => m.type() === 'error' && errors.push(`[landing] ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`[landing] ${e.message}`));
    page.on('response', (r) => r.status() >= 400 && errors.push(`[landing] HTTP ${r.status()} ${r.url()}`));
    await page.goto(new URL('..', url).href);
    const verdicts = [];
    for (const deg of [0, 120]) {
      await page.$eval('#tilt', (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input'));
      }, String(deg));
      verdicts.push(await page.textContent('#verdict'));
    }
    if (verdicts.join() !== 'Clean,Wipeout') errors.push(`[landing] landing judge said ${verdicts}`);
    if (!(await page.locator('#shop li').count())) errors.push('[landing] the shop did not render');
    await page.screenshot({ path: `${outDir}/landing.png` });
    await page.close();
  }
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
    // Biome picker: the demo run behind the title switches right away. Twilight Pines is
    // locked until level 3, so on a fresh profile it's only a preview: not remembered, not playable.
    await page.click('#overlay [data-act="biome-next"]');
    await page.waitForTimeout(800);
    const picked = await page.evaluate(() => ({
      biome: window.__game.scene.getScene('play').ctx.biome,
      saved: localStorage.getItem('yeti-set-go.biome'),
      cameras: window.__game.scene.getScene('play').cameras.cameras.length,
      playable: !document.querySelector('#overlay .title [data-act="play"]').disabled,
    }));
    await page.screenshot({ path: `${outDir}/${name}-0b-biome.png` });
    if (picked.biome !== 'twilight' || picked.saved !== null || picked.playable || picked.cameras !== 3) errors.push(`[${name}] bad biome pick ${JSON.stringify(picked)}`);
    await page.click('#overlay [data-act="biome-prev"]');
    await page.waitForTimeout(500);
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

    // Meta: Goals and Shop panels, buying with granted coins (?coins=), and the purchase changing the next run.
    const profile = () => page.evaluate(() => JSON.parse(localStorage.getItem('yeti-set-go.profile') ?? 'null'));
    const panel = () =>
      page.evaluate(() => ({
        screen: document.querySelector('#overlay .screen:not([hidden])')?.className ?? null,
        focus: document.activeElement?.closest('.screen')?.className ?? document.activeElement?.tagName,
        focusAct: document.activeElement?.dataset?.act ?? null,
      }));
    await page.goto(`${url}&coins=5000`);
    await page.waitForFunction(() => window.__game?.scene?.getScene('play')?.run, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const before = await profile();
    if (before?.coins !== 5000) errors.push(`[${name}] ?coins=5000 gave ${JSON.stringify(before)}`);
    await page.click('#overlay [data-act="goals"]');
    await page.waitForTimeout(300);
    const goals = await panel();
    const goalRows = await page.locator('#overlay .goals .goal').count();
    await page.screenshot({ path: `${outDir}/${name}-6-goals.png` });
    if (!goals.screen?.includes('goals') || !goals.focus?.includes('goals') || goalRows !== 3) errors.push(`[${name}] bad goals panel ${JSON.stringify({ goals, goalRows })}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await panel();
    if (!closed.screen?.includes('title') || closed.focusAct !== 'goals') errors.push(`[${name}] Esc did not close goals ${JSON.stringify(closed)}`);
    await page.click('#overlay [data-act="shop"]');
    await page.waitForTimeout(300);
    const shop = await panel();
    if (!shop.screen?.includes('shop') || !shop.focus?.includes('shop')) errors.push(`[${name}] bad shop panel ${JSON.stringify(shop)}`);
    await page.click('#overlay [data-act="buy"][data-id="headStart"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${outDir}/${name}-7-shop.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (!(await panel()).screen?.includes('title')) errors.push(`[${name}] Esc did not close the shop`);
    // Reload without the grant: the purchase stuck, the demo run behind the title is untouched, the next run starts on a snowmobile.
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.scene?.getScene('play')?.run, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const after2 = await profile();
    if (after2?.upgrades?.headStart !== 1 || after2?.coins !== 4600) errors.push(`[${name}] purchase did not persist ${JSON.stringify(after2)}`);
    const demoStack = await page.evaluate(() => window.__game.scene.getScene('play').run.mounts.stack.join('+'));
    if (demoStack !== '') errors.push(`[${name}] the demo run got a start mount: ${demoStack}`);
    await page.click('#overlay [data-act="play"]');
    await page.waitForFunction(() => window.__game.scene.getScene('play').state === 'playing', null, { timeout: 5000 });
    const runStack = await page.evaluate(() => window.__game.scene.getScene('play').run.mounts.stack.join('+'));
    if (runStack !== 'snowmobile') errors.push(`[${name}] Head start did not change the run: stack "${runStack}"`);
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
