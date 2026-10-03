/**
 * PHASE 2 — progress event bus.
 *
 * Gameplay code (CombatDirector, PlayerController, GameLoop) emits domain
 * events from the exact frames where something meaningful happened; App.tsx
 * subscribes once and turns them into XP, lifetime stats, achievement checks
 * and UI toasts. Keeping the fan-out here means no engine file ever imports
 * React, React never inspects enemy internals, and the events are
 * testable in isolation.
 *
 * All listeners are fire-and-forget: an exception inside one listener is
 * swallowed and removed so a broken toast can never stall the game loop.
 */

export interface ProgressEvent {
  type: string;
  /** Free-form payload — every field is optional and event-specific. */
  data?: Record<string, unknown>;
}

export type ProgressListener = (event: ProgressEvent) => void;

const listeners = new Set<ProgressListener>();

/** Subscribes to progress events. Returns an unsubscribe function. */
export function onProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publishes an event to every listener. Never throws. */
export function emitProgress(type: string, data?: Record<string, unknown>): void {
  const event: ProgressEvent = { type, data };
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch {
      listeners.delete(listener);
    }
  }
}

/** Drops every listener (used by tests / hot reload safety). */
export function clearProgressListeners(): void {
  listeners.clear();
}

/** Event type constants — keeps string literals honest across files. */
export const PROGRESS_EVENTS = {
  /** An enemy died (any source). data: { enemyType, env, boss, heavy } */
  KILL: 'kill',
  /** Player executed a downed enemy (gun-fu crit / judo slam / grip). data: { move } */
  EXECUTION: 'execution',
  /** Player knocked a gun loose. data: {} */
  DISARM: 'disarm',
  /** Player killed with a ricochet hit. data: {} */
  RICOCHET_KILL: 'ricochetKill',
  /** Player took damage (any source). data: { amount } */
  PLAYER_DAMAGED: 'playerDamaged',
  /** Wave cleared. data: { wave, styleRank, maxCombo, damageTaken } */
  WAVE_CLEAR: 'waveClear',
} as const;
