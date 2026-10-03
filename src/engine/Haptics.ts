/**
 * PHASE 1B E6 — gameplay haptics bus.
 *
 * One module-level service so every combat system can fire a cue without
 * holding a reference to InputManager (or allocating a callback per event).
 * Two actuators, in order: the connected gamepad's dual-rumble motors
 * (Backbone / Kishi / Xbox), then the phone's vibration motor.
 *
 * `settings.haptics` (default ON) flips `Haptics.enabled`; InputManager's
 * shipped `vibrate()` signature is untouched and routes through the same gate.
 */
export type HapticCue =
  | 'hit'
  | 'heavy'
  | 'parry'
  | 'shot'
  | 'hurt'
  | 'boom'
  | 'takedown'
  | 'tick';

/** Cue → rumble duration in ms. Kept short: haptics must never feel sticky. */
const CUE_DURATION: Record<HapticCue, number> = {
  hit: 18,
  heavy: 42,
  parry: 55,
  shot: 26,
  hurt: 70,
  boom: 130,
  takedown: 95,
  tick: 12,
};

/** Strong-motor weight per cue (weak motor rides at 40% of it). */
const CUE_STRONG: Record<HapticCue, number> = {
  hit: 0.35,
  heavy: 0.75,
  parry: 0.6,
  shot: 0.5,
  hurt: 0.9,
  boom: 1,
  takedown: 0.85,
  tick: 0.2,
};

/** Global minimum gap between cues — a flurry of hits reads as one buzz. */
const CUE_THROTTLE_MS = 35;

class HapticsService {
  /** Flipped from GameSettings via App's settings effect. */
  public enabled = true;

  private lastCueAt = 0;

  /** Fires a gameplay cue (no-op while disabled or inside the throttle gap). */
  public cue(kind: HapticCue): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastCueAt < CUE_THROTTLE_MS) return;
    this.lastCueAt = now;
    this.rumble(CUE_DURATION[kind], CUE_STRONG[kind] * 0.4, CUE_STRONG[kind]);
  }

  /**
   * Raw dual-rumble / phone-vibration write. Ignores the cue throttle but
   * still honours the settings toggle — this is what InputManager.vibrate
   * and the touch-button tick call directly.
   */
  public rumble(durationMs: number, weakMagnitude: number, strongMagnitude: number): void {
    if (!this.enabled || typeof navigator === 'undefined') return;

    // 1. Gamepad dual-rumble motors (Type-C controllers)
    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp || !gp.connected) continue;
        const actuator = (gp as unknown as { vibrationActuator?: { playEffect?: Function } })
          .vibrationActuator;
        if (actuator && typeof actuator.playEffect === 'function') {
          actuator
            .playEffect('dual-rumble', {
              startDelay: 0,
              duration: durationMs,
              weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
              strongMagnitude: Math.min(1, Math.max(0, strongMagnitude)),
            })
            .catch(() => {});
          return;
        }
      }
    }

    // 2. Phone hardware vibration
    if (navigator.vibrate) {
      try {
        navigator.vibrate(durationMs);
      } catch {
        // Safe ignore — iOS Safari rejects non-whitelisted patterns.
      }
    }
  }
}

export const Haptics = new HapticsService();
