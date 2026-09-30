// Visual tour: drives the game on a faked clock (so slow headless rendering
// doesn't matter) and screenshots key moments: a flip, a landing, big air.
// Usage: npm run build && node scripts/tour.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('screenshots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const [w, h, dpr] = (process.env.VIEW ?? '1280x720x1').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Freeze the page clock: game time only moves when we say so, however long
// each (software-rendered) frame takes for real.
await page.clock.install({ time: 0 });
await page.clock.pauseAt(1000);
await page.goto(`http://localhost:4175/?seed=${process.env.SEED ?? 7}${process.env.DEBUG ? '&debug' : ''}`);
// Let fonts/boot finish on the fake clock.
for (let i = 0; i < 40 && !(await page.evaluate(() => !!window.__game?.scene?.getScene('play')?.run)); i++) {
  await page.clock.runFor(100);
}
const state = () =>
  page.evaluate(() => {
    const s = window.__game.scene.getScene('play').run.skier;
    return { mode: s.mode, x: Math.round(s.x), air: +s.airTime.toFixed(2), h: Math.round(s.heightAboveGround()), spin: Math.round((s.airRotation * 180) / Math.PI) };
  });
const frames = async (ms) => {
  for (let t = 0; t < ms; t += 16) await page.clock.runFor(16);
};
const shot = async (name) => {
  await page.screenshot({ path: `screenshots/tour-${name}.png` });
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
await browser.close();
server.kill();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
