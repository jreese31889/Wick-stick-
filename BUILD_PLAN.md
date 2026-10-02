# WICK STICK Game Build Plan - Phase 2

This plan outlines the next development phase for the "John Stick" game, broken into parallel workstreams to enable efficient multi-agent development.

## Workstream 1: Visual Polish & Effects
**Goal:** Enhance the visual fidelity and impact of the game with improved graphics, animations, and particle effects.
**Owned Files:**
- `src/engine/Renderer.ts` (for rendering improvements)
- `src/engine/AnimationController.ts` (for animation refinements)
- `src/engine/Ragdoll.ts` (for improved death animations/effects)
- `src/components/GameCanvas.tsx` (for canvas-level visual effects)
- `src/index.css` (for global styling or specific visual components)
- `public/assets/ai/` (for adding new AI-generated visual assets)
**Concrete Tasks:**
- Implement dynamic lighting and shadows on the stick figures and environment.
- Add more varied and impactful hit/block particle effects beyond blood splatter.
- Improve ragdoll physics with more realistic joint constraints and environmental interactions (e.g., bouncing off walls).
- Develop character customization options (e.g., different stick figure colors, simple accessories).
- Enhance background parallax scrolling for depth.

## Workstream 2: Combat Depth & Enemy AI
**Goal:** Expand combat mechanics, introduce new enemy types, and improve existing AI for more engaging gameplay.
**Owned Files:**
- `src/engine/CombatDirector.ts` (for managing combat flow and encounters)
- `src/engine/EnemyController.ts` (for new enemy AI behaviors)
- `src/engine/EnemyRig.ts` (for defining new enemy types and their properties)
- `src/engine/PlayerController.ts` (for new player combat abilities)
- `src/engine/InputManager.ts` (for new input mappings for player abilities)
- `src/types/game.ts` (for defining new combat states, enemy types, etc.)
**Concrete Tasks:**
- Design and implement 2-3 new enemy archetypes with distinct attack patterns and weaknesses.
- Implement enemy blocking, dodging, and counter-attack behaviors.
- Add player special moves or "super" attacks that consume the HUD combo meter.
- Develop a basic enemy spawning system and wave management.
- Introduce environmental hazards that affect combat.

## Workstream 3: Audio & Music
**Goal:** Create an immersive audio experience with a dynamic soundtrack and impactful sound effects.
**Owned Files:**
- `src/engine/SoundFX.ts` (for managing sound effects)
- `src/components/GameCanvas.tsx` (for integrating background music and ambient sounds)
- `public/assets/audio/` (new directory for audio files)
**Concrete Tasks:**
- Compose/source a main menu theme and 2-3 in-game combat tracks.
- Implement dynamic music changes based on combat intensity or player health.
- Add distinct sound effects for various player attacks, enemy hits, blocks, and special moves.
- Implement ambient environmental sounds for each AI-generated background.
- Develop a sound mixing system (volume controls for music/SFX).

## Workstream 4: Menus & Game Flow
**Goal:** Develop a complete and intuitive user interface for menus, game progression, and overall game feel.
**Owned Files:**
- `src/App.tsx` (for overall game state and routing between screens)
- `src/main.tsx` (main entry point for rendering UI)
- `src/components/` (for new menu components like MainMenu, PauseMenu, GameOver, Options)
- `src/hooks/useLandscapeLock.ts` (potentially for menu-specific orientation handling)
- `src/index.css` (for styling UI elements)
**Concrete Tasks:**
- Design and implement a main menu with Play, Options, How to Play, and Exit buttons.
- Create a pause menu with Resume, Restart, Options, and Main Menu options.
- Develop a game over/win screen that displays performance metrics.
- Implement an options menu for sound volume, control remapping, and graphic settings.
- Integrate a simple level progression system or stage selection.
