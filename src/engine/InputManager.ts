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

  // Type-C / USB-C Gamepad state
  public gamepadStatus: GamepadStatus = { connected: false, name: '' };
  private prevGamepadButtons: boolean[] = [];
  private prevGamepadStart = false;

  // Callbacks
  public onPauseRequested?: () => void;
  public onGamepadChange?: (status: GamepadStatus) => void;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', this.handleGamepadConnected);
      window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
    }
  }

  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
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
    button: 'jump' | 'dodge' | 'attack' | 'heavy' | 'block' | 'grab' | 'shoot' | 'reload' | 'interact' | 'focus',
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
          padFocus = isDown(8) || isDown(10) || isDown(11); // Select / L3 / R3
          padStart = isDown(9);                     // Start / Menu
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

    // Clamp stick vector
    const len = Math.sqrt(moveX * moveX + moveY * moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    // Combine Touch Controls + Type-C Gamepad
    const jump = this.virtualJump || padJump;
    const dodge = this.virtualDodge || padDodge;
    const attack = this.virtualAttack || padAttack;
    const heavy = this.virtualHeavy || padHeavy;
    const block = this.virtualBlock || padBlock;
    const grab = this.virtualGrab || padGrab;
    const shoot = this.virtualShoot || padShoot;
    const reload = this.virtualReload || padReload;
    const interact = this.virtualInteract || padInteract;
    const focus = this.virtualFocus || padFocus;

    // Detect "just pressed" edges
    const prevJump = this.prevVirtualJump || Boolean(this.prevGamepadButtons[0]);
    const prevDodge = this.prevVirtualDodge || Boolean(this.prevGamepadButtons[1]);
    const prevAttack = this.prevVirtualAttack || Boolean(this.prevGamepadButtons[2]);
    const prevHeavy = this.prevVirtualHeavy || Boolean(this.prevGamepadButtons[3]);
    const prevBlock = this.prevVirtualBlock || Boolean(this.prevGamepadButtons[4]);
    const prevGrab = this.prevVirtualGrab || Boolean(this.prevGamepadButtons[5]);
    const prevReload = this.prevVirtualReload || Boolean(this.prevGamepadButtons[6]);
    const prevShoot = this.prevVirtualShoot || Boolean(this.prevGamepadButtons[7]);
    const prevFocus = this.prevVirtualFocus || Boolean(this.prevGamepadButtons[8]);
    const prevInteract = this.prevVirtualInteract || Boolean(this.prevGamepadButtons[7] || this.prevGamepadButtons[0]);

    this.state = {
      moveX,
      moveY,
      aimX,
      aimY,
      aimActive,
      jump,
      jumpJustPressed: jump && !prevJump,
      dodge,
      dodgeJustPressed: dodge && !prevDodge,
      attack,
      attackJustPressed: attack && !prevAttack,
      heavyAttack: heavy,
      heavyAttackJustPressed: heavy && !prevHeavy,
      block,
      grab,
      grabJustPressed: grab && !prevGrab,
      shoot,
      shootJustPressed: shoot && !prevShoot,
      reload,
      reloadJustPressed: reload && !prevReload,
      interact,
      interactJustPressed: interact && !prevInteract,
      focus,
      focusJustPressed: focus && !prevFocus,
    };

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

    this.prevGamepadButtons = [
      padJump,
      padDodge,
      padAttack,
      padHeavy,
      padBlock,
      padGrab,
      padReload,
      padShoot,
      padFocus,
      padStart,
    ];

    return this.state;
  }
}
