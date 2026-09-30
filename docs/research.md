# Ski Safari–style game: research & plan

Status: Phase 0 (feel prototype) built. See README.md.

## 1. What Ski Safari actually is

Ski Safari (Defiant Development, 2012; iOS/Android, later Yodo1-published) is a
2D side-scrolling **endless downhill runner**. Sven is woken when an avalanche
smashes his cabin, and the run lasts until the avalanche catches him. The whole
game is played with **one finger**.

### Core loop (verified from reviews and store copy)

| Mechanic | How it works |
|---|---|
| Controls | Tap = jump. Hold while airborne = rotate backwards (backflip). Release to stop rotating. |
| Landing | Land roughly parallel to the slope → speed boost + points. Land badly → crash/tumble, losing speed (and your mount if riding). |
| Avalanche | Chases from the left and speeds up over time. Staying ahead is the only fail condition. Players are told to build a big lead early. |
| Speed | Staying on the snow is faster than being in the air. Tricks, landed flips and full coin clusters give bursts of speed. |
| Obstacles | Rocks, ski cabins (vault the roof or smash through), ice patches, cliffs. |
| Coins | Placed in clusters. Grabbing a whole cluster gives a speed burst. Coins are spent in the shop. |
| Score | Distance plus tricks (flips, riding animals, coin clusters, hopping off rocks) × multiplier. A bad landing wipes a built-up multiplier. |
| Objectives / ranks | A few active objectives at a time (e.g. "ride 3 penguins", "collect 50 coins"). Progress carries across runs. Finishing a set ranks Sven up, which raises the base score multiplier and unlocks perks such as starting a run on an animal. |
| Shop ("Lodge") | Upgrades (penguins flip faster, eagles fly longer), cosmetics (costumes, scarves, snowmobile skins). |
| Slopes | Several themed maps unlocked over time (e.g. Eagle Bluffs; Crane Cliffs added in the 10th-anniversary update). |

### Rideables: the "Safari" part and the thing that sets it apart

| Ride | Behaviour |
|---|---|
| Penguin | Sven rides it like a snowboard. Glides further and flips faster. Lost on impact, so it works as a one-hit shield. |
| Yeti | Carries Sven. Tough: smashes through obstacles. When it takes a hit it belly-slides with Sven on its back instead of ending the run. |
| Eagle | Grabs Sven and flies high for a limited time. |
| Snowmobile | Very high top speed and **carries several animals at once** (yeti + penguin + eagle stacked). Flipping it with a big multiplier is the high-score play. |

Stacking plus using mounts as shields is where the game's depth comes from. The
jump-and-flip core is shared with Tiny Wings, Alto and Solipskier. Mounts are
what make this game different.

### Later additions: recommend skipping

- The 10th-anniversary edition (free-to-play) added daily login, a lucky spin,
  seasonal events and new character/snowmobile skins.
- Ski Safari 2 added biomes (Penguin Peaks, Jurassic Lark, Twister Canyon), new
  creatures (mammoth, pterodactyl, baby ankylosaurus), a boost that works as a
  battering ram, and multiplayer powerups. It was widely criticised for
  paywalled maps and heavy ads.
- Ski Safari: Adventure Time is licensed IP. Avoid it entirely.

### Lessons from the original's development

- Defiant said the hardest technical problem was **keeping the game hitch-free
  while generating meshes and objects on the fly** down an endless slope. They
  used **custom terrain physics built for high speed** and **object pooling**.
  Both points feed straight into the tech choices below.
- Commercially, it made roughly $69/day in its first year and later reached
  100M+ downloads through localisation. Distribution mattered as much as the
  game did.

## 2. Feature scope, in phases (each ends with a go/no-go check)

The feature list is long, but the game lives or dies on how the core movement
feels. Build the smallest version that tests the feel before adding anything
else.

### Phase 0: Feel prototype (gate: "is 60 seconds of just this fun?")
- Seeded, endless procedural slope with chunked streaming
- Skier kinematics: grounded slope-following, ballistic air, jump, hold-to-flip
- Landing judgement (good / sloppy / crash) plus a speed reward for flips
- Camera that follows and zooms out with height and speed
- Instant restart
- Debug overlay: speed, angle, slope angle, FPS, seed

### Phase 1: Minimum viable game
- Avalanche with a speed curve, visible when close (tension)
- Crash → tumble → recover or get caught → game over
- Obstacles: rock, cabin (roof is rideable), ice patch
- Coins in clusters with a cluster bonus
- Score, multiplier from tricks, local high score
- Title / game-over screens, SFX and one music loop
- Touch, mouse and keyboard (Space) input; works in a mobile browser

### Phase 2: The Safari
- Mount system as a state machine plus a **stack** (snowmobile carries others)
- Penguin → Yeti → Eagle → Snowmobile, in that order (rising complexity)
- Mount-as-shield rules

### Phase 3: Meta progression
- Objectives (3 active, persistent) and ranks → base multiplier
- Coin shop: a handful of upgrades that change gameplay, not cosmetics first
- A second biome (palette + obstacle set + spawn table)

### Out of scope unless there is a specific reason
Daily login, lucky spin, ads/IAP, online leaderboards, multiplayer, events.

## 3. Tech selection

### Recommendation

| Layer | Choice | Why |
|---|---|---|
| Language / build | **TypeScript + Vite** | Instant dev server, static build, plays anywhere with a URL. |
| Framework | **Phaser 4** (4.2.1 on npm as of this writing) | Includes scenes, input, WebAudio, tweens, particles, camera, loader and scaling. With PixiJS v8 we would rebuild all of that ourselves. |
| Player / terrain physics | **Custom, no rigid-body engine** | See below. This is the most important decision. |
| Obstacle collision | Simple AABB / circle overlap against the player | That is all the game needs. |
| Crash ragdoll (optional, later) | Tween/animation first. `planck` (Box2D port) only if it is worth it | Keep the physics engine out of the core loop. |
| Tests | **Vitest** for terrain/physics/scoring math; **Playwright** for smoke tests and screenshots (Chromium is preinstalled here) | A seeded, deterministic simulation lets gameplay logic be unit-tested. |
| Hosting | Static site (Vercel or GitHub Pages) | Share a link, play on phone. |
| App stores (later, optional) | Capacitor wrapper | Only if publishing matters. |

### Why custom physics instead of Matter.js / Planck / Rapier

The obvious choice is to put the skier and terrain into a physics engine. For
this game that is the wrong call:

1. **Speed.** The player moves very fast. Matter.js has **no continuous
   collision detection** (a long-open issue, and no release since 0.20.0 in
   2024), so fast bodies tunnel through thin terrain.
2. **Seams.** A skier sliding across a chain of polygon edges catches on the
   joints ("ghost collisions"). Engines have fixes (Box2D chain shapes), but
   it becomes a constant fight.
3. **Feel is authored, not simulated.** Air control, landing tolerance, boost
   on landing and slope stickiness are design parameters. In a rigid-body
   engine each one is a hack layered on top of the solver.
4. **The model is small.** The terrain is a function `y = h(x)`. On the ground,
   the skier moves along the tangent with `a = g·sinθ − friction − drag`. In the
   air it is a projectile with player-controlled rotation. Landing compares the
   body angle to the slope normal. That is about 200 lines, deterministic, and
   testable. The original shipped custom terrain physics for the same reasons.

### Alternatives considered

| Option | Verdict |
|---|---|
| PixiJS v8 + own systems | Lighter and faster at raw rendering, but rendering is not our bottleneck. We would hand-write audio, input, scenes and a camera. Good second choice. |
| Plain Canvas 2D, no framework | Feasible. Rejected for the same reason as Pixi, with more work. |
| Godot 4 | A strong 2D engine and the right pick if **native** mobile/desktop is the goal. Its web export is heavy, and the workflow is editor-centric, which is harder for an AI-driven, text-only workflow to iterate on and test headlessly. |
| Unity | What the original used. Overkill and editor-bound, and web builds are heavy. No. |
| Phaser Arcade / Matter physics for the player | No, for the reasons above. |

## 4. Architecture sketch

```
src/
  main.ts                 Phaser config, scale mode, scenes
  scenes/                 Boot, Title, Play, GameOver
  sim/                    Pure TS, no Phaser imports → unit-testable
    rng.ts                Seeded PRNG
    terrain.ts            Segment templates + stitching, h(x), slope(x)
    spawner.ts            Per-chunk obstacles/coins/animals from spawn tables
    skier.ts              Grounded/air/crash state machine, fixed timestep
    avalanche.ts          Position + speed curve
    mounts.ts             Mount stack + per-mount modifiers
    scoring.ts            Points, multiplier, trick detection
  render/                 Phaser-side views of sim state (terrain mesh, sprites)
  tuning.ts               Every feel constant in one place
```

Key design decisions:
- **Split simulation from rendering.** `sim/` runs at a fixed 60 or 120 Hz step
  and knows nothing about Phaser. Rendering interpolates between steps. This
  makes the game deterministic per seed, which makes it debuggable and testable.
- **Terrain from templates, not raw noise.** Pure sine/noise terrain tends to be
  boring or produce unfair jumps. Use a weighted library of parameterised
  segments (rollers, kicker ramp, cliff drop, long flat with cabin, big
  booter). Stitch them with cubic Hermite curves so the slope is C1-continuous
  (no kinks), keep a guaranteed downhill trend, and add low-amplitude noise for
  texture. Difficulty then comes from choosing templates, not tuning noise.
- **Pool everything** that streams in: terrain chunk meshes, obstacles, coins.
- **One tuning file.** All feel numbers in one place: gravity, slope accel, air
  drag, flip speed, landing tolerance, boost, avalanche curve, mount
  multipliers.

## 5. Risks and blind spots

1. **Feel is most of the work.** The feature list makes the game look like a
   content problem. It is a tuning problem. Plan to spend most of the early
   time on Phase 0.
2. **Art is the hidden cost.** Placeholder rectangles make a good game feel bad.
   Choose an art direction early. Flat vector shapes drawn in code can look
   intentional and cost nothing.
3. **Legal.** Mechanics are not protected. The **name "Ski Safari", "Sven", the
   art, music and characters are.** Use an original name and original assets.
4. **Mobile web quirks.** iOS audio unlock, fullscreen and orientation locking,
   touch latency. Test on a real phone in Phase 1, not at the end.
5. **Scope creep.** Enforce the phase gates. Nothing from Phase 2 goes in while
   Phase 0 feels floaty.

## 6. Decisions (2026-09-30)

| Question | Decision |
|---|---|
| Platform | Web first (desktop + mobile browser) |
| Goal | Learning to make fun games + portfolio. Not commercial, not published to stores. |
| Name | **Selancar Ahay** |
| Art | See §7. Start with shapes drawn in code; bring in AI-generated characters only once the style is locked. |

## 7. Art direction and where the sprites come from

**Style:** flat, clean, cute vector: soft blues for the world, warm colours
(orange jacket, yellow beanie, pink scarf) for anything the player must track.
All colours live in `src/render/palette.ts`.

**What needs art, and what doesn't:**
- The slope, sky, mountains, trees and snow *must* be drawn in code anyway,
  because the terrain is procedural. This is most of the screen and it is
  already done.
- Only the characters and props need to be designed: the skier, penguin,
  yeti, eagle, snowmobile, rocks and cabins. That is roughly 10–15 assets.
- **Don't animate frame by frame.** Use one rigid pose per character (or a
  few parts) and animate in code: rotation, squash-and-stretch, a fluttering
  scarf. AI tools are still bad at consistent animation frames. The flip
  mechanic already rotates the whole body, which is exactly what Ski Safari
  does.

**Options, ranked for this project:**
1. **Shapes drawn in code** (the current skier). Free, crisp at any zoom, one
   palette, no licence questions. It hits its limit on characters that need
   charm, like the yeti's face.
2. **Recraft**, for characters. It generates real **SVG vector** art with a
   reusable *style ID* (upload 1–5 reference images), which is the answer to
   the "every AI image looks different" problem. It has an official hosted MCP
   server: `claude mcp add --transport http recraft https://mcp.recraft.ai/mcp`
   (sign in through the browser, no API key).
   - **Licence:** on the free plan, Recraft owns the images and makes them
     public. One paid month (~$12) gives you the rights to what you make that
     month.
   - **This cloud environment:** the connector must be added in claude.ai
     settings, and `img.recraft.ai` must be allowed in the environment's
     network settings, or the downloads fail.
3. **OpenAI gpt-image** (through a community MCP): transparent PNGs, and you own
   the output. It is raster only and has no saved style, so consistency is
   harder than with Recraft.
4. **Kenney.nl CC0 packs** (Animal Pack has a penguin; Background Elements;
   Platformer Art Winter). Free and legally clean, but there is no yeti, skier
   or snowmobile, and mixing in art from other sources will clash.
5. Not a fit: PixelLab and Retro Diffusion (pixel art only), Scenario (overkill
   for about 10 sprites).

**Keeping AI art consistent:**
- Fix the palette and outline rules in every prompt.
- Reuse one style ID.
- Generate related sprites together on one sheet.
- Remove backgrounds and normalise sizes afterwards.

(Research from search summaries, September 2026. Recheck prices and terms
before paying.)

## Sources

- [Unity case study: Ski Safari by Defiant Development](https://unity3d.com/showcase/case-stories/defiant_development-skisafari)
- [Game Developer: Ski Safari post-mortem](https://www.gamedeveloper.com/business/ski-safari-post-mortem-how-an-australian-mobile-game-became-a-chinese-hit)
- [TouchArcade review](https://toucharcade.com/2012/05/03/ski-safari-review-an-endless-runner-with-style/)
- [TouchArcade: "The only game you can backflip on a yeti"](https://toucharcade.com/2013/08/31/ta-plays-rewind-ski-safari-the-only-game-you-can-backflip-on-a-yeti/)
- [Pocket Gamer review](https://www.pocketgamer.com/ski-safari/ski-safari-review/)
- [Game Usagi review](https://gameusagi.com/2012/05/point-review-ski-safari-ios/)
- [WriterParty guide](https://writerparty.com/party/guide-to-ski-safari-for-ios-and-android-tips-tricks-hints-cheats-and-strategies/)
- [GameSkinny: Ski Safari 2 beginner guide](https://www.gameskinny.com/tips/ski-safari-2-guide-for-beginners-on-the-slopes/)
- [Google Play: Ski Safari 10th Anniversary](https://play.google.com/store/apps/details?id=com.yodo1.skisafarigp)
- [App Store: Ski Safari](https://apps.apple.com/us/app/ski-safari/id503092422)
- [matter-js issue #5: no CCD / tunneling](https://github.com/liabru/matter-js/issues/5)
- [Rapier: CCD docs](https://rapier.rs/docs/user_guides/javascript/rigid_body_ccd/)
- [Phaser vs PixiJS (2026)](https://generalistprogrammer.com/comparisons/phaser-vs-pixijs)
- [Emanuele Feronato: Tiny Wings terrain with Box2D](https://emanueleferonato.com/2011/07/14/create-a-terrain-like-the-one-in-tiny-wings-with-flash-and-box2d/)
- [Recraft hosted MCP server](https://www.recraft.ai/docs/mcp-reference/remote-server)
- [Recraft styles API](https://www.recraft.ai/docs/api-reference/styles)
- [Recraft image ownership](https://www.recraft.ai/docs/trust-and-security/ownership)
- [Kenney Animal Pack (CC0)](https://kenney.nl/assets/animal-pack)
- [Why AI can't make game-ready spritesheets (Gamelabs)](https://gamelabstudio.co/blog/why-ai-cant-make-game-ready-spritesheets)
