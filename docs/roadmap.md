# Yeti, Set, Go!: roadmap review

Snapshot as of 2026-10-02, updated as phases land. Source of truth for the plan is
[`research.md`](research.md) §2 and §4; this file lays out what exists in code
versus what is still planned, so the plan can be adjusted.

Legend: ✅ done · 🟡 partial · ⬜ not started · ❓ decision needed

---

## Next up

Phase 1 is built. Remaining Phase 1 items need a human:

1. **Deploy** (in progress separately). Static Vite build; Pages needs `base` in `vite.config.ts`.
2. **Real-phone test** on the deployed URL: iOS audio unlock, touch latency, orientation.
3. **Phase 0 gate sign-off:** a quick "is 60 s fun?" playtest.

Then Phase 2 (mounts, with the polar bear as the tough mount) and Phase 3.

Decided 2026-10-02: coins ship in Phase 1 (cluster speed bonus, lifetime
wallet for the Phase 3 shop); the tough mount is a **polar bear**.

---

## Phase 0 — Feel prototype ✅

**Gate:** "Is 60 seconds of just this fun?" Never formally signed off; Phase 1
work has started anyway.

| Planned feature | Status | Where / notes |
|---|---|---|
| Seeded endless procedural slope, chunked streaming | ✅ | `src/sim/terrain.ts`. Templates `start, cruise, rollers, kicker, drop, bowl, booter`, Hermite-stitched (C1, no kinks). `?seed=` param. |
| Skier: slope-following ground, ballistic air, jump, hold-to-flip | ✅ | `src/sim/skier.ts`, modes `ground / air / crash`. |
| Landing judgement + flip speed reward | ✅ | `clean` (<28°) / `sloppy` (<62°, keeps 80% speed) / `crash` (keeps 35%). +260 px/s per flip on clean land. |
| Camera follows, zooms out with height and speed | ✅ | `PlayScene.updateCamera`. Frames the landing spot during jumps. Three cameras (backdrop / world / UI). |
| Instant restart | ✅ | R key / ↻ button. |
| Debug overlay (speed, angle, slope, FPS, seed) | ✅ | D key or `?debug`. |

### Built beyond the Phase 0 plan

- **Live tuning panel** (T / `?tune`), 27 feel constants in `src/tuning.ts`, persisted to `localStorage`, "Copy values" button.
- **Forgiveness mechanics:** coyote time (0.08 s), jump buffer (0.1 s), landing assist (auto-settles toward safe angle when within 40°).
- **Difficulty ramp:** kicker and drop templates get more frequent with distance.
- **Fixed 120 Hz sim with render interpolation** (`PlayScene` accumulator).
- **Art:** code-drawn character, parallax sky/mountains/trees, snowfall, ski spray. Palette in `src/render/palette.ts`.
- **Terrain chunk pooling** (`src/render/terrainView.ts`).
- **Tooling:** Vitest sim tests, headless bot probe (`bun run probe`, now reports survival time), Chromium smoke test that drives the menus, scripted screenshot tour.

---

## Phase 1 — Minimum viable game ✅ (real-phone test pending)

Goal: a run that can be *lost*, with a reason to play again.

| Feature | Status | Notes / open questions |
|---|---|---|
| Avalanche with speed curve, visible when close | ✅ | In `src/sim/run.ts` + `src/render/avalancheView.ts`. Starts 350 px back at 500 px/s, +6 px/s², **rubber-banded** to never be more than 2400 px (60 m) behind. Camera keeps it in shot when close; HUD shows distance under 40 m. |
| Crash → tumble → recover or get caught → game over | ✅ | Recover after 1 s; caught ends the run. |
| Score, trick multiplier, local high score | ✅ | `src/sim/score.ts`. 1 pt/m + trick points (100 / 300 / 600 for 1 / 2 / 3 flips, +50 big air ≥1.1 s) × multiplier. Clean flips raise multiplier up to ×10; sloppy or crash resets it. Best score in `localStorage`. |
| Title / pause / game-over screens | ✅ | `src/ui/menu.ts`, DOM over canvas. Title over a demo run; pause via button, Esc, P, or tab blur; game over with stats + new-best badge. |
| SFX + music | ✅ | `src/audio.ts`, all synthesised WebAudio, no files. Ski hiss + wind follow speed; jump, landing, trick chime (pitch rises with multiplier), crash, caught, avalanche rumble, coin blips, hit thud. Music: 128 BPM, 16-bar loop (`Music` class at the end of `audio.ts`) with a softer title arrangement and an urgent one when the avalanche is close; fades out when caught. M mutes all (persisted); separate Music toggle in menus. |
| Touch, mouse, keyboard input; mobile browser | 🟡 | Tap/click/Space/↑/W all work. **Real-phone test not done** (risk #4, iOS audio unlock especially). |
| Obstacles: rock, cabin (rideable roof), ice patch | ✅ | `src/sim/spawner.ts`, own RNG stream so terrain per seed is unchanged. Per-feature spawn tables with an easy→hard ramp (`obstacleDensity` scales it). Fair placement checked against four "ghost" riders (idle, slow, fast, lip-jumper): no rock in forced flights or on touchdowns, cabins only where every ghost meets the wall on the snow or clears the roof. Skier rides a `Ground` overlay (terrain + roofs + ice). Hitting a cabin wall crashes and smashes it to rubble. Ice: near-zero friction, 0.4× drag, no spray. 0.8 s invulnerability after a hit. Views pooled in `src/render/obstacleView.ts`. |
| Coins in clusters + full-cluster speed bonus | ✅ | Lines on the snow or arcs over jumps, 5–12 coins. Full cluster: +300 px/s. Lifetime wallet in `src/wallet.ts` (`yeti-set-go.coins`). HUD counter, coins on game-over screen. |
| Yeti player art | ✅ | Lavender fur with an indigo outline so it reads on snow, yellow beanie, pink scarf. `src/render/skierView.ts`. |

---

## Phase 2 — The Safari (mounts) ⬜

What makes this game more than Tiny Wings / Alto. Since the player *is* the
yeti, the yeti dropped out of the mount list.

| Feature | Status | Notes |
|---|---|---|
| Mount system: state machine + **stack** | ⬜ | Planned `sim/mounts.ts`. Snowmobile carries other mounts. |
| Penguin | ⬜ | Glides further, flips faster, one-hit shield. |
| Eagle | ⬜ | Grabs the yeti, flies high for limited time. |
| Snowmobile | ⬜ | High top speed, carries stacked animals. |
| Mount-as-shield rules | ⬜ | Hit drops top of stack instead of crashing. |
| Polar bear (tough mount) | ⬜ | Smashes rocks and cabins. Fills the role left open by removing the yeti. |
| Character art | ⬜ | Recraft (SVG + style ID) recommended once style locked; ~10–15 assets total. |

---

## Phase 3 — Meta progression ⬜

| Feature | Status | Notes |
|---|---|---|
| Objectives (3 active, persistent) | ⬜ | e.g. "ride 3 penguins". |
| Ranks → base multiplier, perks | ⬜ | e.g. start run on a mount. |
| Coin shop with gameplay upgrades | ⬜ | Upgrades before cosmetics. |
| Second biome | ⬜ | Palette + obstacle set + spawn table. |

---

## Explicitly out of scope

Daily login, lucky spin, ads/IAP, online leaderboards, multiplayer, events,
app-store builds (Capacitor only if publishing ever matters).

---

## Not on any phase yet (candidates to add)

- **Hosting / shareable link** (Vercel or GitHub Pages). No deploy set up. Cheap, and needed for the real-phone test and portfolio.
- ~~Pooling for obstacles/coins~~ done with the obstacles.
- **Crash ragdoll** via tween, `planck` only if worth it. The existing tumble covers it for now.
- ~~Reduced-motion setting~~ done: follows the OS `prefers-reduced-motion` (no shake, no flicker).

---

## Suggested adjustments to consider

1. **Do the real-phone test now.** Audio, music, menus and obstacles all landed; iOS is where they break.
2. ~~Draw the yeti before obstacles~~ done.
3. ~~Obstacles first, coins later~~ both done.
4. ~~Move coins to Phase 3~~ kept in Phase 1.
5. ~~Pick the tough-mount replacement~~ polar bear.
6. **Add deploy to Phase 1** (in progress).
