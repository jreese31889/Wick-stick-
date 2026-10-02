import { AnimationState, InputState, PerkId, PlayerPhysics, SpecialMoveId, StickFigurePose, WeaponType } from '../types/game';
import { clamp, lerp } from './MathUtils';
import { AnimationController } from './AnimationController';
import { StickRig } from './StickRig';
import { SoundFX } from './SoundFX';
import { Ragdoll } from './Ragdoll';

/** Rate-limited step toward a target: reaches it exactly, at any frame rate. */
function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

export class PlayerController {
  public physics: PlayerPhysics;
  public input: InputState;
  private animController = new AnimationController();
  public rig = new StickRig();
  public currentPose: StickFigurePose;

  // Ragdoll for the death kill-cam (rendered instead of the keyframed rig)
  public ragdoll: Ragdoll | null = null;
  // Last received blow, used to seed the death ragdoll's tumble
  public lastHitKbx = 0;
  public lastHitKby = 0;

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

  // Hysteresis for the gait selector so RUN/WALK/IDLE can't flicker as the
  // speed hovers on a boundary (a flicker would restart the pose cross-fade
  // every frame and make the legs stutter).
  private locomotionState: 'IDLE' | 'WALK' | 'RUN' = 'IDLE';
  /** How long the hurt flinch owns the pose before locomotion resumes. */
  private static readonly HURT_HOLD = 0.35;

  // Combat combo tracking (string step) + CombatDirector chain finisher flag
  private comboStep = 0;
  private comboTimer = 0;
  /** Armed by CombatDirector once a chain crosses 5x — next press is the finisher. */
  public finisherArmed = false;
  public hasFiredBulletThisShot = false;
  public hasThrownKnifeThisFrame = false;
  /**
   * SHOOT edge for the pistol, deferred to CombatDirector: only the director
   * can see live enemies, so it decides between a point-blank PISTOL WHIP and
   * a real shot (ammo spend, recoil, tracer) and resolves the result here.
   */
  public pendingPistolShot = false;
  /**
   * Seconds spent at (nearly) full run speed with the stick held — the KICK
   * button turns into a FLYING KICK once this crosses FLYING_KICK_SUSTAIN.
   */
  private runSustainTimer = 0;
  private static readonly FLYING_KICK_SUSTAIN = 0.3;

  // ---- Combo-meter specials (charged by landing hits, paid for by CombatDirector) ----
  /** Mirror of CombatDirector.stats.comboCount, synced every frame by the director. */
  public comboMeter = 0;
  /** Set on trigger; the director validates the cost, burns the meter and resolves the hit. */
  public pendingSpecial: SpecialMoveId | null = null;
  /** One-frame flag: the special chord was pressed without enough combo in the tank. */
  public specialDenied = false;
  /** i-frames covering the special / super animation. */
  public specialInvulnTimer = 0;
  private specialDenyCooldown = 0;

  /** Combo points burned by SPIN_SLASH. */
  public static readonly SPECIAL_COST = 5;
  /** Combo points burned by the EXECUTIONER super. */
  public static readonly SUPER_COST = 15;

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
      special: false,
      specialJustPressed: false,
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
    this.lastHitKbx = knockbackX;
    this.lastHitKby = knockbackY;
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
    this.specialDenied = false;
    if (this.specialInvulnTimer > 0) this.specialInvulnTimer = Math.max(0, this.specialInvulnTimer - dt);
    if (this.specialDenyCooldown > 0) this.specialDenyCooldown = Math.max(0, this.specialDenyCooldown - dt);

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

    // Sustained full-speed run detection — the KICK button reads this to decide
    // between a standing power kick and a Xiao Xiao FLYING KICK.
    const atFullRun =
      this.physics.grounded &&
      Math.abs(input.moveX) > 0.6 &&
      this.physics.velocity.x !== 0 &&
      Math.sign(input.moveX) === Math.sign(this.physics.velocity.x) &&
      Math.abs(this.physics.velocity.x) >= this.RUN_SPEED * 0.95;
    if (
      atFullRun &&
      !this.isAttackState(this.physics.state) &&
      !this.physics.isDodging &&
      !this.physics.isSliding &&
      !this.physics.isBlocking
    ) {
      this.runSustainTimer += dt;
    } else {
      this.runSustainTimer = 0;
    }

    // 1. STATE TRANSITION & INPUT HANDLING
    this.handleActions(input, dt);

    // 2. MOVEMENT & PHYSICS INTEGRATION
    this.handleMovement(input, dt);

    // 3. SECONDARY RIG PHYSICS (Verlet necktie pinned at collar + coat flutter)
    const moveSpeed = Math.hypot(this.physics.velocity.x, this.physics.velocity.y);
    const tieFlutter = Math.min(
      1,
      (this.isAttackState(this.physics.state) ? 0.65 : 0) +
        (this.physics.isDodging ? 0.85 : 0) +
        Math.min(0.5, moveSpeed / 700)
    );
    this.rig.updatePhysics(
      this.physics.velocity.x,
      this.physics.velocity.y,
      this.physics.facingRight,
      dt,
      this.currentPose.neck.x,
      this.currentPose.neck.y,
      tieFlutter
    );

    // 4. SKELETAL POSE CALCULATION
    // Specials have their own authored poses (SPIN_SLASH whirl, EXECUTIONER
    // wind-up), so every state maps 1:1 onto the pose it should read as.
    this.currentPose = this.animController.generatePose(
      this.physics.state,
      this.physics.stateTimer,
      this.physics.velocity.x,
      this.physics.velocity.y,
      this.physics.facingRight,
      dt,
      this.physics.position.x,
      this.physics.position.y,
      this.physics.grounded
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
        SoundFX.playSlide();
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

      // Pistol: defer the whole resolution (point-blank PISTOL WHIP, real
      // shot, or empty-chamber click) to CombatDirector — it is the only
      // system with a view of live enemy range. No ammo is spent here.
      this.pendingPistolShot = true;
      return;
    }

    // COMBO SPECIAL / SUPER — spends the combo meter (5 / 15 points)
    if (
      input.specialJustPressed &&
      !isAttacking &&
      !this.physics.isBlocking &&
      !this.physics.isDodging &&
      !this.physics.isSliding &&
      this.physics.grounded &&
      this.specialDenyCooldown <= 0
    ) {
      if (this.comboMeter >= PlayerController.SUPER_COST) {
        this.triggerSpecial('EXECUTIONER');
        return;
      }
      if (this.comboMeter >= PlayerController.SPECIAL_COST) {
        this.triggerSpecial('SPIN_SLASH');
        return;
      }
      // Not enough combo stored — flash the cost and fall through so a
      // PUNCH+KICK chord still lands the punch instead of eating the input.
      this.specialDenied = true;
      this.specialDenyCooldown = 0.9;
      SoundFX.playPunch('light');
    }

    // PUNCH BUTTON — jab / cross / spinning string (short reach, fast)
    if (input.attackJustPressed && !this.physics.isBlocking && !this.physics.isDodging) {
      if (this.finisherArmed) {
        this.triggerFinisher();
      } else {
        this.triggerPunch();
      }
      return;
    }

    // KICK BUTTON — long-reach power kick (heavy damage, guard crush)
    if (input.heavyAttackJustPressed && !this.physics.isBlocking && !this.physics.isDodging) {
      if (this.finisherArmed) {
        this.triggerFinisher();
      } else {
        this.triggerKick();
      }
      return;
    }

    // RECOVERY FROM ATTACKS
    if (isAttacking) {
      const attackDuration = this.getAttackDuration(this.physics.state);
      if (this.physics.state === 'ATTACK_FLYING_KICK') {
        // The airborne kick holds its extension until the feet find the floor,
        // then recovers as soon as the minimum strike time has elapsed.
        if (this.physics.grounded && this.physics.stateTimer >= attackDuration) {
          this.setState('IDLE');
        }
      } else if (this.physics.stateTimer >= attackDuration) {
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

  /** Blade upkeep for any armed melee strike (durability burn + slash audio). */
  private consumeWeaponOnStrike(): void {
    if (this.physics.equippedWeapon === 'KATANA') {
      SoundFX.playBladeSlash();
      this.physics.weaponDurability--;
      if (this.physics.weaponDurability <= 0) {
        this.physics.equippedWeapon = 'UNARMED';
      }
    }
  }

  /** PUNCH — branching jab (LIGHT_1) → cross (LIGHT_2) → spin finisher (LIGHT_3). */
  private triggerPunch(): void {
    this.consumeWeaponOnStrike();

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

  /** KICK — contextual: LEG SWEEP ender, FLYING KICK out of a sprint, or power kick. */
  private triggerKick(): void {
    // LEG SWEEP ender: PUNCH, PUNCH, KICK — the third chain hit drops low.
    if (this.comboTimer > 0 && this.comboStep === 2) {
      this.consumeWeaponOnStrike();
      this.setState('ATTACK_SWEEP');
      const sweepDir = this.physics.facingRight ? 1 : -1;
      this.physics.velocity.x = sweepDir * 210;
      this.comboStep = 0;
      this.comboTimer = 0;
      this.runSustainTimer = 0;
      SoundFX.playWhoosh(0.95);
      return;
    }

    // FLYING KICK (Xiao Xiao): only launches out of a sustained full sprint.
    if (
      this.physics.grounded &&
      this.runSustainTimer >= PlayerController.FLYING_KICK_SUSTAIN &&
      Math.abs(this.physics.velocity.x) >= this.RUN_SPEED * 0.95
    ) {
      this.consumeWeaponOnStrike();
      this.setState('ATTACK_FLYING_KICK');
      const flyDir = this.physics.facingRight ? 1 : -1;
      this.physics.velocity.x = flyDir * 470;
      this.physics.velocity.y = -300;
      this.physics.grounded = false;
      this.runSustainTimer = 0;
      this.comboStep = 0;
      this.comboTimer = 0;
      SoundFX.playWhoosh(1.35);
      return;
    }

    this.consumeWeaponOnStrike();
    this.setState('ATTACK_KICK');
    const dir = this.physics.facingRight ? 1 : -1;
    this.physics.velocity.x = dir * 240; // Committing forward thrust
    this.comboStep = 0;
    this.comboTimer = 0;
    this.runSustainTimer = 0;
  }

  /** CHAIN FINISHER — auto-loaded once a landed combo crosses 5 hits. */
  private triggerFinisher(): void {
    this.consumeWeaponOnStrike();
    this.setState('ATTACK_HEAVY');
    const dir = this.physics.facingRight ? 1 : -1;
    this.physics.velocity.x = dir * 260;
    this.comboStep = 0;
    this.comboTimer = 0;
    SoundFX.playWhoosh(1.4);
  }

  /**
   * SPECIAL / SUPER — consumes combo meter points once CombatDirector accepts
   * the trigger. The move plays with i-frames; the director burns the meter
   * and resolves the area damage during the strike window.
   */
  private triggerSpecial(id: SpecialMoveId): void {
    this.consumeWeaponOnStrike();
    this.pendingSpecial = id;
    this.comboStep = 0;
    this.comboTimer = 0;
    const dir = this.physics.facingRight ? 1 : -1;

    if (id === 'EXECUTIONER') {
      this.setState('ATTACK_SUPER');
      this.physics.velocity.x = dir * 50;
      this.specialInvulnTimer = 0.85;
      SoundFX.playWhoosh(1.7);
    } else {
      this.setState('ATTACK_SPECIAL');
      this.physics.velocity.x = dir * 170;
      this.specialInvulnTimer = 0.5;
      SoundFX.playWhoosh(1.25);
    }
  }

  /** Called by CombatDirector when the trigger cannot be honoured (grappling, out of meter). */
  public cancelSpecial(): void {
    this.pendingSpecial = null;
    this.specialInvulnTimer = 0;
    if (this.physics.state === 'ATTACK_SPECIAL' || this.physics.state === 'ATTACK_SUPER') {
      this.physics.state = 'IDLE';
      this.physics.stateTimer = 0;
      this.physics.velocity.x = 0;
    }
  }

  private handleMovement(input: InputState, dt: number): void {
    const isAttacking = this.isAttackState(this.physics.state);

    // Horizontal movement — rate-limited so velocity actually reaches the
    // target (an exponential approach never arrives, which reads as input lag
    // at the top end of the stick).
    if (!this.physics.isDodging && !this.physics.isSliding && !this.physics.isBlocking && !isAttacking) {
      const targetSpeed = input.moveX * this.RUN_SPEED;

      if (Math.abs(input.moveX) > 0.08) {
        this.physics.velocity.x = moveToward(
          this.physics.velocity.x,
          targetSpeed,
          this.ACCELERATION * dt
        );

        // Pivot instead of snapping: only mirror the body once momentum agrees
        // with the new direction (or has died), so reversing at speed reads as a
        // plant-and-turn rather than an instant full-body flip.
        const wantRight = input.moveX > 0;
        if (wantRight !== this.physics.facingRight) {
          const carrying = Math.sign(this.physics.velocity.x) === (wantRight ? 1 : -1);
          if (Math.abs(this.physics.velocity.x) < 80 || carrying) {
            this.physics.facingRight = wantRight;
          }
        }
      } else {
        this.physics.velocity.x = moveToward(this.physics.velocity.x, 0, this.FRICTION * dt);
      }
    } else if (this.physics.isSliding) {
      // Constant-rate slide scrub: predictable length, ties to the 0.42s exit
      this.physics.velocity.x = moveToward(this.physics.velocity.x, 0, 950 * dt);
    } else if (this.physics.state === 'ATTACK_FLYING_KICK') {
      // Airborne launch: keep the sprint's momentum and let gravity draw the
      // arc — only a slow bleed, so the kick actually covers ground.
      this.physics.velocity.x = moveToward(this.physics.velocity.x, 0, 110 * dt);
    } else if (this.physics.isBlocking || isAttacking) {
      // Natural attack/block friction — frame-rate independent decay
      this.physics.velocity.x *= Math.exp(-7.7 * dt);
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

    // The hurt flinch owns the pose for its duration — including the frame it
    // lands on — so the hit reaction actually plays instead of being stomped by
    // LAND / locomotion one frame after it starts.
    const inHurtFlinch =
      this.physics.state === 'HURT' &&
      this.physics.stateTimer < PlayerController.HURT_HOLD;

    // Ground Collision Check
    if (this.physics.position.y >= this.GROUND_Y) {
      if (!this.physics.grounded) {
        // Just landed
        this.physics.grounded = true;
        if (
          !inHurtFlinch &&
          !this.physics.isDodging &&
          !this.physics.isSliding &&
          !isAttacking
        ) {
          this.setState('LAND');
        }
      }
      this.physics.position.y = this.GROUND_Y;
      this.physics.velocity.y = 0;
    }

    // State Selection for locomotion when not locked in action
    if (inHurtFlinch) {
      // Hold the flinch; locomotion takes back over the frame it decays.
    } else if (this.physics.grounded && !this.physics.isDodging && !this.physics.isSliding && !this.physics.isBlocking && !isAttacking) {
      if (this.physics.state === 'LAND' && this.physics.stateTimer < 0.12) {
        // Stay in land compression briefly
      } else {
        this.locomotionState = this.pickGait(Math.abs(this.physics.velocity.x));
        if (this.locomotionState === 'RUN') this.setState('RUN');
        else if (this.locomotionState === 'WALK') this.setState('WALK');
        else this.setState('IDLE');
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

  /**
   * Gait selector with hysteresis: each state has its own enter/exit band so
   * hovering around a speed boundary can't toggle the pose every frame.
   */
  private pickGait(speed: number): 'IDLE' | 'WALK' | 'RUN' {
    switch (this.locomotionState) {
      case 'RUN':
        if (speed >= 130) return 'RUN';
        return speed >= 26 ? 'WALK' : 'IDLE';
      case 'WALK':
        if (speed >= 170) return 'RUN';
        return speed >= 14 ? 'WALK' : 'IDLE';
      default:
        if (speed >= 170) return 'RUN';
        return speed >= 26 ? 'WALK' : 'IDLE';
    }
  }

  private setState(newState: AnimationState): void {
    if (this.physics.state !== newState) {
      this.physics.state = newState;
      this.physics.stateTimer = 0;
    }
  }

  /**
   * Direct state injection for director-driven reactions (pistol whip,
   * parry counter, gun-fu execution shot) — always restarts the timer.
   */
  public forceState(newState: AnimationState): void {
    this.physics.state = newState;
    this.physics.stateTimer = 0;
  }

  private isAttackState(s: AnimationState): boolean {
    return s.startsWith('ATTACK_');
  }

  private getAttackDuration(s: AnimationState): number {
    switch (s) {
      case 'ATTACK_LIGHT_1': return 0.20;
      case 'ATTACK_LIGHT_2': return 0.22;
      case 'ATTACK_LIGHT_3': return 0.26;
      case 'ATTACK_KICK': return 0.34;
      case 'ATTACK_SWEEP': return 0.30;
      case 'ATTACK_FLYING_KICK': return 0.40;
      case 'ATTACK_HEAVY': return 0.32;
      case 'ATTACK_SPECIAL': return 0.58;
      case 'ATTACK_SUPER': return 0.95;
      case 'ATTACK_GUN_SHOT': return 0.22;
      default: return 0.25;
    }
  }
}
