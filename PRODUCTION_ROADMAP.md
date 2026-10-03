# PRODUCTION_ROADMAP.md — John Stick feature status map

**Baseline:** git `5f0e644` (M14 Android optimization punch-list), working tree clean, `npm run lint` + `npm run build` green.
**Scope:** every production feature the owner has asked for, mapped **DONE / PARTIAL / NEW** against the file that actually implements it (or the file that must).
**Method:** status is decided by reading the code, not the design doc — a feature is DONE only when the shipped path is reachable in a real run.

Legend: ✅ DONE (ships today) · 🟡 PARTIAL (works, but a documented half of the contract is missing) · ⛔ NEW (does not exist in `src/`).

Summary: **41 features — 29 DONE · 4 PARTIAL · 8 NEW.**

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
| E3 | **Surface-aware impact FX (wood / glass / barrel / wall colour + debris)** | ⛔ NEW | Impacts are hard-coded per hit (`CombatDirector.ts:507/:515/:527-543/:556`); no prop/surface context reaches the FX path |
| E4 | **Distinct weapon audio: per-gun reports + explosion boom** | ⛔ NEW | Every gun shares `SoundFX.playGunshot` (`SoundFX.ts:193-196`); no explosion sound. Existing signatures must not change — land as new methods `playGunReport(kind)` / `playExplosion()` |
| E5 | **Music system: menu + dynamic combat score** | ✅ | `src/engine/Music.ts` — procedural 96 BPM score (5 layer buses, bar-locked pattern swaps, menu/run/paused/victory/death scenes, 4 run-intensity tiers fed from `App.tsx`), `settings.musicVolume` + `OptionsModal` slider, SFX ducking from `SoundFX.playSample`/`playWorld` |
| E6 | Haptics / controller rumble | ✅ | `src/engine/Haptics.ts` (`cue`, distance-scaled `cueAt`, `takedown` pattern, `heartbeat` pattern) driven from `CombatDirector` (finisher, grapple slam, execution, barrel slam) + low-HP heartbeat `GameLoop.updateHeartbeat` |

## F. UI, flow, platform (5)

| # | Feature | Status | Implementing file / symbol |
|---|---------|--------|----------------------------|
| F1 | Title / pause / game-over + victory screens, stage select, HUD, settings menus | ✅ | `src/App.tsx`, `src/components/PauseMenu.tsx`, `HowToPlayModal.tsx`, HUD `App.tsx:578-762`, boss/combo canvas HUD `Renderer.renderBossHUD` (`:1291`) |
| F2 | Save system: cleared stages, highest wave, best score/combo/kills/time, victories | ✅ | `settings.ts:46-138` (`john-stick.progress.v1`, sanitized on load), auto-save `App.tsx` |
| F3 | Landscape mobile controls: floating joystick + labeled PUNCH/KICK/GRAB + 10 touch buttons | ✅ | `VirtualControls.tsx` (buttons `:188-343`, joystick `:148-177`), `InputManager.setVirtualButton` (`:277`) |
| F4 | Controller (Type-C/Bluetooth) + keyboard bindings | ✅ | `InputManager.handleKeyDown` (`:141`), pad poll (`:322-376`), status badge `App.tsx:654-667` |
| F5 | 60 FPS Android target: quality tiers, DPR caps, pooling, capped FX, offline APK | ✅ | `M14_PUNCHLIST.md` (executed at `5f0e644`), `ObjectPool.ts`, FX caps `CombatDirector.ts:120-128` / `EnvironmentManager.ts:92-97`, `settings.applyQuality`, Capacitor package `../wick-stick-game-apk` |

---

## Phase 1 implementation targets (this change set)

| Pillar | Features | Where |
|--------|----------|-------|
| **Arsenal** | B6, D5, HUD reserve/ammo readout | `src/engine/Weapons.ts` (new), `PlayerController`, `CombatDirector`, `EnvironmentManager`, `types/game.ts`, `InputManager`, `VirtualControls`, `App.tsx` |
| **Enemy escalation** | C5, C6, C7 (speed leg) | `EnemyController`, `EnemyRig`, `CombatDirector`, `Renderer.renderBossHUD`, `GameLoop` |
| **Destructible props** | D2 (bullet damage + cover), D3 (barrels + chain) | `types/game.ts`, `EnvironmentManager`, `CombatDirector`, `Renderer.renderDestructibles`, `GameLoop` |
| **VFX feel** | E3, E4 | `CombatDirector`, `SoundFX`, `Renderer` |

**Guardrails carried into Phase 1:** no change to existing damage numbers, cooldowns, hit-stop frames or gun-fu trigger order; gun-fu moves keep byte-identical triggers; `SoundFX` public signatures unchanged (new methods only); quality tiers/DPR caps untouched; no new per-frame allocations outside pooled records; no git commit.

## Phase 2+ backlog (explicitly not in this change set)

- A9 input buffering + dodge/block attack chains · C8 `EndlessLevelManager` + rewardMultiplier · B8 touch aim stick · F1 milestone/contract persistence + virtual pause button · style meter (design §14) · cinematic finisher system (design §15) · attack-input bug register in `GAME_AUDIT.md` §8 (comboMeter never written ⇒ `SPIN_SLASH`/`EXECUTIONER` unreachable).
