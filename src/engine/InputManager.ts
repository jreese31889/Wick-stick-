import { InputState } from '../types/game';

export interface GamepadStatus {
  connected: boolean;
  name: string;
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

  // Mobile virtual control inputs (pure touch)
  private virtualMoveX = 0;
  private virtualMoveY = 0;
  private virtualAimX = 0;
  private virtualAimY = 0;
  private virtualAimActive = false;
  private virtualJump = false;
  private virtualDodge = false;
  private virtualAttack = false;
  private virtualHeavy = false;
  private virtualBlock = false;
  private virtualGrab = false;
  private virtualShoot = false;
  private virtualReload = false;
  private virtualInteract = false;
  private virtualFocus = false;
  private virtualSpecial = false;
  private virtualSwap = false;

  private prevVirtualJump = false;
  private prevVirtualDodge = false;
  private prevVirtualAttack = false;
  private prevVirtualHeavy = false;
  private prevVirtualBlock = false;
  private prevVirtualGrab = false;
  private prevVirtualShoot = false;
  private prevVirtualReload = false;
  private prevVirtualInteract = false;
  private prevVirtualFocus = false;
  private prevVirtualSpecial = false;
  private prevVirtualSwap = false;

  // Keyboard bindings (desktop fallback — mobile stays touch-first)
  private kbJump = false;
  private kbDodge = false;
  private kbAttack = false;
  private kbHeavy = false;
  private kbBlock = false;
  private kbGrab = false;
  private kbShoot = false;
  private kbReload = false;
  private kbInteract = false;
  private kbFocus = false;
  private kbSpecial = false;
  private kbSwap = false;
  private kbMoveX = 0;
  private kbMoveY = 0;

  private prevKbJump = false;
  private prevKbDodge = false;
  private prevKbAttack = false;
  private prevKbHeavy = false;
  private prevKbGrab = false;
  private prevKbShoot = false;
  private prevKbReload = false;
  private prevKbInteract = false;
  private prevKbFocus = false;
  private prevKbSpecial = false;
  private prevKbSwap = false;
  private prevKbBlock = false;

  // Type-C / USB-C Gamepad state
  public gamepadStatus: GamepadStatus = { connected: false, name: '' };
  // P2-02: fixed-length history (was rebuilt as a new array every frame)
  private prevGamepadButtons: boolean[] = [
    false, false, false, false, false, false, false, false, false, false,
  ];
  private prevGamepadStart = false;
  /** L3 edge history for the gun-swap binding (L3 left the focus chord). */
  private prevPadSwap = false;

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

  private handleGamepadConnected = (e: GamepadEvent): void => {
    const cleanName = this.formatGamepadName(e.gamepad.id);
    this.gamepadStatus = { connected: true, name: cleanName };
    if (this.onGamepadChange) this.onGamepadChange(this.gamepadStatus);
  };

  private handleGamepadDisconnected = (): void => {
    this.checkConnectedGamepad();
  };

  /**
   * Desktop keyboard fallback. Mobile remains touch-first; gamepads keep their
   * existing Type-C bindings. Q (or PUNCH+KICK together) fires the combo special.
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    switch (e.code) {
      case 'Space': this.kbJump = true; break;
      case 'KeyW': case 'ArrowUp': this.kbMoveY = -1; break;
      case 'KeyS': case 'ArrowDown': this.kbMoveY = 1; break;
      case 'KeyA': case 'ArrowLeft': this.kbMoveX = -1; break;
      case 'KeyD': case 'ArrowRight': this.kbMoveX = 1; break;
      case 'ShiftLeft': case 'ShiftRight': this.kbDodge = true; break;
      case 'KeyJ': this.kbAttack = true; break;
      case 'KeyK': this.kbHeavy = true; break;
      case 'KeyL': this.kbBlock = true; break;
      case 'KeyE': this.kbGrab = true; this.kbInteract = true; break;
      case 'KeyF': this.kbShoot = true; break;
      case 'KeyR': this.kbReload = true; break;
      case 'KeyC': this.kbFocus = true; break;
      case 'KeyQ': this.kbSpecial = true; break;
      case 'KeyX': this.kbSwap = true; break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'Space': this.kbJump = false; break;
      case 'KeyW': case 'ArrowUp': if (this.kbMoveY < 0) this.kbMoveY = 0; break;
      case 'KeyS': case 'ArrowDown': if (this.kbMoveY > 0) this.kbMoveY = 0; break;
      case 'KeyA': case 'ArrowLeft': if (this.kbMoveX < 0) this.kbMoveX = 0; break;
      case 'KeyD': case 'ArrowRight': if (this.kbMoveX > 0) this.kbMoveX = 0; break;
      case 'ShiftLeft': case 'ShiftRight': this.kbDodge = false; break;
      case 'KeyJ': this.kbAttack = false; break;
      case 'KeyK': this.kbHeavy = false; break;
      case 'KeyL': this.kbBlock = false; break;
      case 'KeyE': this.kbGrab = false; this.kbInteract = false; break;
      case 'KeyF': this.kbShoot = false; break;
      case 'KeyR': this.kbReload = false; break;
      case 'KeyC': this.kbFocus = false; break;
      case 'KeyQ': this.kbSpecial = false; break;
      case 'KeyX': this.kbSwap = false; break;
    }
  };

  private releaseKeyboard = (): void => {
    this.kbJump = false;
    this.kbDodge = false;
    this.kbAttack = false;
    this.kbHeavy = false;
    this.kbBlock = false;
    this.kbGrab = false;
    this.kbShoot = false;
    this.kbReload = false;
    this.kbInteract = false;
    this.kbFocus = false;
    this.kbSpecial = false;
    this.kbSwap = false;
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
        const name = this.formatGamepadName(gp.id);
        if (!this.gamepadStatus.connected || this.gamepadStatus.name !== name) {
          this.gamepadStatus = { connected: true, name };
          if (this.onGamepadChange) this.onGamepadChange(this.gamepadStatus);
        }
        return;
      }
    }
    if (!found && this.gamepadStatus.connected) {
      this.gamepadStatus = { connected: false, name: '' };
      if (this.onGamepadChange) this.onGamepadChange(this.gamepadStatus);
    }
  }

  /**
   * Haptic vibration rumble on Type-C controller or mobile device
   */
  public vibrate(durationMs = 120, weakMagnitude = 0.4, strongMagnitude = 0.7): void {
    if (typeof navigator === 'undefined') return;

    // 1. Try Gamepad vibration actuator (dual-rumble motors in Backbone/Kishi/Xbox)
    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp && gp.connected && (gp as unknown as { vibrationActuator?: { playEffect: Function } }).vibrationActuator) {
          const actuator = (gp as unknown as { vibrationActuator: { playEffect: Function } }).vibrationActuator;
          if (typeof actuator.playEffect === 'function') {
            actuator.playEffect('dual-rumble', {
              startDelay: 0,
              duration: durationMs,
              weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
              strongMagnitude: Math.min(1, Math.max(0, strongMagnitude)),
            }).catch(() => {});
            return;
          }
        }
      }
    }

    // 2. Fallback to phone hardware vibration
    if (navigator.vibrate) {
      try {
        navigator.vibrate(durationMs);
      } catch {
        // Safe ignore
      }
    }
  }

  // Virtual control hooks from mobile touch UI
  public setVirtualJoystick(x: number, y: number): void {
    this.virtualMoveX = x;
    this.virtualMoveY = y;
  }

  public setVirtualAim(x: number, y: number, active: boolean): void {
    this.virtualAimX = x;
    this.virtualAimY = y;
    this.virtualAimActive = active;
  }

  public setVirtualButton(
    button: 'jump' | 'dodge' | 'attack' | 'heavy' | 'block' | 'grab' | 'shoot' | 'reload' | 'interact' | 'focus' | 'special' | 'swap',
    pressed: boolean
  ): void {
    switch (button) {
      case 'jump': this.virtualJump = pressed; break;
      case 'dodge': this.virtualDodge = pressed; break;
      case 'attack': this.virtualAttack = pressed; break;
      case 'heavy': this.virtualHeavy = pressed; break;
      case 'block': this.virtualBlock = pressed; break;
      case 'grab': this.virtualGrab = pressed; break;
      case 'shoot': this.virtualShoot = pressed; break;
      case 'reload': this.virtualReload = pressed; break;
      case 'interact': this.virtualInteract = pressed; break;
      case 'focus': this.virtualFocus = pressed; break;
      case 'special': this.virtualSpecial = pressed; break;
      case 'swap': this.virtualSwap = pressed; break;
    }
  }

  /**
   * Polls inputs and prepares the single unified InputState for this frame.
   * Completely mobile-first: merges touch virtual inputs with Type-C gamepad.
   */
  public poll(): InputState {
    this.checkConnectedGamepad();

    let moveX = this.virtualMoveX;
    let moveY = this.virtualMoveY;
    let aimX = this.virtualAimX;
    let aimY = this.virtualAimY;
    let aimActive = this.virtualAimActive;

    let padJump = false;
    let padDodge = false;
    let padAttack = false;
    let padHeavy = false;
    let padBlock = false;
    let padGrab = false;
    let padShoot = false;
    let padReload = false;
    let padInteract = false;
    let padFocus = false;
    let padSwap = false;
    let padStart = false;

    // Type-C Gamepad reading
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp || !gp.connected) continue;

        // Left Analog Stick with Deadzone (0.15)
        const axisX = gp.axes[0] || 0;
        const axisY = gp.axes[1] || 0;
        const deadzone = 0.15;

        if (Math.abs(axisX) > deadzone) {
          moveX = axisX;
        }
        if (Math.abs(axisY) > deadzone) {
          moveY = axisY;
        }

        // Right Analog Stick for Twin-Stick Precision Free Aim
        const rightAxisX = gp.axes[2] !== undefined ? gp.axes[2] : (gp.axes[3] !== undefined ? gp.axes[3] : 0);
        const rightAxisY = gp.axes[3] !== undefined && gp.axes[2] !== undefined ? gp.axes[3] : 0;
        const rightDeadzone = 0.22;
        const rightLen = Math.sqrt(rightAxisX * rightAxisX + rightAxisY * rightAxisY);
        if (rightLen > rightDeadzone) {
          aimX = rightAxisX / rightLen;
          aimY = rightAxisY / rightLen;
          aimActive = true;
        }

        const b = gp.buttons;
        if (b && b.length > 0) {
          const isDown = (index: number) => Boolean(b[index] && (b[index].pressed || b[index].value > 0.45));

          // D-Pad override
          if (isDown(14)) moveX = -1; // Left
          if (isDown(15)) moveX = 1;  // Right
          if (isDown(12)) moveY = -1; // Up
          if (isDown(13)) moveY = 1;  // Down

          // Standard Action Buttons
          padJump = isDown(0);                      // A / Cross
          padDodge = isDown(1);                     // B / Circle
          padAttack = isDown(2);                    // X / Square (Primary Combo)
          padHeavy = isDown(3);                     // Y / Triangle (Guard Crush)
          padBlock = isDown(4);                     // L1 / LB (Block / Parry)
          padGrab = isDown(5);                      // R1 / RB (Takedown / Grab)
          padReload = isDown(6);                    // L2 / LT (Reload)
          padShoot = isDown(7);                     // R2 / RT (Pistol / Shotgun / Throw)
          padFocus = isDown(8) || isDown(11);   // Select / R3 (L3 is SWAP)
          padSwap = isDown(10);                 // L3 — cycle the owned firearms
          padStart = isDown(9);                 // Start / Menu
          padInteract = isDown(0) || isDown(7);     // Contextual action
        }
        break; // Process primary active gamepad
      }
    }

    // Trigger Pause via Type-C Gamepad Start/Options button
    if (padStart && !this.prevGamepadStart) {
      if (this.onPauseRequested) {
        this.onPauseRequested();
      }
    }
    this.prevGamepadStart = padStart;

    // Keyboard fallback (only when touch stick / gamepad are idle)
    if (Math.abs(moveX) < 0.01 && this.kbMoveX !== 0) moveX = this.kbMoveX;
    if (Math.abs(moveY) < 0.01 && this.kbMoveY !== 0) moveY = this.kbMoveY;

    // Clamp stick vector
    const len = Math.sqrt(moveX * moveX + moveY * moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    // Combine Touch Controls + Type-C Gamepad + Keyboard
    const jump = this.virtualJump || padJump || this.kbJump;
    const dodge = this.virtualDodge || padDodge || this.kbDodge;
    const attack = this.virtualAttack || padAttack || this.kbAttack;
    const heavy = this.virtualHeavy || padHeavy || this.kbHeavy;
    const block = this.virtualBlock || padBlock || this.kbBlock;
    const grab = this.virtualGrab || padGrab || this.kbGrab;
    const shoot = this.virtualShoot || padShoot || this.kbShoot;
    const reload = this.virtualReload || padReload || this.kbReload;
    const interact = this.virtualInteract || padInteract || this.kbInteract;
    const focus = this.virtualFocus || padFocus || this.kbFocus;
    const swap = this.virtualSwap || padSwap || this.kbSwap;
    // Combo special: dedicated binding OR holding PUNCH + KICK together
    const special = this.virtualSpecial || this.kbSpecial || (attack && heavy);

    // Detect "just pressed" edges
    const prevJump = this.prevVirtualJump || Boolean(this.prevGamepadButtons[0]) || this.prevKbJump;
    const prevDodge = this.prevVirtualDodge || Boolean(this.prevGamepadButtons[1]) || this.prevKbDodge;
    const prevAttack = this.prevVirtualAttack || Boolean(this.prevGamepadButtons[2]) || this.prevKbAttack;
    const prevHeavy = this.prevVirtualHeavy || Boolean(this.prevGamepadButtons[3]) || this.prevKbHeavy;
    const prevBlock = this.prevVirtualBlock || Boolean(this.prevGamepadButtons[4]) || this.prevKbBlock;
    const prevGrab = this.prevVirtualGrab || Boolean(this.prevGamepadButtons[5]) || this.prevKbGrab;
    const prevReload = this.prevVirtualReload || Boolean(this.prevGamepadButtons[6]) || this.prevKbReload;
    const prevShoot = this.prevVirtualShoot || Boolean(this.prevGamepadButtons[7]) || this.prevKbShoot;
    const prevFocus = this.prevVirtualFocus || Boolean(this.prevGamepadButtons[8]) || this.prevKbFocus;
    const prevInteract = this.prevVirtualInteract || Boolean(this.prevGamepadButtons[7] || this.prevGamepadButtons[0]) || this.prevKbInteract;
    const prevSpecial = this.prevVirtualSpecial || this.prevKbSpecial || (prevAttack && prevHeavy);
    const prevSwap = this.prevVirtualSwap || this.prevPadSwap || this.prevKbSwap;

    // P2-02: mutated in place — poll() no longer allocates a fresh state
    // object every frame (PlayerController keeps a live reference to it).
    const s = this.state;
    s.moveX = moveX;
    s.moveY = moveY;
    s.aimX = aimX;
    s.aimY = aimY;
    s.aimActive = aimActive;
    s.jump = jump;
    s.jumpJustPressed = jump && !prevJump;
    s.dodge = dodge;
    s.dodgeJustPressed = dodge && !prevDodge;
    s.attack = attack;
    s.attackJustPressed = attack && !prevAttack;
    s.heavyAttack = heavy;
    s.heavyAttackJustPressed = heavy && !prevHeavy;
    s.block = block;
    s.grab = grab;
    s.grabJustPressed = grab && !prevGrab;
    s.shoot = shoot;
    s.shootJustPressed = shoot && !prevShoot;
    s.reload = reload;
    s.reloadJustPressed = reload && !prevReload;
    s.interact = interact;
    s.interactJustPressed = interact && !prevInteract;
    s.focus = focus;
    s.focusJustPressed = focus && !prevFocus;
    s.special = special;
    s.specialJustPressed = special && !prevSpecial;
    s.swap = swap;
    s.swapJustPressed = swap && !prevSwap;

    // Update history for next frame
    this.prevVirtualJump = this.virtualJump;
    this.prevVirtualDodge = this.virtualDodge;
    this.prevVirtualAttack = this.virtualAttack;
    this.prevVirtualHeavy = this.virtualHeavy;
    this.prevVirtualBlock = this.virtualBlock;
    this.prevVirtualGrab = this.virtualGrab;
    this.prevVirtualShoot = this.virtualShoot;
    this.prevVirtualReload = this.virtualReload;
    this.prevVirtualInteract = this.virtualInteract;
    this.prevVirtualFocus = this.virtualFocus;
    this.prevVirtualSpecial = this.virtualSpecial;
    this.prevVirtualSwap = this.virtualSwap;

    this.prevKbJump = this.kbJump;
    this.prevKbDodge = this.kbDodge;
    this.prevKbAttack = this.kbAttack;
    this.prevKbHeavy = this.kbHeavy;
    this.prevKbBlock = this.kbBlock;
    this.prevKbGrab = this.kbGrab;
    this.prevKbShoot = this.kbShoot;
    this.prevKbReload = this.kbReload;
    this.prevKbInteract = this.kbInteract;
    this.prevKbFocus = this.kbFocus;
    this.prevKbSpecial = this.kbSpecial;
    this.prevKbSwap = this.kbSwap;

    this.prevGamepadButtons[0] = padJump;
    this.prevGamepadButtons[1] = padDodge;
    this.prevGamepadButtons[2] = padAttack;
    this.prevGamepadButtons[3] = padHeavy;
    this.prevGamepadButtons[4] = padBlock;
    this.prevGamepadButtons[5] = padGrab;
    this.prevGamepadButtons[6] = padReload;
    this.prevGamepadButtons[7] = padShoot;
    this.prevGamepadButtons[8] = padFocus;
    this.prevGamepadButtons[9] = padStart;
    this.prevPadSwap = padSwap;

    return this.state;
  }
}
