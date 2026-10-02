# JOHN STICK — Game Design & Production Document
**Revision 2 — October 2, 2026**
*Updated from the original WICK STICK spec. This is now the single source of truth for the game's vision, current state, and production crew.*

## Revision 2 changelog
- **Renamed:** WICK STICK → **John Stick** everywhere (title, UI, package `com.reesedigital.johnstick`, repo `jreese31889/Wick-stick-`).
- **Tech stack corrected:** This is a **web game** (React 19 + Vite 6 + TypeScript, custom 2D canvas engine) **packaged for Android via Capacitor 8** — not a native Android project. All "Android" requirements in this doc mean the Capacitor-packaged APK running on Android hardware.
- **Added Section 24:** Current build status — everything actually shipped so far.
- **Crew restructured (Section 5):** Hermes (Gemini-powered) is now Lead Developer & Orchestrator, running 4 parallel workstreams via opencode workers. The 12 specialist roles are retained as the role catalog Hermes assigns from.
- **Controls updated (Section 17):** documents the current shipped scheme vs. the target scheme.
- **Blood decided:** stylized blood splatter is IN (shipped).
- **Milestones updated (Section 19):** marked with real completion status.
- **Reference video:** `/mnt/data/20797.mp4` is not present in the current workspace. The feel keywords (FAST, SMOOTH, CINEMATIC, RESPONSIVE, IMPACTFUL, STYLISH) are retained as the design compass.

---
# 1. PROJECT IDENTITY
**Official title: JOHN STICK**

A stylish stick-figure martial-arts action game featuring fluid combat, branching combos, cinematic takedowns, smooth physics, multiple enemies, procedural endless levels, and highly responsive Android touchscreen controls.

The game is inspired by the FEEL of modern cinematic assassin/action choreography, but the characters, world, animations, story, dialogue, music, visual assets, and gameplay implementation are ORIGINAL. Do not copy copyrighted movie scenes, dialogue, music, character models, or exact choreography.

**Platform:** Web build (React + Canvas) packaged as an installable Android APK via Capacitor. Primary target is Android phones in landscape orientation.

# 2. PLAYER CHARACTER
The player is an ORIGINAL stick-figure character.
- Black stick-figure body, fitted black suit, white dress shirt, black tie, black dress shoes
- Clean silhouette, simple stick-figure construction, professional appearance
- **Shipped:** the tie is simulated with Verlet rope/cloth physics (`src/engine/TieRope.ts`) — it swings, whips, and settles naturally during combat, dashes, and jumps
- The character must remain recognizable during: running, jumping, dodging, punching, kicking, blocking, grappling, throwing, falling, getting up, finishing enemies
- Do not create a realistic human model. The stick-figure aesthetic is core to the game's identity.

# 3. REFERENCE VIDEO
The original reference (`/mnt/data/20797.mp4`) is not available in the current workspace. The crew works from its extracted feel targets instead. Before major design decisions, revisit these qualities:
**FAST · SMOOTH · CINEMATIC · RESPONSIVE · IMPACTFUL · STYLISH**
Study prior art for: character proportions, animation timing, combat rhythm, hit reactions, camera behavior, impact effects, pacing. Never directly copy copyrighted material.

# 4. AI ORCHESTRATOR
**Hermes is the Lead Developer, Producer, System Architect, QA Director, and AI Agent Orchestrator** for John Stick. Hermes runs on Google Gemini and coordinates specialized worker agents (via the opencode CLI) when the environment supports multiple agents.

Hermes must:
- Analyze the existing project before assigning work
- Break the project into systems and assign clear workstreams
- Give each worker its owned files and forbid cross-workstream edits
- Review worker output, test integrations, identify bugs, resolve conflicts
- Maintain architecture, track progress, and keep this design doc current
- Ask Juwan for decisions when the answer would meaningfully change the game (small batches, 3–7 at a time)
- Never let agents blindly overwrite existing systems; every agent inspects code before modifying it

# 5. DEVELOPMENT TEAM
## Active crew (Phase 2, in progress as of Oct 2, 2026)
Hermes leads 4 parallel workstreams (plan: `BUILD_PLAN.md`):
- **WS1 — Visual Polish & Effects:** lighting/shadows, particles, ragdoll refinement, parallax, character customization
- **WS2 — Combat Depth & Enemy AI:** new enemy archetypes, block/dodge/counter AI, special moves, wave spawning, hazards
- **WS3 — Audio & Music:** Web Audio–synthesized soundtrack, dynamic combat music, SFX, volume controls
- **WS4 — Menus & Game Flow:** main menu, pause, game-over stats, options, stage select

## Specialist role catalog
Hermes assigns these roles to workers as needed. (Consolidated from the original 12; the responsibilities are unchanged.)
- **Lead Architect** — project structure, system interfaces, modularity, save architecture
- **Combat Director** — mechanics, combos, hit detection, knockback, counters, parries, grappling, throws, finishers
- **Animation + Physics Engineer** — rig, blending, procedural animation, momentum, ragdoll, collision; no stiff/snapping/clipping motion
- **Player Controller** — touch input, movement, dodge, block, responsiveness; input must feel instant
- **Enemy AI Director** — archetypes: Basic, Rusher, Heavy, Defender, Elite, Boss (multi-phase); never let all enemies attack at once
- **Endless Level Director** — infinite procedural encounters, dynamic difficulty scaling (never just multiply HP)
- **Level Designer** — modular arenas (rooftop, dojo, nightclub, hotel lobby, warehouse, alley…); readable combat spaces
- **UI/UX Designer** — landscape mobile controls, clean HUD
- **Camera + Cinematic Director** — follow, framing, hit-stop, shake, slow-mo finishers; never fight the player
- **Audio + VFX Director** — impacts, particles, screen effects; original/generated assets only
- **Android Optimization Engineer** — 60 FPS target on mid-range hardware; pooling, capped particles, resolution scaling
- **QA / Playtest Agent** — reproduce → explain → fix → re-test; never hide bugs

# 6. COMBAT SYSTEM
Combat is the HEART of John Stick. Branching, contextual combos — never just Attack → Attack → Attack.
**Shipped:** punch/kick attacks, combo counter with timing windows, escalating damage, HUD combo meter.
**Target chains** (design goals for WS2): ATTACK→ATTACK→KICK, DODGE→ATTACK, BLOCK→ATTACK, PERFECT PARRY→COUNTER, GRAB→THROW, LAUNCH→AIR→AIR→KICK, GROUND→FINISHER. Input buffering throughout — the system forgives imperfect timing.

# 7. COMBO SYSTEM
Light/heavy attacks, kicks, elbows, knees, sweeps, launchers, counters, throws, ground attacks, finishers, air attacks. The system reads: current animation, player movement, enemy position/state, attack direction, previous attack, input timing. **Shipped:** chained punch/kick combos with timing window, escalating damage, finisher on long chains, live combo HUD.

# 8. MULTI-ENEMY COMBAT
Fights must feel like continuous cinematic brawls: dodge A → counter A → turn to B → block C → counter C. Enemies must not stun-lock the player. **Shipped:** multiple simultaneous enemies. **In progress (WS2):** intelligent attack staggering so enemies create openings instead of dogpiling.

# 9. PHYSICS
Smooth, weighted, believable: acceleration, momentum, knockback, falling, landing, stagger, recovery, directional impact.
**Shipped:** ragdoll death physics (`src/engine/Ragdoll.ts`) — gravity, joint constraints, ground collision, impact impulses, settle + fade. Tie cloth physics (`src/engine/TieRope.ts`). **In progress (WS1):** wall bounces, tighter joint constraints.

# 10. ENDLESS LEVEL SYSTEM
`EndlessLevelManager` tracks: currentLevel, enemyCount, health/damage/speed/aggression multipliers, eliteChance, bossChance, spawnPattern, arenaType, rewardMultiplier. Loop: FIGHT → clear arena → LEVEL COMPLETE → next encounter → forever. No maximum level. **Shipped:** procedural endless levels with AI-generated arena backdrops (rooftop, dojo, nightclub).

# 11. PROCEDURAL ENCOUNTERS
Rule/weight–generated encounters (Lv1: 1 Basic → Lv5: 2 Basic + 1 Heavy → Lv10: 3 Basic + 1 Elite → Lv25: Boss → Lv50+: advanced mixes). Complexity scales; never just inflate HP. **In progress (WS2):** wave system, new archetypes.

# 12. LEVEL VARIETY
Randomize composition, spawn positions, aggression, arena, elite/boss probability. Never spawn on top of the player; always allow reaction time.

# 13. PLAYER DEATH
On death: stop gameplay, show RUN OVER — LEVEL REACHED / ENEMIES DEFEATED / BEST COMBO / SCORE — with RESTART RUN. **In progress (WS4):** full game-over screen with stats.

# 14. STYLE METER (future)
Reward combo variety, parries, counters, dodges, throws, multi-enemy hits, finishers, air combos. Repeating one move scores less. Not yet implemented — design it before building.

# 15. CINEMATIC FINISHERS (future)
On vulnerable enemies: brief slow-mo, camera push-in, special animation, impact effects, snap back to gameplay. Keep them short; never stall the fight.

# 16. CAMERA
Follow smoothly, anticipate movement, keep nearby enemies framed, slight zoom on big moments, light shake on heavy impacts. **Shipped:** smooth follow camera. **Planned:** hit-stop, finisher framing (WS1/WS2).

# 17. MOBILE CONTROLS
Landscape-first. **Shipped (current):** left-side movement controls, right-side action buttons including separate labeled **PUNCH** and **KICK** buttons, redesigned thumb-friendly layout (`VirtualControls.tsx`). **Target:** virtual joystick (left); Attack / Heavy / Dodge / Block / Grab (right). Do not require one button per combo — keep combat context-sensitive and forgiving via input buffering.

# 18. SAVE SYSTEM
**Target:** HighestLevel, HighestScore, HighestCombo, TotalEnemiesDefeated, unlocks. **Prototype scope:** HighestLevel + HighestScore only. Not yet implemented — WS4.

# 19. DEVELOPMENT MILESTONES (status: Oct 2, 2026)
- M1 Project inspection & architecture — ✅ DONE
- M2 Player stick figure — ✅ DONE
- M3 Movement — ✅ DONE
- M4 One enemy — ✅ DONE
- M5 Basic combat — ✅ DONE
- M6 Combos — ✅ DONE (chained punch/kick, timing window, HUD meter)
- M7 Physics & hit reactions — ✅ DONE (ragdoll, tie cloth, knockback)
- M8 Multiple enemies — ✅ DONE
- M9 Endless level generation — ✅ DONE (procedural + AI arenas)
- M10 Enemy archetypes — 🔄 IN PROGRESS (WS2)
- M11 Cinematic camera — 🔄 PARTIAL (follow ✅, hit-stop/finishers pending)
- M12 VFX/audio — 🔄 IN PROGRESS (blood ✅, WS1 effects + WS3 audio)
- M13 Progression/menus — 🔄 IN PROGRESS (WS4)
- M14 Android optimization — ⬜ TODO (APK exists; perf pass pending)
- M15 QA — 🔄 ONGOING
- M16 Final polish — ⬜ TODO
After EVERY milestone: BUILD → TEST → FIX → TEST AGAIN → REVIEW. Never stack untested systems.

# 20. ASK ME QUESTIONS (standing workflow)
Hermes/J.I.N must ask Juwan about subjective decisions in small batches (3–7 at a time) and wait for answers before implementing. Never ask what can be answered by inspecting the project. Current open questions include: finisher behavior, stamina/health regen, special meter design, boss frequency, weapons (yes/no), style meter rules, save behavior, music style, difficulty curve.

# 21. DECISION HIERARCHY
1. Juwan's explicit instructions 2. His answers to design questions 3. Reference feel (FAST/SMOOTH/CINEMATIC…) 4. Gameplay quality 5. Android performance 6. Code maintainability. On conflict: explain, offer options, ask — never silently ignore.

# 22. AGENT COORDINATION
Hermes maintains: CURRENT MILESTONE, COMPLETED/IN-PROGRESS SYSTEMS, NEXT TASKS, KNOWN BUGS, BLOCKED TASKS, DESIGN DECISIONS, PLAYER FEEDBACK, PERFORMANCE ISSUES. Plans live in `BUILD_PLAN.md`. Workers get owned-file lists and must inspect before modifying.

# 23. CODE QUALITY
Modular systems (Player, Combat, Animation, Physics, AI, Levels, Camera, UI, Audio, VFX, Save, Progression separate). Events/interfaces over duplication. Tunable combat parameters — no magic numbers buried in logic.

# 24. CURRENT BUILD STATUS (shipped in working tree + APK, Oct 2, 2026)
- Engine: React 19 + Vite 6 + TS, custom 2D canvas engine, ~3,000+ lines
- Characters: suited stick fighter with cloth-physics tie; ragdoll deaths
- Combat: punch/kick buttons, branching combos, timing windows, combo HUD, escalating damage, finishers
- Effects: blood splatter particles + fading ground splats, hit particles
- Arenas: AI-generated backgrounds (rooftop, dojo, nightclub) with parallax
- Mobile: landscape orientation lock + rotate hint overlay, thumb-friendly touch layout
- Levels: procedural endless encounters with scaling difficulty
- Sound: basic SFX (full audio pass in WS3)
- Package: debug APK (`JohnStick.apk`, `com.reesedigital.johnstick`), installable with "unknown apps" allowed

# 25. VIBE-CODING WORKFLOW
Work conversationally with Juwan. After each meaningful change report: WHAT was built, WHY, WHAT changed, HOW to test it, WHAT is needed from him. On failure: WHAT failed, WHY, WHAT is changing, HOW it will be tested. Never pretend untested work works.

# 26. CORE PHILOSOPHY
FAST · SMOOTH · RESPONSIVE · CINEMATIC · SKILL-BASED · REPLAYABLE · ORIGINAL · MOBILE-FRIENDLY.
Simple graphics are fine — the COMBAT must be excellent. A simple stick figure with incredible animation beats a detailed character with terrible combat. Priority order: responsiveness, combat, animation, physics, enemy AI, level variety, cinematic presentation, performance, progression, visual polish.
