import { AnimationState, InputState, PerkId, PlayerPhysics, StickFigurePose, WeaponType } from '../types/game';
import { clamp, lerp } from './MathUtils';
import { AnimationController } from './AnimationController';
import { StickRig } from './StickRig';
import { SoundFX } from './SoundFX';

export class PlayerController {
  public physics: PlayerPhysics;
  public input: InputState;
  private animController = new AnimationController();
  public rig = new StickRig();
  public currentPose: StickFigurePose;

  // Constants
  private readonly RUN_SPEED = 320;
  private readonly SLIDE_SPEED = 480;
  private readonly ROLL_SPEED = 420;
  private readonly JUMP_FORCE = -540;
  private readonly GRAVITY = 1350;
  private readonly ACCELERATION = 2200;
  private readonly FRICTION = 1800;
  private readonly GROUND_Y = 0; // Stage floor baseline

  // Godot-style CharacterBody2D Jump Buffering & Coyote Time
  private jumpBufferTimer = 0;
  private coyoteTimer = 0;

  // Combat combo tracking
  private comboStep = 0;
  private comboTimer = 0;
  public hasFiredBulletThisShot = false;
  public hasThrownKnifeThisFrame = false;

  constructor(startX: number = 0, startY: number = 0) {
    this.physics = {
      position: { x: startX, y: startY },
      velocity: { x: 0, y: 0 },
      grounded: true,
      facingRight: true,
      isSliding: false,
      isDodging: false,
      isBlocking: false,
      isWallSliding: false,
      aimAngle: null,
      state: 'IDLE',
      stateTimer: 0,
      moveSpeed: 0,
      health: 100,
      maxHealth: 100,
      stamina: 100,
      maxStamina: 100,
      ammo: 7,
      maxAmmo: 7,
      isReloading: false,
      reloadTimer: 0,
      equippedWeapon: 'UNARMED',
      weaponDurability: 0,
      coins: 0,
      perks: {},
      focus: 50,
      maxFocus: 100,
      isFocusActive: false,
      focusTimer: 0,
    };

    this.input = {
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

    this.currentPose = this.animController.generatePose(
      'IDLE', 0, 0, 0, true, 0.016, startX, startY
    );
  }

  public equipWeapon(weapon: WeaponType): void {
    this.physics.equippedWeapon = weapon;
    const bonusDurability = this.physics.perks['LETHAL_BLADE'] ? 6 : 0;
    if (weapon === 'KATANA') {
      this.physics.weaponDurability = 14 + bonusDurability;
    } else if (weapon === 'SHOTGUN') {
      this.physics.weaponDurability = 6;
    } else {
      this.physics.weaponDurability = 4;
    }
  }

  public triggerFocus(): boolean {
    if (this.physics.focus >= 35 && !this.physics.isFocusActive) {
      this.physics.isFocusActive = true;
      this.physics.focusTimer = 5.5;
      SoundFX.playWhoosh(0.5);
      return true;
    }
    return false;
  }

  public applyPerk(perkId: PerkId): void {
    this.physics.perks[perkId] = true;
    if (perkId === 'KEVLAR_WEAVE') {
      this.physics.maxHealth += 30;
      this.physics.health = Math.min(this.physics.maxHealth, this.physics.health + 30);
    } else if (perkId === 'EXTENDED_MAG') {
      this.physics.maxAmmo = 12;
      this.physics.ammo = 12;
    } else if (perkId === 'LETHAL_BLADE' && this.physics.equippedWeapon === 'KATANA') {
      this.physics.weaponDurability += 8;
    }
  }

  public takeDamage(damage: number, knockbackX: number, knockbackY: number): void {
    if (this.physics.perks['KEVLAR_WEAVE']) {
      damage *= 0.8; // 20% ballistic weave protection
    }
    this.physics.health = Math.max(0, this.physics.health - damage);
    this.physics.velocity.x = knockbackX;
    this.physics.velocity.y = knockbackY;
    this.physics.grounded = false;
    this.setState('HURT');
  }

  public update(input: InputState, dt: number): void {
    this.input = input;
    this.physics.stateTimer += dt;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.hasThrownKnifeThisFrame = false;

    // Twin-stick aim calculation (Right Stick / Touch aim)
    if (input.aimActive) {
      this.physics.aimAngle = Math.atan2(input.aimY, input.aimX);
      // Turn to face aim direction if not actively in an attack animation
      if (!this.isAttackState(this.physics.state) && !this.physics.isDodging && !this.physics.isSliding) {
        this.physics.facingRight = input.aimX >= 0;
      }
    } else {
      this.physics.aimAngle = null;
    }

    // Godot Jump Buffer & Coyote Time timers
    if (input.jumpJustPressed) {
      this.jumpBufferTimer = 0.14; // 140ms jump buffer
    } else if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= dt;
    }

    if (this.physics.grounded) {
      this.coyoteTimer = 0.12; // 120ms coyote time
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= dt;
    }

    // Godot Variable Jump Height (Jump Cut)
    if (!input.jump && this.physics.velocity.y < -120 && !this.physics.grounded) {
      this.physics.velocity.y *= 0.62;
    }

    // Regenerate stamina (boosted by Adrenaline Infusion)
    if (!this.physics.isBlocking && !this.physics.isDodging) {
      const regenRate = this.physics.perks['ADRENALINE_INFUSION'] ? 55 : 35;
      this.physics.stamina = Math.min(this.physics.maxStamina, this.physics.stamina + regenRate * dt);
    }

    // Reload progress countdown
    if (this.physics.isReloading) {
      this.physics.reloadTimer -= dt;
      if (this.physics.reloadTimer <= 0) {
        this.physics.isReloading = false;
        this.physics.ammo = this.physics.maxAmmo;
      }
    }

    // Bullet-Time Focus timer countdown
    if (this.physics.isFocusActive) {
      this.physics.focusTimer -= dt;
      this.physics.focus = Math.max(0, (this.physics.focusTimer / 5.5) * 100);
      if (this.physics.focusTimer <= 0) {
        this.physics.isFocusActive = false;
        this.physics.focus = 0;
      }
    }

    // 1. STATE TRANSITION & INPUT HANDLING
    this.handleActions(input, dt);

    // 2. MOVEMENT & PHYSICS INTEGRATION
    this.handleMovement(input, dt);

    // 3. SECONDARY RIG PHYSICS (Tie & Coat Flutter)
    this.rig.updatePhysics(
      this.physics.velocity.x,
      this.physics.velocity.y,
      this.physics.facingRight,
      dt
    );

    // 4. SKELETAL POSE CALCULATION
    this.currentPose = this.animController.generatePose(
      this.physics.state,
      this.physics.stateTimer,
      this.physics.velocity.x,
      this.physics.velocity.y,
      this.physics.facingRight,
      dt,
      this.physics.position.x,
      this.physics.position.y
    );
  }

  private handleActions(input: InputState, dt: number): void {
    const isAttacking = this.isAttackState(this.physics.state);

    // BLOCKING
    if (input.block && this.physics.grounded && !isAttacking && !this.physics.isDodging && !this.physics.isSliding) {
      if (this.physics.state !== 'BLOCK') {
        this.setState('BLOCK');
        this.physics.isBlocking = true;
      }
      return;
    } else if (this.physics.isBlocking && !input.block) {
      this.physics.isBlocking = false;
      this.setState('IDLE');
    }

    // DODGE / SLIDE TRIGGER
    if (input.dodgeJustPressed && !this.physics.isDodging && !this.physics.isSliding && this.physics.stamina >= 15) {
      this.physics.stamina -= 15;
      const isCrouching = input.moveY > 0.4;
      const hasSpeed = Math.abs(this.physics.velocity.x) > 100;

      if (isCrouching || (hasSpeed && input.moveY > 0.2)) {
        // LOW SLIDE
        this.setState('SLIDE');
        this.physics.isSliding = true;
        const dir = this.physics.facingRight ? 1 : -1;
        this.physics.velocity.x = dir * this.SLIDE_SPEED;
        return;
      } else {
        // COMBAT DODGE ROLL
        this.setState('DODGE_ROLL');
        this.physics.isDodging = true;
        const moveDir = Math.abs(input.moveX) > 0.1 ? Math.sign(input.moveX) : (this.physics.facingRight ? 1 : -1);
        this.physics.facingRight = moveDir > 0;
        this.physics.velocity.x = moveDir * this.ROLL_SPEED;
        return;
      }
    }

    // FINISH SLIDE OR ROLL
    if (this.physics.isSliding) {
      if (this.physics.stateTimer > 0.42 || Math.abs(this.physics.velocity.x) < 80) {
        this.physics.isSliding = false;
        this.setState('IDLE');
      }
      return;
    }

    if (this.physics.isDodging) {
      if (this.physics.stateTimer > 0.36) {
        this.physics.isDodging = false;
        this.setState('IDLE');
      }
      return;
    }

    // BULLET-TIME FOCUS TRIGGER
    if (input.focusJustPressed) {
      this.triggerFocus();
    }

    // RELOAD TRIGGER
    if (input.reloadJustPressed && this.physics.ammo < this.physics.maxAmmo && !this.physics.isReloading && !this.physics.isDodging) {
      this.physics.isReloading = true;
      this.physics.reloadTimer = 0.95;
      SoundFX.playReload();
    }

    // TACTICAL GUN-FU / SHOTGUN / KNIFE THROW TRIGGER
    if (input.shootJustPressed && !this.physics.isBlocking && !this.physics.isDodging && !this.physics.isSliding) {
      if (this.physics.equippedWeapon === 'KNIFE') {
        // Hurl tactical knife across arena!
        this.hasThrownKnifeThisFrame = true;
        this.physics.equippedWeapon = 'UNARMED';
        this.setState('ATTACK_LIGHT_1');
        return;
      }

      if (this.physics.equippedWeapon === 'SHOTGUN') {
        if (this.physics.weaponDurability > 0) {
          this.physics.weaponDurability--;
          this.hasFiredBulletThisShot = true;
          this.setState('ATTACK_GUN_SHOT');
          SoundFX.playGunshot();
          SoundFX.playPunch('slam');
          const recoilDir = this.physics.facingRight ? -1 : 1;
          this.physics.velocity.x = recoilDir * 220;
          if (this.physics.weaponDurability <= 0) {
            this.physics.equippedWeapon = 'UNARMED';
          }
          return;
        }
      }

      if (this.physics.ammo > 0) {
        this.physics.ammo--;
        this.hasFiredBulletThisShot = true;
        this.physics.isReloading = false;
        this.setState('ATTACK_GUN_SHOT');
        SoundFX.playGunshot();
        const recoilDir = this.physics.facingRight ? -1 : 1;
        this.physics.velocity.x = recoilDir * 110;
        return;
      } else {
        SoundFX.playPunch('light'); // Empty chamber click
        if (!this.physics.isReloading) {
          this.physics.isReloading = true;
          this.physics.reloadTimer = 0.95;
          SoundFX.playReload();
        }
      }
    }

    // ATTACK COMBO TRIGGERING
    if (input.attackJustPressed && !this.physics.isBlocking && !this.physics.isDodging) {
      this.triggerAttack(false);
      return;
    }

    if (input.heavyAttackJustPressed && !this.physics.isBlocking && !this.physics.isDodging) {
      this.triggerAttack(true);
      return;
    }

    // RECOVERY FROM ATTACKS
    if (isAttacking) {
      const attackDuration = this.getAttackDuration(this.physics.state);
      if (this.physics.stateTimer >= attackDuration) {
        this.setState('IDLE');
      }
      return;
    }

    // JUMP TRIGGER (With Godot Jump Buffer & Coyote Time)
    if (this.jumpBufferTimer > 0 && !this.physics.isBlocking) {
      // Ground jump
      if (this.physics.grounded || this.coyoteTimer > 0) {
        this.physics.velocity.y = this.JUMP_FORCE;
        this.physics.grounded = false;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.setState('JUMP_ASCENT');
        SoundFX.playWhoosh(1.2);
        return;
      }

      // Godot Wall Slide & Wall-Kick Rebound
      const nearLeftWall = this.physics.position.x <= -830;
      const nearRightWall = this.physics.position.x >= 830;
      if (!this.physics.grounded && (nearLeftWall || nearRightWall)) {
        const wallDir = nearLeftWall ? 1 : -1;
        this.physics.velocity.x = wallDir * 360;
        this.physics.velocity.y = this.JUMP_FORCE * 0.92;
        this.physics.facingRight = wallDir > 0;
        this.jumpBufferTimer = 0;
        this.setState('JUMP_ASCENT');
        SoundFX.playPunch('kick');
        return;
      }
    }
  }

  private triggerAttack(isHeavy: boolean): void {
    // If wielding katana, play katana slash audio and reduce durability
    if (this.physics.equippedWeapon === 'KATANA') {
      SoundFX.playBladeSlash();
      this.physics.weaponDurability--;
      if (this.physics.weaponDurability <= 0) {
        this.physics.equippedWeapon = 'UNARMED';
      }
    }

    if (isHeavy) {
      this.setState('ATTACK_HEAVY');
      const dir = this.physics.facingRight ? 1 : -1;
      this.physics.velocity.x = dir * 180; // Heavy forward lunge
      this.comboStep = 0;
      return;
    }

    // Branching light combo sequence
    if (this.comboTimer > 0 && this.comboStep === 1) {
      this.setState('ATTACK_LIGHT_2');
      this.comboStep = 2;
      this.comboTimer = 0.45;
      const dir = this.physics.facingRight ? 1 : -1;
      this.physics.velocity.x = dir * 140;
    } else if (this.comboTimer > 0 && this.comboStep === 2) {
      this.setState('ATTACK_LIGHT_3');
      this.comboStep = 0; // Combo finisher
      this.comboTimer = 0;
      const dir = this.physics.facingRight ? 1 : -1;
      this.physics.velocity.x = dir * 210;
    } else {
      this.setState('ATTACK_LIGHT_1');
      this.comboStep = 1;
      this.comboTimer = 0.45;
      const dir = this.physics.facingRight ? 1 : -1;
      this.physics.velocity.x = dir * 100;
    }
  }

  private handleMovement(input: InputState, dt: number): void {
    const isAttacking = this.isAttackState(this.physics.state);

    // Horizontal Movement
    if (!this.physics.isDodging && !this.physics.isSliding && !this.physics.isBlocking && !isAttacking) {
      const targetSpeed = input.moveX * this.RUN_SPEED;
      
      if (Math.abs(input.moveX) > 0.08) {
        // Accelerating
        this.physics.velocity.x = lerp(this.physics.velocity.x, targetSpeed, 14 * dt);
        this.physics.facingRight = input.moveX > 0;
      } else {
        // Braking / Friction
        const currentSpeed = Math.abs(this.physics.velocity.x);
        const drop = this.FRICTION * dt;
        const newSpeed = Math.max(0, currentSpeed - drop);
        this.physics.velocity.x = (this.physics.velocity.x > 0 ? 1 : -1) * newSpeed;
      }
    } else if (this.physics.isSliding) {
      // Slide deceleration
      const dir = Math.sign(this.physics.velocity.x);
      this.physics.velocity.x -= dir * 900 * dt;
    } else if (this.physics.isBlocking || isAttacking) {
      // Natural attack/block friction
      this.physics.velocity.x *= 0.88;
    }

    // Apply Gravity
    if (!this.physics.grounded) {
      this.physics.velocity.y += this.GRAVITY * dt;
    }

    // Integrate Position
    this.physics.position.x += this.physics.velocity.x * dt;
    this.physics.position.y += this.physics.velocity.y * dt;

    // Arena Boundaries Clamp (-840 to 840) and Wall Slide
    const ARENA_BOUND = 840;
    const isAtWall = this.physics.position.x <= -830 || this.physics.position.x >= 830;
    if (this.physics.position.x < -ARENA_BOUND) {
      this.physics.position.x = -ARENA_BOUND;
      if (this.physics.velocity.x < 0) this.physics.velocity.x = 0;
    } else if (this.physics.position.x > ARENA_BOUND) {
      this.physics.position.x = ARENA_BOUND;
      if (this.physics.velocity.x > 0) this.physics.velocity.x = 0;
    }

    if (!this.physics.grounded && isAtWall && this.physics.velocity.y > 0) {
      // Wall slide friction drag
      this.physics.velocity.y = Math.min(this.physics.velocity.y, 180);
      this.physics.isWallSliding = true;
    } else {
      this.physics.isWallSliding = false;
    }

    // Ground Collision Check
    if (this.physics.position.y >= this.GROUND_Y) {
      if (!this.physics.grounded) {
        // Just landed
        this.physics.grounded = true;
        if (!this.physics.isDodging && !this.physics.isSliding && !isAttacking) {
          this.setState('LAND');
        }
      }
      this.physics.position.y = this.GROUND_Y;
      this.physics.velocity.y = 0;
    }

    // State Selection for locomotion when not locked in action
    if (this.physics.grounded && !this.physics.isDodging && !this.physics.isSliding && !this.physics.isBlocking && !isAttacking) {
      if (this.physics.state === 'LAND' && this.physics.stateTimer < 0.12) {
        // Stay in land compression briefly
      } else if (Math.abs(this.physics.velocity.x) > 30) {
        this.setState('RUN');
      } else {
        this.setState('IDLE');
      }
    } else if (!this.physics.grounded && !isAttacking && !this.physics.isDodging) {
      if (this.physics.velocity.y < 0) {
        this.setState('JUMP_ASCENT');
      } else {
        this.setState('FALL');
      }
    }

    this.physics.moveSpeed = Math.abs(this.physics.velocity.x);
  }

  private setState(newState: AnimationState): void {
    if (this.physics.state !== newState) {
      this.physics.state = newState;
      this.physics.stateTimer = 0;
    }
  }

  private isAttackState(s: AnimationState): boolean {
    return s.startsWith('ATTACK_');
  }

  private getAttackDuration(s: AnimationState): number {
    switch (s) {
      case 'ATTACK_LIGHT_1': return 0.20;
      case 'ATTACK_LIGHT_2': return 0.22;
      case 'ATTACK_LIGHT_3': return 0.26;
      case 'ATTACK_HEAVY': return 0.32;
      case 'ATTACK_GUN_SHOT': return 0.22;
      default: return 0.25;
    }
  }
}
