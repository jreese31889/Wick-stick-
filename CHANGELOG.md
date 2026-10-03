# John Stick — Changelog

Player-facing history, newest first. Build numbering: `versionCode` `10` = **v10** (`versionName 10.0.0`); see `RELEASE_BUILD.md` §7. Versions v1–v5 predate the git record and are grouped from the milestone notes (`BUILD_PLAN.md`, `M15_QA_CHECKLIST.md`, `JOHN_STICK_DESIGN.md` §24), so their scope is approximate.

---

## Unreleased — next build (v11)

### Added
- **Joystick jump.** Flicking the movement stick UP now jumps, with the same 140 ms buffer and variable jump height as the JUMP button — release early for a short hop, hold it for the full arc. Keyboard and pad JUMP keep working as alternates.
- **Joystick crouch.** Hold the movement stick DOWN to drop into a crouch: the torso folds, the hurtbox shrinks, and you shuffle at half pace. Crouching ducks under jabs, hooks, slams and overheads — but a floor-level sweep still trips you, so it stays a read rather than a free pass.
- **Crouch attack string.** CROUCH + PUNCH is a fast low poke; press PUNCH again inside the chain window and it becomes a rising uppercut that launches an opponent for a juggle. CROUCH + KICK throws the leg sweep on demand.
- **Air attack string.** PUNCH in the air is a quick poke that keeps your arc; KICK in the air is an overhead slam that detonates on landing with a shockwave and hit-stop, or a flying kick if you are carrying real forward speed. Landing from the slam commits you to a short recovery — the guard and the dodge stay open throughout.
- **Enemy jump-ins.** Rushers and acrobats can now coil and leap at you with an overhead dive. It telegraphs as a visible crouch, it whiffs over a crouching fighter, and it leaves them open on the way down — paired with their existing low sweep, the enemy kit now has a proper high/low triangle.

### Fixed
- **Combo specials are usable again.** SPIN_SLASH (5-hit chain) and EXECUTIONER (15-hit chain) could never be triggered: the chain counter was never carried over to the special meter, the strike never registered, and a cancelled special never released its charge. All three are fixed, so the moves connect, spend exactly their cost, and refund nothing on a whiff.
- **Enemy stagger now respects enemy type.** Heavy enemies build stagger 2× slower and acrobats 1.2× slower per hit, as designed — previously every enemy staggered at the same rate regardless of archetype.
- **You can no longer be left standing while invulnerable.** Being launched while holding block could carry the guard into a dodge roll; releasing block mid-roll then left 0.36 s of invisible i-frames during which nothing you pressed did anything. The guard no longer travels with a roll or slide.

---

## v10 — Living soundtrack, world audio you can locate, haptics you can feel

### Added
- **Procedural music system.** A 96 BPM adaptive score with five layered stems: a calm menu theme, an escalating combat score that swaps patterns on bar boundaries, intensity tiers that react to how hot the fight is, and dedicated cues for pause, victory and death.
- **Spatialized sound effects.** Every punch, shell casing, glass break, coin, prop and gunshot now comes from its world position with distance falloff and stereo placement — a hit off-screen reads as off-screen.
- **Gameplay haptics.** Rumble on finishers, grapple slams, executions and barrel blasts, distance-scaled so a far explosion is a tap and a near one is a jolt, plus a low-health heartbeat pattern. Toggle in Options.

---

## v9 — Play it your way

### Added
- **Controller support.** Type-C and Bluetooth gamepads: sticks, triggers and face buttons mapped, connection status badge in the HUD.
- **Touch layout editor.** Drag any control anywhere on screen, switch between the default and mirrored southpaw presets, undo the session, save to the profile.
- **Swipe gestures** on the look area for attacks and dodges.
- **Aim assist** setting.
- **Android back button** now pauses / steps back through menus instead of killing the app.

---

## v8 — Progress that follows you

### Added
- **Persistent profile.** Levels and XP, lifetime stats, and everything you have earned survives restarts.
- **Unlocks.** Loadouts, moves and cosmetics unlock as you play, with unlock toasts in-run.
- **Upgrades.** Spend earned currency on permanent upgrade tiers.
- **Skins and weapon tints.** Palette options for the fighter and the arsenal.
- **Achievements** with live progress tracking.
- **Style ranks (D → SS).** Variety pays: landing different moves in a row scores far more than spamming one, and the rank decays when the fight goes quiet.

---

## v7 — The advanced combat layer

### Added
- **Precision aim** — right-stick / on-screen laser aiming with a locked reticle.
- **Hit zones.** The head band of every rig is a headshot.
- **Disarms.** A well-timed strike knocks a gun out of an enemy's hands.
- **Ricochets.** Rounds can bounce once off walls into a second target.
- **Group AI.** Attack tokens, flanking slots and repositioning — enemies pressure together instead of queueing politely.
- **Takedown camera** on cinematic finishes, with slow-motion and kill-cam ragdolls.
- **Adaptive difficulty** that reads your performance and adjusts the squad's aggression.

---

## v6 — Bigger arsenal, meaner squad

### Added
- **Full gun arsenal.** SMG, shotgun and rifle alongside the pistol, with reserve ammo, tactical reloads and mid-fight weapon switching.
- **Elite enemies.** Promoted variants in violet and gold with boosted health, new behaviour and a star tag over their head.
- **Multi-phase boss.** New attack patterns at 66% and 33% health, phase banners and a death cinematic.
- **Destructible props.** Glass displays, champagne tables and weapon racks break, drop loot and become cover — bullets damage them too.
- **Explosive barrels** that chain-detonate and hurt everyone in the radius.
- **Surface-aware impact FX.** Wood splinters, glass shards and per-surface spark colours, plus a distinct report per gun and a real boom for barrels.

---

## v5 — Android performance pass

### Added
- **Quality tiers** with resolution and device-pixel-ratio caps, frame-rate readout in Options.
- **Pooled everything** — particles, ragdolls, shells, tracers, dropped items — with hard caps so long runs do not grow memory.
- Target: sustained 60 FPS on mid-range Android in 4-enemy fights with heavy FX.

---

## v4 — John Stick

### Changed
- Renamed from WICK STICK to **John Stick** across the game, menus and package (`com.reesedigital.johnstick`).
- **Combat, animation, audio and UI overhaul:** reworked hit feel, timing windows and combo timing, refreshed HUD and menus.

---

## v3 — First installable build

### Added
- **Endless procedural encounters** with difficulty that scales wave by wave.
- **Combo HUD, escalating damage and finishers** — chain hits to grow the multiplier, cash it out on a finisher.
- **Debug APK** you can sideload on a phone ("unknown apps" allowed).
- **QA sweep:** full pass over movement, combos, gun-fu, defense, weapons, AI, levels, menus, saves, audio and performance, with a checklist for every feature.

---

## v2 — Depth and polish wave

### Added
- Visual polish: impact FX, blood particles, parallax room backdrops.
- Enemy AI pass: blocking, dodging, counter-ripostes, stagger and guard breaks.
- Audio pass and music bed.
- Menus and game flow: title, pause, game over, stage select, settings with saved progress.

---

## v1 — First playable

### Added
- Core game: 2D canvas engine, stick fighter with cloth-physics tie, punch/kick combo strings with timing windows, ragdoll deaths, first arenas, landscape touch controls (floating joystick + labeled buttons), Options (SFX volume, FPS counter).
