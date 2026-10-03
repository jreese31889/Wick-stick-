import { AnimationState, InputState, PerkId, PlayerPhysics, SpecialMoveId, StickFigurePose, WeaponType } from '../types/game';
import { clamp, lerp } from './MathUtils';
import { AnimationController } from './AnimationController';
import { StickRig } from './StickRig';
import { SoundFX } from './SoundFX';
import { Ragdoll } from './Ragdoll';
import { GUNS, GUN_ORDER, GunId, isGun } from './Weapons';
import { emitProgress, PROGRESS_EVENTS } from '../profile/ProgressEvents';
import type { RunProfile } from '../profile/Progression';

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

  // ---- PHASE 2: run-scoped profile stats (tier 0 = shipped baseline) ----
  /** Movement-speed multiplier from the Footwork upgrade. */
  private runSpeedMult = 1;
  /** Reload-duration multiplier (Swift Reload move unlocks a faster cycle). */
  private runReloadMult = 1;
  /** Fraction of max Focus granted on wave clear / execution. */
  private runFocusGainRatio = 0;
  /** Damage taken during the current wave (drives the UNTOUCHABLE achievement). */
  public waveDamageTaken = 0;

  // Constants
  private readonly RUN_SPEED = 320;
  private readonly SLIDE_SPEED = 480;
  private readonly ROLL_SPEED = 420;
  private readonly JUMP_FORCE = -540;
  private readonly GRAVITY = 1350;
  private readonly ACCELERATION = 2200;
  private readonly FRICTION = 1800;
  private readonly GROUND_Y = 0; // Stage floor baseline

  /** PHASE 2: profile-scaled locomotion speeds (identical at tier 0). */
  private runSpeed(): number {
    return this.RUN_SPEED * this.runSpeedMult;
  }
  private slideSpeed(): number {
    return this.SLIDE_SPEED * this.runSpeedMult;
  }
  private rollSpeed(): number {
    return this.ROLL_SPEED * this.runSpeedMult;
  }

  // Godot-style CharacterBody2D Jump Buffering & Coyote Time
  private jumpBufferTimer = 0;
  private coyoteTimer = 0;

  // PHASE 1B A9: buffered attack / dodge presses. A press that lands while
  // BLOCK, SLIDE, DODGE_ROLL or an attack recovery owns the controller is
  // held for INPUT_BUFFER seconds and spent the moment the lock clears —
  // design §6/§17 "input buffering throughout — forgives imperfect timing".
  // The window is frozen while a dodge/slide owns the controller (those locks
  // the player cannot end early) and bleeds normally through block/recovery.
  private static readonly INPUT_BUFFER = 0.3;
  private punchBufferTimer = 0;
  private kickBufferTimer = 0;
  private dodgeBufferTimer = 0;

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
  /**
   * PHASE 1B aim model: true while a twin-stick aim input is live (right
   * stick or the touch aim stick). Drives angled fire, tightened spread and
   * the camera push-in — hip-fire (false) keeps the shipped straight ray.
   */
  public precisionAim = false;
  public hasFiredBulletThisShot = false;
  public hasThrownKnifeThisFrame = false;
  /**
   * SHOOT edge for the pistol, deferred to CombatDirector: only the director
   * can see live enemies, so it decides between a point-blank PISTOL WHIP and
   * a real shot (ammo spend, recoil, tracer) and resolves the result here.
   */
  public pendingPistolShot = false;
  /**
   * Same deferred-SHOOT edge for the automatics and the shotgun. Only the
   * director can see live targets, so it decides between a point-blank whip
   * and a real shot (ammo spend, recoil, tracers) and resolves it here.
   */
  public pendingSalvoShot = false;
  /** One salvo per trigger pull — the director clears it once a shot commits. */
  public hasFiredSalvoThisShot = false;

  // ---- Phase 1 firearm arsenal (stats live in engine/Weapons.ts) ----
  /** The held gun. Never written into `physics.equippedWeapon` — that stays melee. */
  public currentGun: GunId = 'PISTOL';
  public gunState: Record<GunId, { owned: boolean; ammo: number; reserve: number; magSize: number }> = {
    PISTOL: { owned: true, ammo: GUNS.PISTOL.magSize, reserve: GUNS.PISTOL.reserveMax, magSize: GUNS.PISTOL.magSize },
    SMG: { owned: false, ammo: 0, reserve: 0, magSize: GUNS.SMG.magSize },
    SHOTGUN: { owned: false, ammo: 0, reserve: 0, magSize: GUNS.SHOTGUN.magSize },
    RIFLE: { owned: false, ammo: 0, reserve: 0, magSize: GUNS.RIFLE.magSize },
  };
  /** Seconds until the held gun may fire again (automatics only need this). */
  private gunCooldown = 0;
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
      ammo: GUNS.PISTOL.magSize,
      maxAmmo: GUNS.PISTOL.magSize,
      reserveAmmo: GUNS.PISTOL.reserveMax,
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
      swap: false,
      swapJustPressed: false,
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

  // ---- Phase 1 arsenal: reload / swap / pickups (stats from engine/Weapons.ts) ----

  /**
   * Starts a reload for the held gun: tactical timer when rounds remain in the
   * magazine, empty-chamber timer when it is dry. No-op when already reloading
   * or when there is nothing to move out of the reserve.
   */
  public beginReload(): void {
    if (this.physics.isReloading) return;
    const gun = this.gunState[this.currentGun];
    if (this.physics.ammo >= gun.magSize || this.physics.reserveAmmo <= 0) return;
    const stats = GUNS[this.currentGun];
    this.physics.isReloading = true;
    const base = this.physics.ammo > 0 ? stats.reloadTactical : stats.reloadEmpty;
    this.physics.reloadTimer = base * this.runReloadMult;
    SoundFX.playReload();
  }

  /** Moves rounds from reserve into the magazine when the reload timer lapses. */
  private finishReload(): void {
    const gun = this.gunState[this.currentGun];
    const need = this.physics.maxAmmo - this.physics.ammo;
    const take = Math.min(need, this.physics.reserveAmmo);
    this.physics.ammo += take;
    this.physics.reserveAmmo -= take;
    gun.ammo = this.physics.ammo;
    gun.reserve = this.physics.reserveAmmo;
    this.physics.isReloading = false;
    this.physics.reloadTimer = 0;
  }

  /** Cycles to the next owned firearm in roster order (wraps around). */
  public cycleGun(): void {
    const start = Math.max(0, GUN_ORDER.indexOf(this.currentGun));
    for (let i = 1; i <= GUN_ORDER.length; i++) {
      const id = GUN_ORDER[(start + i) % GUN_ORDER.length];
      if (id !== this.currentGun && this.gunState[id].owned) {
        this.equipGun(id);
        return;
      }
    }
    SoundFX.playGunCock(); // single gun — rack the slide as feedback
  }

  /** Stashes the held magazine, loads the new gun's and mirrors it into physics. */
  private equipGun(id: GunId): void {
    const cur = this.gunState[this.currentGun];
    cur.ammo = this.physics.ammo;
    cur.reserve = this.physics.reserveAmmo;
    cur.magSize = this.physics.maxAmmo;

    this.currentGun = id;
    const next = this.gunState[id];
    this.physics.ammo = next.ammo;
    this.physics.maxAmmo = next.magSize;
    this.physics.reserveAmmo = next.reserve;
    this.physics.isReloading = false;
    this.physics.reloadTimer = 0;
    this.gunCooldown = 0;

    // A picked-up melee SHOTGUN would otherwise shadow the arsenal shotgun
    if (id === 'SHOTGUN' && this.physics.equippedWeapon === 'SHOTGUN') {
      this.physics.equippedWeapon = 'UNARMED';
    }
    SoundFX.playGunCock();
  }

  /** Weapon-pickup entry point (GameLoop drains `physics.pendingGunPickup`). */
  public pickupGun(weapon: WeaponType): void {
    if (!isGun(weapon)) return;
    const id = weapon as GunId;
    const stats = GUNS[id];
    const gun = this.gunState[id];
    const magSize = id === 'PISTOL' && this.physics.perks['EXTENDED_MAG'] ? 12 : stats.magSize;

    if (!gun.owned) {
      gun.owned = true;
      gun.magSize = magSize;
      gun.ammo = magSize;
      gun.reserve = stats.reserveMax;
      this.equipGun(id);
      // Brand new gun: it comes out of the case loaded, reserve full
      this.physics.ammo = magSize;
      this.physics.maxAmmo = magSize;
      this.physics.reserveAmmo = stats.reserveMax;
      gun.ammo = magSize;
      gun.reserve = stats.reserveMax;
    } else {
      gun.reserve = Math.min(stats.reserveMax, gun.reserve + Math.ceil(stats.reserveMax / 2));
      this.equipGun(id);
    }
  }

  /** Ammo-pack pickup: tops up the held gun's reserve (GameLoop drains pendingAmmo). */
  public pickupAmmo(rounds: number): void {
    const stats = GUNS[this.currentGun];
    const gun = this.gunState[this.currentGun];
    gun.reserve = Math.min(stats.reserveMax, gun.reserve + rounds);
    this.physics.reserveAmmo = gun.reserve;
  }

  /** Wave-clear restock: half a reserve pouch for every owned gun. */
  public restockAmmo(): void {
    for (let i = 0; i < GUN_ORDER.length; i++) {
      const id = GUN_ORDER[i];
      const gun = this.gunState[id];
      if (!gun.owned) continue;
      gun.reserve = Math.min(GUNS[id].reserveMax, gun.reserve + Math.ceil(GUNS[id].reserveMax / 2));
    }
    this.physics.reserveAmmo = this.gunState[this.currentGun].reserve;
  }

  /** Focus costs a flat chunk to trigger — never below 0 after the spend. */
  private static readonly FOCUS_COST = 35;

  public triggerFocus(): boolean {
    if (this.physics.focus >= PlayerController.FOCUS_COST && !this.physics.isFocusActive) {
      this.physics.focus = Math.max(0, this.physics.focus - PlayerController.FOCUS_COST);
      this.physics.isFocusActive = true;
      this.physics.focusTimer = 5.5;
      SoundFX.playWhoosh(0.5);
      return true;
    }
    return false;
  }

  /**
   * PHASE 2: Focus grant on wave clear / execution (tier 0 ratio = 0, so the
   * shipped one-burst-per-run behaviour is untouched until upgraded).
   */
  public grantFocus(ratio: number): void {
    if (ratio <= 0) return;
    this.physics.focus = Math.min(
      this.physics.maxFocus,
      this.physics.focus + this.physics.maxFocus * ratio
    );
  }

  /**
   * PHASE 2: paints the profile's run stats onto this fighter. Called once per
   * run start (after fullReset, which builds a fresh controller).
   */
  public applyRunProfile(run: RunProfile): void {
    this.runSpeedMult = run.speedMult > 0 ? run.speedMult : 1;
    this.runReloadMult = run.reloadMult > 0 ? run.reloadMult : 1;
    this.runFocusGainRatio = Math.max(0, run.focusGainRatio);
    this.waveDamageTaken = 0;

    if (run.healthBonus > 0) {
      this.physics.maxHealth += run.healthBonus;
      this.physics.health = Math.min(
        this.physics.maxHealth,
        this.physics.health + run.healthBonus
      );
    }
    if (run.focusMaxBonus > 0) {
      this.physics.maxFocus += run.focusMaxBonus;
      this.physics.focus = Math.min(
        this.physics.maxFocus,
        this.physics.focus + run.focusStartBonus
      );
    }
    if (run.startFullReserve) {
      for (const id of GUN_ORDER) {
        const gun = this.gunState[id];
        gun.reserve = GUNS[id].reserveMax;
      }
      this.physics.reserveAmmo = this.gunState[this.currentGun].reserve;
    }

    const LOADOUT_WEAPONS: Record<string, WeaponType | null> = {
      FISTS: null,
      SMG: 'SMG',
      SHOTGUN: 'SHOTGUN',
      RIFLE: 'RIFLE',
      KATANA: 'KATANA',
    };
    const weapon = LOADOUT_WEAPONS[run.loadout];
    if (weapon === 'KATANA') this.equipWeapon('KATANA');
    else if (weapon) this.pickupGun(weapon);
  }

  /** Ratio the next wave-clear / execution Focus grant will pay out. */
  public get focusGainRatio(): number {
    return this.runFocusGainRatio;
  }

  public applyPerk(perkId: PerkId): void {
    this.physics.perks[perkId] = true;
    if (perkId === 'KEVLAR_WEAVE') {
      this.physics.maxHealth += 30;
      this.physics.health = Math.min(this.physics.maxHealth, this.physics.health + 30);
    } else if (perkId === 'EXTENDED_MAG') {
      this.physics.maxAmmo = 12;
      this.physics.ammo = 12;
      this.gunState.PISTOL.magSize = 12;
      this.gunState.PISTOL.ammo = Math.min(12, this.gunState.PISTOL.ammo + 5);
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
    const healthBefore = this.physics.health;
    this.physics.health = Math.max(0, this.physics.health - damage);
    // PHASE 2: wave damage ledger (UNTOUCHABLE) + progression listener
    const taken = healthBefore - this.physics.health;
    if (taken > 0) {
      this.waveDamageTaken += taken;
      emitProgress(PROGRESS_EVENTS.PLAYER_DAMAGED, { amount: taken });
    }
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
      this.precisionAim = true;
      // Turn to face aim direction if not actively in an attack animation
      if (!this.isAttackState(this.physics.state) && !this.physics.isDodging && !this.physics.isSliding) {
        this.physics.facingRight = input.aimX >= 0;
      }
    } else {
      this.physics.aimAngle = null;
      this.precisionAim = false;
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

    // Reload progress countdown — tactical (round stays chambered) vs empty
    if (this.physics.isReloading) {
      this.physics.reloadTimer -= dt;
      if (this.physics.reloadTimer <= 0) {
        this.finishReload();
      }
    }

    // Per-gun inter-shot cooldown (automatics, shotgun, rifle)
    if (this.gunCooldown > 0) this.gunCooldown = Math.max(0, this.gunCooldown - dt);

    // Bullet-Time Focus timer countdown
    if (this.physics.isFocusActive) {
      this.physics.focusTimer -= dt;
      // PHASE 2: the Focus pool is a consumable now — it was spent on trigger
      // and is no longer drained/zeroed by the burst timer.
      if (this.physics.focusTimer <= 0) {
        this.physics.isFocusActive = false;
      }
    }

    // Sustained full-speed run detection — the KICK button reads this to decide
    // between a standing power kick and a Xiao Xiao FLYING KICK.
    const atFullRun =
      this.physics.grounded &&
      Math.abs(input.moveX) > 0.6 &&
      this.physics.velocity.x !== 0 &&
      Math.sign(input.moveX) === Math.sign(this.physics.velocity.x) &&
      Math.abs(this.physics.velocity.x) >= this.runSpeed() * 0.95;
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

    // PHASE 1B A9: capture the buffered press channels. A fresh press refills
    // the window, an idle one bleeds out (frozen while dodge/slide hold the
    // controller); handleActions spends each channel the frame the state that
    // blocked it clears (see INPUT_BUFFER).
    const bufferFrozen = this.physics.isDodging || this.physics.isSliding;
    const bufferBleed = bufferFrozen ? 0 : dt;
    this.punchBufferTimer = input.attackJustPressed
      ? PlayerController.INPUT_BUFFER
      : Math.max(0, this.punchBufferTimer - bufferBleed);
    this.kickBufferTimer = input.heavyAttackJustPressed
      ? PlayerController.INPUT_BUFFER
      : Math.max(0, this.kickBufferTimer - bufferBleed);
    this.dodgeBufferTimer = input.dodgeJustPressed
      ? PlayerController.INPUT_BUFFER
      : Math.max(0, this.dodgeBufferTimer - bufferBleed);

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

    // DODGE / SLIDE TRIGGER (PHASE 1B: accepts a buffered press too)
    if (
      (input.dodgeJustPressed || this.dodgeBufferTimer > 0) &&
      !this.physics.isDodging &&
      !this.physics.isSliding &&
      this.physics.stamina >= 15
    ) {
      this.dodgeBufferTimer = 0;
      // A3: the guard never travels with the move. A roll/slide that inherits
      // isBlocking decays instead of carrying momentum, and releasing block
      // mid-move would stomp DODGE_ROLL back to IDLE while isDodging is still
      // true — 0.36 s of standing i-frames that swallow every input.
      this.physics.isBlocking = false;
      this.physics.stamina -= 15;
      const isCrouching = input.moveY > 0.4;
      const hasSpeed = Math.abs(this.physics.velocity.x) > 100;

      if (isCrouching || (hasSpeed && input.moveY > 0.2)) {
        // LOW SLIDE
        this.setState('SLIDE');
        this.physics.isSliding = true;
        const dir = this.physics.facingRight ? 1 : -1;
        this.physics.velocity.x = dir * this.slideSpeed();
        SoundFX.playSlide();
        return;
      } else {
        // COMBAT DODGE ROLL
        this.setState('DODGE_ROLL');
        this.physics.isDodging = true;
        const moveDir = Math.abs(input.moveX) > 0.1 ? Math.sign(input.moveX) : (this.physics.facingRight ? 1 : -1);
        this.physics.facingRight = moveDir > 0;
        this.physics.velocity.x = moveDir * this.rollSpeed();
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

    // SWAP — cycle the owned firearms (keyboard X / pad L3 / touch SWAP)
    if (input.swapJustPressed && !this.physics.isDodging) {
      this.cycleGun();
      return;
    }

    // RELOAD TRIGGER — tactical timer when a round is chambered, empty timer otherwise
    if (input.reloadJustPressed && !this.physics.isReloading && !this.physics.isDodging) {
      this.beginReload();
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

      // Non-pistol firearms defer to the salvo path (pellets / per-gun stats)
      if (this.currentGun !== 'PISTOL') {
        if (this.physics.isReloading || this.gunCooldown > 0) return;
        if (this.physics.ammo <= 0) {
          SoundFX.playGunCock();
          this.beginReload();
          return;
        }
        this.gunCooldown = GUNS[this.currentGun].fireInterval;
        this.pendingSalvoShot = true;
        return;
      }

      // Pistol: defer the whole resolution (point-blank PISTOL WHIP, real
      // shot, or empty-chamber click) to CombatDirector — it is the only
      // system with a view of live enemy range. No ammo is spent here.
      this.pendingPistolShot = true;
      return;
    }

    // Arsenal automatics (SMG): holding SHOOT keeps firing while the cooldown lapses
    const autoStats = GUNS[this.currentGun];
    if (
      autoStats.auto &&
      this.currentGun !== 'PISTOL' &&
      input.shoot &&
      !this.physics.isBlocking &&
      !this.physics.isDodging &&
      !this.physics.isSliding &&
      !this.physics.isReloading &&
      this.gunCooldown <= 0
    ) {
      if (this.physics.ammo <= 0) {
        SoundFX.playGunCock();
        this.beginReload();
      } else {
        this.gunCooldown = autoStats.fireInterval;
        this.pendingSalvoShot = true;
      }
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
    // PHASE 1B A9: a press buffered through BLOCK / DODGE / SLIDE lands here.
    if (
      (input.attackJustPressed || this.punchBufferTimer > 0) &&
      !this.physics.isBlocking &&
      !this.physics.isDodging
    ) {
      this.punchBufferTimer = 0;
      if (this.finisherArmed) {
        this.triggerFinisher();
      } else {
        this.triggerPunch();
      }
      return;
    }

    // KICK BUTTON — long-reach power kick (heavy damage, guard crush)
    if (
      (input.heavyAttackJustPressed || this.kickBufferTimer > 0) &&
      !this.physics.isBlocking &&
      !this.physics.isDodging
    ) {
      this.kickBufferTimer = 0;
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
      Math.abs(this.physics.velocity.x) >= this.runSpeed() * 0.95
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
      const targetSpeed = input.moveX * this.runSpeed();

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
