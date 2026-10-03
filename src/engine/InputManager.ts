import { InputState } from '../types/game';
import { Haptics } from './Haptics';

export interface GamepadStatus {
  connected: boolean;
  name: string;
}

/** Virtual (touch / gesture) button channels — also used by keyboard + pad. */
export type VirtualButton =
  | 'jump'
  | 'dodge'
  | 'attack'
  | 'heavy'
  | 'block'
  | 'grab'
  | 'shoot'
  | 'reload'
  | 'interact'
  | 'focus'
  | 'special'
  | 'swap';

/**
 * PHASE 3 1 — one shared action channel table. Touch, keyboard and gamepad
 * all write into the same 12 slots; `poll()` merges them with a single OR and
 * derives every "just pressed" edge from the same merged history, so there is
 * exactly one place where an action can become true.
 */
const ACT_JUMP = 0;
const ACT_DODGE = 1;
const ACT_ATTACK = 2;
const ACT_HEAVY = 3;
const ACT_BLOCK = 4;
const ACT_GRAB = 5;
const ACT_SHOOT = 6;
const ACT_RELOAD = 7;
const ACT_INTERACT = 8;
const ACT_FOCUS = 9;
const ACT_SPECIAL = 10;
const ACT_SWAP = 11;
const ACTION_COUNT = 12;

const BUTTON_INDEX: Record<VirtualButton, number> = {
  jump: ACT_JUMP,
  dodge: ACT_DODGE,
  attack: ACT_ATTACK,
  heavy: ACT_HEAVY,
  block: ACT_BLOCK,
  grab: ACT_GRAB,
  shoot: ACT_SHOOT,
  reload: ACT_RELOAD,
  interact: ACT_INTERACT,
  focus: ACT_FOCUS,
  special: ACT_SPECIAL,
  swap: ACT_SWAP,
};

/**
 * PHASE 3 1 — per-frame hints the engine pushes down before `poll()` so the
 * pad's context button and the ADS hold can resolve against real game state
 * without InputManager reaching back into the simulation.
 */
export interface InputHint {
  /** Player facing — ADS without stick deflection aims along it. */
  facingRight: boolean;
  /** Open exit door within reach → the context button means "enter". */
  nearDoor: boolean;
  /** A tactical reload is actually possible right now. */
  canReload: boolean;
}

/** Radial stick transform result (reused across frames — no allocation). */
interface StickSample {
  x: number;
  y: number;
  active: boolean;
}

/**
 * PHASE 3 1 — module-level gamepad readers. Free functions (not closures
 * built inside poll()) so the 60 Hz input path allocates nothing.
 */
function padPressed(buttons: readonly GamepadButton[], index: number): boolean {
  const btn = buttons[index];
  return Boolean(btn && (btn.pressed || btn.value > 0.45));
}

function padValue(buttons: readonly GamepadButton[], index: number): number {
  const btn = buttons[index];
  if (!btn) return 0;
  return btn.value > 0 ? btn.value : btn.pressed ? 1 : 0;
}

export class InputManager {
  private state: InputState = {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    aimActive: false,
    jump: false,
    jumpJustPressed: false,
    dodge: false,
    dodgeJustPressed: false,
    attack: false,
    attackJustPressed: false,
    heavyAttack: false,
    heavyAttackJustPressed: false,
    block: false,
    grab: false,
    grabJustPressed: false,
    shoot: false,
    shootJustPressed: false,
    reload: false,
    reloadJustPressed: false,
    interact: false,
    interactJustPressed: false,
    focus: false,
    focusJustPressed: false,
    special: false,
    specialJustPressed: false,
    swap: false,
    swapJustPressed: false,
  };

  // --- Touch (virtual) channel ---------------------------------------
  private virtX = 0;
  private virtY = 0;
  private virtAimX = 0;
  private virtAimY = 0;
  private virtAimActive = false;
  private virt = new Uint8Array(ACTION_COUNT);

  // --- Keyboard channel (desktop fallback) ----------------------------
  private kb = new Uint8Array(ACTION_COUNT);
  private kbMoveX = 0;
  private kbMoveY = 0;

  // --- Gamepad channel ------------------------------------------------
  private pad = new Uint8Array(ACTION_COUNT);
  /** LT held → precision-aim lock (PHASE 3 1: ADS / precision). */
  private padAdsHeld = false;
  private prevPadStart = false;

  // --- Merge history (edges are derived from this, one source of truth) --
  private prevMerged = new Uint8Array(ACTION_COUNT);

  // Reusable samples so poll() never allocates.
  private readonly moveStick: StickSample = { x: 0, y: 0, active: false };
  private readonly aimStick: StickSample = { x: 0, y: 0, active: false };

  // PHASE 3: pad tuning (fractions + gains) pushed from GameSettings.
  private moveDeadzone = 0.15;
  private aimDeadzone = 0.22;
  private moveGain = 1;
  private aimGain = 1;

  /** Engine-provided context for ADS aim direction and the pad X button. */
  public readonly hint: InputHint = { facingRight: true, nearDoor: false, canReload: false };

  // PHASE 3: touch-button pulses (swipe gestures) — released after a frame
  // budget so a gesture reads as exactly one press through the edge detector.
  // A fixed-size table (not a Map) keeps poll() allocation-free at 60 Hz.
  private readonly pulseUntilAt = new Float64Array(ACTION_COUNT);
  /** Gates the pulse expiry scan so idle frames do zero work. */
  private pulsesActive = false;

  public gamepadStatus: GamepadStatus = { connected: false, name: '' };
  /** Raw id of the pad seen last frame — gates name formatting (allocation). */
  private lastPadId = '';

  // Callbacks
  public onPauseRequested?: () => void;
  public onGamepadChange?: (status: GamepadStatus) => void;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', this.handleGamepadConnected);
      window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('keyup', this.handleKeyUp);
      window.addEventListener('blur', this.releaseKeyboard);
    }
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('blur', this.releaseKeyboard);
    }
  }

  /** PHASE 3 1: deadzones (%) and sensitivities (%) from the Options menu. */
  public applyTuning(tuning: {
    moveDeadzone: number;
    aimDeadzone: number;
    moveSensitivity: number;
    aimSensitivity: number;
  }): void {
    this.moveDeadzone = Math.min(0.4, Math.max(0, tuning.moveDeadzone / 100));
    this.aimDeadzone = Math.min(0.4, Math.max(0, tuning.aimDeadzone / 100));
    this.moveGain = Math.min(2, Math.max(0.5, tuning.moveSensitivity / 100));
    this.aimGain = Math.min(2, Math.max(0.5, tuning.aimSensitivity / 100));
  }

  private handleGamepadConnected = (e: GamepadEvent): void => {
    const cleanName = this.formatGamepadName(e.gamepad.id);
    this.lastPadId = e.gamepad.id;
    if (this.gamepadStatus.connected && this.gamepadStatus.name === cleanName) return;
    this.gamepadStatus = { connected: true, name: cleanName };
    if (this.onGamepadChange) this.onGamepadChange(this.gamepadStatus);
  };

  private handleGamepadDisconnected = (): void => {
    this.checkConnectedGamepad();
  };

  /**
   * Desktop keyboard fallback. Mobile remains touch-first; gamepads use the
   * PHASE 3 standard layout. Q (or PUNCH+KICK together) fires the combo special.
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    switch (e.code) {
      case 'Space': this.kb[ACT_JUMP] = 1; break;
      case 'KeyW': case 'ArrowUp': this.kbMoveY = -1; break;
      case 'KeyS': case 'ArrowDown': this.kbMoveY = 1; break;
      case 'KeyA': case 'ArrowLeft': this.kbMoveX = -1; break;
      case 'KeyD': case 'ArrowRight': this.kbMoveX = 1; break;
      case 'ShiftLeft': case 'ShiftRight': this.kb[ACT_DODGE] = 1; break;
      case 'KeyJ': this.kb[ACT_ATTACK] = 1; break;
      case 'KeyK': this.kb[ACT_HEAVY] = 1; break;
      case 'KeyL': this.kb[ACT_BLOCK] = 1; break;
      case 'KeyE': this.kb[ACT_GRAB] = 1; this.kb[ACT_INTERACT] = 1; break;
      case 'KeyF': this.kb[ACT_SHOOT] = 1; break;
      case 'KeyR': this.kb[ACT_RELOAD] = 1; break;
      case 'KeyC': this.kb[ACT_FOCUS] = 1; break;
      case 'KeyQ': this.kb[ACT_SPECIAL] = 1; break;
      case 'KeyX': this.kb[ACT_SWAP] = 1; break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'Space': this.kb[ACT_JUMP] = 0; break;
      case 'KeyW': case 'ArrowUp': if (this.kbMoveY < 0) this.kbMoveY = 0; break;
      case 'KeyS': case 'ArrowDown': if (this.kbMoveY > 0) this.kbMoveY = 0; break;
      case 'KeyA': case 'ArrowLeft': if (this.kbMoveX < 0) this.kbMoveX = 0; break;
      case 'KeyD': case 'ArrowRight': if (this.kbMoveX > 0) this.kbMoveX = 0; break;
      case 'ShiftLeft': case 'ShiftRight': this.kb[ACT_DODGE] = 0; break;
      case 'KeyJ': this.kb[ACT_ATTACK] = 0; break;
      case 'KeyK': this.kb[ACT_HEAVY] = 0; break;
      case 'KeyL': this.kb[ACT_BLOCK] = 0; break;
      case 'KeyE': this.kb[ACT_GRAB] = 0; this.kb[ACT_INTERACT] = 0; break;
      case 'KeyF': this.kb[ACT_SHOOT] = 0; break;
      case 'KeyR': this.kb[ACT_RELOAD] = 0; break;
      case 'KeyC': this.kb[ACT_FOCUS] = 0; break;
      case 'KeyQ': this.kb[ACT_SPECIAL] = 0; break;
      case 'KeyX': this.kb[ACT_SWAP] = 0; break;
    }
  };

  private releaseKeyboard = (): void => {
    this.kb.fill(0);
    this.kbMoveX = 0;
    this.kbMoveY = 0;
  };

  private formatGamepadName(rawId: string): string {
    const id = rawId.toLowerCase();
    if (id.includes('backbone')) return 'Backbone One (USB-C)';
    if (id.includes('kishi')) return 'Razer Kishi (USB-C)';
    if (id.includes('gamesir')) return 'GameSir Type-C';
    if (id.includes('xbox')) return 'Xbox Wireless / Type-C';
    if (id.includes('playstation') || id.includes('dualsense') || id.includes('dualshock')) return 'PlayStation / Type-C';
    if (id.includes('pro controller')) return 'Switch Pro / Type-C';
    return rawId.split('(')[0].trim() || 'Type-C Mobile Gamepad';
  }

  private checkConnectedGamepad(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    let found = false;
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        found = true;
        // Fast path: the same pad as last frame — skip name formatting
        // (formatGamepadName allocates, and this runs every poll).
        if (this.gamepadStatus.connected && this.lastPadId === gp.id) return;
        const name = this.formatGamepadName(gp.id);
        this.lastPadId = gp.id;
        if (!this.gamepadStatus.connected || this.gamepadStatus.name !== name) {
          this.gamepadStatus = { connected: true, name };
          if (this.onGamepadChange) this.onGamepadChange(this.gamepadStatus);
        }
        return;
      }
    }
    if (!found && this.gamepadStatus.connected) {
      this.lastPadId = '';
      this.gamepadStatus = { connected: false, name: '' };
      if (this.onGamepadChange) this.onGamepadChange(this.gamepadStatus);
    }
  }

  /**
   * Haptic vibration rumble on Type-C controller or mobile device.
   * PHASE 1B: routes through the shared Haptics bus so the settings toggle
   * (settings.haptics) gates every actuator write in one place.
   */
  public vibrate(durationMs = 120, weakMagnitude = 0.4, strongMagnitude = 0.7): void {
    Haptics.rumble(durationMs, weakMagnitude, strongMagnitude);
  }

  // Virtual control hooks from mobile touch UI
  public setVirtualJoystick(x: number, y: number): void {
    this.virtX = x;
    this.virtY = y;
  }

  public setVirtualAim(x: number, y: number, active: boolean): void {
    this.virtAimX = x;
    this.virtAimY = y;
    this.virtAimActive = active;
  }

  public setVirtualButton(button: VirtualButton, pressed: boolean): void {
    const index = BUTTON_INDEX[button];
    this.virt[index] = pressed ? 1 : 0;
    if (!pressed) this.pulseUntilAt[index] = 0;
  }

  /**
   * PHASE 3 3 — one-shot press for swipe gestures. The pulse holds the shared
   * virtual channel for a few frames so the same edge detector that serves the
   * on-screen buttons also serves gestures (no second input path).
   */
  public pulseButton(button: VirtualButton, durationMs = 140): void {
    const index = BUTTON_INDEX[button];
    this.virt[index] = 1;
    this.pulseUntilAt[index] = performance.now() + durationMs;
    this.pulsesActive = true;
  }

  /** Drops every held input (pause / background / stage start). */
  public releaseAll(): void {
    this.virt.fill(0);
    this.kb.fill(0);
    this.pad.fill(0);
    this.kbMoveX = 0;
    this.kbMoveY = 0;
    this.virtX = 0;
    this.virtY = 0;
    this.setVirtualAim(0, 0, false);
    this.padAdsHeld = false;
    this.pulseUntilAt.fill(0);
    this.pulsesActive = false;
  }

  /**
   * Radial deadzone + sensitivity. `deadzone` is the raw fraction, `gain` the
   * sensitivity multiplier: raising sensitivity shrinks the effective deadzone
   * (the stick engages sooner) and scales travel toward full deflection.
   * Writes into a reused sample — never allocates.
   */
  private readStick(
    rawX: number,
    rawY: number,
    deadzone: number,
    gain: number,
    out: StickSample
  ): void {
    const len = Math.sqrt(rawX * rawX + rawY * rawY);
    const dz = Math.min(0.55, Math.max(0.01, deadzone / gain));
    if (len <= dz || len === 0) {
      out.x = 0;
      out.y = 0;
      out.active = false;
      return;
    }
    let mx = rawX * gain;
    let my = rawY * gain;
    const mag = Math.sqrt(mx * mx + my * my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    out.x = mx;
    out.y = my;
    out.active = true;
  }

  /**
   * PHASE 3 1 — polls keyboard, touch and gamepad into ONE action state.
   * Every channel lands in the same 12-slot table; edges come from the merged
   * history, so no device can produce a "just pressed" the others can't see.
   */
  public poll(): InputState {
    this.checkConnectedGamepad();

    // --- expire gesture pulses (fixed table — no allocation) ----------
    if (this.pulsesActive) {
      const now = performance.now();
      let stillActive = false;
      for (let k = 0; k < ACTION_COUNT; k++) {
        const until = this.pulseUntilAt[k];
        if (until === 0) continue;
        if (now >= until) {
          this.virt[k] = 0;
          this.pulseUntilAt[k] = 0;
        } else {
          stillActive = true;
        }
      }
      this.pulsesActive = stillActive;
    }

    // --- gamepad ------------------------------------------------------
    let moveX = this.virtX;
    let moveY = this.virtY;
    let aimX = this.virtAimX;
    let aimY = this.virtAimY;
    let aimActive = this.virtAimActive;
    let padSeen = false;
    let padStart = false;
    this.padAdsHeld = false;
    this.pad.fill(0);

    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp || !gp.connected) continue;
        padSeen = true;

        // Left stick — locomotion (radial deadzone + sensitivity)
        this.readStick(gp.axes[0] || 0, gp.axes[1] || 0, this.moveDeadzone, this.moveGain, this.moveStick);
        if (this.moveStick.active) {
          moveX = this.moveStick.x;
          moveY = this.moveStick.y;
        }

        // Right stick — twin-stick aim feeding the precision-aim model
        const rx = gp.axes[2] !== undefined ? gp.axes[2] : 0;
        const ry = gp.axes[3] !== undefined ? gp.axes[3] : 0;
        this.readStick(rx, ry, this.aimDeadzone, this.aimGain, this.aimStick);
        if (this.aimStick.active) {
          const len = Math.sqrt(this.aimStick.x * this.aimStick.x + this.aimStick.y * this.aimStick.y) || 1;
          aimX = this.aimStick.x / len;
          aimY = this.aimStick.y / len;
          aimActive = true;
        }

        const b = gp.buttons;
        if (b && b.length > 0) {
          // D-Pad override (digital full deflection, shipped behaviour)
          if (padPressed(b, 14)) moveX = -1;
          if (padPressed(b, 15)) moveX = 1;
          if (padPressed(b, 12)) moveY = -1;
          if (padPressed(b, 13)) moveY = 1;

          /* PHASE 3 standard pad layout:
             A jump · B dodge · X context (interact / reload) · Y swap
             LB punch · RB kick · LT ADS (hold) · RT fire
             L3 block · R3 grab · Select focus · Start pause */
          this.pad[ACT_JUMP] = padPressed(b, 0) ? 1 : 0;
          this.pad[ACT_DODGE] = padPressed(b, 1) ? 1 : 0;
          this.pad[ACT_SWAP] = padPressed(b, 3) ? 1 : 0;
          this.pad[ACT_ATTACK] = padPressed(b, 4) ? 1 : 0;
          this.pad[ACT_HEAVY] = padPressed(b, 5) ? 1 : 0;
          this.pad[ACT_SHOOT] = padPressed(b, 7) ? 1 : 0;
          this.pad[ACT_FOCUS] = padPressed(b, 8) ? 1 : 0;
          this.pad[ACT_BLOCK] = padPressed(b, 10) ? 1 : 0;
          this.pad[ACT_GRAB] = padPressed(b, 11) ? 1 : 0;
          padStart = padPressed(b, 9);

          // LT — ADS / precision aim while held (analog trigger aware)
          this.padAdsHeld = padValue(b, 6) > 0.45;

          // X — context button: enter door when one is open and in reach,
          // reload when a tactical reload is actually possible, else interact.
          if (padPressed(b, 2)) {
            if (this.hint.nearDoor) this.pad[ACT_INTERACT] = 1;
            else if (this.hint.canReload) this.pad[ACT_RELOAD] = 1;
            else this.pad[ACT_INTERACT] = 1;
          }
        }
        break; // Process primary active gamepad
      }
    }

    // Trigger Pause via Start / Menu
    if (padStart && !this.prevPadStart && this.onPauseRequested) this.onPauseRequested();
    this.prevPadStart = padStart;

    // Keyboard fallback (only when touch stick / gamepad are idle)
    if (Math.abs(moveX) < 0.01 && this.kbMoveX !== 0) moveX = this.kbMoveX;
    if (Math.abs(moveY) < 0.01 && this.kbMoveY !== 0) moveY = this.kbMoveY;

    // Clamp stick vector
    const len = Math.sqrt(moveX * moveX + moveY * moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    // ADS precision lock: LT held with no live aim stick aims along the
    // facing the engine reports, so touch and pad enter the same precision
    // aim state (laser, tightened spread, camera push-in).
    if (!aimActive && this.padAdsHeld && padSeen) {
      aimX = this.hint.facingRight ? 1 : -1;
      aimY = 0;
      aimActive = true;
    }

    // --- merge every channel into the single action state -------------
    const s = this.state;
    const merged = this.mergedScratch;
    for (let k = 0; k < ACTION_COUNT; k++) {
      merged[k] = this.virt[k] || this.kb[k] || this.pad[k] ? 1 : 0;
    }
    // Combo special: dedicated binding OR holding PUNCH + KICK together
    merged[ACT_SPECIAL] = merged[ACT_SPECIAL] || (merged[ACT_ATTACK] && merged[ACT_HEAVY]) ? 1 : 0;

    const prev = this.prevMerged;
    s.moveX = moveX;
    s.moveY = moveY;
    s.aimX = aimX;
    s.aimY = aimY;
    s.aimActive = aimActive;
    s.jump = merged[ACT_JUMP] === 1;
    s.jumpJustPressed = s.jump && prev[ACT_JUMP] === 0;
    s.dodge = merged[ACT_DODGE] === 1;
    s.dodgeJustPressed = s.dodge && prev[ACT_DODGE] === 0;
    s.attack = merged[ACT_ATTACK] === 1;
    s.attackJustPressed = s.attack && prev[ACT_ATTACK] === 0;
    s.heavyAttack = merged[ACT_HEAVY] === 1;
    s.heavyAttackJustPressed = s.heavyAttack && prev[ACT_HEAVY] === 0;
    s.block = merged[ACT_BLOCK] === 1;
    s.grab = merged[ACT_GRAB] === 1;
    s.grabJustPressed = s.grab && prev[ACT_GRAB] === 0;
    s.shoot = merged[ACT_SHOOT] === 1;
    s.shootJustPressed = s.shoot && prev[ACT_SHOOT] === 0;
    s.reload = merged[ACT_RELOAD] === 1;
    s.reloadJustPressed = s.reload && prev[ACT_RELOAD] === 0;
    s.interact = merged[ACT_INTERACT] === 1;
    s.interactJustPressed = s.interact && prev[ACT_INTERACT] === 0;
    s.focus = merged[ACT_FOCUS] === 1;
    s.focusJustPressed = s.focus && prev[ACT_FOCUS] === 0;
    s.special = merged[ACT_SPECIAL] === 1;
    s.specialJustPressed = s.special && prev[ACT_SPECIAL] === 0;
    s.swap = merged[ACT_SWAP] === 1;
    s.swapJustPressed = s.swap && prev[ACT_SWAP] === 0;

    prev.set(merged);
    return s;
  }

  private readonly mergedScratch = new Uint8Array(ACTION_COUNT);
}
