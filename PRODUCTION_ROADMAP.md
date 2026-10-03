# PRODUCTION_ROADMAP.md — John Stick feature status map

**Baseline:** git `5f0e644` (M14 Android optimization punch-list), working tree clean, `npm run lint` + `npm run build` green.
**Scope:** every production feature the owner has asked for, mapped **DONE / PARTIAL / NEW** against the file that actually implements it (or the file that must).
**Method:** status is decided by reading the code, not the design doc — a feature is DONE only when the shipped path is reachable in a real run.

Legend: ✅ DONE (ships today) · 🟡 PARTIAL (works, but a documented half of the contract is missing) · ⛔ NEW (does not exist in `src/`).

Summary: **41 features — 31 DONE · 4 PARTIAL · 6 NEW.**

---

## A. Combat feel & core loop (9)

| # | Feature | Status | Implementing file / symbol |
|---|---------|--------|----------------------------|
| A1 | Punch/kick buttons → branching jab→cross→spin string with 0.45 s windows | ✅ | `PlayerController.triggerPunch` (`src/engine/PlayerController.ts:525`), `triggerKick` (`:551`), input gates `handleActions` (`:450/:460`) |
| A2 | Combo counter, timing-window decay, escalating damage ≤2.0×, live HUD meter | ✅ | `CombatDirector.addCombo`/`breakCombo`/`comboDamageMultiplier` (`src/engine/CombatDirector.ts:141-164`), `Renderer.renderComboHUD` (`src/engine/Renderer.ts` ~`:931`), `App.tsx:687-729` |
| A3 | Chain finisher armed every 5 hits (×2.5, heavy hit-stop, slow-mo) | ✅ | `FINISHER_EVERY` (`CombatDirector.ts:113`), arm `:153`, consume `PlayerController.triggerFinisher` |
| A4 | Hit-stop freeze frames (loop-level + combat-level) | ✅ | `GameLoop.ts:411-416`, `CombatDirector.hitStopFrames` (`:80`, early-return `:266-269`), set at 17 call sites |
| A5 | Camera trauma shake, slow-mo, speed lines, kill-cam ragdoll | ✅ | `src/engine/Camera.ts`, `CombatDirector.slowMoFactor/speedLinesTimer` (`:81-83`), `GameLoop.ts:576-602` |
| A6 | Knockback, wall slam, stagger meter, guard break, staggered-takedown prompt | ✅ | `EnemyController.takeDamage` (`src/engine/EnemyController.ts:976`), `guardBreak` (`:1067`), wall bounce `applyPhysics` (`:921-938`), banner `App.tsx:737-742` |
| A7 | Perfect parry → riposte cash-in (block <0.2 s, ×2.5) | ✅ | `CombatDirector.checkEnemyAttacks` parry branch, `RIPOSTE_WINDOW` (`:200`), cash-in `:812-820`, `announceMove('PARRY RIPOSTE')` (`:835`) |
| A8 | Dodge roll i-frames (melee + bullets), slide, jump buffer + coyote time | ✅ | `PlayerController.ts:338-377`, `:219-235`, i-frame checks `CombatDirector` (`evading` getter `EnemyController.ts:103`) |
| A9 | **Input buffering for attacks + `DODGE→ATTACK` / `BLOCK→ATTACK` chains** (design §6/§17 "forgive imperfect timing") | ⛔ NEW | Only jump is buffered (`PlayerController.ts:220`); attack presses during dodge/slide/block are discarded by early returns (`:331/:371/:392`). Land in `PlayerController.handleActions` |

## B. Signature moves & arsenal (8)

| # | Feature | Status | Implementing file / symbol |
|---|---------|--------|----------------------------|
| B1 | Flying kick (sprint ≥0.3 s + KICK, per-flight hit latch) | ✅ | `PlayerController.ts:66-67/:264-280/:571`, hits `CombatDirector.flyingKickHits` (`:196`), banner `GameLoop.ts:441` |
| B2 | Leg sweep ender (PUNCH, PUNCH, KICK — trips guards, knocks down bodies) | ✅ | `PlayerController.triggerKick` (`:551-560`), trip/knockdown `CombatDirector` sweep branches (`:842/:906`) |
| B3 | GRAB → judo slam (42 dmg, thrown body bowls the squad = GUN-FU BOWL) | ✅ | `CombatDirector.checkPlayerGrab` (`:1061`), THROW path `updateGrapple`, bowl `updateThrownEnemies` (`:1366`), `announceMove` (`:1269`) |
| B4 | GRAB + SHOOT → grip execution (pistol to the temple) | ✅ | variant select `CombatDirector.ts:1084-1090`, `updateExecutionGrapple` (spends a round `:1327-1330`) |
| B5 | PISTOL WHIP point-blank + GUN-FU CRIT (42 dmg, slow-mo, breaks guard) | ✅ | `resolvePistolWhip` (`CombatDirector.ts:566`), called before any ammo spend (`:434`), crit branch `:517-534` |
| B6 | **Gun arsenal: SMG / SHOTGUN / RIFLE + reserve ammo + tactical reloads + switching** (pistol currently the only real gun) | ⛔ NEW | Only `PISTOL` path exists: `CombatDirector.checkPlayerGunfire` (`:424-559`), fixed 0.95 s reload (`PlayerController.ts:385-389`, `CombatDirector.ts:439-443`), `maxAmmo=7/12` (`:103`), `WeaponType` has `SHOTGUN` but **zero drops exist** (`EnvironmentManager.dropWeapon` call sites: KATANA/KNIFE only). Land in new `src/engine/Weapons.ts` + `PlayerController` inventory + `CombatDirector` pellet raycast |
| B7 | Knife throw (SHOOT with KNIFE) + melee arsenal with durability (katana 14, knife 5, LETHAL_BLADE +8) and ground pickups | ✅ | throw `PlayerController.ts:393-399` → `EnvironmentManager.throwKnife` (`:428`); durability `equipWeapon` (`:151`) / `consumeWeaponOnStrike` (`:514`); pickup `EnvironmentManager.update` (`:489-522`), render `Renderer.renderDroppedWeapons` (`:1591`) |
| B8 | Twin-stick aim (right stick / touch aim) with on-screen laser | 🟡 PARTIAL | Laser renders (`Renderer.renderAimLaser` `:996`) and gamepad right-stick drives `aimActive` (`InputManager.ts:341-349`), but the **touch aim stick is never wired** — `setVirtualAim(0,0,false)` only (`App.tsx:256`) |

## C. Enemies & encounters (8)

| # | Feature | Status | Implementing file / symbol |
|---|---------|--------|----------------------------|
| C1 | 11 archetypes with distinct stats, palette and tags | ✅ | `types/game.ts:149-160`, `EnemyController.initArchetype` (`:171-327`), `EnemyRig.ARCHETYPE_TAGS` (`src/engine/EnemyRig.ts:5-17`) |
| C2 | Attack token — never more than one enemy mid-swing; 0.12–0.8 s telegraphs | ✅ | `GameLoop.ts:531-557`, windup table `EnemyController.ts:653-659`, ⚠️ label `EnemyRig.ts:466-468` |
| C3 | Reactive block / dodge / counter-riposte | ✅ | `EnemyController.updateAI` (`:430-458`), riposte `COUNTER` (`:609-638`), queue `CombatDirector.ts:878` |
| C4 | AI throttling (20 Hz beyond 480 px) + flanking slots | ✅ | `AI_THROTTLE_*` (`EnemyController.ts:29-31`, `:384-399`), `targetOffset` (`:126`) |
| C5 | **Elite enemy variant promotion (violet/gold livery, ×1.8 HP, flank + cover behaviour, ★ tag)** | ⛔ NEW | `ELITE` exists as a fixed archetype only (`initArchetype` `:212-223`); no per-spawn elite *promotion* of other archetypes, no cover use. Land in `EnemyController` + `EnemyRig.renderStatusOverhead` (`EnemyRig.ts:413`) |
| C6 | **Multi-phase boss (pattern shifts at 66 %/33 %, phase banner, death cinematic)** | ⛔ NEW | Bosses are one HP bar: `Renderer.renderBossHUD` (`:1291-1380`), boss spawn `GameLoop.ts:150-154`, kill cinematic generic (`CombatDirector.ts:353-370`). Land in `EnemyController.takeDamage` phase check + `CombatDirector.triggerBossIntro` + `renderBossHUD` |
| C7 | Difficulty scaling across HP / damage / speed / aggression | 🟡 PARTIAL | HP + damage only: `GameLoop.spawnSquad` (`:215-222`) → `applyWaveScaling` (`EnemyController.ts:333-338`); no speed multiplier (design §10) |
| C8 | Randomized procedural encounters (`EndlessLevelManager`: eliteChance, bossChance, spawnPattern, rewardMultiplier) | 🟡 PARTIAL | Endless **loop** works (`GameLoop.nextWave` `:243-259`, authored waves 4-6), but the manager class and all RNG weights are absent (grep = 0), encounters are deterministic by wave number |

## D. Environment & loot (5)

| # | Feature | Status | Implementing file / symbol |
|---|---------|--------|----------------------------|
| D1 | 4 room themes with parallax AI backdrops, rain, door transition, room banner | ✅ | `ROOM_CONFIGS` (`EnvironmentManager.ts:29-69`), `initRoom` (`:147`), `Renderer.renderExitDoor` (`:1382`), rain `Renderer` (~`:445`) |
| D2 | Destructible props (glass display / champagne table / weapon rack) — melee | 🟡 PARTIAL | Break + drop: `checkHitboxAgainstDestructibles` (`EnvironmentManager.ts:619-642`), `shatterObject` (`:327`), render `Renderer.renderDestructibles` (`:1469`). **Gaps:** bullets do not damage props; props are purely decorative (no cover/solidity); no crates or barrels |
| D3 | **Explosive barrels + chained explosions damaging player and enemies** | ⛔ NEW | `DestructibleObject.type` union has no barrel (`types/game.ts:286`). Land in `EnvironmentManager` prop spawn + `CombatDirector.resolveExplosions` |
| D4 | Loot: Continental gold coins (magnetic), med kits, dropped weapons | ✅ | `EnvironmentManager.dropCoin`/`dropHealthPack`/`dropWeapon` (`:372-426`), pools + caps (`:92-97`), pickup loops (`:489-602`) |
| D5 | **Ammo-pack pickups feeding reserve ammo** | ⛔ NEW | No ammo concept beyond the pistol mag (`PlayerPhysics.ammo/maxAmmo`, `types/game.ts:111-112`). Land with B6 in `EnvironmentManager` + `PlayerController.pickupGun`/`pickupAmmo` |

## E. VFX, audio, haptics (6)

| # | Feature | Status | Implementing file / symbol |
|---|---------|--------|----------------------------|
| E1 | Impact FX suite: tracers, muzzle bloom, shell casings, sparks, shockwaves, damage popups, blade arcs | ✅ | `CombatDirector` pools (`:39-78`, caps `:120-128`), `Renderer.renderCombatFX` (`:759-860`), `spawnMuzzleBloom` (`:299`) auto-fires on new tracer ids (`:799-803`) |
| E2 | Blood decals + pooled death ragdolls with joint constraints | ✅ | `CombatDirector.spawnBlood`, `src/engine/Ragdoll.ts`, `ragdollPool` recycle `GameLoop.ts:140-145/:266` |
| E3 | Surface-aware impact FX (wood / glass / barrel / wall colour + debris) | ✅ | `CombatDirector.surfaceColor` (`src/engine/CombatDirector.ts:1015` — glass / crate / barrel / table / rack / wall palette) called at `:733`, `:989`, `:1168`, `:1178`, `:2113`; shatter debris by surface `EnvironmentManager.shatterObject` (`:493-516` — wood splinters for crates, glass otherwise, theme tint in `NEON_GALLERY`) |
| E4 | Distinct weapon audio: per-gun reports + explosion boom | ✅ | `SoundFX.playGunReport` (`src/engine/SoundFX.ts:381` — SMG dry/up-pitched, SHOTGUN down-pitched + slam body, RIFLE hard crack, PISTOL delegates to the shipped `playGunshot`) fired from `CombatDirector.resolveSalvoShot` (`:1051`); `SoundFX.playExplosion` (`SoundFX.ts:405`) from `CombatDirector.detonateBarrel` (`:1218`). Existing signatures untouched (new methods only) |
| E5 | **Music system: menu + dynamic combat score** | ✅ | `src/engine/Music.ts` — procedural 96 BPM score (5 layer buses, bar-locked pattern swaps, menu/run/paused/victory/death scenes, 4 run-intensity tiers fed from `App.tsx`), `settings.musicVolume` + `OptionsModal` slider, SFX ducking from `SoundFX.playSample`/`playWorld` |
| E6 | Haptics / controller rumble | ✅ | `src/engine/Haptics.ts` (`cue`, distance-scaled `cueAt`, `takedown` pattern, `heartbeat` pattern) driven from `CombatDirector` (finisher, grapple slam, execution, barrel slam) + low-HP heartbeat `GameLoop.updateHeartbeat` |

## F. UI, flow, platform (5)

| # | Feature | Status | Implementing file / symbol |
|---|---------|--------|----------------------------|
| F1 | Title / pause / game-over + victory screens, stage select, HUD, settings menus | ✅ | `src/App.tsx`, `src/components/PauseMenu.tsx`, `HowToPlayModal.tsx`, HUD `App.tsx:578-762`, boss/combo canvas HUD `Renderer.renderBossHUD` (`:1291`) |
| F2 | Save system: cleared stages, highest wave, best score/combo/kills/time, victories + progression profile | ✅ | Run stats `settings.ts:149` (`john-stick.progress.v1`, sanitized on load); Phase 2 profile in `src/profile/` — `ProfileStore.ts` (`johnstick-profile-v1`, versioned + `sanitizeProfile`), XP/levels + style rank `Progression.ts:23-95`, unlocks/upgrades/skins/achievements catalogs `Catalogs.ts`, auto-save `App.tsx:453/:565/:769` |
| F3 | Landscape mobile controls: floating joystick + labeled PUNCH/KICK/GRAB + 10 touch buttons, drag-to-place layout editor + swipe gestures | ✅ | `VirtualControls.tsx` (buttons `:188-343`, joystick `:148-177`, swipe gestures on the look area `:425`), `InputManager.setVirtualButton` (`:277`) + one-shot pulse for swipes (`:339`), editor `src/components/TouchLayoutEditor.tsx` (drag any control, `default`/`southpaw` presets, undo, persisted in settings), opened from `App.tsx:725` |
| F4 | Controller (Type-C/Bluetooth) + keyboard bindings | ✅ | `InputManager.handleKeyDown` (`:141`), pad poll (`:322-376`), rebind table `src/components/PadBindings.ts` (`PAD_BINDINGS`, `PAD_BADGE`, footer hints), status badge `App.tsx:654-667` |
| F5 | 60 FPS Android target: quality tiers, DPR caps, pooling, capped FX, offline APK | ✅ | `M14_PUNCHLIST.md` (executed at `5f0e644`), `ObjectPool.ts`, FX caps `CombatDirector.ts:120-128` / `EnvironmentManager.ts:92-97`, `settings.applyQuality`, Capacitor package `../wick-stick-game-apk` |

---

## G. J.I.N 2026-10-03 audit gaps G5–G8 (this change set)

Numbering follows the audit's four open gaps. The source keeps each lane's own tag in its comments — `Difficulty.ts` header **G5**, `EnemyController.ts` reaction block **G5 reactions** (the audit calls that work *G5 enemy behaviours*), `TrainingRoom.ts` / `GameLoop.ts` / `CombatDirector.ts` **G7**.

| # | Gap | Status | Implementing file / symbol |
|---|-----|--------|----------------------------|
| G5 | **Difficulty tiers ROOKIE / PRO / CONTINENTAL — behaviour-only scaling.** Scales reaction floor + jitter, aim error, decision drain, defensive-read chance, squad attack gap, flank-ring depth and poise-break retreat length. Never HP, damage, hit-stop or slow-mo. PRO = 1.0 on every scale, so the default/stored `'pro'` run is byte-identical to the build it came from | ✅ | `src/engine/Difficulty.ts` (`DIFFICULTY_TIERS`, `MIN_HUMAN_REACTION = 0.2`, `BASE_AIM_SPREAD = 22`, `reactionDelay`, `aimSpreadPx`, `setDifficulty`); reads: `EnemyController.update` (`coolScale = adaptive × decisionCooldownScale`, block/dodge rolls × `defenseChanceScale`, clamped ≤ 0.9), `EnemyController.fireBullet` (`aimSpreadPx()`), `GameLoop` coordination (`:736` `attackGap`, `:772` `flankRingScale`); persisted `settings.difficulty` (`settings.ts:66/:98`, load `:254`, `ProfileStore.ts:156`); picker `OptionsModal.tsx:246`; chip `StageSelectModal.tsx:177` |
| G6 | **Enemy reaction behaviours — the reads G5 puts a clock on.** (i) gunshot heard within 700 px → ALERT, guard comes up only when the tier latency runs out; (ii) a round lands within 130 px → COVER, break for the nearest intact prop and hold the guard for the whole seat; (iii) poise break → RETREAT away from whoever broke it, abandoned at the arena wall | ✅ | `EnemyController.armReaction` (`:586`, COVER outranks an in-flight ALERT, dropped if one is already in the pipe, inert on a sandbag), `pendingReaction` (`:614`), `tickReactions` (`:642`, retreat clock only runs while neutral so a stun cannot burn it), `raiseGuard`/`clearCover`/`isNeutral` (`:617-631`), seat hold `updateAI:712-726`, retreat `:747-764`; `CombatDirector.signalGunshot` (`:396`, armed at `:859`), `armCoverNear`/`armCoverFor` (`:409/:423`, seat = prop edge ±800 clamp, falls back to ALERT with no prop), armed from `guardBreak` (`EnemyController:1508`), first poise-break (`:1438`), perfect parry and wall-slam stagger |
| G7 | **Training Arena** — spawnable dummies, mechanic checklist, no player death, instant reset, zero progression writes | ✅ | Tracker `src/engine/TrainingRoom.ts` (8 ids, inert until `trainingSetActive(true)`); `GameLoop.enterTraining` (`:396`), `spawnTrainingDummies` (`:374` — sandbag / attacker / shooter), `resetTraining` (`:409`), death floor + `trainingTopUp` (`:815-830`), wave-clear/door/coin gates (`:603/:619/:639`), attack token released for every dummy (`:778-786`); marks + silent progression `CombatDirector.emitProgressIfLive` (`:385`, 7 sites) and `trainingMark` (`:575/:832/:1225/:1477/:2575`); `PlayerController.trainingTopUp` (`:384`), slide/standing SHOOT sites (`:741/:808`) → `tryFireWeapon` (`:1353`); UI `src/components/TrainingPanel.tsx`, `App.startTraining` (`:608`) / `exitTraining` (`:686`), `TRAINING_STAGE` card `StageSelectModal.tsx:95` |
| G8 | **Headless coverage for G5–G7** — no UI-only proof; every claim below is asserted by driving the real engine | ✅ | `smoke_combat.ts` **A5** (27 checks: tier floors ≥ 0.20 and ordered, PRO baseline byte-equal, aim band 35.2/22.0/12.1, sub-human clamp, latency band, HP/damage invariance across tiers, decision-pace order rookie 42 / pro 60 / continental 81 frames, live ALERT + COVER + RETREAT) and **A6** (29 checks: board inert outside the drill, all 8 marks fired by the real state machine, slide-fire keeps the SLIDE pose, takedown writes no progression, damage tally silent, top-up rules, three dummy roles). Suite **127 PASS / 0 FAIL**, exit 0 |

### G5 per-tier values — every entry is a behaviour read, never a stat

| Profile | reactionMin | reactionJitter | aimSpreadScale (→ px) | decisionCooldownScale | defenseChanceScale | attackGap | flankRingScale | retreatDuration |
|---------|------------:|---------------:|----------------------:|----------------------:|-------------------:|----------:|---------------:|----------------:|
| ROOKIE | 0.45 s | 0.35 s | 1.60 → 35.2 px | 1.45 (lazy) | 0.70 | 0.40 s | 1.30 | 1.10 s |
| PRO (shipped, default) | 0.30 s | 0.22 s | 1.00 → 22.0 px | 1.00 | 1.00 | 0.22 s | 1.00 | 0.90 s |
| CONTINENTAL | 0.22 s | 0.14 s | 0.55 → 12.1 px | 0.75 (sharp) | 1.25 | 0.12 s | 0.85 | 0.70 s |

One draw is `max(MIN_HUMAN_REACTION, reactionMin) + rand × jitter`, so **0.20 s is the floor under every tier** — no profile can schedule a frame-perfect reaction. Aim error is `max(4, 22 × aimSpreadScale)` px of vertical spread (never a laser). Defence rolls clamp at 0.9 in place. Unset or unknown `settings.difficulty` sanitises to `'pro'` (`settings.ts:254`, `ProfileStore.ts:156`), which is what makes the tier invisible to an existing save.

---

## Phase 1 implementation targets (this change set)

| Pillar | Features | Where |
|--------|----------|-------|
| **Arsenal** | B6, D5, HUD reserve/ammo readout | `src/engine/Weapons.ts` (new), `PlayerController`, `CombatDirector`, `EnvironmentManager`, `types/game.ts`, `InputManager`, `VirtualControls`, `App.tsx` |
| **Enemy escalation** | C5, C6, C7 (speed leg) | `EnemyController`, `EnemyRig`, `CombatDirector`, `Renderer.renderBossHUD`, `GameLoop` |
| **Destructible props** | D2 (bullet damage + cover), D3 (barrels + chain) | `types/game.ts`, `EnvironmentManager`, `CombatDirector`, `Renderer.renderDestructibles`, `GameLoop` |
| **VFX feel** | E3, E4 | `CombatDirector`, `SoundFX`, `Renderer` |

**Guardrails carried into Phase 1:** no change to existing damage numbers, cooldowns, hit-stop frames or gun-fu trigger order; gun-fu moves keep byte-identical triggers; `SoundFX` public signatures unchanged (new methods only); quality tiers/DPR caps untouched; no new per-frame allocations outside pooled records; no git commit.

## Phase 5 — fighting-debug + release prep (this change set)

**Verification:** `npx tsc --noEmit` green · `npm run build` green · `npx tsx smoke_combat.ts` **35/35 PASS** (`ALL GREEN`; headless harness, repo root — no engine import is mocked; it drives the real `CombatDirector`/`EnemyController`/`PlayerController`).

### A1 — combo specials (`SPIN_SLASH` / `EXECUTIONER`) were dead at three independent points

| # | Break | Evidence | Fix |
|---|-------|----------|-----|
| 1 | `player.comboMeter` is written nowhere → the `>= 5` / `>= 15` gate could never open | field declared `PlayerController.ts:132`, read at `:753-758`, **0 writers** | `CombatDirector.mirrorComboMeter` (`:277`) copies `stats.comboCount` into it. Called at step **3a** (`:408`) *after* the decay/`breakCombo` check, so a lapsed chain reads 0 on the frame it dies; on the grapple early-return (`:442`); and at step **13** (`:642`) after landed hits, damage breaks and special spends — always before the next `player.update` (GameLoop runs player step 2, director step 7) |
| 2 | `checkPlayerAttacks`' `isAttacking` union omitted `ATTACK_SPECIAL` / `ATTACK_SUPER` → the move animated but never registered a hit | `CombatDirector.ts:1356-1366`, early return `:1368` | both states added to the union, plus an early branch (`:1374-1385`) that dispatches to `resolveSpecialStrike` (`:1765`) before the normalized-window code runs |
| 3 | `player.pendingSpecial` was write-only; nothing consumed or cleared it | written `PlayerController.ts:941`, `cancelSpecial` (`:960`) had **0 callers** | three settlement paths: contact clears + spends (`:1876-1884`), a window that closes empty clears without spending (`:1779-1781`), director step **3b** (`:410-419`) drops a trigger whose state was forced off the special (dodge cancel / grapple lock / `forceState`) with no spend |

**Design decision — the meter *is* the chain.** `player.comboMeter` is a **mirror** of `CombatDirector.stats.comboCount`, not a second pool: one number drives the HUD ring, the ≤2.0× damage ramp (`A2` row) and the special gate, so they cannot desync — a separate meter would double-book the player and invent a second decay rule. Costs are `PlayerController.SPECIAL_COST = 5` / `SUPER_COST = 15` (`:142/:144`), charged from `comboCount` **on contact only** (`max(0, count - cost)`, `:1876-1884`); the landing then credits `+1` *after* the spend (`:1902`) so the burn can never re-arm a finisher the meter no longer pays for.

**Strike windows** — absolute seconds on `physics.stateTimer` (the pose's `strikeCurve` normalizes separately for animation only):

| Move | Window | Reach | Effect |
|------|--------|-------|--------|
| `SPIN_SLASH` (0.58 s anim) | 0.15 – 0.42 | every body within `95 + KATANA 16` px of the player (whirl) | 30 dmg, heavy, kb 420 / -160, hit-stop 8, trauma 0.42, blade arc, `STYLE_PAYOUT.SPIN_SLASH = 14` |
| `EXECUTIONER` (0.95 s anim) | 0.30 – 0.62 | forward arc at `strikeX = px ± (42 + KATANA 16 + 44)`, radius `78 + 16` | 55 dmg, heavy, kb 520 / -240, hit-stop 12, trauma 0.55 + slow-mo 0.35, `STYLE_PAYOUT.EXECUTIONER = 22` |

One registration per special (`playerAttackRegistered`; the flying kick's per-body latching deliberately not reused). Props in the arc shatter on the same frame (`checkHitboxAgainstDestructibles`, `:1811-1820`) — a prop-only contact **registers but does not spend**, because no fighter was hit. Guard-break on `BLOCK` (`:1844`), dodge i-frames deny credit (`:1837`), whiff (`!connected`, `:1869`) costs animation time only.

### A2 — `staggerTakenScale` was multiplied into nothing

`EnemyController.takeDamage` now scales the per-hit gain: `this.staggerMeter += (isHeavy ? 30 : 15) * this.staggerTakenScale;` (`EnemyController.ts:1122`). Every other `staggerMeter` write was audited and is **not** a per-hit gain, so none of them takes the scale — they stay deliberately flat: resets at `:961`/`:998`, forced full from `guardBreak` (`:1185`), the wall-slam bonus `+20` (`CombatDirector.ts:518`) and the perfect-parry fill (`:1943`). (Berserker ×2.0 → 60 heavy / 30 light, Acrobat ×1.2 → 18, base ×1.0 → 15, asserted in `smoke_combat.ts`.)

### A3 — movement / lock audit (what was checked)

Each path below has a guaranteed exit, so **no change was made**:

1. **BLOCK** (`PlayerController.handleActions:595-605`) — exits on block release; re-enters from LAND/HURT.
2. **SLIDE** (`:643-650`) — `stateTimer > 0.42 s` **or** `|vx| < 80` against the 950 px/s scrub; both always reached, and `stateTimer` keeps counting even when an airborne slide has flipped the pose to FALL.
3. **DODGE_ROLL** (`:652-658`) — `stateTimer > 0.36 s`; nothing can reset the state while `isDodging` (locomotion, LAND and the block branch are all gated on `!isDodging`).
4. **Attack recovery** (`:799-812`) — `stateTimer >= getAttackDuration`; `ATTACK_FLYING_KICK` additionally needs `grounded`, which gravity guarantees.
5. **HURT flinch** — `HURT_HOLD = 0.35 s` (`:82`), then locomotion/air state reclaims it.
6. **LAND** — 0.12 s compression, then gait; if block is held the BLOCK branch takes it over the same frame.
7. **Countdown fields** — reload, gun cooldown, focus, special i-frames, deny cooldown, jump + coyote all decrement in `PlayerController.update`.
8. **Input buffers** (Phase 1B, `INPUT_BUFFER` 0.3 s) — punch/kick/dodge channels are *frozen* while dodge/slide own the controller (`:607-641` early returns) and are spent the frame the lock clears; a press during a roll lands on the exit frame (asserted in `smoke_combat.ts`). They are never zeroed without an action, and a fresh press always overwrites the decay.

Left alone on purpose (pre-existing, exit guaranteed, design choice): air-slide (the slide trigger has no `grounded` gate), dodge-cancel of attacks, jump buffer bleeding through recovery (~0.14 s by design), stick deadzones 0.15 / 0.22 (clamped, user-tunable).

**The one provable defect — fixed:** `isBlocking` could survive into a roll/slide. The grounded BLOCK branch returns early, so the only way into the dodge/slide trigger with the guard still up is being *launched* while holding block. Two consequences were provable: (a) `handleMovement` routed the roll through the block-decay branch instead of carrying momentum, and (b) releasing block mid-roll ran `setState('IDLE')` while `isDodging` was still true → 0.36 s of standing i-frames that swallow every input. Fix: the trigger clears the flag before spending stamina (`PlayerController.ts:619`, `A3:` comment) — the guard never travels with the move.

### Scope of this pass

Only `CombatDirector.ts`, `EnemyController.ts` and `PlayerController.ts` changed, plus the new `smoke_combat.ts`. This closes `GAME_AUDIT.md` §8 items **#1** (`comboMeter` never written), **#2** (`SPIN_SLASH`/`EXECUTIONER` unreachable) and **#4** (`staggerTakenScale` read nowhere). Release packaging docs: `RELEASE_BUILD.md` · player-facing history: `CHANGELOG.md`. No git commit.

## Phase 6 — G5–G8 (this change set)

**Verification:** `npx tsc --noEmit` green · `npm run build` green · `npx tsx smoke_combat.ts` **127 PASS / 0 FAIL** (`ALL GREEN`, exit 0 — A1–A4 unchanged, A5 + A6 new).

**Scope:** new `src/engine/Difficulty.ts` and `src/engine/TrainingRoom.ts`; `EnemyController`, `CombatDirector`, `PlayerController`, `GameLoop`; settings/profile persistence; `OptionsModal`, `StageSelectModal`, new `TrainingPanel`, `App`; `smoke_combat.ts`. Working code was added to, not replaced — every existing smoke check still passes untouched.

**Guardrails held:** PRO reproduces the shipped build exactly (all scales 1.0, `attackGap` 0.22, aim 22 px, decision drain 60 frames/second); no HP, damage, hit-stop, slow-mo or authored cooldown was touched by a tier; the SLIDE pose is never stolen by a round, whip or salvo (slide guard at the three SHOOT commit sites); the checklist cannot tick outside the drill and the drill writes no progression (kills, executions, damage tally, coins, wave clear, door); no new physics loop — reactions ride `EnemyController.update`, cover and retreat ride the existing `IDLE`/`APPROACH` case. No git commit.

**Honest caveats:**
- `smoke_combat.ts` drives `CombatDirector`/`EnemyController`/`PlayerController` headlessly but **not** `GameLoop`/`App` — the death floor, dummy spawn list, door/wave gates and panel UI are covered by code review only.
- This repo has no `@types/react` and `strict` is off, so **JSX props are not type-checked** (`StageSelectModal` `difficulty`/`onTraining`, `TrainingPanel` `onReset`/`onExit`, `OptionsModal` difficulty card). Those were hand-verified against each component's own prop declarations; `tsc` passing does not prove them.
- Difficulty is stored in `settings` and applied through `App`'s settings effect; a profile written by an older build sanitises to `'pro'`, so the tier is invisible until the player picks one.

## Phase 2+ backlog (explicitly not in this change set)

- A9 input buffering + dodge/block attack chains · C8 `EndlessLevelManager` + rewardMultiplier · B8 touch aim stick · F1 milestone/contract persistence + virtual pause button · style meter (design §14) · cinematic finisher system (design §15) · attack-input bug register in `GAME_AUDIT.md` §8 — **#1 / #2 / #4 closed in Phase 5** (see above), remaining entries stay open.
