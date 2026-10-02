# Yeti, Set, Go!

An endless downhill skiing game for the browser, inspired by *Ski Safari*.
You play a yeti on skis, outrunning an avalanche.
Portfolio / learning project. Not affiliated with the original.

**Status: early Phase 1.** Endless procedural slope, jump, hold-to-backflip,
landing judgement, crash and recover, an avalanche chasing you, score with a
trick multiplier, synthesised sound, and title / pause / game-over screens. No
obstacles, coins or animals yet. See [`docs/research.md`](docs/research.md)
for the plan.

## Run it

```bash
bun install
bun run dev        # http://localhost:5173 — also reachable from your phone on the same Wi-Fi
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
| Pause | Esc / P | ⏸ button |
| New run | R | Pause → Restart |
| Mute | M | Sound button in menus |
| Tuning panel | T | — |
| Debug overlay | D | — |

Land with your skis roughly parallel to the snow. Clean landings after flips
give you a speed boost; landing badly is a wipeout.

Stay ahead of the avalanche: it speeds up the longer you ski, and a wipeout
lets it catch up. Score is 1 point per metre plus trick points. A clean flip
scores 100 (2 flips 300, 3 flips 600) and raises the multiplier by the
number of flips, up to ×10. A sloppy landing or a crash resets it to ×1.

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
    run.ts        One run: fixed 120 Hz step, avalanche, stats
    score.ts      Trick points and the multiplier
    rng.ts        Seeded PRNG
  render/       Phaser views of the sim (terrain chunks, skier, avalanche, sky, particles)
  ui/           HUD, DOM menus (title / pause / game over) and the tuning panel
  audio.ts      Every sound, synthesised with WebAudio (no audio files)
  scenes/       PlayScene wires input → sim → views, three cameras
  tuning.ts     Every feel number in one place
tests/          Vitest unit tests for the sim
scripts/
  probe.ts      Headless bots that play the sim and report air time, landings, speed, avalanche survival
  smoke.mjs     Headless Chromium smoke test (fails on console errors)
  tour.mjs      Scripted play-through on a faked clock → screenshots/
```

Why custom physics instead of Matter.js / Box2D, and why templates instead of
noise for the terrain: see [`docs/research.md`](docs/research.md).

## Checks

```bash
bun run test       # unit tests
bun run typecheck
bun run probe      # headless feel stats
bun run build && bun run smoke   # browser smoke test
```
