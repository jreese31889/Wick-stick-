# M14 Android Optimization Plan

This milestone focuses on optimizing the game for Android devices, specifically targeting mid-range hardware to ensure smooth performance and a good user experience.

## Optimization Tasks and Involved Files:

1.  **Render Loop Optimization (Renderer.ts)**
    *   **Task:** Profile and optimize the main render loop to reduce CPU and GPU overhead.
    *   **Sub-tasks:**
        *   Implement frustum culling to avoid rendering off-screen objects.
        *   Optimize shader programs for mobile GPU efficiency.
        *   Reduce overdraw where possible.
    *   **Files:** `src/Renderer.ts`

2.  **Draw Call Reduction**
    *   **Task:** Minimize the number of draw calls to improve rendering performance.
    *   **Sub-tasks:**
        *   Implement static batching for stationary geometry.
        *   Explore dynamic batching for frequently moving, small objects.
        *   Combine textures into atlases to reduce material changes.
    *   **Files:** `src/Renderer.ts`, potentially `src/GameObjects/*.ts` (for object definitions)

3.  **Object Pooling (Particle Systems, Projectiles)**
    *   **Task:** Implement object pooling for frequently instantiated and destroyed objects (e.g., particles, projectiles, enemies) to reduce garbage collection and instantiation overhead.
    *   **Sub-tasks:**
        *   Create generic object pool manager.
        *   Refactor particle system to use pooled particles.
        *   Refactor projectiles and minor enemies to use object pooling.
    *   **Files:** `src/ParticleSystem.ts`, `src/Projectiles/*.ts`, potentially `src/GameObjects/*.ts`

4.  **Particle System Caps**
    *   **Task:** Implement limits on the number of active particles to prevent performance spikes during intense visual effects.
    *   **Sub-tasks:**
        *   Add a global particle count limit.
        *   Implement culling or fading for particles exceeding the cap.
    *   **Files:** `src/ParticleSystem.ts`

5.  **Physics Optimization (Ragdoll.ts, TieRope.ts)**
    *   **Task:** Review and optimize physics calculations, especially for complex systems like ragdolls and ropes.
    *   **Sub-tasks:**
        *   Reduce simulation frequency for non-critical physics objects.
        *   Simplify collision geometries where possible.
        *   Implement sleep states for inactive rigid bodies.
    *   **Files:** `src/Physics/Ragdoll.ts`, `src/Physics/TieRope.ts`

6.  **AI Update Throttling**
    *   **Task:** Implement a mechanism to throttle AI updates for enemies not in immediate player view or interaction range to save CPU cycles.
    *   **Sub-tasks:**
        *   Implement distance-based AI update frequency reduction.
        *   Implement visibility-based AI update pausing/throttling.
    *   **Files:** `src/AI/*.ts` (e.g., `src/AI/EnemyAI.ts`), `src/GameLoop.ts` (for managing updates)

7.  **Resolution Scaling for Mid-range Android**
    *   **Task:** Implement dynamic resolution scaling or user-configurable resolution options to allow the game to run smoothly on devices with varying performance capabilities.
    *   **Sub-tasks:**
        *   Detect device performance tier (if possible) or provide graphic quality settings.
        *   Implement rendering at a lower resolution and scaling up to native display.
    *   **Files:** `src/Renderer.ts`, `src/Settings.ts` (for user options)

8.  **Memory Optimization**
    *   **Task:** Reduce overall memory footprint and identify memory leaks.
    *   **Sub-tasks:**
        *   Optimize asset loading (e.g., lazy loading, compressed textures).
        *   Review large data structures for efficient memory use.
        *   Implement memory profiling tools to identify and fix leaks.
    *   **Files:** Project-wide, but likely `src/AssetManager.ts`, `src/GameObjects/*.ts`

# M15 QA Checklist

This milestone outlines the comprehensive QA checklist to ensure the game's quality and stability across all features.

## General Areas:

### 1. Movement & Controls
*   Player character movement (walk, run, jump, dodge)
*   Responsiveness of touch controls
*   Consistency of movement across different terrains
*   Collision detection with environment and characters
*   Input responsiveness and latency

### 2. Combat System
*   Basic attacks and animations
*   Special abilities and their effects
*   Combo execution and damage calculation
*   Hit detection and feedback (visual, audio, haptic)
*   Enemy attack patterns and telegraphs
*   Player and enemy health/damage systems
*   Weapon switching and utility items

### 3. Physics & Interactions
*   Ragdoll physics on enemy defeat
*   Rope mechanics (if applicable) and interactions
*   Environmental destructibility/interactivity
*   Object interactions (picking up, throwing, pushing)
*   Consistency of physics behavior

### 4. Enemy AI
*   Pathfinding and navigation
*   Targeting and engagement logic
*   Reaction to player actions (aggro, disengage)
*   Group behavior and coordination
*   Variety in enemy types and combat roles
*   Idle, patrol, and combat states

### 5. Level Transitions & Progression
*   Seamless loading between levels/areas
*   Correct spawning at checkpoints/start points
*   Endless progression mechanics (if applicable)
*   Objective tracking and completion
*   Reward systems and loot drops

### 6. Camera System
*   Camera following player smoothly
*   Collision avoidance with environment
*   Zooming and framing during combat/exploration
*   Camera behavior in tight spaces

### 7. Performance & Stability
*   Frame rate stability on various Android devices (low, mid, high-end)
*   Memory usage and leak detection
*   Loading times
*   Heat generation and battery drain
*   Crash testing and stability under stress

### 8. Save/Load System
*   Saving game progress at various points
*   Loading saved games correctly
*   State preservation (player position, inventory, enemy status, quest progress)
*   Handling corrupted save files

### 9. User Interface (UI) & Menus
*   Main menu navigation
*   Pause menu functionality
*   Inventory management
*   Settings (graphics, audio, controls)
*   Tutorials and in-game hints
*   Readability and scaling on different screen sizes

### 10. Audio
*   Background music and ambiance
*   Sound effects for actions, combat, UI
*   Volume controls in settings
*   Audio consistency and quality

### 11. Edge Cases & Exploits
*   Boundary testing (clipping, falling out of world)
*   Negative testing (invalid inputs, unexpected sequences)
*   Exploiting game mechanics (e.g., infinite combos, out-of-bounds movement)
*   Error handling and recovery
