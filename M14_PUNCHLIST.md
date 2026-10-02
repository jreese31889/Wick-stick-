# M14_PUNCHLIST.md — Android Optimization Punch List

**QA/Audit agent · October 2, 2026 · targets extracted from the CURRENT `src/` code**
Companion docs: `GAME_AUDIT.md` (feature status), `M15_QA_CHECKLIST.md` §K (perf baseline tests), plan of record: `OPTIMIZATION_QA_PLAN.md`.

**How to use this list**
- Items are ordered **P0 (cheap dead-weight) → P1 (render pipeline) → P2 (allocations) → P3 (pooling) → P4 (physics/AI) → P5 (resolution/settings) → P6 (instrumentation)**. Each is independently landable; do P6-01 first so every later item is measurable.
- Every item: **where** (file + symbol, line = snapshot), **do**, **gain**, **verify**.
- ⚠️ **Ownership:** `Renderer.ts`, `AnimationController.ts`, `StickRig.ts`, `Ragdoll.ts`, `GameCanvas.tsx`, `index.css` = WS1 (visual agent, active now). `EnemyController.ts`/`EnemyRig.ts` pose sections are also hot. Coordinate before editing those; prefer items marked ⬜ uncontested.
- **Gate for every item:** `npm run lint` (tsc) + §K-01 FPS baseline comparison + `M15_QA_CHECKLIST` L-block (no regressions). No builds during the visual pass.

---

## P0 — Dead weight (delete/skip, near-zero risk)

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P0-01** ⬜ | Dead rain simulation — `EnvironmentManager.update` (`EnvironmentManager.ts:452-461`) simulates 90 `rainDrops` that **nothing renders** (renderer draws its own procedural rain at `Renderer.renderBackground` `RN:437-453`) | Delete `rainDrops` array (`EM:115`), `initRain` (`EM:122-132`), and the update block — or render them instead of the procedural copy (decide with WS1) | 90 particle updates/frame in RAINY_ALLEY for $0 | RAINY_ALLEY looks unchanged; FPS ≥ baseline |
| **P0-02** ⬜ | `Hitbox.soundType` never read (`types/game.ts:186`, written at `EC:617-778`) | Remove field + writes, or wire it into `CombatDirector.checkPlayerAttacks` local `soundType` (`CD:650/916`) so enemy hitbox sound variety actually plays | Minor clarity + real SFX variety if wired | `tsc`; hit sounds still correct |
| **P0-03** ⬜ | `Ragdoll.drainImpacts` dead (`Ragdoll.ts:191`, queue capped `MAX_IMPACTS=6`) | Either call it from `GameLoop` ragdoll step (`GameLoop.ts:502-509`) to fire impact FX/SFX on floor/wall contact, or delete it | New impact feel for ~free; removes dead code | Ragdoll landing makes a thud; no perf change |
| **P0-04** ⬜ | Write-only fields: `EnemyController.aiTimer` (`EC:61/401`), `PlayerController.comboMeter` (see bug #1 — needs WS2 fix, not just cleanup) | Remove `aiTimer`; schedule `comboMeter` sync (design: charge per landed hit) as a **feature fix** tracked in audit §8-1 | CPU trivial; unblocks specials | `tsc`; specials become reachable (QA B-09) |
| **P0-05** ⬜ | Unused types `HazardZone`/`HazardPhase`/`SpawnOrder` (`types/game.ts:361-393`) | Keep only if WS2 hazards are imminent; otherwise drop | Zero-cost (types erase) | `tsc` |

## P6 — Instrumentation (do first)

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P6-01** ⬜ | Frame-time breakdown — only a 0.5 s FPS average exists (`GameLoop.loop` `GL:252-260`) | Add `performance.now()` deltas around `player.update`+`enemy.update`+`combatDirector.update` vs `renderer.render`, expose avg update-ms/render-ms next to the FPS chip (behind `settings.showFps`) | Makes every item below provable; finds the true bottleneck | Chip shows 2 numbers; ~0 overhead |
| **P6-02** ⬜ | Counters: active particles, pool hits/misses, ragdoll count, enemy pose cost | One stats object read by the debug toggle (`PauseMenu` rig debug `App.tsx`) | Exposes cap saturation & allocation churn | Numbers move as expected under stress (K-03) |
| **P6-03** ⬜ | Optional `performance.mark` per wave (spawn → clear) | 2 marks per wave | Tracks progression perf | Chrome timeline |

## P1 — Render pipeline (biggest CPU/GPU lever)

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P1-01** ⚠️WS1 | **Background/floor not pre-rendered** — `Renderer.renderBackground` (`RN:382-455`) rebuilds gradient + ~13 parallax pillars + wall trim + ~6 sconce radial gradients + rain every frame; `renderFloor` (`RN:533-569`) rebuilds gradient + tile strokes every frame | Bake static parts (trim, pillars at base scale, floor tiles, arena pillars `RN:456-521`, door frame) into an **offscreen canvas per room theme** on `initRoom`/resize; blit each frame, keep only parallax offsets live. Re-bake when `EnvironmentManager.initRoom`/`setupRoomForWave` runs | Removes ~8-10 gradient constructions + ~40 fills per frame — top candidate for mobile fill-rate | `M15` K-01: FPS ≥ baseline, pixel-diff arena looks identical; re-bake verified by G-03 arena rotation |
| **P1-02** ⚠️WS1 | Per-frame gradient creation | Cache `createLinearGradient` at `RN:398` (bg), `RN:480` (sky), `RN:540` (floor), `RN:1198/1205` (door) and radial gradients at `RN:428` (sconces ×6), `RN:521` (boundary ×2), `RN:723` (muzzle ≤8), `RN:1060` (health glow), `RN:1376` (weapon glow) keyed by position/size; reuse `vignetteGradient` pattern already proven at `RN:90-92/1083-1098` | Kills ~15-20 gradient objects/frame | P6-01 render-ms drops |
| **P1-03** ⬜ | Missing cull: `renderDestructibles` (`RN:1246`) and `renderExitDoor` (`RN:1180`) ignore the `inView` gate (`RN:373`, `CULL_PADDING=240` `RN:47`) that every other family already uses | Add `inView(...)` early-continue | Free; correctness-neutral | Items disappear only off-view |
| **P1-04** ⬜ | Per-item `save/restore` batching | Group transforms for: casings `RN:684-696`, glass shards `RN:1345`, dropped weapons `RN:1371`, coins `RN:1430`, projectiles `RN:1462`, health packs `RN:1056`, figure shadows `RN:577` — same single-`save` pattern already used for particles `RN:591` / sparks `RN:622` / enemy bullets `RN:741` | Fewer state flips; 35 `ctx.save()` sites → ~15 | Visual identical, render-ms ↓ |
| **P1-05** ⬜ | Per-frame string/array garbage in draw path: `renderSpeedLines` `fade.toFixed(3)` ×18 (`RN:1038`), `` `${count}x COMBO` `` + `multiplier.toFixed(2)` (`RN:956-962`), `` `${w}x${h}` `` vignette key (`RN:1086`), `setLineDash([6,4])`/`([10,8])` fresh arrays (`RN:851/899`), `enemies.find` closure in `renderBossHUD` (`RN:1110`) | Pre-allocate dash arrays as module constants; update HUD strings only when values change (dirty flag); hoist boss lookup out of render (GameLoop already knows if a boss exists) | Removes steady-state GC pressure | P6-02 allocation counter ↓ |
| **P1-06** ⚠️WS1 | `shadowBlur` per frame: `renderAimLaser` (`RN:849-850`), `renderBossHUD` (`RN:1126-1127`) | Replace with layered stroke (as blade glow already does, `RN:810-811`) or gate behind `quality==='high'` | GPU blur is expensive on mid-range | Visual check at all 3 quality tiers |
| **P1-07** ⬜ | Overdraw: full `clearRect` + full-screen vignette fill + full bg repaint every frame (`RN:250/1101`) | Acceptable if P1-01 lands (bg becomes blit); additionally skip vignette repaint when gradient cached (it is) — just confirm it's a single fillRect | Fill-rate | K-01 on device |

## P2 — Per-frame allocations (GC churn)

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P2-01** ⚠️WS1-🔥 | **Pose generation is the top allocator:** player `AnimationController.generatePose` → `buildPose` (`AC:100/155`) + `translatePose` (`AC:133`) + `mixPose` (`AC:126`) ≈ 42–63 objects/frame; each enemy repeats via `EnemyController.updatePose` → `buildEnemyPose` (`EC:1094/1124`) ≈ 42 objects/enemy/frame | Convert to **in-place buffers**: single reusable `StickFigurePose` per actor, joints written in place (pattern already exists: `Renderer.copyPoseInto` `RN:61`, `afterimagePosePool` `RN:81`). Mix/cross-fade writes into a scratch pose | ~170+ allocations/frame at 3 enemies → ~0; likely biggest GC win | Pose visuals identical (animation agent must sign off — coordinate!), FPS ↑, P6-02 ↓ |
| **P2-02** ⬜ | `InputManager.poll` allocates a fresh 24-field `InputState` + new `prevGamepadButtons` array **every frame** (`IM:421`, `IM:475`) | Reuse one mutable input object + fixed-size prev-button array; only `JustPressed` edges recomputed | 24+ fields/frame → 0 | All input QA (M15 §A) passes |
| **P2-03** ⬜ | Per-frame closures from `some/every/find`: `GameLoop.ts:338` (door check), `GL:412-414` (attack token), `CombatDirector.ts:372` (wave-clear), `Renderer.ts:1110` (boss find) | Replace with `for` loops (token loop already is a loop — just these 4) | 4 closures + 4 scans/frame | Behavior identical |
| **P2-04** ⚠️WS1 | Render-path point literals: `EnemyRig.renderTorso` (`EnemyRig.ts:204-209/238`), `StickRig.renderTorsoAndSuit` (`StickRig.ts:365-370/400`) — 7 objects ×2 passes/enemy/frame | Reuse module-level scratch points | ~56 objects/frame at 3 enemies | Visual identical (WS1 owns these files) |

## P3 — Pooling & caps (currently missing families)

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P3-01** 🔥 | **Enemy bullets unpooled + UNCAPPED**: allocated as literals in `EnemyController.fireBullet` (`EC:1040`), spliced in `CombatDirector.updateEnemyBullets` (`CD:1128-1138`), only cull is life/|x|>900 | Add `enemyBulletPool` (`ObjectPool` pattern, `ObjectPool.ts:14`) + `MAX_ENEMY_BULLETS = 64` with `trimOldest` (`CD:14`) like `MAX_TRACERS` (`CD:124`) | Removes GC churn during GUNNER/SNIPER spam; caps worst case | K-03 with snipers; bullets never exceed cap |
| **P3-02** 🔥 | **Ragdolls never pooled**: `new Ragdoll` at `EC:987`, `CD:871`, `GL:460` — each allocates 16 points + 28 constraints (~45 objects), never recycled; `enemy.ragdoll` kept after death | Pool `Ragdoll` instances (reset state in a `recycle(pose, vx, vy)`), release on `dead` (`Ragdoll.ts:204`) after fade; also drop `enemy.ragdoll` ref when corpse replaced (`GameLoop.spawnSquad` `GL:78-124`) | ~45 objects per death + retained corpses freed early | Kill 20 enemies, memory flat |
| **P3-03** ⬜ | Health packs & dropped weapons unpooled/uncapped: `EnvironmentManager.dropHealthPack` (`EM:402`), `dropWeapon` (`EM:372`), splices `EM:518/580/596` | Pool both (`healthPackPool`, `weaponPool`), add small caps (8 / 12) | Bounded worst case in loot-heavy runs | E-06 QA passes |
| **P3-04** ⬜ | `spawnDust` overflow uses `this.particles.shift()` (`RN:136`) — O(n) per spawn while saturated at 220 | Ring-buffer index (oldest pointer) instead of `shift()` | O(n)→O(1) at cap | K-03 dust saturation |
| **P3-05** ⬜ | `splice(i,1)` removals in reverse loops: `Renderer.ts:163/176`, `CombatDirector.ts:1567-1663`, `EnvironmentManager.ts:482/518/557/580/596/609` | Swap-pop (`arr[i]=arr[len-1]; arr.pop()`) — order doesn't matter for particles | Cheaper at cap sizes (≤320) | Visual order may change for decals — acceptable? confirm with WS1 |
| **P3-06** ✅done | Pools already in place (do not re-do): dust `RN:77`, afterimage poses `RN:81`, sparks/popups/blood/casings/shockwaves/tracers/bladeArcs `CD:48-78`, shards/coins/knives `EM:98-112`; caps all present (`CD:120-126`, `RN:36-41`, `EM:92-94`) | — | — | — |

## P4 — Physics & AI throttling

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P4-01** ⚠️WS1 | **TieRope never sleeps**: 3 ropes (7+4+4 = 15 segments) × 3 relaxation iterations = 45 solves + 18 integrations **every frame** even idle (`TieRope.update` `TR:53-169`, iterations `TR:141-168`); ground clamp runs inside all 3 iterations (`TR:164-167`) | (a) Move ground clamp out of the iteration loop; (b) drop to 1-2 iterations when `flutter≈0` and player speed ≈0 (mirror ragdoll's sleep divider pattern `Ragdoll.ts:229-230`); full rate on dash/jump/hit | ~50 % rope CPU while idle; ropes are on the player 100 % of runtime | Tie still settles naturally (visual — get WS1 sign-off); FPS ↑ on menu-adjacent/idle frames |
| **P4-02** ⚠️WS1 | Ragdoll sleep still pays a 16-point speed scan every frame for the full 7 s life (`Ragdoll.update` `RG:209-232`, early-out `RG:224-232`) | Run the max-speed scan every 4th frame while `asleep` (same cadence as its reduced solve `RG:229-230`) | Cuts idle-ragdoll cost ~75 % | Corpses don't jitter; settle/fade timing unchanged |
| **P4-03** ⬜ | **Off-screen enemies still pay full pose + AI**: `Renderer` notes pose work runs in sim for culled enemies (`RN:309-314`); `updatePose` ≈42 allocs + `updateAI` + physics run regardless | Extend the existing AI throttle pattern (`AI_THROTTLE_DISTANCE=480`, `AI_THROTTLE_INTERVAL=1/20` `EC:28/30/365-384`) to pose generation: outside `CULL_PADDING` (`RN:47`), rebuild pose at 10 Hz, interpolate or hold | Scales enemy count; pairs with P2-01 | Off-screen enemy re-enters view without pose snap (QA F-12) |
| **P4-04** ✅done | AI decision throttling + single attack token already implemented (`EC:365-384`, `GL:410-431`) — plan item 6 of `OPTIMIZATION_QA_PLAN.md` is **done**, don't rebuild | — | — | — |
| **P4-05** ⬜ | All-pairs micro-loops: `CombatDirector.updateThrownEnemies` (thrown × enemies, `CD:1366-1415`), `EnvironmentManager.checkProjectilesAgainstEnemies` (`EM:640-658`, `Math.hypot` per pair) | Keep — bounded by ≤4 enemies / ≤32 knives; only add a distance pre-check if profiling (P6-01) shows it | Low priority | — |

## P5 — Resolution & quality settings (plan items 1 & 7)

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P5-01** 🔥 | **Quality tiers are CSS-only**: `applyQuality` sets `data-quality` consumed by `index.css:78-108`; canvas is untouched — `GameCanvas.updateSize` hard-caps DPR at 2 regardless (`GameCanvas.ts:19-26`) | Wire quality → canvas: `low` = DPR cap 1.0 + render scale 0.75, `medium` = DPR 1.5, `high` = DPR 2. Implement render scale in `GameCanvas.updateSize` (backing store = CSS × dpr × scale, context scaled) | **Single largest lever on fill-bound mobile GPUs** — plan item 7 "Resolution Scaling" | K-02: measurable FPS delta per tier; text/UI stays DOM-sharp (HUD is React, unaffected) |
| **P5-02** 🔥 | Quality → FX budgets | Scale caps by tier: dust 220/140/80, afterimages 14/8/4, sparks 320/180/100, rain streaks (`RN:445`) 75/50/25, muzzle blooms, blood 160/100/60. Caps live as `static readonly` (`CD:120-126`, `RN:36-41`) — make them instance fields set from `settings.quality` | Bounded FX cost on `low` | K-03 per tier; caps visible in P6-02 |
| **P5-03** ⬜ | DPR-normalized framing: `GameLoop` passes backing-store px (`canvas.width/height`) to `renderer.render` (`GL:264/281/300/512`) while `Camera.BASE_ZOOM` (`Camera.ts:14`) is DPR-independent → world extent/character size differs at DPR 1 vs 2 | Pass CSS px + let renderer scale, or divide view size by dpr | Consistent framing across devices | ⚠️ **Character-size related — coordinate with animation/camera agent before touching** (their file, active now) |
| **P5-04** ⬜ | No quality preset in `Settings` for particle/blur/etc. beyond the 3 tiers | Covered by P5-02; also add "Render Scale" explicit option (0.6/0.75/1.0) in `OptionsModal` → `GameSettings` (`settings.ts:13-20`) | User control on weak devices | Persist across reload (I-03) |
| **P5-05** ⚠️WS1 | Full-screen repaint architecture (clear + bg + vignette every frame) | Acceptable after P1-01; document as residual | — | — |

## P6B — Loop structure (cheap, medium gain)

| ID | Target | Do | Gain | Verify |
|---|---|---|---|---|
| **P6B-01** ⬜ | `renderer.render(...)` duplicated 4× in `GameLoop.loop` branches (paused `GL:264`, game-over `GL:281`, hit-stop `GL:300`, normal `GL:512`) | Hoist to one call site with flags | DRY; enables conditional render | All 4 states render correctly (M15 H-02, L-05) |
| **P6B-02** ⬜ | Paused/game-over frames run the **full** render pipeline every rAF (`GL:263-294`) behind opaque React overlays | Skip render when overlay fully covers canvas (or throttle paused render to 10 Hz) | Big CPU save while paused/idle menus | K-05: paused CPU ↓; resume repaints cleanly |
| **P6B-03** ⬜ | No visibility handling: rAF keeps firing in background tabs on some engines | Add `document.visibilitychange` → pause sim (`setPaused` already safe, `GL:62`) | Battery/heat (K-07) | Tab switch → pause; return → resume or prompt |
| **P6B-04** ✅done | dt clamped 50 ms (`GL:250`), pause resets `lastTime` (`GL:56/66`), opaque canvas context (`GL:242`), FPS counter 0.5 s windows (`GL:252-260`) — already good | — | — | — |
| **P6B-05** ⬜ | React re-render on every FPS tick (`onStateChange` `GL:259` → App state) | Push fps to a ref + direct DOM text update, or only push on integer change / when chip visible | Cuts React churn during play | Chip still updates |

---

## Suggested execution order (one optimization run)

1. **P6-01/P6-02** instrumentation (measure).
2. **P0-01…P0-05** dead weight (~30 min, zero risk).
3. **P1-03, P1-04, P1-05, P6B-01…03** cheap render/loop wins.
4. **P3-01, P3-02, P3-03, P3-04** pooling gaps (bullet spam + corpses = GC spikes).
5. **P5-01, P5-02** quality→canvas wiring (biggest device FPS win; touches GameCanvas/settings — uncontested by visual agent).
6. **P1-01/P1-02** background baking ⚠️WS1 — coordinate; largest render win.
7. **P2-01/P2-04** in-place poses ⚠️WS1 — coordinate; largest allocation win.
8. **P4-01…P4-03** rope/ragdoll/off-screen throttling ⚠️WS1.

## Done already (do not redo) — evidence for `OPTIMIZATION_QA_PLAN.md` items
| Plan item | Status | Evidence |
|---|---|---|
| Object pooling (plan #3) | ✅ Mostly done | `ObjectPool.ts` + 12 pools; gaps = P3-01/02/03 |
| Particle caps (plan #4) | ✅ Done | `CD:120-126`, `RN:36-41`, `EM:92-94` — overflow recycles oldest |
| AI throttling (plan #6) | ✅ Done | `EC:28/30/365-384`; gap only for pose gen (P4-03) |
| Frustum culling (plan #1) | ✅ Mostly done | `inView` `RN:373` across 15 families; gap = P1-03 |
| Ragdoll sleep (plan #5) | ✅ Done | `RG:224-233` (refine = P4-02); TieRope sleep missing = P4-01 |
| Render-loop profile (plan #1) | ⬜ | = P6-01 |
| Draw-call/batching reduction (plan #2) | 🟡 Partial | Batched families exist (`RN:591/622/741`); gap = P1-04 |
| Resolution scaling (plan #7) | ⬜ | = P5-01 |
| Memory/asset (plan #8) | 🟡 Partial | Backdrops cached (`RN:107/113`), samples eager-load; gaps = P3-02, P6B-03 |

**Expected outcome if P0–P5 executed:** sustained 60 FPS on mid-range Android in 4-enemy + heavy-FX scenes, flat memory over long runs, and a measurable FPS spread between quality tiers (the current tier setting does nothing for the canvas).
