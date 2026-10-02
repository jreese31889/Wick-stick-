# M15_QA_CHECKLIST.md — John Stick QA Test Checklist

**QA/Audit agent · October 2, 2026 · mapped to the code as it exists today**

Every item is concrete, checkable, and tied to a real feature (with the implementing symbol in backticks for bug triage). Run in order within a section; tick ✅ / ❌ and file a bug note with repro steps for any ❌.

**Test setup**
- Dev: `npm run dev` (serves web build via `server.ts`); type gate: `npm run lint` (= `tsc --noEmit`).
- Targets: desktop Chrome (keyboard+gamepad), Android phone landscape (touch), plus a mid-range device for perf sections.
- Turn on **FPS chip** (Options → FPS Counter) before perf testing. Recommended: Options → Graphics = Performance for K-block, Balanced/Cinematic for A/B compare.
- Visual/animation pass is landing concurrently — re-pull latest `src/` before a session; **animation/character-size/visibility observations go to the animation agent, not as blockers here.**

Item IDs: **A** movement · **B** combos · **C** gun-fu moves · **D** defense · **E** weapons/guns · **F** enemy AI · **G** levels/progression · **H** menus/flow · **I** saves/settings · **J** audio · **K** performance · **L** edge cases.

---

## A. Movement & Controls (touch + keyboard + gamepad)

| # | Test | Steps | Expected |
|---|---|---|---|
| A-01 | Virtual joystick move | Hold/drag left joystick in each of 8 directions | Player accelerates smoothly, faces movement direction, no stick-at-full-speed snap |
| A-02 | Jump + buffer | Tap JUMP just before landing | Jump fires on landing (`jumpBufferTimer` 0.14 s, `PC:221`); coyote time lets jump ≤0.12 s after walking off a ledge |
| A-03 | Dodge roll i-frames | Roll through an incoming attack | Zero damage during roll (`PC:376-382`, `CD:969`); costs 15 stamina |
| A-04 | Slide | Hold run direction + DODGE while grounded moving | Slide state + slide SFX (`PC:348-355`, `playSlide`) |
| A-05 | Keyboard bindings | Space/WASD/arrows/Shift/J/K/L/E/F/R/C/Q | All respond (`InputManager.ts:138-175`); **also confirm How-to-Play is wrong about "no keyboard bindings" — file as doc bug #6** |
| A-06 | Gamepad | Connect pad: sticks, A/B/X/Y, L1/R1, Start | Movement + buttons map (`IM:359-380`); Start pauses |
| A-07 | Touch button feedback | Tap each of the 10 buttons | 15 ms haptic + press visual (`VC:125-131`); no stuck buttons after drag-off release |
| A-08 | Input clearing | Start a stage, pause→Main Menu→re-enter | No ghost inputs fire on entry (`clearVirtualInputs` `App.tsx:237-247`) |
| A-09 | Input buffer gap (known-open) | Press PUNCH during a dodge roll | **Current behavior: input is dropped** (no attack buffer, `PC:376-382`). Record actual behavior; this is design §6/§17 target not yet built — do not "fix" by expecting it |

## B. Combos, finisher, HUD

| # | Test | Steps | Expected |
|---|---|---|---|
| B-01 | 3-hit light string | PUNCH → PUNCH → PUNCH within 0.45 s each | `ATTACK_LIGHT_1→2→3`, escalating damage 14→18→28 (`CD:658-668`) |
| B-02 | String window expiry | PUNCH, wait 0.6 s, PUNCH | Chain resets to step 1 (no cross) |
| B-03 | **PUNCH→PUNCH→KICK = leg sweep** | Punch, punch, kick in window | Sweep state, 18 dmg, low hitbox; see C-02 |
| B-04 | Combo counter + decay | Land hits, stop attacking | HUD count holds ~2.8 s then breaks (`RN:931-999`, `APP:672-689`); decay bar drains |
| B-05 | Damage scaling | Reach 10–20 hit combo, hit again | Damage multiplier grows to max ×2.0 (`comboDamageMultiplier`); HUD shows `×dmg` |
| B-06 | Combo break on player hit | Take a hit mid-combo | Counter resets to 0, multiplier drops (`CD:1032`) |
| B-07 | **Finisher arm at 5** | Land 5 hits without being hit | `FINISHER READY` badge pulses (canvas + React pill); next PUNCH/KICK becomes finisher |
| B-08 | Finisher payout | Land the finisher | ×2.5 damage, hitstop ≥14 frames, slow-mo + popup, finisher consumed (`CD:891-899`) |
| B-09 | Combo meter charge (known-bug) | Any combo, then PUNCH+KICK chord | **Expected today: denial feedback only** — `comboMeter` is never written so `SPIN_SLASH`(5)/`EXECUTIONER`(15) can never fire (`PC:71,439`). Verify: no crash, light punch lands, `specialDenied` flash plays. **File as High bug if a special ever fires, or track the fix** |
| B-10 | Style label | Sustain long/varied combo | Style badge climbs NOIR→BABA YAGA (`CD:1419-1424`), pause screen shows `styleRating` |
| B-11 | Decay-bar overflow (known cosmetic) | Land a move that installs a 3.2–3.5 s window (knife hit, gun-fu crit, slam) | Bar may render beyond full width (normalized by 2.8 `RN:992`). Record; cosmetic |

## C. Gun-fu special moves (all implemented — verify each fires & reads correctly)

| # | Test | Steps | Expected |
|---|---|---|---|
| C-01 | **Flying kick** | Sprint in one direction ≥0.3 s (full speed ≥0.95×320), then KICK | `ATTACK_FLYING_KICK`: launches (vx 470 / vy −300), 36 dmg, +24 reach, hits each enemy at most once per flight (`flyingKickHits`), landing recovery + dust (`PC:571-587`, `CD:696-706`) |
| C-02 | **Leg sweep** | PUNCH, PUNCH, KICK inside combo windows | `ATTACK_SWEEP`, 18 dmg, low hitbox; **trips a blocking enemy** (`LEG SWEEP!` popup `CD:842-863`); knocks down already-downed bodies (`CD:906-912`) |
| C-03 | Sweep whiff | Do the sweep with no enemy in range | Whiff allowed, recovery plays, no damage/crash |
| C-04 | **Pistol whip** | Stand 14–68 px from an enemy, ≤40 px vertical, press SHOOT | Whip resolves **before** ammo is spent: 26 dmg, `PISTOL WHIP` banner, guard break on blocking enemy (`resolvePistolWhip` `CD:547-617`) |
| C-05 | Pistol whip range fail | >70 px away, press SHOOT | Normal gunshot instead (raycast path `CD:405-540`) |
| C-06 | **Judo slam** | GRAB within 60 px / 30 px of a live enemy (no SHOOT held) | `JUDO SLAM`: pull-in→hoist→slam, 42 dmg, +150 score, takedown count++, thrown body can bowl into others (≤3 pins, `GUN-FU BOWL`) (`CD:1174-1267`, `CD:1366-1416`) |
| C-07 | **Grip execution** | With ammo >0 and not reloading: **hold SHOOT and press GRAB** in range | Variant switches to `EXECUTION`: muzzle-to-temple at 0.28 s, damage `100 × combo multiplier`, ammo consumed, `GRIP EXECUTION` banner (`CD:1064-1067`, `CD:1273-1349`) |
| C-08 | Execution with empty gun | Same input with ammo 0 / reloading | Falls back to THROW (judo slam), no phantom ammo spend |
| C-09 | Grab out of range / invalid | GRAB with no enemy within 60 px, or while HURT/dodging | Nothing happens, no state lock (`CD:1045`) |
| C-10 | Grapple interrupted | Grab, then get hit by a second enemy / pause mid-grapple | `resetTransientState`/`endGrapple` clean up; enemy not stuck in `GRAPPLED` after restart |
| C-11 | **Parry riposte** | Block an incoming attack within **0.2 s of pressing BLOCK** | `PERFECT PARRY!`: parry SFX, 10-frame hitstop, slow-mo, enemy force-staggered, +25 score, `RIPOSTE READY` banner (`CD:988-1014`) |
| C-12 | Riposte cash-in | Within 0.15 s of the parry, land any attack | `PARRY RIPOSTE` banner, ×2.5 damage, speed lines (`CD:812-820`) |
| C-13 | Riposte window expiry | Parry, wait >0.15 s, then attack | Normal damage, no riposte popup |
| C-14 | Late block (not a parry) | Block >0.2 s before the hit lands | Normal block: chip damage, guard spark, no stagger (`CD:1015-1024`) |

## D. Defense, stagger, death

| # | Test | Steps | Expected |
|---|---|---|---|
| D-01 | Block chip & stamina | Hold BLOCK through several hits | 20 % chip, stamina drains 15/block, regens 35/s (55 with perk) |
| D-02 | Guard crush | Hammer a blocking enemy with heavies | `GUARD CRUSH` → `guardBreak()` → enemy open (`CD:830`, `EC:1055`) |
| D-03 | Enemy stagger meter | Keep attacking | Stagger bar fills (heavy +30 / light +15), STAGGER 1.6 s, HUD takedown prompt appears (`App.tsx:721-726`) |
| D-04 | Stagger takedown | Hit a staggered enemy | Bonus damage/score path, enemy goes down |
| D-05 | HEAVY super-armor | Attack a HEAVY during its windup | It tanks light hits (no stagger) (`EC:1000-1006`) |
| D-06 | Player death flow | Let health reach 0 | 1.4 s slow-mo kill-cam → ragdoll spawn → `RUN OVER` end screen with stats (`GameLoop.ts:449-474`) |
| D-07 | Death during hit-stop/slow-mo | Die right as a finisher lands | No double-transition, end screen shows once, engine frozen behind overlay |
| D-08 | Dodge vs bullets | Roll through a GUNNER/SNIPER round | Complete miss (`CD:1116/1139`); sniper `pierceBlock` rounds must still be dodgeable and must bypass block (`types/game.ts:331`) |

## E. Weapons, guns, items

| # | Test | Steps | Expected |
|---|---|---|---|
| E-01 | Pistol fire + casing + tracer | SHOOT | Raycast hit, casing ejects, tracer renders, 28 dmg (42 point-blank <95 px + slow-mo crit) (`CD:405-540`) |
| E-02 | Empty chamber | Fire 6 rounds (mag 6) | Empty click + auto reload (`CD:417-426`); reload SFX + cock SFX |
| E-03 | Ammo HUD | Watch pips while firing/reloading | Pips drain/refill (`App.tsx:592-615`) |
| E-04 | Weapon pickup & durability | Pick up katana/knife/shotgun from racks/drops | Equipped + durability bar; each strike decrements; at 0 weapon drops (`PC:407-427`, `PC:519-527`) |
| E-05 | Knife throw | Throw at enemy | Knife projectile, impale SFX, blood, `checkProjectilesAgainstEnemies` hit |
| E-06 | Coins / medkit | Kill enemies, break objects, walk over drops | Coins collect (cap 192), health pack heals 35 + synth chime (`EnvironmentManager.ts:552/591-596`) |
| E-07 | Perk effects | Buy KEVLAR_WEAVE (−20 % dmg), EXTENDED_MAG, LETHAL_BLADE, VAMPIRIC_TAKEDOWN | Each measurably applies (`PC:173-189`, `CD:730-736`, `CD:1257-1260`) |
| E-08 | Perk reset | Buy perks, die/restart | Coins & perks reset on `fullReset` (`GameLoop.ts:228`) — confirm intended |

## F. Enemy AI (11 archetypes)

| # | Test | Steps | Expected |
|---|---|---|---|
| F-01 | Archetype roster | Use pause-menu spawners / stage select to see all | 11 types spawn: BASIC, RUSHER, HEAVY, DEFENDER, ELITE, GUNNER, BOSS, MARQUIS, BERSERKER, ACROBAT, SNIPER — each with correct name tag (`EnemyRig.ARCHETYPE_TAGS`) |
| F-02 | **Attack staggering** | Fight 3–4 enemies | Never all attacking at once: max one `WINDUP/ATTACK` at a time (attack token `GameLoop.ts:410-431`); note: a 2nd enemy may start windup while first is in RECOVERY — judge by feel, file if it becomes a stunlock |
| F-03 | Telegraphs | Watch each enemy attack | Windup visible 0.12–0.8 s before hit (`EC:641-647`); ⚠️ label over head; SNIPER shows laser sight (`RN:879-921`) |
| F-04 | DEFENDER behavior | Attack a DEFENDER | Blocks often (.65), parries/ripostes (.60), rarely dodges |
| F-05 | ACROBAT/ELITE dodge | Fight them | Frequent dodge rolls with i-frames — hits should whiff during `evading` (`WHIFF` popup) |
| F-06 | GUNNER strafe | Fight GUNNER | Keeps 280–380 px, strafes, fires bursts; bullets chip block, bypass nothing else |
| F-07 | SNIPER lane | Fight SNIPER | Holds 320–760 px, backs off if too close, charged shot pierces block |
| F-08 | BOSS / MARQUIS HP bars | Reach wave 4 / wave 6 (or stage select) | Boss HUD with HP + stagger bars; MARQUIS 480 HP, faster/aggressive stats (`EC:284`) |
| F-09 | Boss phases (known-open) | Damage BOSS to 50 %/25 % | **No phase change exists** (stat-variant only) — record as design gap vs §5 "multi-phase", not a regression |
| F-10 | Flanking slots | Watch 3+ melee enemies | They hold offsets instead of stacking on player (`targetOffset` `EC:407`) |
| F-11 | Wall slam | Knock enemy into arena boundary | `WALL SLAM!` reaction + extra stagger (`EC:913-929`, `CD:315-327`) |
| F-12 | AI throttle sanity | Let enemies idle far away (if any off-camera) | Distant IDLE/APPROACH enemies update at 20 Hz (`EC:365-384`) — no visible stutter/teleport when they re-engage |
| F-13 | Ragdoll death | Kill enemies with heavy hits | Ragdoll tumbles, settles, fades ≤7 s; corpse stays until next spawn (`App.tsx:471`) |

## G. Levels, spawning, progression

| # | Test | Steps | Expected |
|---|---|---|---|
| G-01 | Wave ladder | Clear waves 1→7+ | 1: BASIC · 2: +RUSHER · 3: +HEAVY · 4: BOSS · 5: DEFENDER+ELITE · 6: MARQUIS · 7+: cycle [7,6,8,4,5] (`GameLoop.nextWave`) |
| G-02 | Spawn offsets | Watch every spawn | Never on top of player (offsets ≥165 px), enters from sides (`GameLoop.ts:73-136`); **no grace window** — note if a spawn attacks on frame 1 |
| G-03 | Arena rotation | Advance waves | Themes rotate CONTINENTAL_LOUNGE→NEON_GALLERY→RAINY_ALLEY→PENTHOUSE_SUITE with backdrop art + destructible layouts (`EnvironmentManager.initRoom`) |
| G-04 | Wave clear → door | Kill all enemies | Banner "CHAMBER CLEARED", exit door opens only when all `DOWNED` (`GameLoop.ts:336-340`) |
| G-05 | Advance via door | Walk into door + GRAB/interact | `nextWave()` + door SFX (`GameLoop.ts:343-352`) |
| G-06 | Advance via button | Tap "NEXT WAVE" HUD button | Same result (`App.tsx:737-745`) |
| G-07 | Difficulty scaling | Reach wave ≥7 | Enemy HP ×(1+(w−6)·0.15) and damage ×(1+(w−6)·0.08) applied (`GameLoop.ts:140-148`); **speed/aggression do NOT scale (known-open)** |
| G-08 | Victory | Kill MARQUIS at wave ≥6 | Victory screen with stats; persists `victories/best*` (`App.tsx:368-385`) |
| G-09 | Endless continue | On victory press Continue — Endless | Unpauses, `nextWave()`, wave counter keeps climbing (`App.tsx:387-395`) |
| G-10 | Stage select unlock | Fresh progress | Stage 1 open, 2–6 locked; clear 1 → 2 unlocks (`isStageUnlocked` `StageSelectModal.tsx:89-92`) |
| G-11 | Stage boot | Pick stage 3/4/5/6 | Correct wave set + correct encounter spawned (`App.tsx:304-330`) |
| G-12 | Endless stage entry | Pick stage 7 "Endless Covenant" | Starts at wave 7 endless pattern |
| G-13 | Elite/boss RNG (known-open) | Play many waves | Boss/elite encounters are **deterministic by wave**, no `eliteChance/bossChance` — confirm no random boss surprise (design §10 gap) |

## H. Menus & game flow

| # | Test | Steps | Expected |
|---|---|---|---|
| H-01 | Main menu | Open app | Play / Stages / Options / How to Play + 4 career tiles + stages-cleared count |
| H-02 | Pause entry/exit | Header button, Escape, gamepad Start; resume via Resume, X, backdrop click | All pause/resume paths work; sim frozen while paused (`GameLoop.ts:263-277`) |
| H-03 | Escape stacking | With 2 modals open, press Escape repeatedly | Closes topmost first, then pauses (`App.tsx:437-444`) |
| H-04 | Pause blocked in invalid states | Press pause on game-over screen / victory screen | Blocked (`App.tsx:271`) |
| H-05 | Restart from pause | Pause → Restart | Fresh stage, wave reset, full reset (`GameLoop.fullReset`) |
| H-06 | Main Menu from pause | Pause → Main Menu | Clean title state, no ghost inputs, no running sim |
| H-07 | Game-over stats | Die | Shows kills, max combo, time, score, wave, takedowns, parries, style, damage, coins (`GameOverScreen.tsx:118-134`) |
| H-08 | Record badge | Beat `bestScore` | `Record` badge shows (`App.tsx:548`) |
| H-09 | Retry / Stages / Menu buttons on end screen | Each | Correct transitions; Retry replays same stage |
| H-10 | Options | Change volume/quality/FPS | Slider/buttons react live; FPS chip toggles; Restore Defaults resets all 3 |
| H-11 | Quality tiers | Switch Performance/Balanced/Cinematic | DOM `data-quality` changes CSS effects (`settings.ts:141`) — **canvas rendering unchanged (known gap, M14)** |
| H-12 | How to Play | Open from menu + pause | 14 binding rows + tips; **known doc bug: footer claims no keyboard bindings** |
| H-13 | Combat Manual | Pause → Combat Manual | Live stats grid (max combo/parries/takedowns/style) + mappings; Resume works |
| H-14 | Armory | Pause → Armory, buy perk | Coins deduct, perk applies, `+` feedback; debug "+5 Coins" works |
| H-15 | Contracts | Pause → Contracts | 8 milestones; completion reflects live run (**lost on reset — known gap**) |
| H-16 | Rotate overlay | Load in portrait on touch device | Overlay shows; Try Landscape Lock attempts lock; "play anyway" dismisses; returning to portrait re-arms (`App.tsx:229-231`) |
| H-17 | Touch controls visibility | During play vs menus | Virtual controls only while playing (`App.tsx:1344-1350`); no touch pause button (**known gap — header only**) |
| H-18 | Victory vs defeat variants | Both end states | Correct buttons each: defeat=Retry, victory=Continue-Endless+Replay |

## I. Saves & settings persistence

| # | Test | Steps | Expected |
|---|---|---|---|
| I-01 | Progress persists | Clear stage 1, reload page | Stage 2 unlocked; `john-stick.progress.v1` in localStorage |
| I-02 | Best score/combo/kills persist | Finish a run, reload | Main menu tiles show new `bestScore`/`bestMaxCombo`; `bestKills` stored (**not displayed anywhere — known gap**) |
| I-03 | Settings persist | Set volume 40, quality low, FPS off; reload | All three restored (`loadSettings` `settings.ts:101-113`) |
| I-04 | Corrupted save | Hand-edit `john-stick.progress.v1` to `{"foo":1}` / negatives / dupes, reload | Sanitizer coerces to defaults, dedupes, clamps — no crash (`settings.ts:119-134`) |
| I-05 | localStorage blocked | Disable storage (or private mode) | Silent no-op, game still runs (`writeJson` try/catch `settings.ts:85-91`) |
| I-06 | Aborted run (known gap) | Play, then Pause → Main Menu mid-run | Score **not** banked (only death/victory bank) — confirm no partial/corrupt write |
| I-07 | Milestones/perks (known gap) | Note Contract completions, reset | Not persisted — confirm expected until WS4 lands |
| I-08 | Save reset path | Look for "reset progress" control | **None exists** — record as missing feature |

## J. Audio

| # | Test | Steps | Expected |
|---|---|---|---|
| J-01 | Sample bank loads | Play a session | 20/20 `.ogg` decode (check network tab: no 404 under `/assets/audio/`) |
| J-02 | Punch/kick/slam mapping | Land light/heavy/kick/slam hits | Distinct samples, pitch jitter, no clipping (`SoundFX.playPunch`) |
| J-03 | Parry sound | Perfect parry | `sfx_block` at parry moment (`CD:993`) |
| J-04 | Gun sounds | Fire, empty, reload, whip, execution | pistol shot random 1–4, cock, reload+delayed cock (`SoundFX.ts:193-207`) |
| J-05 | Whoosh variety | Jump/kick/sweep/dodge | Random whoosh/whoosh2 (`SoundFX.ts:159`) |
| J-06 | Volume slider | Set 0, 50, 100 | Proportional master gain; at 0 effectively muted (`applySfxVolume` `settings.ts:228-232`) |
| J-07 | Mute toggle | HUD button + pause toggle | Mute on/off, button state synced, persists as volume 0/60 (`App.tsx:255-263`) |
| J-08 | Context suspension | Switch tab away/back, first interaction | Audio resumes without gesture errors (`initCtx` `SoundFX.ts:74-90`) |
| J-09 | **Music (known-absent)** | Listen anywhere | **No music exists** — verify no console errors from missing tracks; log as WS3 open item |
| J-10 | Missing SFX coverage | Footsteps, landings, deaths, UI clicks | Not implemented (menus reuse combat SFX) — record gaps, not regressions |
| J-11 | Audio during pause/hit-stop | Pause mid-fight | No stuck looping SFX; one-shots finish or stop cleanly (all SFX are one-shot `BufferSource`) |

## K. Performance (M14 pre-check baseline)

| # | Test | Steps | Expected |
|---|---|---|---|
| K-01 | FPS baseline | Enable FPS chip; fight 4 enemies with blood/sparks active | ≥55 reads green (`App.tsx:911`); note baseline numbers per device |
| K-02 | Quality tier compare | Same fight at Performance vs Cinematic | Note: tiers currently only change CSS — FPS delta should be ~0 (confirms known canvas gap) |
| K-03 | Particle caps under stress | Finisher + slam + gun-fu bowling in a dense wave | Particle counts stay capped (blood ≤160, sparks ≤320, dust ≤220…) — no unbounded growth, oldest recycled |
| K-04 | Long session | 20+ min continuous play, many waves | No FPS decay trend, no memory growth spike (Performance/memory tab), no corpse/particle leak (bodies replaced each spawn) |
| K-05 | Pause cost | Sit paused 5 min | rAF still renders while paused (`GameLoop.ts:263-277`) — note CPU; expected behavior today |
| K-06 | DPR / framing | Test 1× and 2× DPR devices | Note apparent character size/framing differences (backing-store px passed to render) — **report to animation/camera agent** |
| K-07 | Thermal | 15 min on mid-range Android | Record heat/throttle observations for M14 |
| K-08 | Load time | Cold reload | First paint + first stage start timing; sample decode is eager at boot (`GameLoop.ts:48`) |

## L. Edge cases & exploits

| # | Test | Steps | Expected |
|---|---|---|---|
| L-01 | Boundaries | Run to arena edges | Clamped ±840, wall bounce, no fall-out (`EC:889-942`) |
| L-02 | Infinite combo exploit | Mash PUNCH on a downed enemy | No hit on `DOWNED` except slide/sweep (`CD:779`); no infinite juggle (no launcher exists) |
| L-03 | Grab spam | Mash GRAB | Only one grapple at a time (`isGrappling` gate `CD:1045`) |
| L-04 | Shoot-during-grapple double fire | Execution input | `pendingPistolShot` cleared so only the execution round fires (`CD:1074`) |
| L-05 | Pause during hit-stop / slow-mo / kill-cam | Escape at those moments | No state desync; timers resume correctly; pause blocked during kill-cam |
| L-06 | Restart mid-grapple / mid-air | Pause → Restart at any moment | Clean reset, no stuck `GRAPPLED` enemy, no residual slow-mo (`resetTransientState` `CD:206-219`) |
| L-07 | Tab blur mid-fight | Switch tabs 5 s, return | dt clamp 50 ms prevents physics explosion (`GameLoop.ts:250`); no teleport |
| L-08 | Rapid stage switching | Spam stage select/deploy | No double-spawn, telemetry reset each time (`resetRunTelemetry` `App.tsx:290-301`) |
| L-09 | Enemy count ceiling | Pause-menu spawners + AI Bureau injectors | Corpses accumulate until respawn — verify cap/feel; watch FPS (K-01) |
| L-10 | Thrown-body pins | Judo slam into crowds | ≤3 pins, no infinite pin loop (`CD:1389`) |
| L-11 | Chip-lethal on block | Kill enemy via blocked chip | Goes DOWNED with ragdoll, no crash (`CD:870-874`) |
| L-12 | All-buttons-at-once | Press every touch button + joystick simultaneously | No stuck state, no crash, sane outcome |
| L-13 | Gamepad disconnect mid-combo | Unplug pad | Falls back to touch/keyboard without crashing input poll (`IM:353-380`) |
| L-14 | Zero enemies door | Reach door logic with empty array | `every()` on empty array = door opens immediately (`GameLoop.ts:338`) — confirm no false wave-clear recording |
| L-15 | Console cleanliness | Full session, DevTools open | **Zero errors/warnings** (repo has no `console.*`; keep it that way) and zero 404s (assets/audio/ai) |

---

### Known-open items — verify resilience, do NOT file as regressions
1. `comboMeter` never charged → combo specials unreachable (High, see audit §8-1).
2. No attack input buffering (design target) — inputs during dodge/slide/block dropped.
3. No `DODGE→ATTACK` / `BLOCK→ATTACK` / launcher / air chains / ground finisher.
4. No music (WS3), no multi-phase boss, no aggro/leash/pathfinding, no elite/boss RNG, no speed/aggression scaling.
5. Options = 3 settings only; milestones/perks not persisted; no save-reset control; `bestKills`/`highestWaveCleared` not displayed.
6. How-to-Play keyboard-bindings claim wrong; combo decay bar can exceed 100 % with 3.0–3.5 s windows.
7. Animation / visibility / character-size: **owned by the concurrent agent** — route those findings there.

### Sign-off
| Section | Tester | Date | Result |
|---|---|---|---|
| A–B Controls/Combos | | | |
| C Gun-fu moves | | | |
| D–E Defense/Weapons | | | |
| F Enemy AI | | | |
| G Levels/Progression | | | |
| H–I Menus/Saves | | | |
| J Audio | | | |
| K Performance | | | |
| L Edge cases | | | |
