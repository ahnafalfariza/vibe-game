# Levels 1–10 and in-run zones: spec

Status: Phase 4 step 1 built (2026-10-05); the rest is planned. Two features, built in order:

- **Phase 4: Levels.** Ranks become ten hand-made levels with a finale, then an endless Legend mode.
- **Phase 5: Zones.** Milestones inside a run: a marker every 500 m, a bonus, and difficulty that keeps rising past 1,500 m.

Numbers below are first guesses calibrated against `bun run probe` on every
biome (2026-10-05, after `avalancheAccel` went from 6 to 7.5):

| Biome | Mean survival | Metres | Coins | Score (before multiplier) |
|---|---|---|---|---|
| Sunny Slopes | 61 s | 1,466 | 52 | 2,981 |
| Twilight Pines | 70 s | 1,778 | 61 | 3,480 |
| Blossom Ridge | 64 s | 1,596 | 60 | 3,233 |
| Glacier Gorge | 72 s | 1,754 | 52 | 3,462 |
| Ember Peak | 66 s | 1,534 | 58 | 3,116 |

The best single bot run lasted 113 s (Glacier Gorge); most never reach 90 s.
Expect the balance pass to move these numbers.

The level rewards build on the three biomes from `efa620c` (Blossom Ridge,
Glacier Gorge and Ember Peak unlock at ranks 4, 6 and 8).

---

## Phase 4: Levels 1–10

### Why

Ranks already work like levels (three goals, finish all three, move up), but:

1. **Nothing to finish.** Ranks never end, so there's no "I beat it".
2. **Goals are random.** Rank 4 is three random tier-1 goals, not a designed step. Nothing teaches the game in order, and a newly unlocked biome is never asked for.
3. **Ranks 9 and up give nothing.** Even with the new biomes, rewards stop at rank 8.

### What changes

| | Today (ranks) | Levels |
|---|---|---|
| Name | Rank N | Level N (1–10), then Legend N |
| Goals | 3 drawn at random per rank | 3 fixed goals per level, from a table; random again in Legend |
| End | None | Finishing level 10 makes you a **Yeti Legend** (finale card) |
| Rewards | Perks or biomes at 2–8 | Something at every level, plus a coin bonus for each level-up |
| Score multiplier | 1 + 0.25·(N−1) | Unchanged (level 10 = ×3.25, Legend 1 = ×3.5, …) |
| When you move up | At the end of the run | Unchanged |

### The ten levels

Each level teaches one new thing (in **bold**) and repeats two older skills.
Mount goals only appear after an earlier level has made you ski past that
mount's first appearance (penguin 250 m, eagle 700 m, snowmobile 1,000 m,
bear 1,400 m). Each biome you unlock is used by a goal in the very next level.

| Lvl | Goals | Reaching the next level unlocks |
|---|---|---|
| 1 | Land 3 backflips in one run · Collect 25 coins in one run · Ski 600 m in one run | **2:** Penguin start |
| 2 | **Ride a penguin** · Land 2 clean backflips in one run · Grab 2 full coin clusters in one run | **3:** Twilight Pines |
| 3 | **Ski 1,000 m on Twilight Pines** · **Stay in the air 2 s in one jump** · Collect 100 coins in total | **4:** Blossom Ridge |
| 4 | **Get picked up by an eagle** · Reach a ×4 trick multiplier · Ski 1,000 m on Blossom Ridge | **5:** Safari season |
| 5 | **Ride a snowmobile** · Land a clean double backflip · Score 6,000 in one run | **6:** Glacier Gorge |
| 6 | **Let mounts take 2 hits for you** in one run · Ski 1,500 m on Glacier Gorge · Grab 5 full coin clusters in one run | **7:** Thick fur |
| 7 | **Ride a polar bear** · Hit 240 km/h · **Ski 800 m without a wipeout** | **8:** Ember Peak |
| 8 | **Smash 3 rocks or cabins with a polar bear** · Ride 3 different mounts in one run · Ski 1,200 m on Ember Peak | **9:** Second wind *(new)* |
| 9 | Land a clean triple backflip · Reach a ×8 trick multiplier · Ski 2,000 m in one run | **10:** Hot start *(new)* |
| 10 | **Finale:** Score 16,000 in one run · Outrun the avalanche for 90 s · Ski 1,200 m without a wipeout | **Yeti Legend:** Golden fur, Legend mode |

Goal ids, for reference: 1 `flips 3, coins 25, distance 600` · 2 `penguinRides 1, cleanFlips 2, clusters 2` ·
3 `twilightMetres 1000, air 2, totalCoins 100` · 4 `eagleRides 1, multiplier 4, blossomMetres 1000` ·
5 `sledRides 1, bigFlip 2, score 6000` · 6 `shields 2, glacierMetres 1500, clusters 5` ·
7 `bearRides 1, speed 240, noCrash 800` · 8 `smashes 3, variety 3, emberMetres 1200` ·
9 `bigFlip 3, multiplier 8, distance 2000` · 10 `score 16000, survive 90, noCrash 1200`.

Score goals count the displayed score, so they already include the level
multiplier: 6,000 at level 5 (×2) is ~3,000 base, about an average run;
16,000 at level 10 (×3.25) is ~4,900 base, roughly 1.5× the bot average.
That's deliberate for the finale, and Hot start (reaching level 10) helps with it.

The biome distance targets sit below each biome's bot average (Twilight
1,000 of 1,778 m, Blossom 1,000 of 1,596, Glacier 1,500 of 1,754, Ember 1,200
of 1,534) because a player meeting a biome for the first time is still
learning its terrain. "Ski 2,000 m" at level 9 is above every biome's
average: a long-run goal, easiest on Twilight Pines or Glacier Gorge.

### New goal kind: distance on a biome

Four new `GOALS` entries: `twilightMetres`, `blossomMetres`, `glacierMetres`
and `emberMetres` ("Ski N m on Twilight Pines in one run"). Each has
`family: 'distance'` and a `biome` id. `RunProgress` gains `biome`, and the
goal measures `metres` when the run's biome matches and 0 otherwise. Legend
draws can include them, since every biome is open by then.

### New rewards

Biomes now fill levels 4, 6 and 8, so only the top of the ladder needs new rewards.

| Reward | When | What it does | Cost to build |
|---|---|---|---|
| Second wind | reach 9 | Once per run, when the avalanche would catch you it's knocked back 30 m instead. Toast plus sound. | Small: a flag in `Run.stepAvalanche`, plus a new event |
| Hot start | reach 10 | The trick multiplier starts at ×2 and never drops below it (wipeouts and sloppy landings reset it to ×2) | Small: a floor in `Score` |
| Golden fur | Legend | The yeti turns gold: palette overrides for the yeti keys (fur, outline, beanie, scarf), applied after the biome's | Small: one palette, no picker |
| Level-up coins | every level | +50 × the new level (L2 = 100 … L10 = 500, 2,700 in total; 500 per Legend level) | One line in `RunGoals.finish` |

### Legend mode

After level 10 the number keeps counting (level 11 shows as **Legend 1**).
Legend levels draw random goals with today's `drawGoals` at the top tier, keep
adding +0.25 to the score multiplier, and pay the 500-coin bonus. This is the
current endless rank system, unchanged.

### Skipping a goal (pressure valve)

Fixed goals can get you stuck in a way random draws couldn't (a triple
backflip at level 9). Each unfinished goal on the Goals card gets a
**Skip · N coins** button, with N = 50 × level. A skipped goal counts as done.
This competes with the shop on purpose, and makes a cheap test for whether a
goal is too hard: if playtesters skip it, retune it.

### UI

- **Wording:** "Rank" becomes "Level" (or "Legend") everywhere: HUD, Goals tag, Goals card, game-over card, biome lock hints ("Reach level 3"), the landing page (the "Rank 3 gets you in" section and its perk list), and the README.
- **Level path:** a row of 10 pips on the Goals card. Done pips are filled, the current one is highlighted, and each shows its reward on hover or tap. This is the milestone view.
- **Level up:** the game-over card's "Rank up!" block becomes "Level N complete!", listing the unlock and the coin bonus.
- **Finale:** finishing level 10 swaps that block for a "Yeti Legend!" card (golden yeti, the Legend explanation).

### Data and code

- `src/sim/meta.ts`
  - `LEVELS: readonly (readonly [goalId: string, target: number])[][]`: the table above. Delete `FIRST_GOALS` (it's level 1).
  - `goalsFor(level, bestMetres, rng, avoid)`: level ≤ `LEVELS.length` builds the goals from the table, otherwise calls `drawGoals`. `RunGoals.finish` and `newProfile` use it.
  - Four biome-distance `GOALS`; `GoalDef.biome`; `RunProgress.biome`.
  - Rename `rank` to `level` throughout (`Profile.level`, `Perk.level`, `levelMultiplier`, `RunSummary.levelUp`). Bump `PROFILE_VERSION` to 2.
  - `Perk` gains `multiplierFloor?: number` and `secondWind?: true`; `runSetup` passes them on as `RunOptions`.
  - `skipGoal(p, goal)`: pay, mark done.
- `src/sim/score.ts`: a `floor` (default 1) used wherever the multiplier resets.
- `src/sim/run.ts`: the `secondWind` option, and a `{ type: 'secondWind' }` event.
- `src/render/palette.ts`: the Golden fur overrides.
- `src/ui/menu.ts`, `src/ui/hud.ts`, `src/scenes/PlayScene.ts`, `src/biomes.ts`: the wording, level path, skip buttons, finale card, second-wind toast, and the biome passed into `RunProgress`.
- `index.html`, `src/landing.ts`: the landing page's rank copy, and its perk list (it reads `PERKS`, so it follows the rename).

### Saved games

`normalizeProfile` reads `o.level ?? o.rank`, so a rank-6 player becomes level 6.
For levels 1–10 **the table is the source of truth**: on load, the stored
goals are replaced by that level's table goals, keeping `progress` and `done`
for any goal with the same id. Old random goals are swapped for designed ones,
and later edits to the table reach existing saves automatically. A player
above rank 10 lands in Legend and keeps their goals.

### Tests

- `tests/meta.test.ts`:
  - Table invariants: 10 levels, 3 goals each, every id exists in `GOALS`, no two goals of one family in a level, at most one "in total" goal per level.
  - Each mount goal sits after a level whose distance goal (biome or not) passes that mount's `MOUNT_TABLE.from`.
  - Each biome goal sits at or after the level that unlocks its biome.
  - Biome goals only count runs on their biome.
  - Migration: rank N becomes level N, and matching progress is kept.
  - Level-up coin bonus; Legend draws random goals; skip spends coins and marks the goal done.
- `tests/run.test.ts`: second wind saves you once, then the avalanche catches you.
- `tests/run.test.ts` or a new `score` test: a hot-start floor of 2 survives a crash.
- `scripts/smoke.mjs`: update the menu selectors and text that say "Rank".
- `scripts/probe.ts` (nice to have): for each level, which of its single-run goals the best bot met. A quick first read for the balance pass.

### Build order

Each step ships on its own.

1. Rename rank to level, add the level table, biome goals, migration and tests. UI wording only. *(This alone delivers "levels 1–10".)*
2. Level path, finale card, Legend label, level-up coins.
3. New perks: second wind and hot start.
4. Skip-a-goal.
5. Golden fur.

---

## Phase 5: Zones (milestones within a run)

### Why

A run has no landmarks. Distance is only a number on the HUD, and difficulty
stops rising at 1,500 m (`DIFFICULTY_RAMP`), so long runs flatten out.
Zones give each run a rhythm ("made it to zone 4!") and keep the climb going.

### What

- **Zone length 500 m.** Zone 1 is 0–500 m, zone 2 is 500–1,000 m, and so on. An average run (1,470–1,780 m, depending on the biome) ends in zone 3 or 4.
- **Crossing a boundary:** a gate on the slope (two flag poles and a banner reading "Zone 3 · 1,000 m"), a HUD toast, a chime, and a flat **+250 × zone** points bonus. The bonus isn't multiplied by the trick multiplier, but the level multiplier applies like it does to the rest of the score.
- **Difficulty past 1,500 m:** zones 1–3 keep today's ramp. From zone 4, `obstacleDensity` gets +10% per zone, capped at ×1.5 (zone 8). The avalanche already speeds up over time, so it's left alone.
- **Records:** "Reached zone N" on the game-over card; the best zone in the profile, shown on the title screen.

### Data and code

- `src/sim/run.ts`: `ZONE_METRES = 500`, `stats.zone`, a `{ type: 'zone', zone, x }` event when `distancePx` crosses a boundary, and the bonus added to the score.
- `src/sim/spawner.ts`: density scaled by the zone multiplier past zone 3. Check with `bun run probe` that fairness and survival still hold, in every biome.
- `src/render/zoneGateView.ts`: the gate, drawn in code like the obstacles and tinted by the biome palette. At most two on screen, so no pooling.
- HUD toast and chime: reuse the goal-complete toast and the trick chime at a new pitch.
- Profile: `bestZone`.

### Tests

- Run: crossing 500 m emits one zone event and adds the bonus; reversing (eagle, bounce) doesn't fire it twice.
- Spawner: the density scale is 1 up to zone 3, rises after that, and is capped.

### Later (out of scope for v1)

- Changing scenery by zone, e.g. the sky darkening toward dusk as you go. Today the biome palette is set before the scene's views are built, so changing it mid-run is real render work.
- "Reach zone N" goals for Legend draws. Today they'd duplicate the distance goals.

---

## Decisions

Decided 2026-10-05, going with the proposed defaults:

1. **Skip price:** 50 × level coins (~5 runs of coins at level 5).
2. **Legend multiplier:** keeps adding +0.25 per level, no cap.
3. **Level-up coins:** 50 × the new level (2,700 over levels 2–10, 500 per Legend level).
4. **Golden fur:** always on in Legend, no toggle.
5. **Zone length:** 500 m.
6. **Survive goal:** targets lowered to 40, 50, 60, 75 and 90 s for the faster avalanche (done in step 1).
