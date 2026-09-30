# Selancar Ahay

An endless downhill skiing game for the browser, inspired by *Ski Safari*.
Portfolio / learning project. Not affiliated with the original.

**Status: Phase 0 — feel prototype.** Endless procedural slope, jump,
hold-to-backflip, landing judgement, crash and recover. No avalanche, animals
or score yet. See [`docs/research.md`](docs/research.md) for the plan.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — also reachable from your phone on the same Wi-Fi
```

Handy URL parameters:

| Param | Effect |
|---|---|
| `?seed=123` | Same mountain every run (great for comparing tuning changes) |
| `?debug` | Show the debug overlay |
| `?tune` | Open the tuning panel on load |

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Jump | Space / ↑ / W / click | Tap |
| Backflip | Hold while in the air | Hold |
| New run | R | ↻ button |
| Tuning panel | T | — |
| Debug overlay | D | — |

Land with your skis roughly parallel to the snow. Clean landings after flips
give you a speed boost; landing badly is a wipeout.

## Tuning the feel

Press **T** for a live panel of every feel constant (gravity, flip speed,
landing tolerance…). Changes apply instantly and persist in `localStorage`.
When something feels right, hit **Copy values** and paste them into
`src/tuning.ts`.

## Project layout

```
src/
  sim/          Pure TypeScript game logic. No Phaser, fully unit-tested.
    terrain.ts    Endless mountain from shaped templates, joined with Hermite curves
    skier.ts      Custom skier physics: ground / air / crash, landing judgement
    run.ts        One run: fixed 120 Hz step, stats
    rng.ts        Seeded PRNG
  render/       Phaser views of the sim (terrain chunks, skier, sky, particles)
  ui/           HUD and the tuning panel
  scenes/       PlayScene wires input → sim → views, three cameras
  tuning.ts     Every feel number in one place
tests/          Vitest unit tests for the sim
scripts/
  probe.ts      Headless bots that play the sim and report air time, landings, speed
  smoke.mjs     Headless Chromium smoke test (fails on console errors)
  tour.mjs      Scripted play-through on a faked clock → screenshots/
```

Why custom physics instead of Matter.js / Box2D, and why templates instead of
noise for the terrain: see [`docs/research.md`](docs/research.md).

## Checks

```bash
npm test           # unit tests
npm run typecheck
npm run probe      # headless feel stats
npm run build && npm run smoke   # browser smoke test
```
