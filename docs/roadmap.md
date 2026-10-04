# Yeti, Set, Go!: roadmap review

Snapshot as of 2026-10-04, updated as phases land. Source of truth for the plan is
[`research.md`](research.md) §2 and §4; this file lays out what exists in code
versus what is still planned, so the plan can be adjusted.

Legend: ✅ done · 🟡 partial · ⬜ not started · ❓ decision needed

---

## Next up

Phases 1–3 are built and deployed (Cloudflare Workers). What's left needs a
human, then polish:

1. **Real-phone test** on the deployed URL: iOS audio unlock, touch latency, orientation.
2. **Playtest sign-off:** the Phase 0 "is 60 s fun?" gate, now with the full game.
3. **Balance pass** from real play: goal tiers (mid-tier "ride 2 penguins" needs ~1,200 m runs), shop prices, cabin rarity (fairness rules leave few spots), mount spawn rate.
4. **Known rough edges:** all fixed. Holding through a jump reaches an eagle; only a jump grabs one (a tall stack riding underneath doesn't); quitting a run (restart, main menu, closing the tab) banks its coins and goal progress; the portrait game-over card fits short phones down to 360×480.

Decided 2026-10-02: coins ship in Phase 1 (cluster speed bonus, lifetime
wallet for the Phase 3 shop); the tough mount is a **polar bear**.

---

## Phase 0 — Feel prototype ✅

**Gate:** "Is 60 seconds of just this fun?" Never formally signed off; Phase 1
work has started anyway.

| Planned feature | Status | Where / notes |
|---|---|---|
| Seeded endless procedural slope, chunked streaming | ✅ | `src/sim/terrain.ts`. Templates `start, cruise, rollers, kicker, drop, bowl, booter, chute, steps, whoops, gap`, Hermite-stitched (C1, no kinks). The newer four are gradient profiles (`shape()`): each piece is a parabola, so no wiggles. Each biome weights them with its own terrain mix. `?seed=` param. |
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
| Avalanche with speed curve, visible when close | ✅ | In `src/sim/run.ts` + `src/render/avalancheView.ts`. Starts 350 px back at 500 px/s, +7.5 px/s² (was 6 until the chutes made runs faster), **rubber-banded** to never be more than 2400 px (60 m) behind. Camera keeps it in shot when close; HUD shows distance under 40 m. |
| Crash → tumble → recover or get caught → game over | ✅ | Recover after 1 s; caught ends the run. |
| Score, trick multiplier, local high score | ✅ | `src/sim/score.ts`. 1 pt/m + trick points (100 / 300 / 600 for 1 / 2 / 3 flips, +50 big air ≥1.1 s) × multiplier. Clean flips raise multiplier up to ×10; sloppy or crash resets it. Best score in `localStorage`. |
| Title / pause / game-over screens | ✅ | `src/ui/menu.ts`, DOM over canvas. Title over a demo run; pause via button, Esc, P, or tab blur; game over with stats + new-best badge. |
| SFX + music | ✅ | `src/audio.ts`, all synthesised WebAudio, no files. Ski hiss + wind follow speed; jump, landing, trick chime (pitch rises with multiplier), crash, caught, avalanche rumble, coin blips, hit thud. Music: 128 BPM, 16-bar loop (`Music` class at the end of `audio.ts`) with a softer title arrangement and an urgent one when the avalanche is close; fades out when caught. M mutes all (persisted); separate Music toggle in menus. |
| Touch, mouse, keyboard input; mobile browser | 🟡 | Tap/click/Space/↑/W all work. **Real-phone test not done** (risk #4, iOS audio unlock especially). |
| Obstacles: rock, cabin (rideable roof), ice patch | ✅ | `src/sim/spawner.ts`, own RNG stream so terrain per seed is unchanged. Per-feature spawn tables with an easy→hard ramp (`obstacleDensity` scales it). Fair placement checked against four "ghost" riders (idle, slow, fast, lip-jumper): no rock in forced flights or on touchdowns, cabins only where every ghost meets the wall on the snow or clears the roof. Skier rides a `Ground` overlay (terrain + roofs + ice). Hitting a cabin wall crashes and smashes it to rubble. Ice: near-zero friction, 0.4× drag, no spray. 0.8 s invulnerability after a hit. Views pooled in `src/render/obstacleView.ts`. |
| Coins in clusters + full-cluster speed bonus | ✅ | Lines on the snow or arcs over jumps, 5–12 coins. Full cluster: +300 px/s. Lifetime wallet in `src/wallet.ts` (`yeti-set-go.coins`). HUD counter, coins on game-over screen. |
| Yeti player art | ✅ | Lavender fur with an indigo outline so it reads on snow, yellow beanie, pink scarf. `src/render/skierView.ts`. |

---

## Phase 2 — The Safari (mounts) ✅

What makes this game more than Tiny Wings / Alto. Since the player *is* the
yeti, the yeti dropped out of the mount list.

| Feature | Status | Notes |
|---|---|---|
| Mount system: state machine + **stack** | ✅ | `src/sim/mounts.ts`. Stack is at most snowmobile → one animal → yeti; a new animal swaps the old one off (it runs away), a snowmobile slides under the stack. State (on foot / riding / carried) is derived from the stack and eagle timer. Mounts change feel through one effective-tuning function; `skier.ts` only gained generic hooks (`lift`, `fallGravity`, `thrust`, carried flight). Mounts are a `mount` entry in the spawn table, first due around 370 / 810 / 1180 / 1530 m, then roughly every 600 m. Riding onto one scores 100–200 × multiplier. `?mount=<kind>` starts every run on that mount. |
| Penguin | ✅ | Half ground and air drag, flips 1.3× faster, 0.85× gravity when falling. Shield. |
| Eagle | ✅ | Carries the whole stack for 5 s: hold to climb, release to glide (110–520 px up). Ignores obstacles while flying. Not a shield. |
| Snowmobile | ✅ | 15 s of fuel, minimum speed 750 px/s plus thrust, flips slower. Carries one animal; keeps it when the tank runs dry. Shield. |
| Mount-as-shield rules | ✅ | A rock, cabin wall or crash landing knocks the top mount off instead: keep `sloppySpeedKeep`, invulnerability window, multiplier reset. |
| Polar bear (tough mount) | ✅ | Rocks and cabins shatter (150 × multiplier) and the bear stays. Heavier: more friction, 0.8× jump. A crash landing still knocks it off. |
| Character art | ✅ | Code-drawn in `src/render/mountView.ts`, same outline style as the yeti. HUD shows the stack plus eagle-flight and fuel bars. |

---

## Phase 3 — Meta progression ✅

| Feature | Status | Notes |
|---|---|---|
| Objectives (3 active, persistent) | ✅ | `src/sim/meta.ts` (pure rules) + `src/profile.ts` (localStorage, key `yeti-set-go.profile`, versioned; migrates the old `yeti-set-go.coins` wallet). 30 goals (23 single-run, 7 cumulative) over flips, air, speed, coins, clusters, distance, no-crash metres, score, and each mount. 5 difficulty tiers rising every two ranks. Three drawn from different families; mount goals only once your best run reaches that mount. Checked live: a mid-run toast and chime. |
| Ranks → base multiplier, perks | ✅ | Finish all three goals to rank up at the end of the run. Rank N multiplies the whole score by 1 + 0.25·(N−1). Perks: rank 2 penguin start, rank 3 Twilight Pines, rank 4 Blossom Ridge, rank 5 mounts 1.5× as often, rank 6 Glacier Gorge, rank 7 wipeouts 30% shorter, rank 8 Ember Peak. |
| Coin shop with gameplay upgrades | ✅ | Seven upgrades, 7,060 coins for everything (about 45 coins a run): head start (snowmobile, then + polar bear), coin magnet, cluster boost, avalanche delay, eagle wings, bigger tank, sturdy landings. Applied as tuning overrides and start mounts; never to the title-screen demo run. `?coins=` and `?profile=reset` for testing. |
| Second biome | ✅ | **Twilight Pines** (`src/biomes.ts`): dusk palette, moon, stars, aurora, denser pines, glowing cabin windows, fewer rocks, 3× cabins, longer ice. Biomes are data: palette overrides, backdrop options, a terrain mix and a spawn table. Picked on the title screen (‹ ›), remembered in `yeti-set-go.biome`, locked until rank 3, `?biome=` to force. |
| More biomes | ✅ | Each favours its own terrain. **Blossom Ridge** (rank 4): spring pinks, blossom pines, petals; whoops, rollers and kickers, more coins, fewer rocks. **Glacier Gorge** (rank 6): blue ice; gaps, chutes and bowls, 2× ice and longer sheets. **Ember Peak** (rank 8): a volcano at sunset, ash snow, charred pines, embers; steps, drops and booters, 1.6× rocks. Avalanche survival and coins a run, probe means (4 bots × 5 seeds): Sunny Slopes 61 s / 52 (was 62 s / 45 before the new terrain), Twilight 70 s / 61, Blossom 64 s / 60, Glacier 72 s / 52, Ember 66 s / 58. |

---

## Explicitly out of scope

Daily login, lucky spin, ads/IAP, online leaderboards, multiplayer, events,
app-store builds (Capacitor only if publishing ever matters).

---

## Not on any phase yet (candidates to add)

- ~~Hosting / shareable link~~ done: Cloudflare Workers, with a preview URL per PR (`wrangler.jsonc`).
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
6. ~~Add deploy to Phase 1~~ done (Cloudflare Workers).
