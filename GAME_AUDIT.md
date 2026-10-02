# GAME_AUDIT.md — John Stick Implementation Audit

**QA/Audit agent · October 2, 2026 · READ-ONLY audit (no `src/` changes, no builds)**

Sources of truth read: `JOHN_STICK_DESIGN.md` (Rev 2), `OPTIMIZATION_QA_PLAN.md`, `BUILD_PLAN.md`, and the full `src/` tree (~14,700 lines TS/TSX).

**Legend**
- ✅ **DONE** — implemented and wired end-to-end in code
- 🟡 **PARTIAL** — exists but incomplete / some paths missing / not surfaced in UI
- ⛔ **OPEN** — not implemented (design promises it)
- 🔄 **IN PROGRESS** — owned by the concurrent visual/animation agent right now; **not judged in this audit**

> **Line-number caveat:** a visual/animation pass is editing `src/` concurrently (during this audit `AnimationController.ts`, `StickRig.ts`, `EnemyRig.ts`, `EnemyController.ts`, `Renderer.ts`, `Camera.ts` were rewritten). Line refs below are a snapshot at audit time and may drift; **function/symbol names are the stable anchors**.

---

## 1. Milestone status vs `JOHN_STICK_DESIGN.md` §19

| M | Design claim | Audit verdict | Evidence |
|---|---|---|---|
| M1 Inspection/architecture | ✅ DONE | ✅ Confirmed | Modular `src/engine/*` + `src/components/*` + `src/types/game.ts` |
| M2 Player stick figure | ✅ DONE | ✅ Confirmed (rig drawing 🔄 in progress) | `StickRig.ts`, `types/game.ts:34` `StickFigurePose` |
| M3 Movement | ✅ DONE | ✅ Confirmed | `PlayerController.handleMovement` (`PlayerController.ts`), jump buffer `PC:221`, coyote `PC:227` |
| M4 One enemy | ✅ DONE | ✅ Confirmed | `EnemyController.ts`, `EnemyRig.ts` |
| M5 Basic combat | ✅ DONE | ✅ Confirmed | `CombatDirector.checkPlayerAttacks` |
| M6 Combos | ✅ DONE | ✅ Confirmed — see §2 | two-layer combo system, HUD, timing windows |
| M7 Physics & hit reactions | ✅ DONE | ✅ Confirmed | `Ragdoll.ts` (16 pts/28 constraints/sleep), `TieRope.ts`, knockback/stagger in `EnemyController.takeDamage` |
| M8 Multiple enemies | ✅ DONE | ✅ Confirmed | `GameLoop.spawnSquad` (`GameLoop.ts:71`), attack-token system (`GameLoop.ts:410-431`) |
| M9 Endless level generation | ✅ DONE | 🟡 See §6 — endless **loop** done, `EndlessLevelManager` abstraction does **not** exist | `GameLoop.nextWave` (`GameLoop.ts:168`) |
| M10 Enemy archetypes | 🔄 IN PROGRESS (design) | ✅ **DONE in code — 11 archetypes** (design named 6; no "9" claim found in any doc) | `types/game.ts:149-160`, `EnemyController.initArchetype` |
| M11 Cinematic camera | 🔄 PARTIAL (design) | 🟡 Follow ✅, hit-stop ✅, slow-mo ✅, impact trauma ✅; explicit finisher push-in/framing ⛔ | `Camera.ts`; `GameLoop.ts:297-313` hit-stop; `CombatDirector.slowMoFactor` |
| M12 VFX/audio | 🔄 IN PROGRESS | 🟡 Blood/sparks/particles ✅, 20 SFX samples ✅, **music ⛔** (§5) | `CombatDirector.spawnBlood`, `SoundFX.ts` |
| M13 Progression/menus | 🔄 IN PROGRESS | 🟡 Menus ✅, saves ✅, stage select ✅; options limited, style meter ⛔ (§4, §6) | `src/components/*` |
| M14 Android optimization | ⬜ TODO | ⛔ Confirmed open → `M14_PUNCHLIST.md` | — |
| M15 QA | 🔄 ONGOING | → `M15_QA_CHECKLIST.md` | — |
| M16 Final polish | ⬜ TODO | ⛔ | — |

---

## 2. Combat system — DONE vs OPEN

### 2.1 DONE ✅

| Feature | Symbol / file |
|---|---|
| Light combo string (jab→cross→spin) within 0.45 s windows | `PlayerController.triggerPunch` (`PC:530-553`) |
| PUNCH→PUNCH→KICK → **leg sweep** branch | `PlayerController.triggerKick` (`PC:558-568`) |
| Landed-hit combo counter, timer, break-on-hit | `CombatDirector.addCombo` / `breakCombo` / `COMBO_WINDOW = 2.8` (`CD:112-152`, decay `CD:260-265`) |
| Escalating damage ≤ 2.0× at 20 hits | `CombatDirector.comboDamageMultiplier` (`CD:129-131`) |
| **Finisher every 5 hits** — ×2.5, hitstop ≥14 f, slow-mo | `FINISHER_EVERY` (`CD:113`), arm `CD:140-142`, detonate `CD:891-899`, consumed `PC:599-607` |
| Combo HUD (canvas + React + pause screen) | `Renderer.renderComboHUD` (`RN:931-999`), `App.tsx:672-695`, `PauseMenu.tsx:116-134` |
| Style ladder NOIR→BABA YAGA from combo | `CombatDirector` (`CD:1419-1424`), HUD `App.tsx:944-952` |
| **Perfect parry → riposte** (block <0.2 s, 0.15 s cash-in, ×2.5) | `checkEnemyAttacks` (`CD:988-1014`), cash-in `CD:812-820`, `RIPOSTE_WINDOW` `CD:188` |
| **Grab → judo slam** (GRAB button) | `checkPlayerGrab` (`CD:1041-1080`), `updateGrapple` THROW path (`CD:1194-1267`), 42 dmg |
| **Grab + Shoot → grip execution** | variant select `CD:1064-1067`, `updateExecutionGrapple` (`CD:1273-1349`) |
| **Flying kick** (sprint ≥0.3 s + KICK) | `PC:571-587`, sustain gate `PC:66-67/264-280`, per-flight target set `flyingKickHits` (`CD:184`) |
| **Leg sweep** (18 dmg, trips blocking enemy, knocks down downed bodies) | `CD:685-695`, trip `CD:842-863`, knockdown `CD:906-912` |
| **Pistol whip** (melee before spending ammo, breaks guard) | `resolvePistolWhip` (`CD:547-617`), invoked `CD:412-415` |
| Guns: pistol raycast, point-blank gun-fu crit (42 dmg + slow-mo), reload, empty-click, shotgun, knife throw | `checkPlayerGunfire` (`CD:405-540`), `PC:397-427` |
| Dodge roll **i-frames** (melee + bullets) | `PC:343-382`, `CD:969`, `CD:1116/1139` |
| Hit detection (active-frame windows + circle test + single-hit latch) | `checkPlayerAttacks` (`CD:619-962`), windows `CD:644-737` |
| Hit-stop (loop-level freeze + combat-level freeze) | `GameLoop.ts:297-313`, `CD:253-257`, sets at 17 call sites |
| Knockback + wall slam reaction | `CD:797-799`, `EnemyController` wall bounce `EC:913-929`, `WALL SLAM!` `CD:315-327` |
| Enemy stagger meter (50) + guard break + stagger-takedown prompt | `EC:54-56`, `guardBreak` `EC:1055-1063`, HUD `App.tsx:721-726` |
| Player health/stamina/block cost/perk damage reduction | `PC:186-197`, `PC:238-241`, `KEVLAR_WEAVE` `PC:187-189` |
| Death → kill-cam → ragdoll → game over | `GameLoop.ts:449-474` |
| Touch controls: 10 buttons incl. labeled PUNCH/KICK + GRAB + floating joystick | `VirtualControls.tsx:24-34`, `188-343` |
| Keyboard + gamepad bindings | `InputManager.ts:138-175`, `359-380` |

### 2.2 OPEN ⛔ / 🟡

| Gap | Detail | Reference |
|---|---|---|
| **Attack input buffering** ⛔ | Only **jump** has a buffer (0.14 s). Attacks pressed during dodge/slide/block are **discarded**, contradicting design §6/§17 "input buffering throughout" | `PC:39/221` vs early-returns `PC:331-336/368-382` |
| `DODGE→ATTACK` and `BLOCK→ATTACK` chain branches ⛔ | Both states own the frame and return; design target chain not built | `PC:331-336`, `PC:376-382`, gates `PC:455/465` |
| `LAUNCH→AIR→AIR→KICK` ⛔ | No launcher/juggle state anywhere (grep `launcher\|LAUNCH\|juggle` = 0) | `types/game.ts:6-27` has no air-combo state |
| `GROUND→FINISHER` 🟡 | No named ground finisher; downed bodies only hittable by slide/sweep | `CD:779` |
| **Combo specials `SPIN_SLASH` / `EXECUTIONER` unreachable** ⛔ (bug) | Gate reads `comboMeter` (`PC:439/443`) but **`comboMeter` is never written anywhere in `src/`** → cost 5/15 can never be met; `pendingSpecial` (`PC:616`) has **no reader** in CombatDirector/GameLoop; `cancelSpecial` never called | `PC:71` declaration + reads only |
| Touch **special** button missing 🟡 | `TouchButton` union omits `'special'`; PUNCH+KICK chord is the only mobile path (`IM:405-406`) | `VirtualControls.tsx:24-34` |
| Touch aim stick ⛔ | `setVirtualAim` only ever called with `(0,0,false)` | `App.tsx:241` |
| Player stagger/poise ⛔ | Enemies stagger; player only has a 0.35 s `HURT` pose | `PC:196/714-719` |
| Style meter (design §14) ⛔ | Only a combo-derived style **label** exists; no variety scoring / repeat-move decay | design `JOHN_STICK_DESIGN.md:100-101` |
| Combo decay bar overflow 🟡 (cosmetic bug) | Bar divides by `COMBO_WINDOW=2.8` but several calls install 3.0–3.5 s windows → bar can exceed 100 % | `RN:992` vs `CD:310/513/528/1230/1322/1412` |

---

## 3. Enemy archetypes & AI — DONE vs OPEN

### 3.1 Archetypes: **11 implemented** (design names 6; the "9" figure appears in no repo doc)

`EnemyType` — `src/types/game.ts:149-160`: `BASIC · RUSHER · HEAVY · DEFENDER · ELITE · GUNNER · BOSS · MARQUIS · BERSERKER · ACROBAT · SNIPER`

- Stat table: `EnemyController.initArchetype` (`EC:156-312`) — per-type HP/speed/stagger/block/dodge/counter (e.g. MARQUIS 480 HP `EC:284`, BOSS 360 `EC:271`, ACROBAT dodge .78 `EC:240`).
- Per-type behavior: SNIPER lane logic `EC:448-469`; GUNNER strafe/shoot `EC:473-519`; HEAVY super-armor `EC:1000-1006`; attack-pattern roll tables `EC:531-556`.
- HUD name tags: `EnemyRig.ARCHETYPE_TAGS` (`EnemyRig.ts:5-17`).
- Design-named 6 (Basic/Rusher/Heavy/Defender/Elite/Boss) all present → **M10 effectively DONE**.
- **Multi-phase boss ⛔ OPEN** — `BOSS`/`MARQUIS` are pure stat variants; no phase thresholds (`renderBossHUD` draws one HP + one stagger bar, `Renderer.ts:1115-1189`). Design §5 names "Boss (multi-phase)".

### 3.2 AI — DONE ✅

| Feature | Reference |
|---|---|
| 14-state machine (`IDLE…GRAPPLED`) | `types/game.ts:162-176`, dispatcher `updateAI` (`EC:393-887`) |
| Attack telegraphs (windup table 0.12–0.8 s + ⚠️ label + sniper laser) | `EC:641-647`, `EnemyRig.ts:466-468`, `Renderer.renderSniperSights` (`RN:879-921`) |
| **Attack staggering — one attack token at a time** | `GameLoop.ts:410-431`, consumed at `EC:458/487/511/524/571` (caveat: `RECOVERY`/`COUNTER` not counted, so a 2nd windup can start during recovery) |
| Reactive block / dodge / counter-riposte | `EC:413-445`, queue `CD:878`, cash-in `EC:586-626` |
| AI throttling (20 Hz when >480 px & uncommitted) | `AI_THROTTLE_DISTANCE/INTERVAL` `EC:28/30`, logic `EC:365-384` |
| Flanking slots (enemies don't stack on player) | `targetOffset` `EC:115/407` |
| Ragdoll on death + loot (coins/weapon/medkit) + big-kill slow-mo | `EC:987`, `CombatDirector.ts:330-368` |
| HP + ghost bar + stagger bar overhead, boss bar | `EnemyRig.renderStatusOverhead` (`EnemyRig.ts:413-476`), `Renderer.renderBossHUD` |

### 3.3 OPEN ⛔ / 🟡

| Gap | Reference |
|---|---|
| No aggro radius / leash / disengage (grep `aggro\|leash` = 0) | every spawn engages immediately |
| No pathfinding — 1-D `targetX = player.x + offset` approach; no obstacle avoidance around destructibles | `EC:407/561-564` |
| Difficulty scaling: HP/damage multipliers only — **speed/aggression/stagger multipliers absent** (design §10 "health/damage/speed/aggression") | `GameLoop.ts:140-148` → `applyWaveScaling` `EC:318-323` |
| **`eliteChance` / `bossChance` RNG absent** — encounters are deterministic by wave number | `GameLoop.nextWave` `EC`→`GameLoop.ts:168-184` |
| Spawn distance is fixed offsets (≥165 px), no validation/grace window | `GameLoop.ts:73-136` |
| Dead field `staggerTakenScale` (BERSERKER ×2 / ACROBAT ×1.2 weakness **never read**) | decl `EC:77`, set `EC:237/253`, read: nowhere |
| Dead field `aiTimer` (write-only) | `EC:61/401` |
| Reinforcements + hazards types declared but unused | `types/game.ts:361-393` (`HazardZone`, `SpawnOrder`) — no hazard spawn code exists (BUILD_PLAN WS2 task) |

---

## 4. Menus, game flow, UI — DONE vs OPEN

### DONE ✅
- **Main menu** — Play / Stages / Options / How to Play + career tiles (Victories, Best Score, Max Combo, Best Run) + stages-cleared counter: `MainMenu.tsx:24-122`.
- **Pause menu** — Resume / Restart / Options / Main Menu / Armory (perk shop) / Contracts (milestones) / Combat Manual / How to Play / AI Bureau + encounter spawners + sound & debug toggles + run status panel: `PauseMenu.tsx:49-255`.
- **Game over / victory screen** — stats: kills, max combo, time, score, wave, takedowns, parries, style, damage, coins; Record badge; Retry/Stages/Main Menu (defeat) and Continue-Endless/Replay (victory): `GameOverScreen.tsx:5-195`.
- **Stage select → gameplay wiring** — 6 stages, unlock rule (clear N−1), `startStage` sets wave & spawns: `StageSelectModal.tsx:24-98`, `App.tsx:304-330`.
- **Options** — SFX volume slider, graphics quality (Performance/Balanced/Cinematic), FPS counter, Restore Defaults: `OptionsModal.tsx:79-173`.
- **Flow** — title→playing→paused→gameover→restart→title; Escape closes topmost dialog; gamepad Start pauses; simulation freezes behind overlays: `App.tsx:269-276/304-351`, `GameLoop.ts:263-294`.
- **Victory + endless continue** — wave 6 Marquis kill → victory latch → `continueEndless` → `nextWave`: `App.tsx:368-395/495-503`.
- **Rotate overlay + landscape lock** — `useLandscapeLock.ts:53-144`, `RotateDeviceOverlay.tsx:15-68`, re-arm on portrait `App.tsx:229-231`.
- **Combat manual** with live stats: `App.tsx:920-1006`.
- **Perk shop (Armory)** — 7 perks, run-scoped coins: `App.tsx:129-179/280-287`.

### OPEN ⛔ / 🟡
| Gap | Reference |
|---|---|
| Options missing difficulty / music volume / control remap / screen-shake (BUILD_PLAN WS4 task list) | only 3 settings exist, `settings.ts:13-20` |
| **Milestones/Contracts not persisted** — recomputed from live `gameLoop`, lost on reset | `App.tsx:1209/1230` |
| Perks not persisted (reset by `fullReset`) | `GameLoop.ts:228` |
| No dedicated LEVEL COMPLETE interstitial — banner + door + NEXT WAVE button only | `GameLoop.ts:336-352`, `App.tsx:729-745` |
| No virtual **pause** button (header button only) | `App.tsx:808-822` |
| `HowToPlayModal` claims "No keyboard bindings" — **factually wrong** | `HowToPlayModal.tsx:101-103` vs real bindings `InputManager.ts:138-175` |
| Aborted run (Main Menu mid-run) banks no score/best stats | `goToTitle` `App.tsx:337-351` |
| No save-reset / delete-progress control | — |
| Kills & run clock not in live HUD (only pause/end screens) | state `App.tsx:211-212` |

---

## 5. Sound samples & VFX — DONE vs OPEN

### DONE ✅
- **Sample bank: 20/20 `.ogg` present** in `public/assets/audio/` (SOURCES.md + 4 gun shots, block, coin, door, glass, gun_cock, katana_slash, kick, knife_stab, knife_throw, punch_heavy, punch_light, reload, slam, slide, whoosh, whoosh2). Every `SAMPLE_FILES` entry (`SoundFX.ts:15-36`) resolves to a file — **no broken references**.
- **15 SFX methods**, ~75 call sites; synthesis where no sample (`playHeal` 3-note chime `SoundFX.ts:240-265`); decode failures fail silent, never crash; rate jitter per shot.
- **Volume wiring done**: slider → `applySfxVolume` → master `GainNode` bus → `SoundFX.setMasterVolume` (`settings.ts:172-232`, installed pre-React at `main.tsx:7-9`); HUD/pause mute toggles.
- **Particles**: blood decals + ground splats (`spawnBlood` `CD:1515`, splat sticks/expands `CD:1627-1633`, fades 4.5→6.5 s), sparks, shockwaves, tracers, casings, blade arcs, damage popups, dust, afterimages, muzzle blooms, glass shards — **all hard-capped and pooled** (caps: blood 160, sparks 320, dust 220, etc.).
- Object pooling primitive in use: **12 pools** (`ObjectPool.ts`, users in `Renderer.ts:77/81`, `CombatDirector.ts:48-75`, `EnvironmentManager.ts:98-109`).

### OPEN ⛔ / 🟡
| Gap | Reference |
|---|---|
| **No background music at all** — zero code (`rg music` → none), zero music files; WS3 soundtrack + dynamic combat music wholly unbuilt | `BUILD_PLAN.md:37-48`, design §5/§12 |
| No music volume setting (nothing to wire) | `settings.ts:13-20` |
| No footstep / jump-land / death / dedicated UI-click SFX (menus reuse combat sounds) | — |
| Ground splats not cleared on `resetFight` — rely on natural 6.5 s expiry | `CombatDirector.resetTransientState` `CD:206-219` |
| `Hitbox.soundType` assigned but never read (dead metadata) | `types/game.ts:186`, writes `EC:617-778` |
| `Ragdoll.drainImpacts` never called — no impact FX/sound from ragdolls | `Ragdoll.ts:191` |
| `EnvironmentManager.rainDrops` simulated but never rendered (renderer draws its own rain) | `EM:452-461` vs `RN:445-451` |

---

## 6. Levels, progression, saves — DONE vs OPEN

### DONE ✅
- **Endless wave loop**: `spawnSquad` compositions (`GameLoop.ts:71-138`), `nextWave` ladder — wave 4 boss, 5 elite duo, 6 Marquis, 7+ cycles `[7,6,8,4,5]` (`GameLoop.ts:168-184`); GUNNER injection ≥ wave 7.
- **Arena variety**: 4 room themes rotated by wave (`ROOM_CONFIGS` `EnvironmentManager.ts:29-69`, `initRoom` `:148-151`) with AI backdrop images (rooftop/dojo/nightclub) + parallax.
- **Wave clear → door opens → walk in or tap NEXT WAVE** (`GameLoop.ts:336-352`, `App.tsx:729-745`); 250 ms tracker records wave clears (`App.tsx:484-492`).
- **SAVE SYSTEM (localStorage) — design §18 "not yet implemented" is STALE**:
  - `john-stick.settings.v1` → `{sfxVolume, quality, showFps}` (`settings.ts:70`)
  - `john-stick.progress.v1` → `{clearedStages, highestWaveCleared, victories, bestScore, bestMaxCombo, bestKills, bestTimeSec}` (`settings.ts:71`), sanitized on load (`settings.ts:101-134`), auto-saved on change (`App.tsx:402-412`).
  - Design targets: HighestLevel ✅ (`highestWaveCleared`), HighestScore ✅, HighestCombo ✅, Unlocks ✅ (`clearedStages` + `isStageUnlocked`), TotalEnemiesDefeated 🟡 (`bestKills` = per-run best, **never displayed anywhere**).

### OPEN ⛔ / 🟡
| Gap | Reference |
|---|---|
| **`EndlessLevelManager` does not exist** — design §10's class/fields (`currentLevel`, `eliteChance`, `bossChance`, `spawnPattern`, `arenaType`, `rewardMultiplier`) are unimplemented; logic is inlined in `GameLoop` | grep = 0 hits in `src/` |
| No `rewardMultiplier` — flat rewards (+250 wave, +150 takedown) | `CD:377/1228/1321` |
| No speed/aggression multipliers in difficulty scaling | `GameLoop.ts:140-148` |
| No randomized spawn positions (fixed offsets; design §12) | `GameLoop.ts:73-136` |
| Style meter (§14), cinematic finishers as a system (§15) ⛔ | design-only |
| Perk/milestone persistence ⛔ | §4 |

---

## 7. 🔄 IN PROGRESS — animation / visibility / character-size (owned by concurrent agent)

**Not judged for final state in this audit.** Files visibly being edited during this audit (mtime ~14:45–14:58): `AnimationController.ts`, `StickRig.ts`, `EnemyRig.ts`, `Renderer.ts`, `Camera.ts`, `EnemyController.ts` (pose section).

Scope acknowledgment only (status = 🔄 IN PROGRESS):
- Player/enemy pose generation & cross-fade blending — `AnimationController.generatePose/buildPose/mixPose/translatePose`.
- Character silhouette drawing & proportions (stick thickness, suit, tie anchor, coat tails) — `StickRig.renderTorsoAndSuit`, `EnemyRig` outline pass.
- Character size / framing relative to camera zoom — `Camera.ts` (`BASE_ZOOM`), `GameLoop` render call passing backing-store px.
- Rig visibility & culling of characters — `Renderer.render` enemy pass (`inView` gate `RN:373`).

**Consequence for this audit:** findings that depend on those files (e.g., pose allocation counts in §M14 punch list, rig draw cost) are reported as *targets*, not as quality judgments. Re-verify line numbers after the visual pass lands.

---

## 8. Bug/dead-code register found during audit (all unmarked in source — 0 TODO/FIXME in `src/`)

| # | Severity | Issue | Location |
|---|---|---|---|
| 1 | **High** | `comboMeter` never written → `SPIN_SLASH`/`EXECUTIONER` specials unreachable | `PlayerController.ts:71,439,443` |
| 2 | **High** | `pendingSpecial` write-only; no director-side special resolution; `cancelSpecial` never called | `PC:616/635-643` |
| 3 | Medium | Design promises attack input buffering; only jump buffered | `PC:39/221` |
| 4 | Medium | `staggerTakenScale` never read — BERSERKER/ACROBAT weakness is dead | `EC:77,237,253` |
| 5 | Medium | Combo decay bar normalized to 2.8 s vs 3.0–3.5 s windows | `RN:992` vs `CD:310…` |
| 6 | Medium | How-to-Play falsely claims no keyboard bindings | `HowToPlayModal.tsx:101-103` |
| 7 | Low | `TouchButton` union lacks `'special'`; touch aim producer absent | `VC:24-34`, `IM:268-272` |
| 8 | Low | `HazardZone`/`HazardPhase`/`SpawnOrder` types unused (WS2 hazards/reinforcements unbuilt) | `types/game.ts:361-393` |
| 9 | Low | Dead rain simulation (never rendered) | `EnvironmentManager.ts:452-461` |
| 10 | Low | `Ragdoll.drainImpacts` dead; ragdoll impacts produce no FX/sound | `Ragdoll.ts:191` |
| 11 | Low | `Hitbox.soundType` never read | `types/game.ts:186` |
| 12 | Low | `aiTimer` write-only | `EC:61,401` |
| 13 | Low | `goToTitle` mid-run banks no stats | `App.tsx:337-351` |
| 14 | Doc | Design §18 (saves unimplemented) and §19 (M10 in progress) are stale; no "9 archetypes" claim exists anywhere | `JOHN_STICK_DESIGN.md:113,125` |

---

## 9. Headline summary

**DONE:** core movement/physics/ragdoll/tie, two-layer combo system with timing windows + escalating damage + finishers, full gun-fu set (**flying kick, leg sweep, pistol whip, grip execution, judo slam, parry riposte** all implemented), guns/knife, dodge i-frames, hit-stop/slow-mo, 11 enemy archetypes with telegraphs + attack-token staggering + block/dodge/counter + AI throttling, endless wave loop with 4 arenas, all menus/screens/flow, stage select + unlocks, localStorage saves, 20-sample SFX bank with volume bus, capped+pooled particle VFX.

**OPEN:** background music (entire WS3), attack input buffering + DODGE/BLOCK→ATTACK + launcher/air chains + ground finisher, combo specials blocked by unwritten `comboMeter`, style meter, multi-phase boss, aggro/leash/pathfinding, speed/aggression difficulty scaling + elite/boss RNG, `EndlessLevelManager` abstraction, hazard/reinforcement systems, full options screen, milestone/perk persistence, options beyond 3 settings, M14 optimization pass.

**IN PROGRESS (other agent, not judged):** animation blending, character rendering/size/visibility, rig outlines, camera framing.

**Next artifacts:** `M15_QA_CHECKLIST.md` (test items), `M14_PUNCHLIST.md` (optimization targets).
