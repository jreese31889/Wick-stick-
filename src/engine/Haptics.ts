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
 *
 * PHASE 4 E6 — gameplay wiring on top of the bus: `cueAt` (distance-scaled),
 * `takedown` (multi-pulse pattern) and `heartbeat` (low-HP warning). Every
 * entry point tests `enabled` first, so a disabled setting is one boolean.
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

/**
 * PHASE 4 E6 — one rumble pulse inside a pattern. `delayMs` is measured from
 * the moment the pattern is fired, so a sequence needs no timer of its own.
 */
interface HapticPulse {
  delayMs: number;
  durationMs: number;
  weak: number;
  strong: number;
}

/** Takedown / finisher: two quick build pulses, then the body-hit slam. */
const TAKEDOWN_PATTERN: HapticPulse[] = [
  { delayMs: 0, durationMs: 45, weak: 0.3, strong: 0.75 },
  { delayMs: 80, durationMs: 35, weak: 0.25, strong: 0.55 },
  { delayMs: 150, durationMs: 120, weak: 0.55, strong: 1 },
];

/** Low-HP warning: a lub-dub thump, soft then a touch harder. */
const HEARTBEAT_PATTERN: HapticPulse[] = [
  { delayMs: 0, durationMs: 30, weak: 0.3, strong: 0.4 },
  { delayMs: 150, durationMs: 45, weak: 0.35, strong: 0.6 },
];

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
   * PHASE 4 E6 — distance-scaled cue for anything with a position in the
   * world (a barrel cooking off down the room, a sniper's report). The
   * falloff shrinks both the length and the motor strength, and a source
   * beyond `maxDistance` is felt not at all. Same throttle as `cue`.
   */
  public cueAt(kind: HapticCue, distance: number, maxDistance = 1100): void {
    if (!this.enabled) return;
    const dist = distance > 0 ? distance : 0;
    if (dist >= maxDistance) return; // out of range — deliberately silent
    const falloff = Math.pow(1 - dist / maxDistance, 1.4);
    const now = performance.now();
    if (now - this.lastCueAt < CUE_THROTTLE_MS) return;
    this.lastCueAt = now;
    this.rumble(
      Math.max(12, Math.round(CUE_DURATION[kind] * (0.45 + 0.55 * falloff))),
      CUE_STRONG[kind] * 0.4 * falloff,
      CUE_STRONG[kind] * falloff
    );
  }

  /**
   * PHASE 4 E6 — takedown / finisher flourish: a three-pulse build-and-slam
   * pattern instead of a single buzz. Fires through the pattern path, so the
   * gamepad motors and the phone's vibration pattern line up.
   */
  public takedown(): void {
    if (!this.enabled) return;
    this.sequence(TAKEDOWN_PATTERN);
  }

  /**
   * PHASE 4 E6 — low-HP heartbeat. Called by GameLoop on its own cadence;
   * bypasses the combat throttle (it *is* the warning) but still respects
   * the settings toggle, so it costs a boolean test when haptics are off.
   */
  public heartbeat(): void {
    if (!this.enabled) return;
    this.sequence(HEARTBEAT_PATTERN);
  }

  /**
   * Fires a timed pulse pattern on whichever actuators exist: gamepad
   * dual-rumble first (Backbone / Kishi / Xbox — each pulse carries its own
   * start delay), then the phone's native vibration array.
   */
  private sequence(pulses: HapticPulse[]): void {
    if (!this.enabled || typeof navigator === 'undefined' || pulses.length === 0) return;
    this.lastCueAt = performance.now();

    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp || !gp.connected) continue;
        const actuator = (gp as unknown as { vibrationActuator?: { playEffect?: Function } })
          .vibrationActuator;
        if (actuator && typeof actuator.playEffect === 'function') {
          for (const pulse of pulses) {
            actuator
              .playEffect('dual-rumble', {
                startDelay: pulse.delayMs,
                duration: pulse.durationMs,
                weakMagnitude: Math.min(1, Math.max(0, pulse.weak)),
                strongMagnitude: Math.min(1, Math.max(0, pulse.strong)),
              })
              .catch(() => {});
          }
          return;
        }
      }
    }

    if (navigator.vibrate) {
      // Vibration API pattern: [buzz, pause, buzz, pause, …] from t=0.
      const pattern: number[] = [];
      let cursor = 0;
      for (const pulse of pulses) {
        if (pulse.delayMs > cursor) {
          pattern.push(pulse.delayMs - cursor);
          cursor = pulse.delayMs;
        }
        pattern.push(pulse.durationMs);
        cursor += pulse.durationMs;
      }
      try {
        navigator.vibrate(pattern);
      } catch {
        // Safe ignore — iOS Safari rejects non-whitelisted patterns.
      }
    }
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
