# Yeti, Set, Go!: roadmap review

Snapshot as of 2026-10-02 (main at `4942325`). Source of truth for the plan is
[`research.md`](research.md) §2 and §4; this file lays out what exists in code
versus what is still planned, so the plan can be adjusted.

Legend: ✅ done · 🟡 partial · ⬜ not started · ❓ decision needed

---

## Next up

Proposed order for the rest of Phase 1. Folds in adjustments 1, 2, 3 and 6
from the end of this file.

1. **Deploy** (GitHub Pages or Vercel). Static Vite build; Pages needs `base` in `vite.config.ts`.
2. **Real-phone test** on the deployed URL: iOS audio unlock, touch latency, orientation.
3. **Yeti player art** in `src/render/skierView.ts`, drawn in code. Sets the silhouette and hitbox that obstacles are designed around.
4. **Phase 0 gate sign-off:** a quick "is 60 s fun?" playtest before content piles on.
5. **Obstacles** via `src/sim/spawner.ts`: rock, then ice patch, then cabin (rideable roof is the hardest). Keep it pure sim so Vitest and the probe bots cover it.
6. **Music loop.**

Still open: coins (❓ Phase 1 or move to Phase 3 with the shop) and the tough
mount (❓ needed before Phase 2).

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

## Phase 1 — Minimum viable game 🟡 (in progress)

Goal: a run that can be *lost*, with a reason to play again. The "losable run"
half is done; the content half is not.

| Feature | Status | Notes / open questions |
|---|---|---|
| Avalanche with speed curve, visible when close | ✅ | In `src/sim/run.ts` + `src/render/avalancheView.ts`. Starts 350 px back at 500 px/s, +6 px/s², **rubber-banded** to never be more than 2400 px (60 m) behind. Camera keeps it in shot when close; HUD shows distance under 40 m. |
| Crash → tumble → recover or get caught → game over | ✅ | Recover after 1 s; caught ends the run. |
| Score, trick multiplier, local high score | ✅ | `src/sim/score.ts`. 1 pt/m + trick points (100 / 300 / 600 for 1 / 2 / 3 flips, +50 big air ≥1.1 s) × multiplier. Clean flips raise multiplier up to ×10; sloppy or crash resets it. Best score in `localStorage`. |
| Title / pause / game-over screens | ✅ | `src/ui/menu.ts`, DOM over canvas. Title over a demo run; pause via button, Esc, P, or tab blur; game over with stats + new-best badge. |
| SFX + music | 🟡 | `src/audio.ts`, all synthesised WebAudio, no files. Ski hiss + wind follow speed; jump, landing, trick chime (pitch rises with multiplier), crash, caught, avalanche rumble. M mutes (persisted). **No music loop yet.** |
| Touch, mouse, keyboard input; mobile browser | 🟡 | Tap/click/Space/↑/W all work. **Real-phone test not done** (risk #4, iOS audio unlock especially). |
| Obstacles: rock, cabin (rideable roof), ice patch | ⬜ | Planned `sim/spawner.ts` with per-chunk spawn tables. AABB/circle overlap only. Ice patch implies a friction override zone. |
| Coins in clusters + full-cluster speed bonus | ⬜ | Coins have no use until Phase 3 shop. ❓ Ship coins here or defer with the shop? |
| Yeti player art | ⬜ | Game renamed and player is now a yeti (decision in research §6), but `src/render/skierView.ts` still draws the human skier. |

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
| "Tough" mount that smashes obstacles | ❓ | Role left open by removing the yeti. Needs a new animal (or drop the role). |
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
- **Pooling for obstacles/coins** (only terrain is pooled today).
- **Crash ragdoll** via tween, `planck` only if worth it.
- **Reduced-motion setting.**

---

## Suggested adjustments to consider

1. **Do the real-phone test now.** Audio, menus and pause just landed; iOS is where they break.
2. **Draw the yeti** before adding obstacles, so new content is designed around the real character's silhouette and hitbox.
3. **Split the rest of Phase 1** into obstacles first (they change how runs feel), coins later.
4. **Move coins to Phase 3** alongside the shop, unless the cluster speed bonus is wanted for feel.
5. **Pick the tough-mount replacement** (or cut it) before starting Phase 2, since it shapes the stack rules.
6. **Add deploy to Phase 1** so the phone test and portfolio link come for free.
