import { PlayerController } from './PlayerController';
import { EnemyController, resolveDamage, enemyBulletPool } from './EnemyController';
import { Camera } from './Camera';
import { SoundFX } from './SoundFX';
import { Haptics } from './Haptics';
import { ragdollPool } from './Ragdoll';
import { ObjectPool } from './ObjectPool';
import { DamagePopup, ImpactSpark, ShockwaveRing, BulletTracer, CasingParticle, BloodDecal, BladeSlashArc, EnemyBullet, DestructibleObject } from '../types/game';
import { EnvironmentManager } from './EnvironmentManager';
import { GUNS, falloffMultiplier } from './Weapons';

/**
 * Distance along a ray to a vertical target segment (x = targetX, y within
 * [minY, maxY]). Returns -1 on a miss. Allocation-free so it can run per
 * pellet inside the fixed step.
 */
function rayToVertical(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  targetX: number,
  minY: number,
  maxY: number,
  maxT: number
): number {
  if (dx === 0) return -1;
  const t = (targetX - ox) / dx;
  if (t <= 0 || t > maxT) return -1;
  const y = oy + dy * t;
  if (y < minY || y > maxY) return -1;
  return t;
}

/**
 * Recycles the oldest `count` entries of a capped FX array back into its pool
 * (M14: keeps the live arrays bounded without allocating or dropping shells).
 */
function trimOldest<T>(arr: T[], count: number, pool: ObjectPool<T>): void {
  const n = Math.max(0, Math.min(count, arr.length));
  for (let i = 0; i < n; i++) {
    const old = arr.shift();
    if (old === undefined) break;
    pool.release(old);
  }
}

export interface CombatStats {
  comboCount: number;
  comboTimer: number;
  maxCombo: number;
  /** True while the chain finisher is loaded — the next landed strike detonates it. */
  finisherArmed: boolean;
  totalDamageDealt: number;
  parryCount: number;
  takedownCount: number;
  styleRating: string;
  score: number;
}

export class CombatDirector {
  public popups: DamagePopup[] = [];
  public sparks: ImpactSpark[] = [];
  public shockwaves: ShockwaveRing[] = [];
  public tracers: BulletTracer[] = [];
  public casings: CasingParticle[] = [];
  public bloodDecals: BloodDecal[] = [];
  public bladeArcs: BladeSlashArc[] = [];
  public enemyBullets: EnemyBullet[] = [];

  // M14: free lists for the high-churn FX families. Acquire on spawn, release
  // on removal, so a busy fight allocates nothing after the pools warm up.
  private sparkPool = new ObjectPool<ImpactSpark>(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: '#ffffff', size: 1 }),
    CombatDirector.MAX_SPARKS + 64
  );
  private popupPool = new ObjectPool<DamagePopup>(
    () => ({ id: 0, x: 0, y: 0, text: '', color: '#ffffff', size: 16, life: 0, maxLife: 0, vy: 0 }),
    CombatDirector.MAX_POPUPS + 16
  );
  private bloodPool = new ObjectPool<BloodDecal>(
    () => ({
      x: 0, y: 0, vx: 0, vy: 0, radius: 1, alpha: 1,
      life: 0, maxLife: 1, isStuck: false,
    }),
    CombatDirector.MAX_BLOOD + 64
  );
  private casingPool = new ObjectPool<CasingParticle>(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0, life: 0 }),
    CombatDirector.MAX_CASINGS + 32
  );
  private shockwavePool = new ObjectPool<ShockwaveRing>(
    () => ({ x: 0, y: 0, radius: 0, maxRadius: 0, life: 0, maxLife: 0, color: '#ffffff', lineWidth: 0 }),
    CombatDirector.MAX_SHOCKWAVES + 8
  );
  private tracerPool = new ObjectPool<BulletTracer>(
    () => ({ id: 0, x1: 0, y1: 0, x2: 0, y2: 0, life: 0, maxLife: 0, color: '#fef08a', width: 3 }),
    CombatDirector.MAX_TRACERS + 16
  );
  private bladeArcPool = new ObjectPool<BladeSlashArc>(
    () => ({ id: 0, x: 0, y: 0, angle: 0, radius: 0, arcLength: 0, color: '#f59e0b', life: 0, maxLife: 0 }),
    CombatDirector.MAX_BLADE_ARCS + 8
  );
  
  public hitStopFrames: number = 0;
  public slowMoFactor: number = 1.0;
  public slowMoTimer: number = 0;
  public speedLinesTimer: number = 0; // Cinematic radial speed lines on heavy impacts
  /**
   * PHASE 1B 11 — adaptive difficulty signal: damage the player has eaten
   * recently. GameLoop reads (and periodically clears) this window to steer
   * the squad's aggression scalar; it starts every run at 0 (neutral).
   */
  public playerDamageWindow = 0;

  public stats: CombatStats = {
    comboCount: 0,
    comboTimer: 0,
    maxCombo: 0,
    finisherArmed: false,
    totalDamageDealt: 0,
    parryCount: 0,
    takedownCount: 0,
    styleRating: 'NOIR',
    score: 0
  };

  private popupIdCounter = 0;
  private tracerIdCounter = 0;
  private playerAttackRegistered = false;
  private lastPlayerState = '';

  // ============================================================
  // PHASE 1B 8 — STYLE METER (DESIGN §14)
  //   Style points accrue from *variety*: each move kind pays out, but
  //   repeating the same kind back-to-back pays less and less. The meter
  //   bleeds off while the fight goes quiet, so the rank under the combo
  //   HUD reflects how alive the brawl currently is.
  // ============================================================
  public stylePoints = 0;
  public styleRank = 'D';
  /** Last kind registered + how many times it has been chained — repeat decay. */
  private styleKind = '';
  private styleRepeat = 0;
  private styleIdle = 0;
  /** Seconds after which an untouched meter starts draining. */
  private static readonly STYLE_GRACE = 2.2;
  private static readonly STYLE_DECAY = 9;
  /** Base payout per style action kind (before the repeat penalty). */
  private static readonly STYLE_PAYOUT: Record<string, number> = {
    JAB: 3,
    KICK: 5,
    SWEEP: 9,
    FLYING_KICK: 8,
    FINISHER: 18,
    PARRY: 14,
    RIPOSTE: 12,
    TAKEDOWN: 16,
    EXECUTION: 20,
    GRAPPLE: 10,
    HEADSHOT: 12,
    RICOCHET: 7,
    DISARM: 12,
    ENV: 16,
    MULTI: 12,
    GUNFU: 10,
  };

  /**
   * PHASE 1B style payout. `kind` is a STYLE_PAYOUT key; repeating the same
   * kind decays its value to a 30% floor, and switching kinds resets the
   * chain — the whole point is rewarding variety over spam.
   */
  public registerStyle(kind: string): void {
    const base = CombatDirector.STYLE_PAYOUT[kind];
    if (base === undefined) return;
    if (this.styleKind === kind) {
      this.styleRepeat++;
    } else {
      this.styleKind = kind;
      this.styleRepeat = 0;
    }
    const penalty = Math.max(0.3, 1 - this.styleRepeat * 0.22);
    this.stylePoints = Math.min(100, this.stylePoints + base * penalty);
    this.styleIdle = 0;
    this.updateStyleRank();
  }

  private updateStyleRank(): void {
    const p = this.stylePoints;
    this.styleRank = p >= 90 ? 'SS' : p >= 75 ? 'S' : p >= 55 ? 'A' : p >= 35 ? 'B' : p >= 15 ? 'C' : 'D';
  }


  // Awarded once per wave when the last enemy dies; cleared on the next spawn
  private waveClearAwarded = false;

  // ============================================================
  // COMBO SYSTEM
  //   Landed hits inside COMBO_WINDOW extend the chain.
  //   Damage scales +5% per chained hit (max 2.0x at 20 hits).
  //   Every FINISHER_EVERY hits arms the chain finisher — the next
  //   strike plays the heavy finisher animation at 2.5x damage.
  // ============================================================
  public static readonly COMBO_WINDOW = 2.8;
  public static readonly FINISHER_EVERY = 5;
  /**
   * M14 hard caps on live FX arrays (blood, sparks, popups, casings, tracers,
   * shockwaves, blade arcs). Overflow recycles the oldest entry, so a particle
   * storm can never blow up frame time or the heap. All limits sit well above
   * anything a real fight produces, so normal play never hits them.
   */
  public static readonly MAX_BLOOD = 160;
  public static readonly MAX_SPARKS = 320;
  public static readonly MAX_POPUPS = 48;
  public static readonly MAX_CASINGS = 96;
  public static readonly MAX_TRACERS = 64;
  public static readonly MAX_SHOCKWAVES = 32;
  public static readonly MAX_BLADE_ARCS = 24;
  /** P3-01: live enemy rounds (drained from EnemyController.pendingShots). */
  public static readonly MAX_ENEMY_BULLETS = 64;

  // P5-02: FX budgets per quality tier (high == the static defaults above;
  // pools stay sized for high so a mid-run tier switch never overflows).
  public quality: 'low' | 'medium' | 'high' = 'high';
  public get sparkCap(): number {
    return this.quality === 'high' ? CombatDirector.MAX_SPARKS : this.quality === 'medium' ? 180 : 100;
  }
  public get bloodCap(): number {
    return this.quality === 'high' ? CombatDirector.MAX_BLOOD : this.quality === 'medium' ? 100 : 60;
  }

  /** Escalating chain damage multiplier for the currently running combo. */
  public comboDamageMultiplier(): number {
    return 1 + Math.min(this.stats.comboCount, 20) * 0.05;
  }

  /** Registers n landed hits inside the timing window. */
  private addCombo(n: number = 1, timer: number = CombatDirector.COMBO_WINDOW): void {
    const from = this.stats.comboCount;
    this.stats.comboCount = from + n;
    this.stats.comboTimer = timer;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.comboCount);
    // Arm the chain finisher on every threshold crossed (5x, 10x, 15x...)
    for (let c = from + 1; c <= this.stats.comboCount; c++) {
      if (c % CombatDirector.FINISHER_EVERY === 0) this.stats.finisherArmed = true;
    }
    this.updateStyleRating();
  }

  /** Drops the chain: the player got hit or the timing window expired. */
  private breakCombo(): void {
    this.stats.comboCount = 0;
    this.stats.comboTimer = 0;
    this.stats.finisherArmed = false;
    this.updateStyleRating();
  }

  // ============================================================
  // SCORING FORMULA (single source of truth):
  //   kill        +100 x (1 + comboCount x 0.1), rounded
  //   parry       +25
  //   takedown    +150
  //   wave clear  +250
  // ============================================================
  private scoreForKill(): number {
    return Math.round(100 * (1 + this.stats.comboCount * 0.1));
  }

  // Grapple sequence state
  public isGrappling: boolean = false;
  public grappleTimer: number = 0;
  public grappledEnemy: EnemyController | null = null;
  /**
   * GRAB alone runs the judo slam; holding SHOOT while grabbing runs the
   * pistol-grip EXECUTION (a chambered round, spent at the temple).
   */
  private grappleVariant: 'THROW' | 'EXECUTION' = 'THROW';
  private grappleShotFired = false;

  // Gun-fu bodies thrown out of a slam that keep bowling through the squad
  private thrownEnemies: {
    enemy: EnemyController;
    hit: Set<EnemyController>;
    pins: number;
  }[] = [];

  // FLYING KICK tracks its victims per launch so one flight can mow a line
  private flyingKickHits = new Set<EnemyController>();

  // Perfect-parry cash-in window: the next landed strike detonates as a RIPOSTE
  private riposteWindow = 0;
  private static readonly RIPOSTE_WINDOW = 0.15;

  // Signature-move HUD banner (App re-renders the moment bannerChanged flips)
  public moveBanner = '';
  public moveBannerTimer = 0;
  public bannerChanged = false;

  /** Shows a signature-move name in the HUD for a beat (drives App re-render). */
  public announceMove(text: string, duration = 1.7): void {
    this.moveBanner = text;
    this.moveBannerTimer = duration;
    this.bannerChanged = true;
  }

  /** Reserve-ammunition pickup callout (Phase 1 D5). */
  public addAmmoPopup(x: number, y: number, amount: number): void {
    this.addPopup(x, y, `+${amount} ROUNDS`, '#7dd3fc', 16);
  }

  /**
   * Clears everything transient — grapple, thrown bodies, riposte window and
   * HUD banner — so a wave reset can never resume a half-finished sequence.
   */
  public resetTransientState(): void {
    this.isGrappling = false;
    this.grappledEnemy = null;
    this.grappleTimer = 0;
    this.grappleVariant = 'THROW';
    this.grappleShotFired = false;
    this.thrownEnemies.length = 0;
    this.flyingKickHits.clear();
    this.riposteWindow = 0;
    this.moveBanner = '';
    this.moveBannerTimer = 0;
    this.bannerChanged = true;
    // PHASE 1B: style meter + adaptive-damage window both restart per fight
    this.stylePoints = 0;
    this.styleRank = 'D';
    this.styleKind = '';
    this.styleRepeat = 0;
    this.styleIdle = 0;
    this.playerDamageWindow = 0;
  }

  public update(
    dt: number,
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera,
    environmentManager?: EnvironmentManager
  ) {
    // 1. Slow motion timer
    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= dt;
      if (this.slowMoTimer <= 0) {
        this.slowMoFactor = 1.0;
      }
    }

    // 1b. Speed lines decay
    if (this.speedLinesTimer > 0) {
      this.speedLinesTimer = Math.max(0, this.speedLinesTimer - dt);
    }

    // 1c. Signature-move banner + parry-riposte window decay (both run on the
    // effective dt, so hit-stop freezes them and slow-mo stretches them)
    if (this.moveBannerTimer > 0) {
      this.moveBannerTimer -= dt;
      if (this.moveBannerTimer <= 0) {
        this.moveBanner = '';
        this.bannerChanged = true;
      }
    }
    if (this.riposteWindow > 0) {
      this.riposteWindow = Math.max(0, this.riposteWindow - dt);
    }

    // 2. Hit-stop frame countdown
    if (this.hitStopFrames > 0) {
      this.hitStopFrames--;
      return; // Skip combat logic during freeze frames
    }

    // 3. Combo timer decay (chain dies when the timing window lapses)
    if (this.stats.comboTimer > 0) {
      this.stats.comboTimer -= dt;
      if (this.stats.comboTimer <= 0) {
        this.breakCombo();
      }
    }

    // 3b. PHASE 1B style meter: after a short grace window an untouched
    // meter drains, so the rank falls back toward D when the fight cools off.
    if (this.stylePoints > 0) {
      this.styleIdle += dt;
      if (this.styleIdle > CombatDirector.STYLE_GRACE) {
        this.stylePoints = Math.max(0, this.stylePoints - CombatDirector.STYLE_DECAY * dt);
        this.updateStyleRank();
      }
    }

    // 4. Update visual FX particles
    this.updateParticles(dt);

    // 4b. Gun-fu bodies still skidding down the floor bowl into the squad
    this.updateThrownEnemies(dt, enemies, camera);

    // 5. Handle active Grapple / Takedown
    if (this.isGrappling && this.grappledEnemy) {
      this.updateGrapple(dt, player, this.grappledEnemy, camera, enemies);
      return;
    }

    // 6. Reset attack register on player state change
    if (player.physics.state !== this.lastPlayerState) {
      this.playerAttackRegistered = false;
      if (this.lastPlayerState === 'ATTACK_FLYING_KICK') this.flyingKickHits.clear();
      this.lastPlayerState = player.physics.state;
    }

    // Handle Knife Throw
    if (player.hasThrownKnifeThisFrame && environmentManager) {
      const dir = player.physics.facingRight ? 1 : -1;
      environmentManager.throwKnife(player.physics.position.x, player.physics.position.y, dir);
    }

    // Phase 1 D3: queued explosive-barrel detonations (chained blasts drain here)
    if (environmentManager) {
      while (environmentManager.pendingExplosions.length > 0) {
        const pending = environmentManager.pendingExplosions[environmentManager.pendingExplosions.length - 1];
        const blastX = pending.x;
        const blastY = pending.y;
        environmentManager.releaseExplosion();
        this.detonateBarrel(blastX, blastY, player, enemies, camera, environmentManager);
      }
    }

    // Check Projectiles hitting enemies
    if (environmentManager) {
      environmentManager.checkProjectilesAgainstEnemies(enemies, (enemy, damage, px, py) => {
        const dir = player.physics.facingRight ? 1 : -1;
        const rawDamage = Math.max(1, Math.round(damage * this.comboDamageMultiplier()));
        const knifeDamage = enemy.takeDamage(rawDamage, dir * 340, -140, false);
        // Phased through on a dodge roll — the knife buries itself in the floor
        if (knifeDamage <= 0) {
          this.spawnSparks(px, py, dir, 5, '#94a3b8');
          return;
        }
        this.hitStopFrames = 7;
        camera.addTrauma(0.35);
        SoundFX.playKnifeStab(); // blade bites into flesh
        this.spawnShockwave(px, py, 45, '#fef08a');
        this.spawnSparks(px, py, dir, 14, '#ffffff');
        this.spawnBlood(px, py, dir, 8);
        this.addPopup(px, py - 25, `KNIFE IMPALE -${knifeDamage}!`, '#fef08a', 20);
        this.addCombo(1, 3.2);
      });
    }

    // Check Wall Bounce / Splat for any knocked enemies
    for (const enemy of enemies) {
      // Phase 1 C6: a threshold just crossed — banner, shockwave, slow-mo
      if (enemy.phaseChanged) {
        enemy.phaseChanged = false;
        this.announceMove(
          enemy.type === 'MARQUIS'
            ? `⚜️ PHASE ${enemy.bossPhase} — SOVEREIGN WRATH`
            : `🔥 PHASE ${enemy.bossPhase} — ENRAGED`,
          2.2
        );
        camera.addTrauma(0.45);
        this.slowMoFactor = 0.4;
        this.slowMoTimer = 0.35;
        this.speedLinesTimer = 0.3;
        this.spawnShockwave(enemy.position.x, enemy.position.y - 55, 85, '#f59e0b');
        SoundFX.playGunCock();
      }

      if (enemy.wallImpact) {
        enemy.wallImpact = false;
        SoundFX.playPunch('heavy');
        camera.addTrauma(0.32);
        this.spawnShockwave(enemy.position.x, enemy.position.y - 45, 50, '#fbbf24');
        this.spawnSparks(enemy.position.x, enemy.position.y - 45, enemy.position.x > 0 ? -1 : 1, 14, '#fbbf24');
        this.addPopup(enemy.position.x, enemy.position.y - 80, 'WALL SLAM!', '#fbbf24', 18);
        enemy.staggerMeter = Math.min(enemy.maxStagger, enemy.staggerMeter + 20);
        if (enemy.staggerMeter >= enemy.maxStagger) {
          enemy.isStaggered = true;
        }
      }

      // Check Enemy Defeat Loot Drop (Continental Gold Coins & Weapons)
      if (enemy.health <= 0 && !enemy.hasDroppedLoot && environmentManager) {
        enemy.hasDroppedLoot = true;
        this.stats.score += this.scoreForKill();
        const coinCount = enemy.type === 'BOSS' ? 6 : enemy.type === 'HEAVY' ? 3 : 1;
        for (let c = 0; c < coinCount; c++) {
          environmentManager.dropCoin(enemy.position.x + (c - (coinCount - 1) / 2) * 16, enemy.position.y - 35, 1);
        }
        if (enemy.type === 'BOSS' || (enemy.type === 'HEAVY' && Math.random() > 0.4)) {
          environmentManager.dropWeapon(enemy.type === 'BOSS' ? 'KATANA' : 'KNIFE', enemy.position.x, enemy.position.y - 40);
        }

        // == ELIMINATION CINEMATICS ==
        const isBigKill = enemy.type === 'HEAVY' || enemy.type === 'ELITE' || enemy.type === 'DEFENDER' || enemy.type === 'BOSS' || enemy.type === 'MARQUIS';
        this.spawnShockwave(enemy.position.x, enemy.position.y - 50, isBigKill ? 90 : 55, '#f8fafc');
        this.spawnSparks(enemy.position.x, enemy.position.y - 50, enemy.position.x >= 0 ? -1 : 1, isBigKill ? 16 : 8, '#e2e8f0');
        this.addPopup(
          enemy.position.x,
          enemy.position.y - 110,
          isBigKill ? 'ELIMINATED' : 'DOWN',
          isBigKill ? '#f59e0b' : '#94a3b8',
          isBigKill ? 22 : 14
        );
        if (isBigKill) {
          // Brief dramatic slow-mo on significant kills
          this.slowMoFactor = 0.35;
          this.slowMoTimer = 0.32;
          this.speedLinesTimer = 0.35;
          camera.addTrauma(0.4);
        }

        // Phase 1 C6: the boss death cinematic — longer slow-mo, the wide
        // shockwave and a score windfall on top of the kill payout
        if (enemy.type === 'BOSS' || enemy.type === 'MARQUIS') {
          this.slowMoFactor = 0.22;
          this.slowMoTimer = 0.9;
          this.speedLinesTimer = 0.8;
          camera.addTrauma(0.75);
          this.stats.score += 1000;
          this.addPopup(enemy.position.x, enemy.position.y - 130, 'HIGH TABLE FALLS +1000', '#f59e0b', 24);
          this.spawnShockwave(enemy.position.x, enemy.position.y - 60, 150, '#f59e0b');
        }

        // Continental field medic kits: heavies often carry them, others rarely
        const medkitChance = enemy.type === 'BOSS' || enemy.type === 'MARQUIS' ? 1.0
          : enemy.type === 'HEAVY' ? 0.5
          : enemy.type === 'ELITE' ? 0.3
          : 0.12;
        if (Math.random() < medkitChance) {
          environmentManager.dropHealthPack(enemy.position.x, enemy.position.y - 20, 35);
        }

        // Field ammo pouches keep the reserve fed (Phase 1 D5)
        const ammoChance = enemy.type === 'BOSS' || enemy.type === 'MARQUIS'
          ? 1.0
          : enemy.type === 'HEAVY' || enemy.type === 'ELITE' ? 0.5 : 0.22;
        if (Math.random() < ammoChance) {
          environmentManager.dropAmmoPack(enemy.position.x, enemy.position.y - 24, 16);
        }
      }
    }

    // 6b. Wave-clear scoring: awarded once per wave when the last enemy dies
    // P2-03: plain scan instead of `.some(closure)`
    let anyAlive = false;
    for (const e of enemies) {
      if (e.health > 0) {
        anyAlive = true;
        break;
      }
    }
    if (anyAlive) {
      this.waveClearAwarded = false;
    } else if (!this.waveClearAwarded && enemies.length > 0) {
      this.waveClearAwarded = true;
      this.stats.score += 250;
      this.addPopup(
        player.physics.position.x,
        player.physics.position.y - 130,
        'WAVE CLEAR +250',
        '#fbbf24',
        20
      );
    }

    // 7. Check Player Attacks hitting Enemies & Destructibles
    this.checkPlayerAttacks(player, enemies, camera, environmentManager);

    // 8. Check Player Tactical Gunfire (Gun-Fu)
    this.checkPlayerGunfire(player, enemies, camera, environmentManager);

    // 9. Check Enemy Attacks hitting Player
    this.checkEnemyAttacks(player, enemies, camera);

    // 10. Check Player Grab / Takedown trigger
    this.checkPlayerGrab(player, enemies, camera);

    // 11. Enemy ranged fire: drain pending shots, simulate & collide bullets.
    // Uses the effective dt passed in, so pause / hit-stop / slow-mo
    // freeze or scale bullets exactly like everything else.
    this.updateEnemyBullets(dt, player, enemies, camera, environmentManager);

    // 12. PHASE 1B 7: bodies thrown into props — glass shatters, crates and
    // barrels are smashed (barrels cook off), the impact hurts the throwee.
    this.resolveEnvironmentalImpacts(enemies, environmentManager, camera);
  }

  private checkPlayerGunfire(
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera,
    environmentManager?: EnvironmentManager
  ) {
    // Deferred SHOOT trigger: decide between a point-blank PISTOL WHIP and a
    // real round *before* any ammo is spent (see PlayerController.pendingPistolShot).
    if (player.pendingPistolShot) {
      player.pendingPistolShot = false;

      if (this.resolvePistolWhip(player, enemies, camera)) return; // whip, no round burned

      if (player.physics.ammo <= 0) {
        // Empty chamber click + auto reload (never fires a phantom round)
        SoundFX.playGunCock();
        player.beginReload();
        return;
      }

      // Chambered round: commit the shot exactly as the old inline path did
      player.physics.ammo--;
      player.physics.isReloading = false;
      player.forceState('ATTACK_GUN_SHOT');
      SoundFX.playGunshot();
      player.physics.velocity.x = (player.physics.facingRight ? -1 : 1) * 110;
      player.hasFiredBulletThisShot = true;
    }

    // Phase 1 arsenal: SMG / SHOTGUN / RIFLE salvo (its own stats, pellets,
    // falloff, recoil and hit-stop — the pistol path below is untouched).
    if (player.pendingSalvoShot) {
      player.pendingSalvoShot = false;
      this.resolveSalvoShot(player, enemies, camera, environmentManager);
      return;
    }

    if (!player.hasFiredBulletThisShot) return;
    player.hasFiredBulletThisShot = false;

    // PHASE 1B aim model: hip-fire keeps the shipped straight muzzle line,
    // precision aim flies along the stick with a light head-magnetism assist.
    const shot = this.shotVector(player, enemies);
    const dir = shot.dir;
    const dirX = shot.dx;
    const dirY = shot.dy;
    const originX = player.physics.position.x + dir * 34;
    const originY = player.physics.position.y - 62; // Tactical pistol muzzle height

    // 1. Eject spent brass casing with realistic tumbling physics
    this.ejectCasing(originX, originY, dir);

    // 2. Raycast against active enemies along bullet trajectory
    let closestEnemy: EnemyController | null = null;
    let closestT = 99999;

    for (const enemy of enemies) {
      if (enemy.health <= 0 && enemy.state === 'DOWNED') continue;
      const t = rayToVertical(
        originX, originY, dirX, dirY,
        enemy.position.x, enemy.position.y - 110, enemy.position.y + 10, 99999
      );
      if (t >= 0 && t < closestT) {
        closestT = t;
        closestEnemy = enemy;
      }
    }

    // Phase 1 D2: props standing in the muzzle line take the round instead
    if (environmentManager) {
      let propT = closestT;
      let propHit: DestructibleObject | null = null;
      for (const obj of environmentManager.destructibles) {
        if (obj.isBroken) continue;
        const t = rayToVertical(
          originX, originY, dirX, dirY,
          obj.x, obj.y - obj.height, obj.y, closestT
        );
        if (t >= 0 && t < propT) {
          propT = t;
          propHit = obj;
        }
      }
      if (propHit) {
        const impactX = originX + dirX * propT;
        const impactY = originY + dirY * propT;
        this.pushTracer(originX, originY, impactX, impactY, 0.12, 3.5);
        environmentManager.damageObject(propHit, 28, dir * 160, -60);
        this.spawnSparks(impactX, impactY, -dir, 8, this.surfaceColor(propHit.type));
        camera.addTrauma(0.1);
        Haptics.cue('hit');
        return;
      }
    }

    if (closestEnemy) {
      const impactX = originX + dirX * closestT - dir * 10;
      const impactY = originY + dirY * closestT;
      // PHASE 1B hit zones: the top band of the rig is the head.
      const isHeadshot = impactY <= closestEnemy.position.y - 88;

      // Create glowing supersonic bullet tracer to impact point
      this.pushTracer(originX, originY, impactX, impactY, 0.12, 3.5);

      // Close-Quarters Gun-Fu Double Tap execution check (< 95px)
      const isPointBlank = closestT < 95;

      if (closestEnemy.evading) {
        // Roll phases straight through the round
        this.spawnSparks(impactX, impactY, -dir, 6, '#94a3b8');
        this.addPopup(impactX, impactY - 20, 'WHIFF', '#94a3b8', 15);
      } else if (closestEnemy.state === 'BLOCK' && !isPointBlank) {
        // Guarded by enemy
        closestEnemy.takeDamage(10, dir * 160, -60, false);
        this.hitStopFrames = 4;
        camera.addTrauma(0.18);
        SoundFX.playPunch('light');
        this.spawnSparks(impactX, impactY, -dir, 8, '#94a3b8');
        this.addPopup(impactX, impactY - 20, 'BLOCKED', '#94a3b8', 14);
        Haptics.cue('hit');
      } else if (isPointBlank) {
        // == POINT-BLANK GUN-FU EXECUTION ==
        const damage = Math.max(1, Math.round(42 * this.comboDamageMultiplier()));
        closestEnemy.takeDamage(damage, dir * 520, -220, true);
        closestEnemy.state = 'KNOCKBACK';
        this.hitStopFrames = 10;
        this.slowMoFactor = 0.28;
        this.slowMoTimer = 0.38;
        camera.addTrauma(0.55);
        SoundFX.playPunch('heavy');
        this.spawnShockwave(impactX, impactY, 55, '#f59e0b');
        this.spawnSparks(impactX, impactY, dir, 18, '#fbbf24');
        this.spawnBlood(impactX, impactY, dir, 14);
        this.addPopup(impactX, impactY - 30, 'GUN-FU CRIT!', '#f59e0b', 22);

        this.addCombo(2, 3.5);
        this.stats.takedownCount++;
        this.stats.score += 150;
        this.registerStyle('GUNFU');
        Haptics.cue('heavy');
      } else {
        // Standard bullet impact. PHASE 1B hit zones: a round that lands in
        // the head band pays a 1.6x precision multiplier + style credit —
        // body damage stays exactly at the shipped 28.
        const rawDamage = Math.max(
          1,
          Math.round(28 * this.comboDamageMultiplier() * (isHeadshot ? 1.6 : 1))
        );
        const damage = closestEnemy.takeDamage(rawDamage, dir * 340, -140, false);
        this.hitStopFrames = isHeadshot ? 8 : 6;
        camera.addTrauma(isHeadshot ? 0.34 : 0.28);
        SoundFX.playPunch('heavy');
        this.spawnShockwave(impactX, impactY, isHeadshot ? 40 : 32, '#fbbf24');
        this.spawnSparks(impactX, impactY, dir, isHeadshot ? 16 : 12, '#fbbf24');
        this.spawnBlood(impactX, impactY, dir, isHeadshot ? 10 : 7);
        if (isHeadshot) {
          this.addPopup(impactX, impactY - 30, `HEADSHOT -${damage}`, '#fde047', 20);
          this.registerStyle('HEADSHOT');
          this.announceMove('HEADSHOT');
        } else {
          this.addPopup(impactX, impactY - 20, `-${damage}`, '#fde047', 17);
        }

        this.addCombo(1, 3.0);
        Haptics.cue('shot');
      }
    } else {
      // No enemy hit: bullet travels to arena boundary wall and creates sparks
      const arenaBound = 840;
      const endX = dirX > 0 ? arenaBound : -arenaBound;
      const tWall = Math.abs(dirX) > 0.001 ? Math.abs((endX - originX) / dirX) : 0;
      const endY = originY + dirY * tWall;
      this.pushTracer(originX, originY, endX, endY, 0.1, 3);

      // Wall ricochet sparks
      this.spawnSparks(endX, endY, -dir, 10, '#fef08a');
      camera.addTrauma(0.12);
      Haptics.cue('hit');

      // PHASE 1B ricochet: a share of wall strikes skip off at the reflected
      // angle and resolve one more (half-damage) pass down range.
      this.resolveRicochet(enemies, endX, endY, -dirX, dirY, camera, environmentManager, 28);
    }
  }

  /**
   * PHASE 1B aim model — the direction a round actually travels.
   * Hip-fire (no live aim input) keeps the shipped straight muzzle line.
   * Precision aim flies along the stick, nudged toward the nearest enemy
   * head when it already sits inside 12° of the reticle (the on-screen
   * laser shows the final path, so the assist stays readable). The result
   * is written into a reusable record — never allocated per shot.
   */
  private readonly shotDir = { dx: 1, dy: 0, dir: 1 };
  private shotVector(player: PlayerController, enemies: EnemyController[]) {
    const s = this.shotDir;
    const aim = player.physics.aimAngle;
    if (!player.precisionAim || aim === null || aim === undefined) {
      s.dx = player.physics.facingRight ? 1 : -1;
      s.dy = 0;
      s.dir = s.dx > 0 ? 1 : -1;
      return s;
    }

    let ang = aim;
    const mx = player.physics.position.x + (Math.cos(ang) >= 0 ? 34 : -34);
    const my = player.physics.position.y - 62;
    const ASSIST = 0.2094; // 12°
    let bestDiff = ASSIST;
    for (const e of enemies) {
      if (e.health <= 0 && e.state === 'DOWNED') continue;
      const hx = e.position.x - mx;
      const hy = e.position.y - 96 - my;
      if (Math.abs(hy) > 320 || hx * hx + hy * hy > 490000) continue;
      const toHead = Math.atan2(hy, hx);
      const diff = Math.abs(((toHead - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff < bestDiff) {
        bestDiff = diff;
        ang = toHead;
      }
    }

    let dx = Math.cos(ang);
    let dy = Math.sin(ang);
    // Keep the ray solvable: a near-vertical shot has no meaningful x crossing
    if (Math.abs(dx) < 0.25) {
      const sign = dx >= 0 ? 1 : -1;
      dx = 0.25 * sign;
      const n = Math.hypot(dx, dy) || 1;
      dx /= n;
      dy /= n;
    }
    s.dx = dx;
    s.dy = dy;
    s.dir = dx >= 0 ? 1 : -1;
    return s;
  }

  /**
   * PHASE 1B ricochet: re-fires the shot from the impact point along the
   * reflected vector — one bounce max, half damage, full style credit when
   * it pays off. Returns nothing: the FX are pushed straight into the pools.
   */
  private resolveRicochet(
    enemies: EnemyController[],
    fromX: number,
    fromY: number,
    dx: number,
    dy: number,
    camera: Camera,
    environmentManager: EnvironmentManager | undefined,
    baseDamage: number
  ): void {
    if (Math.random() >= 0.45) return;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n;
    dy /= n;
    const dir = dx >= 0 ? 1 : -1;
    const MAX = 1000;

    let enemy: EnemyController | null = null;
    let enemyT = MAX;
    for (const e of enemies) {
      if (e.health <= 0 && e.state === 'DOWNED') continue;
      const t = rayToVertical(fromX, fromY, dx, dy, e.position.x, e.position.y - 110, e.position.y + 10, MAX);
      if (t >= 0 && t < enemyT) {
        enemyT = t;
        enemy = e;
      }
    }

    let prop: DestructibleObject | null = null;
    let propT = MAX;
    if (environmentManager) {
      for (const obj of environmentManager.destructibles) {
        if (obj.isBroken) continue;
        const t = rayToVertical(fromX, fromY, dx, dy, obj.x, obj.y - obj.height, obj.y, MAX);
        if (t >= 0 && t < propT) {
          propT = t;
          prop = obj;
        }
      }
    }

    if (enemy && (!prop || enemyT <= propT)) {
      const impactX = fromX + dx * enemyT - dir * 8;
      const impactY = fromY + dy * enemyT;
      this.pushTracer(fromX, fromY, impactX, impactY, 0.1, 2.5);
      if (enemy.evading) {
        this.spawnSparks(impactX, impactY, -dir, 5, '#94a3b8');
        return;
      }
      if (enemy.state === 'BLOCK') {
        const chip = Math.max(2, Math.round(baseDamage * 0.15));
        enemy.takeDamage(chip, dir * 120, -50, false);
        this.spawnSparks(impactX, impactY, -dir, 6, '#94a3b8');
        this.addPopup(impactX, impactY - 16, 'BLOCKED', '#94a3b8', 14);
        return;
      }
      const raw = Math.max(1, Math.round(baseDamage * 0.5 * this.comboDamageMultiplier()));
      const landed = enemy.takeDamage(raw, dir * 300, -120, false);
      if (landed > 0) {
        this.hitStopFrames = 5;
        camera.addTrauma(0.2);
        SoundFX.playPunch('heavy');
        this.spawnSparks(impactX, impactY, dir, 10, '#fef08a');
        this.spawnBlood(impactX, impactY, dir, 5);
        this.addPopup(impactX, impactY - 24, `RICOCHET -${landed}`, '#fef08a', 18);
        this.addCombo(1, 3.0);
        this.registerStyle('RICOCHET');
        Haptics.cue('hit');
      } else {
        this.spawnSparks(impactX, impactY, -dir, 5, '#94a3b8');
      }
      return;
    }

    if (prop && environmentManager) {
      const impactX = fromX + dx * propT;
      const impactY = fromY + dy * propT;
      this.pushTracer(fromX, fromY, impactX, impactY, 0.1, 2.5);
      environmentManager.damageObject(prop, Math.max(1, Math.round(baseDamage * 0.5)), dir * 130, -60);
      this.spawnSparks(impactX, impactY, -dir, 7, this.surfaceColor(prop.type));
      return;
    }

    // Second wall — sparks only, the round is spent
    const endX2 = dir > 0 ? 840 : -840;
    const tWall = Math.abs((endX2 - fromX) / dx);
    this.pushTracer(fromX, fromY, endX2, fromY + dy * tWall, 0.09, 2);
    this.spawnSparks(endX2, fromY + dy * tWall, -dir, 5, '#fef08a');
  }

  /** Spent brass tumbling out of the ejection port (pooled, capped). */
  private ejectCasing(originX: number, originY: number, dir: number): void {
    trimOldest(this.casings, this.casings.length + 1 - CombatDirector.MAX_CASINGS, this.casingPool);
    const casing = this.casingPool.acquire();
    casing.x = originX - dir * 10;
    casing.y = originY + 2;
    casing.vx = -dir * (90 + Math.random() * 60);
    casing.vy = -(120 + Math.random() * 80);
    casing.rot = Math.random() * Math.PI * 2;
    casing.vRot = (Math.random() - 0.5) * 24;
    casing.life = 1.4;
    this.casings.push(casing);
  }

  /** Phase 1 E3: impact colour by the surface the round actually struck. */
  private surfaceColor(type: DestructibleObject['type'] | 'WALL'): string {
    switch (type) {
      case 'GLASS_DISPLAY':
      case 'GLASS_PANEL':
        return '#a5f3fc';
      case 'CRATE':
        return '#d97706';
      case 'EXPLOSIVE_BARREL':
        return '#fb923c';
      case 'CHAMPAGNE_TABLE':
        return '#94a3b8';
      case 'WEAPON_RACK':
        return '#64748b';
      case 'WALL':
      default:
        return '#fef08a';
    }
  }

  /**
   * Phase 1 B6: the automatics' shot. One ray per pellet with weapon spread
   * and distance falloff, resolved against the squad and any prop in the
   * line; hit-stop / trauma come from the firing weapon's own stat row.
   */
  private resolveSalvoShot(
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera,
    environmentManager?: EnvironmentManager
  ): void {
    const stats = GUNS[player.currentGun];
    if (player.physics.ammo <= 0) return;

    player.physics.ammo--;
    player.physics.isReloading = false;
    player.forceState('ATTACK_GUN_SHOT');
    SoundFX.playGunReport(stats.id);
    const recoilDir = player.physics.facingRight ? -1 : 1;
    player.physics.velocity.x = recoilDir * stats.recoil;

    const dir = player.physics.facingRight ? 1 : -1;
    // PHASE 1B aim model: precision aim flies along the stick (with head
    // assist) and tightens the cone to 35%; hip-fire keeps the shipped cone.
    const shot = this.shotVector(player, enemies);
    const baseX = shot.dx;
    const baseY = shot.dy;
    const dirShot = shot.dir;
    const originX = player.physics.position.x + dirShot * 34;
    const originY = player.physics.position.y - 62;
    this.ejectCasing(originX, originY, dirShot);
    const spreadScale = player.precisionAim ? 0.35 : 1;

    const MAX_RANGE = 1500;
    const comboMult = this.comboDamageMultiplier();
    let totalDamage = 0;
    let anchorX = originX + baseX * 320;
    let anchorY = originY + baseY * 320;
    let hitEnemyOnce = false;
    let headshotLanded = false;

    for (let pellet = 0; pellet < stats.pellets; pellet++) {
      const spread =
        stats.spread > 0 ? (Math.random() * 2 - 1) * stats.spread * spreadScale : 0;
      // Rotate the base direction by this pellet's spread (hip-fire base is
      // axis-aligned, so this reduces to the shipped cos/sin cone exactly).
      const cosS = Math.cos(spread);
      const sinS = Math.sin(spread);
      const dx = baseX * cosS - baseY * sinS;
      const dy = baseX * sinS + baseY * cosS;

      // Nearest live enemy along this ray
      let enemy: EnemyController | null = null;
      let enemyT = MAX_RANGE;
      for (const e of enemies) {
        if (e.health <= 0 && e.state === 'DOWNED') continue;
        const t = rayToVertical(
          originX, originY, dx, dy,
          e.position.x, e.position.y - 110, e.position.y + 10, MAX_RANGE
        );
        if (t >= 0 && t < enemyT) {
          enemyT = t;
          enemy = e;
        }
      }

      // Nearest live prop along this ray
      let prop: DestructibleObject | null = null;
      let propT = MAX_RANGE;
      if (environmentManager) {
        for (const obj of environmentManager.destructibles) {
          if (obj.isBroken) continue;
          const t = rayToVertical(
            originX, originY, dx, dy,
            obj.x, obj.y - obj.height, obj.y, MAX_RANGE
          );
          if (t >= 0 && t < propT) {
            propT = t;
            prop = obj;
          }
        }
      }

      if (enemy && (!prop || enemyT <= propT)) {
        const impactX = originX + dx * enemyT - dirShot * 8;
        const impactY = originY + dy * enemyT;
        this.pushTracer(originX, originY, impactX, impactY, stats.tracerLife, stats.tracerWidth);

        if (enemy.evading) {
          this.spawnSparks(impactX, impactY, -dir, 4, '#94a3b8');
          continue;
        }

        const falloff = falloffMultiplier(stats, enemyT);
        if (enemy.state === 'BLOCK') {
          const chip = Math.max(2, Math.round(stats.damage * 0.3 * falloff));
          const landed = enemy.takeDamage(chip, dir * 140, -50, false);
          if (landed > 0) totalDamage += landed;
          this.spawnSparks(impactX, impactY, -dir, 6, '#94a3b8');
          if (!hitEnemyOnce && landed > 0) {
            anchorX = impactX;
            anchorY = impactY;
            hitEnemyOnce = true;
          }
          continue;
        }

        // PHASE 1B hit zones: rounds landing in the head band pay 1.6x.
        const isHeadshot = impactY <= enemy.position.y - 88;
        const raw = Math.max(
          1,
          Math.round(stats.damage * falloff * comboMult * (isHeadshot ? 1.6 : 1))
        );
        const landed = enemy.takeDamage(raw, dir * stats.recoil, -90 - stats.recoil * 0.15, false);
        if (landed > 0) {
          totalDamage += landed;
          this.spawnBlood(impactX, impactY, dir, isHeadshot ? 8 : 5);
          this.spawnSparks(impactX, impactY, dir, isHeadshot ? 9 : 6, '#fbbf24');
          if (isHeadshot) headshotLanded = true;
          if (!hitEnemyOnce) {
            anchorX = impactX;
            anchorY = impactY;
            hitEnemyOnce = true;
          }
        } else {
          this.spawnSparks(impactX, impactY, -dir, 4, '#94a3b8');
        }
      } else if (prop && environmentManager) {
        const impactX = originX + dx * propT;
        const impactY = originY + dy * propT;
        this.pushTracer(originX, originY, impactX, impactY, stats.tracerLife, stats.tracerWidth);
        const falloff = falloffMultiplier(stats, propT);
        const dmg = Math.max(1, Math.round(stats.damage * falloff));
        environmentManager.damageObject(prop, dmg, dir * 150, -60);
        this.spawnSparks(impactX, impactY, -dir, 8, this.surfaceColor(prop.type));
        anchorX = impactX;
        anchorY = impactY;
      } else {
        // Miss: the round flies to the arena wall
        const endX = dx > 0 ? 840 : -840;
        const tWall = Math.abs((endX - originX) / dx);
        const endY = originY + dy * tWall;
        this.pushTracer(originX, originY, endX, endY, stats.tracerLife, stats.tracerWidth);
        if (pellet === 0) {
          this.spawnSparks(endX, endY, -dir, 6, this.surfaceColor('WALL'));
          // PHASE 1B ricochet: the lead pellet may skip off the wall once
          // (45% roll inside) and resolve a half-damage second pass.
          this.resolveRicochet(enemies, endX, endY, -dx, dy, camera, environmentManager, stats.damage);
        }
      }
    }

    if (totalDamage > 0) {
      this.hitStopFrames = stats.hitStop;
      camera.addTrauma(stats.trauma);
      this.addPopup(anchorX, anchorY - 20, `-${totalDamage}`, '#fde047', stats.pellets > 1 ? 19 : 17);
      this.addCombo(1, 3.0);
      Haptics.cue('shot');
      if (headshotLanded) {
        this.addPopup(anchorX, anchorY - 46, 'HEADSHOT!', '#fde047', 20);
        this.registerStyle('HEADSHOT');
        this.announceMove('HEADSHOT');
      }
    } else {
      camera.addTrauma(stats.trauma * 0.35);
    }
  }

  /**
   * Phase 1 D3: explosive-barrel detonation — radial blast on the squad and
   * the player, plus a chain cook-off on any barrel caught in the radius.
   * Queued by EnvironmentManager.shatterObject, drained in update().
   */
  private detonateBarrel(
    x: number,
    y: number,
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera,
    environmentManager: EnvironmentManager
  ): void {
    const RADIUS = 205;
    SoundFX.playExplosion();
    Haptics.cue('boom');
    this.spawnShockwave(x, y, RADIUS, '#fb923c');
    this.spawnSparks(x, y, 1, 24, '#fdba74');
    this.spawnSparks(x, y, -1, 18, '#fef08a');
    this.addPopup(x, y - 70, 'BOOM!', '#fb923c', 22);
    camera.addTrauma(0.6);
    this.speedLinesTimer = 0.3;
    this.slowMoFactor = 0.45;
    this.slowMoTimer = 0.22;

    for (const enemy of enemies) {
      if (enemy.health <= 0) continue;
      const dx = enemy.position.x - x;
      const dy = enemy.position.y - 50 - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RADIUS) continue;
      const scale = 1 - dist / RADIUS;
      const dirE = dx >= 0 ? 1 : -1;
      const dmg = Math.max(1, Math.round(55 * scale));
      const landed = enemy.takeDamage(dmg, dirE * 540 * scale, -270 * scale, false);
      if (landed > 0) {
        this.addCombo(1, 3.0);
        this.spawnBlood(enemy.position.x, enemy.position.y - 50, dirE, 6);
        this.spawnSparks(enemy.position.x, enemy.position.y - 50, dirE, 10, '#fdba74');
      }
    }

    // The player feels it too — dodge i-frames still ghost the blast
    const pdx = player.physics.position.x - x;
    const pdy = player.physics.position.y - 50 - y;
    const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pdist < RADIUS && !player.physics.isDodging) {
      const scale = 1 - pdist / RADIUS;
      const dmg = Math.max(1, Math.round(30 * scale));
      player.takeDamage(dmg, (pdx >= 0 ? 1 : -1) * 340 * scale, -190 * scale);
      this.breakCombo();
      this.addPopup(player.physics.position.x, player.physics.position.y - 90, `-${dmg}`, '#ef4444', 18);
      this.spawnSparks(player.physics.position.x, player.physics.position.y - 50, pdx >= 0 ? 1 : -1, 12, '#fb923c');
    }

    // Chain cook-off: barrels inside the blast go off next (drained next frame)
    for (const obj of environmentManager.destructibles) {
      if (obj.isBroken || obj.type !== 'EXPLOSIVE_BARREL') continue;
      const cdx = obj.x - x;
      const cdy = obj.y - obj.height * 0.5 - y;
      if (Math.sqrt(cdx * cdx + cdy * cdy) <= RADIUS * 0.95) {
        environmentManager.damageObject(obj, 999, 0, -60);
      }
    }
  }

  /**
   * Close-quarters PISTOL WHIP: when the muzzle would be pressed into a body,
   * driving the slide into their skull beats burning a round at zero range.
   * Returns true when the whip resolved (so no ammo is spent).
   */
  private resolvePistolWhip(
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera
  ): boolean {
    const f = player.physics.facingRight ? 1 : -1;
    const px = player.physics.position.x;
    const py = player.physics.position.y;

    let target: EnemyController | null = null;
    let best = 999;
    for (const enemy of enemies) {
      if (enemy.health <= 0 && enemy.state === 'DOWNED') continue;
      if (enemy.state === 'GRAPPLED') continue;
      const ahead = (enemy.position.x - px) * f; // signed distance in front of the muzzle
      if (ahead < -14 || ahead > 68) continue;
      if (Math.abs(enemy.position.y - py) > 40) continue;
      const d = Math.abs(ahead - 24);
      if (d < best) {
        best = d;
        target = enemy;
      }
    }
    if (!target) return false;

    const impactX = target.position.x - f * 12;
    const impactY = py - 64;
    // Gun-shot stance: arm driving the muzzle into them. It is deliberately
    // outside the melee attack list, so the whip cannot chain into a free jab.
    player.forceState('ATTACK_GUN_SHOT');

    if (target.state === 'BLOCK') {
      // The whip is a heavy strike — it simply shatters a raised guard
      target.guardBreak();
      this.hitStopFrames = 10;
      camera.addTrauma(0.36);
      this.speedLinesTimer = 0.25;
      SoundFX.playPunch('heavy');
      SoundFX.playGunCock();
      this.spawnShockwave(impactX, impactY, 48, '#f59e0b');
      this.spawnSparks(impactX, impactY, f, 14, '#fbbf24');
      this.addPopup(impactX, impactY - 20, 'PISTOL WHIP!', '#f59e0b', 19);
      this.addCombo(1, 3.0);
      this.announceMove('PISTOL WHIP');
      return true;
    }

    const damage = Math.max(1, Math.round(26 * this.comboDamageMultiplier()));
    const landed = target.takeDamage(damage, f * 430, -180, true);
    if (landed <= 0) {
      // Rolled straight through the swing
      this.spawnSparks(impactX, impactY, -f, 6, '#94a3b8');
      this.addPopup(impactX, impactY - 14, 'WHIFF', '#94a3b8', 15);
      return true;
    }

    this.hitStopFrames = 8;
    this.slowMoFactor = 0.45;
    this.slowMoTimer = 0.22;
    camera.addTrauma(0.34);
    SoundFX.playPunch('heavy');
    SoundFX.playGunCock();
    this.spawnShockwave(impactX, impactY, 42, '#fbbf24');
    this.spawnSparks(impactX, impactY, f, 14, '#fbbf24');
    this.spawnBlood(impactX, impactY, f, 8);
    this.addPopup(impactX, impactY - 26, `PISTOL WHIP -${landed}`, '#f59e0b', 19);
    this.stats.totalDamageDealt += landed;
    this.addCombo(1, 3.0);
    this.announceMove('PISTOL WHIP');
    return true;
  }

  private checkPlayerAttacks(
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera,
    environmentManager?: EnvironmentManager
  ) {
    const pState = player.physics.state;
    const pTimer = player.physics.stateTimer;
    const isAttacking =
      pState === 'ATTACK_LIGHT_1' ||
      pState === 'ATTACK_LIGHT_2' ||
      pState === 'ATTACK_LIGHT_3' ||
      pState === 'ATTACK_HEAVY' ||
      pState === 'ATTACK_KICK' ||
      pState === 'ATTACK_SWEEP' ||
      pState === 'ATTACK_FLYING_KICK' ||
      player.physics.isSliding;

    if (!isAttacking) return;
    // A FLYING KICK is a line-clearing launch: it may tag each enemy once per
    // flight instead of spending itself on the first body it touches.
    const isFlyingKick = pState === 'ATTACK_FLYING_KICK';
    if (!isFlyingKick && this.playerAttackRegistered) return;

    // Active attack strike windows (normalized timing)
    let attackWindowStart = 0.08;
    let attackWindowEnd = 0.28;
    let damage = 14;
    let knockbackX = player.physics.facingRight ? 180 : -180;
    let knockbackY = -80;
    let hitStop = 5;
    let soundType: 'light' | 'heavy' | 'kick' = 'light';
    let isHeavy = false;
    let reachBonus = 0;
    // LEG SWEEP strikes the ankles: same low hitbox the slide uses
    const lowStrike = player.physics.isSliding || pState === 'ATTACK_SWEEP';

    if (pState === 'ATTACK_LIGHT_1') {
      // PUNCH (jab) — fastest, shortest reach
      damage = 14;
      hitStop = 4;
      soundType = 'light';
    } else if (pState === 'ATTACK_LIGHT_2') {
      // PUNCH (cross)
      damage = 18;
      knockbackX = player.physics.facingRight ? 240 : -240;
      hitStop = 6;
      soundType = 'light';
    } else if (pState === 'ATTACK_LIGHT_3') {
      damage = 28;
      knockbackX = player.physics.facingRight ? 380 : -380;
      knockbackY = -180;
      hitStop = 9;
      soundType = 'kick';
      isHeavy = true;
    } else if (pState === 'ATTACK_KICK') {
      // KICK button — longest reach, heaviest base damage, knock-down arc
      damage = 32;
      knockbackX = player.physics.facingRight ? 470 : -470;
      knockbackY = -240;
      hitStop = 10;
      soundType = 'kick';
      isHeavy = true;
      reachBonus = 18;
      attackWindowStart = 0.10;
      attackWindowEnd = 0.32;
    } else if (pState === 'ATTACK_SWEEP') {
      // LEG SWEEP ender (PUNCH, PUNCH, KICK) — scythes the ankles, always drops
      damage = 18;
      knockbackX = player.physics.facingRight ? 340 : -340;
      knockbackY = -90;
      hitStop = 7;
      soundType = 'kick';
      isHeavy = true;
      reachBonus = 14;
      attackWindowStart = 0.10;
      attackWindowEnd = 0.30;
    } else if (pState === 'ATTACK_FLYING_KICK') {
      // XIAO XIAO FLYING KICK — launches out of a sustained full sprint
      damage = 36;
      knockbackX = player.physics.facingRight ? 560 : -560;
      knockbackY = -260;
      hitStop = 11;
      soundType = 'kick';
      isHeavy = true;
      reachBonus = 24;
      attackWindowStart = 0.12;
      attackWindowEnd = 0.42;
    } else if (pState === 'ATTACK_HEAVY') {
      // Chain finisher animation (armed by the combo system)
      damage = 38;
      knockbackX = player.physics.facingRight ? 450 : -450;
      knockbackY = -220;
      hitStop = 11;
      soundType = 'heavy';
      isHeavy = true;
      reachBonus = 8;
      attackWindowStart = 0.12;
      attackWindowEnd = 0.32;
    } else if (player.physics.isSliding) {
      damage = 12;
      knockbackX = player.physics.facingRight ? 220 : -220;
      knockbackY = -160;
      hitStop = 5;
      soundType = 'kick';
      attackWindowStart = 0.05;
      attackWindowEnd = 0.45;
    }

    // Katana & Weapon modifier boosts
    let strikeBonus = 0;
    if (player.physics.equippedWeapon === 'KATANA') {
      damage = Math.round(damage * 1.5);
      strikeBonus = 16;
      if (player.physics.perks['LETHAL_BLADE']) {
        damage += 12;
      }
    }

    if (pTimer < attackWindowStart || pTimer > attackWindowEnd) return;

    // Chain escalation: every hit landed inside the combo window hits harder.
    // A perfect parry opens a short RIPOSTE window — cash it in with the very
    // next landed strike for a 2.5x counter.
    const chainMultiplier = this.comboDamageMultiplier();
    const isFinisherHit = this.stats.finisherArmed;
    const isRiposte = this.riposteWindow > 0;
    const baseDamage = Math.max(
      1,
      Math.round(
        damage * chainMultiplier * (isFinisherHit ? 2.5 : 1) * (isRiposte ? 2.5 : 1)
      )
    );

    // Check collision against all alive enemies
    const f = player.physics.facingRight ? 1 : -1;
    const strikeX = player.physics.position.x + f * (42 + strikeBonus + reachBonus);
    const strikeY = player.physics.position.y - (lowStrike ? 18 : 68);
    const strikeRadius = (lowStrike ? 34 : 36) + strikeBonus + reachBonus;

    // Check hit against destructible environmental objects
    if (environmentManager) {
      const shattered = environmentManager.checkHitboxAgainstDestructibles({
        x: strikeX,
        y: strikeY,
        radius: strikeRadius + 15,
        damage: baseDamage,
        knockbackX,
        knockbackY,
        hitStopFrames: hitStop,
      });
      if (shattered) {
        this.playerAttackRegistered = true;
        this.hitStopFrames = 4;
        camera.addTrauma(0.22);
      }
    }

    for (const enemy of enemies) {
      if (enemy.state === 'DOWNED' && !player.physics.isSliding && pState !== 'ATTACK_SWEEP') continue;
      // One flight, one hit per body — the kick keeps going down the line
      if (isFlyingKick && this.flyingKickHits.has(enemy)) continue;

      const ex = enemy.position.x;
      const ey = enemy.position.y - 50; // Center of enemy mass
      const dx = strikeX - ex;
      const dy = strikeY - ey;
      const dist = Math.hypot(dx, dy);

      if (dist < strikeRadius + 30) {
        // HIT CONNECTED!
        if (isFlyingKick) {
          this.flyingKickHits.add(enemy);
        } else {
          this.playerAttackRegistered = true;
        }

        // Ensure knockback is ALWAYS directed away from player
        const dirAway = enemy.position.x >= player.physics.position.x ? 1 : -1;
        const finalKnockbackX = dirAway * Math.abs(knockbackX);
        const impactX = (strikeX + ex) / 2;
        const impactY = (strikeY + ey) / 2;

        // Dodge i-frames: the roll ghosts straight through the swing, and the
        // swing is spent — no chip, no guard crush, no combo credit.
        if (enemy.evading) {
          this.spawnSparks(impactX, impactY, dirAway, 6, '#94a3b8');
          this.addPopup(impactX, impactY - 12, 'WHIFF', '#94a3b8', 15);
          break;
        }

        // == PARRY RIPOSTE CASH-IN: the strike opened by a perfect parry ==
        if (isRiposte) {
          this.riposteWindow = 0;
          this.slowMoFactor = 0.3;
          this.slowMoTimer = 0.3;
          this.speedLinesTimer = 0.3;
          this.announceMove('PARRY RIPOSTE');
          this.addPopup(impactX, impactY - 46, 'RIPOSTE!', '#38bdf8', 22);
          this.spawnShockwave(impactX, impactY, 55, '#38bdf8');
          this.registerStyle('RIPOSTE');
        }

        // Punish window (dodge recovery / heavy recovery) hits harder; the
        // popup and the health bar are driven by the same resolved number.
        const landDamage = resolveDamage(enemy, baseDamage);

        // Check if enemy is guarding (BLOCK state)
        if (enemy.state === 'BLOCK') {
          if (pState === 'ATTACK_HEAVY' || pState === 'ATTACK_KICK') {
            // == GUARD CRUSH! Heavy strike / power kick shatters defense ==
            enemy.guardBreak();
            this.hitStopFrames = 12;
            camera.addTrauma(0.42);
            this.speedLinesTimer = 0.3;
            SoundFX.playPunch('heavy');
            this.spawnShockwave(impactX, impactY, 55, '#f59e0b');
            this.spawnSparks(impactX, impactY, f, 18, '#fbbf24');
            this.spawnBlood(impactX, impactY, f, 6);
            this.addPopup(impactX, impactY - 18, 'GUARD CRUSH!', '#fbbf24', 19);

            this.addCombo(1, 3.0);
            break;
          } else if (player.physics.isSliding || pState === 'ATTACK_SWEEP') {
            // == TRIP! Slide sweep / leg sweep scoops under a blocking enemy ==
            enemy.takeDamage(baseDamage, finalKnockbackX, knockbackY, pState === 'ATTACK_SWEEP');
            enemy.state = 'KNOCKBACK';
            enemy.stateTimer = 0;
            this.hitStopFrames = 6;
            camera.addTrauma(0.25);
            SoundFX.playPunch('kick');
            this.spawnShockwave(impactX, impactY, 35, '#38bdf8');
            this.spawnSparks(impactX, impactY, f, 10, '#38bdf8');
            this.spawnBlood(impactX, impactY, f, 5);
            this.addPopup(
              impactX,
              impactY - 15,
              pState === 'ATTACK_SWEEP' ? 'LEG SWEEP!' : 'TRIP!',
              '#38bdf8',
              16
            );

            this.stats.totalDamageDealt += landDamage;
            this.addCombo(1, 2.8);
            break;
          } else {
            // == BLOCKED! Light attacks absorbed with reduced damage ==
            const chipDamage = Math.max(2, Math.round(landDamage * 0.2));
            enemy.health = Math.max(0, enemy.health - chipDamage);
            // Lethal chip damage must still kill cleanly: ragdoll + DOWNED so
            // defeat cinematics, loot and wave-clear detection see a real death
            if (enemy.health <= 0 && !enemy.ragdoll) {
              // P3-02: recycled shell — released when GameLoop drops the corpse
              enemy.ragdoll = ragdollPool.acquire();
              enemy.ragdoll.reset(enemy.pose, 140, -120);
              enemy.state = 'DOWNED';
              enemy.stateTimer = 0;
            }
            enemy.hpVisibleTimer = 3.2;
            enemy.lastHitTime = performance.now();
            // A clean parry can be cashed in as a riposte (archetype-driven odds)
            enemy.counterQueued = Math.random() < enemy.counterChance;
            enemy.velocity.x = finalKnockbackX * 0.2;
            player.physics.velocity.x = -f * 90; // Minor recoil on player
            this.hitStopFrames = 4;
            camera.addTrauma(0.12);
            SoundFX.playPunch('light');
            this.spawnSparks(impactX, impactY, f, 7, '#94a3b8');
            this.spawnBlood(impactX, impactY, f, 3);
            this.addPopup(impactX, impactY - 15, 'BLOCKED', '#94a3b8', 14);
            break;
          }
        }

        // == FINISHER CONSUMPTION (chain crossed 5x / 10x / 15x...) ==
        if (isFinisherHit) {
          this.stats.finisherArmed = false;
          this.slowMoFactor = 0.35;
          this.slowMoTimer = 0.4;
          this.speedLinesTimer = 0.4;
          SoundFX.playPunch('slam');
          this.spawnShockwave(impactX, impactY, 90, '#f59e0b');
        }

        // Standard clean unblocked hit (chain-escalated damage)
        this.hitStopFrames = isFinisherHit ? Math.max(hitStop, 14) : hitStop;
        enemy.takeDamage(baseDamage, finalKnockbackX, knockbackY, isHeavy || isFinisherHit);

        // PHASE 1B 3 — DISARM: a heavy blow (or the chain finisher) against a
        // ranged archetype knocks the gun loose. It drops as a real pickup the
        // player can grab, and the enemy closes to melee for the next 8s.
        if (
          enemy.health > 0 &&
          (enemy.type === 'GUNNER' || enemy.type === 'SNIPER') &&
          enemy.disarmTimer <= 0 &&
          (isHeavy || isFinisherHit) &&
          Math.random() < 0.5 &&
          environmentManager
        ) {
          enemy.disarmTimer = 8;
          environmentManager.dropWeapon(
            enemy.type === 'SNIPER' ? 'RIFLE' : 'SMG',
            enemy.position.x,
            enemy.position.y - 40,
            -dirAway * 120,
            -220
          );
          this.addPopup(impactX, impactY - 46, 'DISARMED! +50', '#38bdf8', 20);
          this.announceMove('DISARM');
          this.registerStyle('DISARM');
          this.stats.score += 50;
          this.spawnSparks(impactX, impactY, dirAway, 14, '#38bdf8');
          SoundFX.playGunCock();
          Haptics.cue('takedown');
        }

        // LEG SWEEP always converts the knockdown, super armor and all
        if (pState === 'ATTACK_SWEEP') {
          enemy.state = 'KNOCKBACK';
          enemy.stateTimer = 0;
          enemy.velocity.x = finalKnockbackX * 0.8;
          enemy.velocity.y = -150;
          enemy.grounded = false;
        }

        // Sound FX
        if (!isFinisherHit) {
          SoundFX.playPunch(soundType);
        }

        // Camera Shake Trauma
        camera.addTrauma(isFinisherHit ? 0.6 : isHeavy ? 0.42 : 0.22);
        if (isHeavy || isFinisherHit) {
          this.speedLinesTimer = Math.max(this.speedLinesTimer, 0.28);
        }

        // Combo chain & scoring (arms the next finisher at 5x / 10x / 15x)
        this.stats.totalDamageDealt += landDamage;
        this.addCombo(1, CombatDirector.COMBO_WINDOW);

        // PHASE 1B style variety credit + impact haptic
        if (pState === 'ATTACK_SWEEP') this.registerStyle('SWEEP');
        else if (isFlyingKick) this.registerStyle('FLYING_KICK');
        else if (isFinisherHit) this.registerStyle('FINISHER');
        else if (soundType === 'kick') this.registerStyle('KICK');
        else this.registerStyle('JAB');
        Haptics.cue(isFinisherHit || isHeavy ? 'heavy' : 'hit');

        // Particles & Popups — blood sprays from the impact point on every landed hit
        this.spawnSparks(impactX, impactY, f, isHeavy ? 14 : 8, isHeavy ? '#f59e0b' : '#ef4444');
        if (!isFinisherHit) {
          this.spawnShockwave(impactX, impactY, isHeavy ? 45 : 30, isHeavy ? '#f59e0b' : '#ffffff');
        }
        this.spawnBlood(ex, ey, dirAway, isFinisherHit ? 20 : isHeavy ? 11 : 6);
        if (isFinisherHit) {
          this.spawnBlood(impactX, impactY, dirAway, 10);
          this.spawnBlood(ex, ey - 30, dirAway, 6);
        }
        if (player.physics.equippedWeapon === 'KATANA') {
          this.spawnBladeArc(player.physics.position.x + f * 25, player.physics.position.y - 50, f > 0 ? 0.3 : Math.PI - 0.3, 62, '#f59e0b');
        }

        if (isFinisherHit) {
          this.addPopup(impactX, impactY - 46, `FINISHER! -${landDamage}`, '#fbbf24', 26);
        } else if (isFlyingKick) {
          this.addPopup(impactX, impactY - 34, `FLYING KICK -${landDamage}`, '#38bdf8', 21);
        } else if (pState === 'ATTACK_SWEEP') {
          this.addPopup(impactX, impactY - 24, `LEG SWEEP -${landDamage}`, '#38bdf8', 19);
        } else {
          this.addPopup(
            impactX,
            impactY - 10,
            isHeavy ? `CRIT ${landDamage}` : `${landDamage}`,
            isHeavy ? '#fbbf24' : '#f87171',
            isHeavy ? 20 : 15
          );
        }

        break;
      }
    }
  }

  private checkEnemyAttacks(
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera
  ) {
    if (player.physics.isDodging) return; // Invincible during dodge roll!
    // Combo special / super i-frames (set by PlayerController.triggerSpecial)
    if (player.specialInvulnTimer > 0) return;

    const px = player.physics.position.x;
    const py = player.physics.position.y - 50; // Player torso

    for (const enemy of enemies) {
      const hb = enemy.activeHitbox;
      if (!hb || enemy.hasHitPlayerThisAttack) continue;

      const dx = hb.x - px;
      const dy = hb.y - py;
      const dist = Math.hypot(dx, dy);

      if (dist < hb.radius + 24) {
        // ENEMY HIT CONNECTED!
        enemy.hasHitPlayerThisAttack = true;

        if (player.physics.isBlocking) {
          // Check for PERFECT PARRY (blocked within 0.18s of entering block)
          const blockDuration = player.physics.stateTimer;
          if (blockDuration < 0.2) {
            // == PERFECT PARRY! ==
            SoundFX.playParry();
            camera.addTrauma(0.35);
            this.hitStopFrames = 10;
            this.slowMoFactor = 0.25;
            this.slowMoTimer = 0.35;

            // Stun enemy completely!
            enemy.isStaggered = true;
            enemy.staggerMeter = enemy.maxStagger;
            enemy.takeDamage(10, -hb.knockbackX * 0.8, -120, false);
            enemy.state = 'STAGGER';
            enemy.stateTimer = 0;

            this.stats.parryCount++;
            this.stats.score += 25;
            this.addPopup(hb.x, hb.y - 15, 'PERFECT PARRY!', '#38bdf8', 19);
            this.spawnShockwave(hb.x, hb.y, 50, '#38bdf8');
            this.spawnSparks(hb.x, hb.y, 1, 16, '#38bdf8');
            // Opens the RIPOSTE window: the next landed strike hits at 2.5x
            this.riposteWindow = CombatDirector.RIPOSTE_WINDOW;
            this.announceMove('RIPOSTE READY');
            this.registerStyle('PARRY');
            Haptics.cue('parry');
            return;
          } else {
            // Standard Block Guard
            SoundFX.playPunch('light');
            player.physics.stamina = Math.max(0, player.physics.stamina - 15);
            player.physics.velocity.x = hb.knockbackX * 0.3;
            camera.addTrauma(0.12);
            this.addPopup(px, py - 20, 'GUARD', '#94a3b8', 13);
            this.spawnSparks(hb.x, hb.y, 1, 5, '#94a3b8');
            return;
          }
        }

        // Unblocked Hit: Player takes damage
        player.takeDamage(hb.damage, hb.knockbackX, hb.knockbackY);
        SoundFX.playPunch('heavy');
        camera.addTrauma(0.35);
        this.hitStopFrames = hb.hitStopFrames;
        this.breakCombo(); // Chain interrupted
        // PHASE 1B 11: feed the adaptive-difficulty window + hurt haptic
        this.playerDamageWindow += hb.damage;
        Haptics.cue('hurt');

        this.addPopup(px, py - 20, `-${hb.damage}`, '#ef4444', 18);
        this.spawnSparks(hb.x, hb.y, Math.sign(hb.knockbackX), 10, '#ef4444');
        this.spawnBlood(hb.x, hb.y, Math.sign(hb.knockbackX) || -1, 6);
      }
    }
  }

  private checkPlayerGrab(
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera
  ) {
    if (!player.input.grabJustPressed) return;
    if (this.isGrappling || player.physics.state === 'HURT' || player.physics.isDodging) return;

    // Find nearest enemy within grab range (55px)
    const px = player.physics.position.x;
    const py = player.physics.position.y;

    for (const enemy of enemies) {
      if (enemy.state === 'DOWNED' || enemy.state === 'GRAPPLED') continue;

      const dist = Math.abs(enemy.position.x - px);
      if (dist < 60 && Math.abs(enemy.position.y - py) < 30) {
        // INITIATE CLOSE-QUARTERS TAKEDOWN!
        this.isGrappling = true;
        this.grappleTimer = 0;
        this.grappledEnemy = enemy;
        // Variant select: GRAB alone is the judo slam; hold SHOOT while
        // grabbing (with a live round) and the pistol goes to the temple.
        this.grappleVariant =
          player.input.shoot && player.physics.ammo > 0 && !player.physics.isReloading
            ? 'EXECUTION'
            : 'THROW';
        this.grappleShotFired = false;
        // A SHOOT press consumed by this grab must not fire a second round
        player.pendingPistolShot = false;
        enemy.state = 'GRAPPLED';
        enemy.stateTimer = 0;
        enemy.velocity.x = 0;
        enemy.velocity.y = 0;
        SoundFX.playWhoosh(1.2);
        camera.addTrauma(0.15);
        // PHASE 1B 9 — takedown camera: push in tight for the grab and let
        // the hold expire on its own when the move plays out.
        camera.pushIn(1.35, 1.1);
        this.registerStyle('GRAPPLE');
        Haptics.cue('heavy');
        break;
      }
    }
  }

  /**
   * Enemy-bullet simulation + collision (GUNNER rounds).
   * Runs on the effective dt, so pause / hit-stop / slow-mo behave correctly.
   * Dodge i-frames = complete miss; blocking = chip damage + block spark;
   * otherwise the player takes the hit with knockback along the bullet path.
   */
  private updateEnemyBullets(
    dt: number,
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera,
    environmentManager?: EnvironmentManager
  ) {
    // Drain per-enemy pending ranged shots into the shared bullet pool
    for (const e of enemies) {
      if (e.pendingShots.length === 0) continue;
      for (const b of e.pendingShots) {
        this.enemyBullets.push(b);
        // P3-01: cap the live set — oldest round recycles back to the pool
        trimOldest(
          this.enemyBullets,
          this.enemyBullets.length - CombatDirector.MAX_ENEMY_BULLETS,
          enemyBulletPool
        );
        // Muzzle flash tracer along the shot's line of travel
        const sp = Math.hypot(b.vx, b.vy) || 1;
        this.pushTracer(
          b.x,
          b.y,
          b.x + (b.vx / sp) * 26,
          b.y + (b.vy / sp) * 26,
          0.09,
          3
        );
        SoundFX.playGunshot();
      }
      e.pendingShots.length = 0;
    }

    const px = player.physics.position.x;
    const py = player.physics.position.y - 60; // player torso
    const isDodging = player.physics.isDodging;
    const isBlocking = player.physics.isBlocking;
    const playerDead = player.physics.health <= 0;
    const hitRadiusSq = 26 * 26;

    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      // Cull spent or out-of-arena rounds
      if (b.life <= 0 || Math.abs(b.x) > 900) {
        this.enemyBullets.splice(i, 1);
        enemyBulletPool.release(b);
        continue;
      }

      // PHASE 1B 5 — COVER: solid props eat enemy rounds (glass panels are
      // windows and stay transparent to fire), so a body behind a crate is
      // actually protected. The round spends itself on the first prop hit.
      if (environmentManager) {
        let cover: DestructibleObject | null = null;
        for (const obj of environmentManager.destructibles) {
          if (obj.isBroken || obj.type === 'GLASS_PANEL') continue;
          if (
            Math.abs(b.x - obj.x) <= obj.width * 0.5 &&
            b.y <= obj.y &&
            b.y >= obj.y - obj.height
          ) {
            cover = obj;
            break;
          }
        }
        if (cover) {
          this.enemyBullets.splice(i, 1);
          const coverDir = Math.sign(b.vx) || 1;
          environmentManager.damageObject(cover, b.damage, coverDir * 90, -50);
          this.spawnSparks(b.x, b.y, -coverDir, 7, this.surfaceColor(cover.type));
          enemyBulletPool.release(b);
          continue;
        }
      }

      if (playerDead) continue;

      const dx = b.x - px;
      const dy = b.y - py;
      if (dx * dx + dy * dy < hitRadiusSq) {
        this.enemyBullets.splice(i, 1);
        if (isDodging) {
          enemyBulletPool.release(b); // i-frames: complete miss
          continue;
        }

        const dir = Math.sign(b.vx) || 1;

        if (isBlocking && !b.pierceBlock) {
          // Blocked round: chip damage + block spark (uses the same
          // blocking flag the melee path in checkEnemyAttacks uses)
          const chip = Math.max(2, Math.round(b.damage * 0.25));
          player.physics.health = Math.max(0, player.physics.health - chip);
          player.physics.stamina = Math.max(0, player.physics.stamina - 10);
          player.physics.velocity.x = dir * 120;
          camera.addTrauma(0.12);
          SoundFX.playPunch('light');
          this.addPopup(px, py - 20, `BLOCKED -${chip}`, '#94a3b8', 13);
          this.spawnSparks(b.x, b.y, -dir, 7, '#94a3b8');
        } else {
          if (isBlocking && b.pierceBlock) {
            // Guard-piercing round: the guard is simply walked through
            this.addPopup(px, py - 34, 'PIERCED!', '#f87171', 17);
          }
          // Clean hit: knockback follows the bullet's line of travel
          const sp = Math.hypot(b.vx, b.vy) || 1;
          player.takeDamage(b.damage, (b.vx / sp) * 300, (b.vy / sp) * 120 - 60);
          SoundFX.playPunch('heavy');
          camera.addTrauma(0.3);
          this.hitStopFrames = 5;
          this.breakCombo(); // Chain interrupted
          this.addPopup(px, py - 20, `-${b.damage}`, '#ef4444', 18);
          this.spawnSparks(b.x, b.y, dir, 10, '#ef4444');
          this.spawnBlood(b.x, b.y, dir, 5);
          // PHASE 1B 11: adaptive-difficulty window + hurt haptic
          this.playerDamageWindow += b.damage;
          Haptics.cue('hurt');
        }
        // P3-01: recycled only after every read of the shell is done
        enemyBulletPool.release(b);
      }
    }
  }

  /**
   * PHASE 1B 7 — environmental kills. A body travelling faster than 300 px/s
   * (heavy knockback, the GUN-FU BOWL, a slam) plows through whatever it
   * touches: glass panels burst, crates and racks splinter, and an explosive
   * barrel cooks off — which usually finishes whatever hit it. One prop is
   * resolved per enemy per frame, so a flight through a table cluster reads
   * as a chain instead of a single instant wipe.
   */
  private resolveEnvironmentalImpacts(
    enemies: EnemyController[],
    environmentManager: EnvironmentManager | undefined,
    camera: Camera
  ): void {
    if (!environmentManager) return;

    for (const enemy of enemies) {
      if (enemy.health <= 0) continue;
      const speed = Math.abs(enemy.velocity.x);
      if (speed < 300) continue;

      const bodyL = enemy.position.x - 24;
      const bodyR = enemy.position.x + 24;
      const bodyT = enemy.position.y - 104;
      const bodyB = enemy.position.y;

      for (const obj of environmentManager.destructibles) {
        if (obj.isBroken) continue;
        const oL = obj.x - obj.width * 0.5;
        const oR = obj.x + obj.width * 0.5;
        if (bodyR < oL || bodyL > oR) continue;
        if (bodyB < obj.y - obj.height || bodyT > obj.y) continue;

        const dirE = enemy.velocity.x >= 0 ? 1 : -1;
        const isBarrel = obj.type === 'EXPLOSIVE_BARREL';
        const isGlass = obj.type === 'GLASS_PANEL' || obj.type === 'GLASS_DISPLAY';

        // Barrel: guaranteed cook-off on a body hit (chain blast resolves next
        // frame through the shipped pendingExplosions queue). Glass: shatters
        // under the impact. Everything else: a heavy structural hit.
        environmentManager.damageObject(
          obj,
          isBarrel ? 999 : isGlass ? 120 : 60,
          dirE * 200,
          -90
        );

        if (!isGlass) {
          // Solid props hurt: modest body damage on top of the shatter
          const slam = Math.max(6, Math.round(speed * 0.03));
          enemy.takeDamage(slam, dirE * 120, -80, false);
        }

        this.registerStyle('ENV');
        this.addPopup(
          enemy.position.x,
          enemy.position.y - 130,
          isBarrel ? 'BARREL SLAM!' : isGlass ? 'GLASS BREAK!' : 'ENV SLAM!',
          isBarrel ? '#fb923c' : '#a5f3fc',
          20
        );
        this.announceMove(isBarrel ? 'ENVIRONMENTAL KILL' : 'ENV IMPACT');
        camera.addTrauma(isBarrel ? 0.5 : 0.28);
        Haptics.cue(isBarrel ? 'boom' : 'heavy');
        break;
      }
    }
  }

  private updateGrapple(
    dt: number,
    player: PlayerController,
    enemy: EnemyController,
    camera: Camera,
    enemies: EnemyController[]
  ) {
    this.grappleTimer += dt;
    const f = player.physics.facingRight ? 1 : -1;
    const px = player.physics.position.x;
    const py = player.physics.position.y;

    player.physics.velocity.x = 0;
    player.physics.velocity.y = 0;

    if (this.grappleVariant === 'EXECUTION') {
      this.updateExecutionGrapple(player, enemy, camera, f, px, py);
      return;
    }

    // 0.0s to 0.25s: Lock onto enemy collar and pull them in
    if (this.grappleTimer < 0.25) {
      enemy.position.x = px + f * 25;
      enemy.position.y = py;
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
    }
    // 0.25s to 0.45s: Pivot and hoist enemy overhead in judo shoulder throw
    else if (this.grappleTimer < 0.45) {
      const progress = (this.grappleTimer - 0.25) / 0.2;
      const angle = progress * Math.PI; // Arc overhead
      const throwRadius = 38;
      enemy.position.x = px + f * Math.cos(angle) * throwRadius;
      enemy.position.y = py - 40 - Math.sin(angle) * 35;
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
    }
    // 0.45s: SLAM onto the floor, then the body keeps going — bowling!
    else if (this.grappleTimer < 0.7) {
      if (this.grappleTimer - dt < 0.45) {
        // SLAM IMPACT FRAME!
        enemy.position.x = px - f * 42;
        enemy.position.y = py;
        SoundFX.playPunch('slam');
        camera.addTrauma(0.55);
        this.hitStopFrames = 12;
        this.speedLinesTimer = 0.32;

        const damage = Math.max(1, Math.round(42 * this.comboDamageMultiplier()));
        enemy.takeDamage(damage, -f * 120, 0, true);
        enemy.state = 'KNOCKBACK';
        enemy.stateTimer = 0;

        this.stats.takedownCount++;
        this.stats.score += 150;
        this.stats.totalDamageDealt += damage;
        this.addCombo(2, 3.2);

        this.spawnShockwave(enemy.position.x, py - 5, 55, '#f59e0b');
        this.spawnSparks(enemy.position.x, py - 8, -f, 18, '#fbbf24');
        this.spawnBlood(enemy.position.x, py - 20, -f, 16);
        this.spawnBlood(enemy.position.x, 0, -f, 6);
        this.addPopup(enemy.position.x, py - 35, `TAKEDOWN ${damage}`, '#f59e0b', 20);
        this.announceMove('JUDO SLAM');
        // PHASE 1B 9/8: the slam frame gets the tightest framing of the move
        camera.pushIn(1.42, 0.95);
        this.registerStyle('TAKEDOWN');
        Haptics.cue('takedown');

        // == GUN-FU RELEASE: the slammed body becomes the projectile ==
        // Aim it at whoever is left standing so the throw bowls through the
        // squad; with no one behind, it skids into the arena wall instead.
        let throwDir = -f;
        let nearestGap = Infinity;
        for (const other of enemies) {
          if (other === enemy || other.health <= 0) continue;
          const gap = other.position.x - enemy.position.x;
          if (Math.abs(gap) < 520 && Math.abs(gap) < nearestGap) {
            nearestGap = Math.abs(gap);
            throwDir = Math.sign(gap) || throwDir;
          }
        }
        enemy.velocity.x = throwDir * 900;
        enemy.velocity.y = -300;
        enemy.grounded = false;
        this.thrownEnemies.push({ enemy, hit: new Set<EnemyController>(), pins: 0 });

        if (player.physics.perks['VAMPIRIC_TAKEDOWN']) {
          player.physics.health = Math.min(player.physics.maxHealth, player.physics.health + 25);
          this.addPopup(player.physics.position.x, py - 65, '+25 HP (VAMPIRIC)', '#10b981', 18);
        }
      }
    }
    // 0.7s: Takedown complete, resume free control (the body flies on its own)
    else {
      this.endGrapple();
    }
  }

  /**
   * PISTOL-GRIP EXECUTION variant of the grab: haul them in, put the muzzle
   * to the temple at 0.28s, spend one round, and let the body drop away.
   */
  private updateExecutionGrapple(
    player: PlayerController,
    enemy: EnemyController,
    camera: Camera,
    f: number,
    px: number,
    py: number
  ) {
    // 0.0s - 0.28s: pinned in the collar grip while the pistol comes up
    if (this.grappleTimer < 0.28) {
      enemy.position.x = px + f * 26;
      enemy.position.y = py;
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.state = 'GRAPPLED';
      player.forceState('ATTACK_LIGHT_2'); // arm extended into their collar
      return;
    }

    // 0.28s: HEADSHOT — one round, temple, done
    if (!this.grappleShotFired) {
      this.grappleShotFired = true;
      player.forceState('ATTACK_GUN_SHOT');
      player.physics.ammo = Math.max(0, player.physics.ammo - 1);
      player.physics.isReloading = false;
      SoundFX.playGunshot();
      SoundFX.playGunCock();

      const headX = enemy.position.x + f * 6;
      const headY = py - 76;
      this.pushTracer(px + f * 34, py - 62, headX, headY, 0.13, 3.5);

      const damage = Math.max(1, Math.round(100 * this.comboDamageMultiplier()));
      const landed = enemy.takeDamage(damage, f * 520, -300, true);

      if (landed > 0) {
        this.hitStopFrames = 12;
        this.slowMoFactor = 0.3;
        this.slowMoTimer = 0.35;
        this.speedLinesTimer = 0.4;
        camera.addTrauma(0.6);
        this.spawnBlood(headX, headY, f, 22);
        this.spawnBlood(headX, headY - 8, -f, 8);
        this.spawnShockwave(headX, headY, 65, '#f87171');
        this.spawnSparks(headX, headY, f, 16, '#fbbf24');
        this.addPopup(headX, headY - 26, `EXECUTION -${damage}`, '#ef4444', 22);
        this.stats.totalDamageDealt += damage;
        this.stats.takedownCount++;
        this.stats.score += 150;
        this.addCombo(2, 3.5);
        this.announceMove('GRIP EXECUTION');
        // PHASE 1B 9/8: temple shot gets its own push-in + style credit
        camera.pushIn(1.45, 1.0);
        this.registerStyle('EXECUTION');
        Haptics.cue('takedown');
      } else {
        // Rolled through the muzzle — release them instead of leaving a
        // GRAPPLED husk behind when the grapple ends
        enemy.state = 'KNOCKBACK';
        enemy.stateTimer = 0;
        enemy.velocity.x = f * 320;
        enemy.velocity.y = -140;
        enemy.grounded = false;
        this.spawnSparks(headX, headY, -f, 6, '#94a3b8');
        this.addPopup(headX, headY - 14, 'WHIFF', '#94a3b8', 15);
      }

      // Lethal: land them face-down so loot, cinematics and wave-clear see it
      if (enemy.health <= 0) {
        enemy.state = 'DOWNED';
        enemy.stateTimer = 0;
      }
      return;
    }

    // 0.28s - 0.75s: the body is already flying; hold the player's pose,
    // then hand control back.
    if (this.grappleTimer > 0.75) {
      this.endGrapple();
    }
  }

  /** Releases the grapple and rewinds every per-grab bit of state. */
  private endGrapple(): void {
    this.isGrappling = false;
    this.grappledEnemy = null;
    this.grappleTimer = 0;
    this.grappleVariant = 'THROW';
    this.grappleShotFired = false;
  }

  /**
   * Bodies launched out of a slam keep bowling: each one plows into any live
   * enemy it touches (pin damage + knockdown) until it skids to a stop or
   * the floor catches it. Motion itself stays with EnemyController's own
   * KNOCKBACK physics — this only resolves the pins.
   */
  private updateThrownEnemies(dt: number, enemies: EnemyController[], camera: Camera) {
    if (this.thrownEnemies.length === 0) return;

    for (let i = this.thrownEnemies.length - 1; i >= 0; i--) {
      const thrown = this.thrownEnemies[i];
      const body = thrown.enemy;

      // Flight ends when the body lands out of knockback or is already down
      if (body.state !== 'KNOCKBACK' || body.health <= 0) {
        this.thrownEnemies.splice(i, 1);
        continue;
      }

      const speed = Math.abs(body.velocity.x);
      if (speed < 240) {
        // Rolled most of its energy out — no more pins from a crawling body
        this.thrownEnemies.splice(i, 1);
        continue;
      }

      for (const other of enemies) {
        if (other === body || other.health <= 0 || other.state === 'DOWNED') continue;
        if (thrown.hit.has(other) || other.evading) continue;
        if (thrown.pins >= 3) break;

        const dx = other.position.x - body.position.x;
        const dy = other.position.y - body.position.y;
        if (Math.abs(dx) > 54 || Math.abs(dy) > 74) continue;

        thrown.hit.add(other);
        thrown.pins++;

        const dir = Math.sign(body.velocity.x) || 1;
        const pinDamage = Math.max(1, Math.round(18 * this.comboDamageMultiplier()));
        const landed = other.takeDamage(pinDamage, dir * 470, -190, true);
        if (landed <= 0) continue;

        body.velocity.x *= 0.72; // energy transferred into the pin
        this.hitStopFrames = Math.max(this.hitStopFrames, 5);
        camera.addTrauma(0.3);
        SoundFX.playPunch('heavy');
        this.spawnShockwave(other.position.x, other.position.y - 50, 45, '#fbbf24');
        this.spawnSparks(other.position.x, other.position.y - 50, dir, 14, '#fbbf24');
        this.spawnBlood(other.position.x, other.position.y - 56, dir, 8);
        this.addPopup(other.position.x, other.position.y - 96, `BOWLING -${pinDamage}`, '#f59e0b', 18);
        this.stats.totalDamageDealt += landed;
        this.addCombo(1, 3.2);
        this.announceMove('GUN-FU BOWL');
      }
    }
  }

  private updateStyleRating() {
    const c = this.stats.comboCount;
    if (c >= 12) this.stats.styleRating = 'BABA YAGA';
    else if (c >= 8) this.stats.styleRating = 'APEX';
    else if (c >= 5) this.stats.styleRating = 'RELENTLESS';
    else if (c >= 3) this.stats.styleRating = 'BRUTAL';
    else this.stats.styleRating = 'NOIR';
  }

  public addPopup(x: number, y: number, text: string, color: string, size = 16) {
    trimOldest(
      this.popups,
      this.popups.length + 1 - CombatDirector.MAX_POPUPS,
      this.popupPool
    );
    const p = this.popupPool.acquire();
    p.id = ++this.popupIdCounter;
    p.x = x;
    p.y = y;
    p.text = text;
    p.color = color;
    p.size = size;
    p.life = 0.8;
    p.maxLife = 0.8;
    p.vy = -55;
    this.popups.push(p);
  }

  public spawnSparks(x: number, y: number, dir: number, count: number, color: string) {
    trimOldest(
      this.sparks,
      this.sparks.length + count - this.sparkCap,
      this.sparkPool
    );
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * 1.6 + (dir > 0 ? 0 : Math.PI);
      const speed = 120 + Math.random() * 220;
      const s = this.sparkPool.acquire();
      s.x = x;
      s.y = y;
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed - 60;
      s.life = 0.35 + Math.random() * 0.25;
      s.maxLife = 0.6;
      s.color = color;
      s.size = 2 + Math.random() * 2.5;
      this.sparks.push(s);
    }
  }

  public spawnShockwave(x: number, y: number, maxRadius: number, color: string) {
    trimOldest(
      this.shockwaves,
      this.shockwaves.length + 1 - CombatDirector.MAX_SHOCKWAVES,
      this.shockwavePool
    );
    const sw = this.shockwavePool.acquire();
    sw.x = x;
    sw.y = y;
    sw.radius = 6;
    sw.maxRadius = maxRadius;
    sw.life = 0.28;
    sw.maxLife = 0.28;
    sw.color = color;
    sw.lineWidth = 3;
    this.shockwaves.push(sw);
  }

  /** Pooled tracer push — ids stay monotonic so muzzle blooms stay correct. */
  private pushTracer(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    life: number,
    width: number
  ) {
    trimOldest(this.tracers, this.tracers.length + 1 - CombatDirector.MAX_TRACERS, this.tracerPool);
    const tr = this.tracerPool.acquire();
    tr.id = ++this.tracerIdCounter;
    tr.x1 = x1;
    tr.y1 = y1;
    tr.x2 = x2;
    tr.y2 = y2;
    tr.life = life;
    tr.maxLife = life;
    tr.color = '#fef08a';
    tr.width = width;
    this.tracers.push(tr);
  }

  /**
   * Blood spray from an impact point: red particles fly out with gravity, then
   * stick to the floor as short-lived splats that fade away.
   * Hard-capped at MAX_BLOOD so mobile frames stay smooth — when the pool is
   * full the oldest (already-fading) particles are recycled first.
   */
  public spawnBlood(x: number, y: number, dir: number, count: number = 8) {
    // Recycle oldest first when the pool is full (shells go back to the pool)
    trimOldest(
      this.bloodDecals,
      this.bloodDecals.length + count - this.bloodCap,
      this.bloodPool
    );

    for (let i = 0; i < count; i++) {
      const angle = (dir > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.4;
      const speed = 100 + Math.random() * 240;
      const b = this.bloodPool.acquire();
      b.x = x + (Math.random() - 0.5) * 6;
      b.y = y + (Math.random() - 0.5) * 10;
      b.vx = Math.cos(angle) * speed;
      b.vy = Math.sin(angle) * speed - (50 + Math.random() * 70);
      b.radius = 2.2 + Math.random() * 3.2;
      b.alpha = 0.95;
      b.life = 0;
      b.maxLife = 6.5;
      b.isStuck = false;
      this.bloodDecals.push(b);
    }
  }

  public spawnBladeArc(x: number, y: number, angle: number, radius = 55, color = '#f59e0b') {
    trimOldest(
      this.bladeArcs,
      this.bladeArcs.length + 1 - CombatDirector.MAX_BLADE_ARCS,
      this.bladeArcPool
    );
    const arc = this.bladeArcPool.acquire();
    arc.id = Math.random();
    arc.x = x;
    arc.y = y;
    arc.angle = angle;
    arc.radius = radius;
    arc.arcLength = Math.PI * 0.75;
    arc.color = color;
    arc.life = 0;
    arc.maxLife = 0.16;
    this.bladeArcs.push(arc);
  }

  private updateParticles(dt: number) {
    // Popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= 0.94;
      if (p.life <= 0) {
        this.popups.splice(i, 1);
        this.popupPool.release(p);
      }
    }

    // Sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 650 * dt; // Gravity
      s.vx *= 0.96;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        this.sparkPool.release(s);
      }
    }

    // Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      const progress = 1 - sw.life / sw.maxLife;
      sw.radius = 6 + progress * (sw.maxRadius - 6);
      if (sw.life <= 0) {
        this.shockwaves.splice(i, 1);
        this.shockwavePool.release(sw);
      }
    }

    // Bullet Tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.tracers.splice(i, 1);
        this.tracerPool.release(tr);
      }
    }

    // Blade Slash Arc Meshes
    for (let i = this.bladeArcs.length - 1; i >= 0; i--) {
      const arc = this.bladeArcs[i];
      arc.life += dt;
      if (arc.life >= arc.maxLife) {
        this.bladeArcs.splice(i, 1);
        this.bladeArcPool.release(arc);
      }
    }

    // Blood Decals (Godot CPUParticles2D splat physics)
    for (let i = this.bloodDecals.length - 1; i >= 0; i--) {
      const b = this.bloodDecals[i];
      b.life += dt;
      if (!b.isStuck) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vy += 1100 * dt; // Gravity
        // Hit floor at y = 0
        if (b.y >= 0) {
          b.y = 0;
          b.isStuck = true;
          b.vx = 0;
          b.vy = 0;
          b.radius *= 1.45; // Splat expansion
        }
      }
      // Fade out after 4.5 seconds
      if (b.life > 4.5) {
        b.alpha = Math.max(0, 1 - (b.life - 4.5) / 2.0);
      }
      if (b.life >= b.maxLife) {
        this.bloodDecals.splice(i, 1);
        this.bloodPool.release(b);
      }
    }

    // Spent Brass Casings (physics bouncing on the floor)
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.vy += 1200 * dt; // Gravity
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vRot * dt;

      // Floor bounce at baseline 0
      if (c.y >= 0) {
        c.y = 0;
        c.vy = -c.vy * 0.45;
        c.vx *= 0.7;
        c.vRot *= 0.6;
      }

      if (c.life <= 0) {
        this.casings.splice(i, 1);
        this.casingPool.release(c);
      }
    }
  }
}
