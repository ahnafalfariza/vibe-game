// Visual tour: drives the game on a faked clock (so slow headless rendering
// doesn't matter) and screenshots key moments: a flip, a landing, big air.
// Usage: bun run build && node scripts/tour.mjs
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
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Freeze the page clock: game time only moves when we say so, however long
// each (software-rendered) frame takes for real.
await page.clock.install({ time: 0 });
await page.clock.pauseAt(1000);
await page.goto(`http://localhost:${port}/?seed=${process.env.SEED ?? 7}${process.env.DEBUG ? '&debug' : ''}`);
// Let fonts/boot finish on the fake clock.
for (let i = 0; i < 40 && !(await page.evaluate(() => !!window.__game?.scene?.getScene('play')?.run)); i++) {
  await page.clock.runFor(100);
}
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

// Obstacles and coins, on a mountain where they all turn up early. An
// autopilot hops rocks and jumps onto cabin roofs; each moment is shot once.
const seed2 = process.env.OBSTACLE_SEED ?? 36;
const p2 = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
p2.on('pageerror', (e) => errors.push(e.message));
await p2.clock.install({ time: 0 });
await p2.clock.pauseAt(1000);
await p2.goto(`http://localhost:${port}/?seed=${seed2}${process.env.DEBUG ? '&debug' : ''}`);
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
  await p2.screenshot({ path: `screenshots/tour-${name}.png` });
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

// Mounts: a bare slope (no random obstacles or mounts, via saved tuning), with
// each mount put just ahead of the yeti, then ridden. `?mount=` (startMount)
// is tried too. Each step waits for its moment, then shoots it.
async function mountPage(query, [vw, vh, vdpr] = [w, h, dpr]) {
  const p = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: vdpr });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem('yeti-set-go.tuning', JSON.stringify({ obstacleDensity: 0, mountDensity: 0 })));
  await p.clock.install({ time: 0 });
  await p.clock.pauseAt(1000);
  await p.goto(`http://localhost:${port}/?seed=${process.env.MOUNT_SEED ?? 11}${query}${process.env.DEBUG ? '&debug' : ''}`);
  for (let i = 0; i < 40 && !(await p.evaluate(() => !!window.__game?.scene?.getScene('play')?.run)); i++) await p.clock.runFor(100);
  await p.keyboard.press('Enter');
  await p.clock.runFor(100);
  return p;
}
const ride = (p) =>
  p.evaluate(() => {
    const run = window.__game.scene.getScene('play').run;
    const s = run.skier;
    // Keep the avalanche off our backs: this is a photo shoot.
    run.avalancheX = Math.min(run.avalancheX, s.x - 1800);
    const st = run.stats;
    return {
      x: Math.round(s.x),
      mode: s.mode,
      state: run.mounts.state,
      stack: run.mounts.stack.join('+'),
      h: Math.round(s.heightAboveGround()),
      fuel: +run.mounts.fuel.toFixed(1),
      eagle: +run.mounts.eagleTime.toFixed(1),
      smashes: st.smashes,
      shieldsLost: st.shieldsLost,
    };
  });
/** Put `kind` (a mount, or 'rock') `d` px ahead of the yeti, on the slope. Returns its x. */
const put = (p, kind, d) =>
  p.evaluate(
    ([kind, d]) => {
      const run = window.__game.scene.getScene('play').run;
      const x = run.skier.x + d;
      if (kind === 'rock') run.spawner.add({ kind: 'rock', x0: x - 34, x1: x + 34, x, y: run.terrain.height(x) - 7, r: 34 });
      else run.spawner.addMount(kind, x);
      return x;
    },
    [kind, d],
  );
const until = async (p, ok, ms = 8000) => {
  for (let t = 0; t < ms; t += 16) {
    const st = await ride(p);
    if (ok(st)) return st;
    await p.clock.runFor(16);
  }
  return null;
};
const wait = (p, ms) => until(p, () => false, ms);
const snap = async (p, name, st) => {
  await p.screenshot({ path: `screenshots/tour-${name}.png` });
  console.log(name, JSON.stringify(st ?? (await ride(p))));
};
const missed = [];
const moment = async (p, name, ok, ms) => {
  const st = await until(p, ok, ms);
  if (st) await snap(p, name, st);
  else missed.push(name);
  return st;
};
/** Put `kind` ahead while on the snow, until riding into one does `done` (a few tries: it may get flown over). */
const hitUntil = async (p, kind, done) => {
  for (let i = 0; i < 5; i++) {
    await until(p, (st) => st.mode === 'ground', 3000);
    const x = await put(p, kind, 700);
    const st = await until(p, (st) => done(st) || st.x > x + 300, 4000);
    if (st && done(st)) return st;
  }
  return null;
};
const rockUntil = (p, done) => hitUntil(p, 'rock', done);
/** A waiting mount, shot once the yeti is closing in on it. */
const idleShot = async (p, kind, name) => {
  await until(p, (st) => st.mode === 'ground', 3000);
  const x = await put(p, kind, 1300);
  await until(p, (st) => st.x > x - 650, 4000);
  await snap(p, name);
};

// Penguin: waiting, ridden, then a rock knocks it off (the shield).
const p3 = await mountPage('');
await wait(p3, 1500);
await idleShot(p3, 'penguin', '11-penguin-idle');
await moment(p3, '12-penguin-ridden', (st) => st.stack === 'penguin', 6000);
await wait(p3, 500);
if (await rockUntil(p3, (st) => st.shieldsLost > 0)) {
  await wait(p3, 120);
  await snap(p3, '13-shield-lost');
} else missed.push('13-shield-lost');
// Eagle: circling above the slope, then jump into it and climb.
await idleShot(p3, 'eagle', '14-eagle-idle');
const eagleAt = await p3.evaluate(() => window.__game.scene.getScene('play').run.spawner.mounts.at(-1).ax);
const near = await until(p3, (st) => st.state === 'carried' || (st.x > eagleAt - 300 && st.mode === 'ground'), 6000);
if (near?.state !== 'carried') await p3.keyboard.down('Space');
await moment(p3, '15-eagle-grab', (st) => st.state === 'carried', 2000);
await p3.keyboard.down('Space');
await wait(p3, 1500);
await snap(p3, '15b-eagle-flight');
await p3.keyboard.up('Space');
await moment(p3, '15c-eagle-release', (st) => st.state !== 'carried', 6000);
await wait(p3, 400);
await snap(p3, '15d-eagle-flies-off');
await p3.close();

// Snowmobile: parked, ridden, picking up a penguin, running out of fuel.
const p4 = await mountPage('');
await wait(p4, 1500);
await idleShot(p4, 'snowmobile', '16-snowmobile-idle');
await moment(p4, '17-snowmobile-ridden', (st) => st.stack === 'snowmobile', 6000);
await wait(p4, 600);
await put(p4, 'penguin', 1300);
await moment(p4, '18-snowmobile-penguin', (st) => st.stack === 'snowmobile+penguin', 6000);
await wait(p4, 400);
await snap(p4, '18b-snowmobile-penguin-later');
await moment(p4, '19-out-of-fuel', (st) => st.stack === 'penguin', 20000);
await wait(p4, 300);
await snap(p4, '19b-out-of-fuel-after');
await p4.close();

// Polar bear, from ?mount=bear: ridden, smashing a rock, then swapped for a penguin (it runs off).
const p5 = await mountPage('&mount=bear');
await wait(p5, 1200);
await snap(p5, '20-bear-ridden');
if (await rockUntil(p5, (st) => st.smashes > 0)) {
  await wait(p5, 60);
  await snap(p5, '21-bear-smash');
} else missed.push('21-bear-smash');
await until(p5, (st) => st.mode === 'ground', 3000);
await put(p5, 'penguin', 900);
await moment(p5, '23-swap', (st) => st.stack === 'penguin', 6000);
await wait(p5, 250);
await snap(p5, '23b-swap-bear-runs');
await p5.close();
const p6 = await mountPage('');
await wait(p6, 1500);
await idleShot(p6, 'bear', '22-bear-idle');
await p6.close();

// The phone: a stacked rider, and eagle flight.
const phone = [844, 390, 2];
const p7 = await mountPage('&mount=snowmobile', phone);
await wait(p7, 800);
if (await hitUntil(p7, 'bear', (st) => st.stack === 'snowmobile+bear')) {
  await wait(p7, 500);
  await snap(p7, '24-phone-snowmobile-bear');
} else missed.push('24-phone-snowmobile-bear');
await p7.close();
const p8 = await mountPage('&mount=eagle', phone);
await p8.keyboard.down('Space');
await wait(p8, 1800);
await snap(p8, '25-phone-eagle');
await p8.close();
if (missed.length) console.log('mount moments not seen:', missed.join(', '));
await browser.close();
server.kill();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
