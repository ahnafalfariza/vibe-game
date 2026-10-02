// Visual tour: drives the game on a faked clock (so slow headless rendering
// doesn't matter) and screenshots key moments: a flip, a landing, big air.
// Usage: bun run build && node scripts/tour.mjs
// Env: PORT, VIEW=844x390x2 (viewport x DPR), SEED, OBSTACLE_SEED, DEBUG,
// BIOME=twilight (screenshots then go to screenshots/tour-twilight-*.png).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

mkdirSync('screenshots', { recursive: true });
const port = process.env.PORT ?? '4175';
const server = spawn('bunx', ['vite', 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  executablePath: ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p)),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const [w, h, dpr] = (process.env.VIEW ?? '1280x720x1').split('x').map(Number);
const biome = process.env.BIOME;
const extra = (process.env.DEBUG ? '&debug' : '') + (biome ? `&biome=${biome}` : '');
const prefix = `screenshots/tour${biome ? `-${biome}` : ''}`;
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Freeze the page clock: game time only moves when we say so, however long
// each (software-rendered) frame takes for real.
await page.clock.install({ time: 0 });
await page.clock.pauseAt(1000);
await page.goto(`http://localhost:${port}/?seed=${process.env.SEED ?? 7}${extra}`);
// Let fonts/boot finish on the fake clock.
for (let i = 0; i < 40 && !(await page.evaluate(() => !!window.__game?.scene?.getScene('play')?.run)); i++) {
  await page.clock.runFor(100);
}
await page.clock.runFor(1000);
await page.screenshot({ path: `${prefix}-0-title.png` });
// Start a run from the title screen.
await page.keyboard.press('Enter');
await page.clock.runFor(100);
const state = () =>
  page.evaluate(() => {
    const s = window.__game.scene.getScene('play').run.skier;
    return { mode: s.mode, x: Math.round(s.x), air: +s.airTime.toFixed(2), h: Math.round(s.heightAboveGround()), spin: Math.round((s.airRotation * 180) / Math.PI) };
  });
const frames = async (ms) => {
  for (let t = 0; t < ms; t += 16) await page.clock.runFor(16);
};
const shot = async (name) => {
  await page.screenshot({ path: `${prefix}-${name}.png` });
  console.log(name, JSON.stringify(await state()));
};

await frames(2500);
await shot('1-cruise');
// Wait for a ramp lip (steep uphill) and jump + hold for a backflip.
for (let i = 0; i < 600; i++) {
  const a = await page.evaluate(() => window.__game.scene.getScene('play').run.skier.angle);
  if (a < -0.45) break;
  await frames(16);
}
await page.keyboard.down('Space');
await frames(400);
await shot('2-flipping');
// Release like a player would: when most of the way round.
for (let i = 0; i < 200 && (await state()).spin > -250; i++) await frames(16);
await page.keyboard.up('Space');
await frames(300);
await shot('2b-coming-down');
for (let i = 0; i < 300 && (await state()).mode === 'air'; i++) await frames(16);
await frames(120);
await shot('3-landed');
await frames(6000);
await shot('4-later');
// Deliberately over-rotate to see a crash.
while ((await state()).mode !== 'ground') await frames(16);
await page.keyboard.down('Space');
await frames(560);
await page.keyboard.up('Space');
for (let i = 0; i < 300 && (await state()).mode === 'air'; i++) await frames(16);
await frames(200);
await shot('5-after-attempt');
// Fully zoomed out (the camera's limit, MIN_ZOOM_MUL): it eases back in over the next frames.
await page.evaluate(() => (window.__game.scene.getScene('play').view.zoomMul = 0.42));
await page.clock.runFor(16);
await shot('5b-zoomed-out');

// Obstacles and coins, on a mountain where they all turn up early. An
// autopilot hops rocks and jumps onto cabin roofs; each moment is shot once.
const seed2 = process.env.OBSTACLE_SEED ?? 36;
const p2 = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
p2.on('pageerror', (e) => errors.push(e.message));
await p2.clock.install({ time: 0 });
await p2.clock.pauseAt(1000);
await p2.goto(`http://localhost:${port}/?seed=${seed2}${extra}`);
for (let i = 0; i < 40 && !(await p2.evaluate(() => !!window.__game?.scene?.getScene('play')?.run)); i++) await p2.clock.runFor(100);
await p2.keyboard.press('Enter');
await p2.clock.runFor(100);
const look = () =>
  p2.evaluate(() => {
    const run = window.__game.scene.getScene('play').run;
    const s = run.skier;
    const ground = run.terrain.height(s.x);
    let next = null;
    for (const e of run.spawner.entities) {
      if (e.kind === 'coin' || e.kind === 'ice' || (e.kind === 'cabin' && e.broken)) continue;
      const d = e.x0 - s.x;
      if (d > 0 && (!next || d < next.d)) next = { kind: e.kind, d };
    }
    const arc = run.spawner.entities.some((e) => e.kind === 'coin' && !e.taken && Math.abs(e.x - s.x) < 350 && run.terrain.height(e.x) - e.y > 80);
    const overRock = s.mode === 'air' && run.spawner.entities.some((e) => e.kind === 'rock' && Math.abs(e.x - s.x) < 60);
    return {
      mode: s.mode,
      x: Math.round(s.x),
      v: s.velocity,
      onRoof: s.mode === 'ground' && ground - s.y > 50,
      onIce: s.mode === 'ground' && !!run.spawner.sample(s.x).ice,
      arc: s.mode === 'air' && arc,
      overRock,
      next,
      coins: run.stats.coins,
      crashes: run.stats.crashes,
    };
  });
const wanted = new Set(['6-rock-ahead', '6b-rock-hop', '7-cabin-ahead', '8-cabin-roof', '9-ice', '10-coin-arc']);
const shot2 = async (name, st) => {
  if (!wanted.delete(name)) return;
  await p2.screenshot({ path: `${prefix}-${name}.png` });
  console.log(name, JSON.stringify(st));
};
let jumpHeld = false;
for (let i = 0; i < 2500 && wanted.size > 0; i++) {
  const st = await look();
  if (jumpHeld) {
    await p2.keyboard.up('Space');
    jumpHeld = false;
  } else if (st.mode === 'ground' && st.next) {
    // Jump a rock 0.3 s out; jump onto a cabin 0.45 s out so you land on the roof.
    const lead = st.next.kind === 'rock' ? 0.3 : 0.45;
    if (st.next.d < st.v * lead) {
      await p2.keyboard.down('Space');
      jumpHeld = true;
    }
  }
  if (st.next?.kind === 'rock' && st.next.d > 350 && st.next.d < 650) await shot2('6-rock-ahead', st);
  if (st.overRock) await shot2('6b-rock-hop', st);
  if (st.next?.kind === 'cabin' && st.next.d > 450 && st.next.d < 800) await shot2('7-cabin-ahead', st);
  if (st.onRoof) await shot2('8-cabin-roof', st);
  if (st.onIce) await shot2('9-ice', st);
  if (st.arc) await shot2('10-coin-arc', st);
  await p2.clock.runFor(16);
}
if (wanted.size) console.log('not seen:', [...wanted].join(', '));
console.log('obstacle run', JSON.stringify(await look()));
await browser.close();
server.kill();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
