import { Vector2, StickFigurePose, EnemyActionState, EnemyType, Hitbox, EnemyBullet } from '../types/game';
import { clamp, lerp } from './MathUtils';
import { SoundFX } from './SoundFX';
import { mixPose, translatePose, smoothstep, strikeCurve } from './AnimationController';
import { Ragdoll, ragdollPool } from './Ragdoll';
import { ObjectPool } from './ObjectPool';

export type AttackPattern =
  | 'JAB'
  | 'HEAVY_HOOK'
  | 'SWEEP'
  | 'FLURRY'
  | 'SLAM'
  | 'LUNGE'
  | 'RIPOSTE';

/** Seconds into a dodge roll before the i-frames expire (punish window opens). */
const DODGE_IFRAMES = 0.3;
/** Total length of an enemy dodge roll. */
const DODGE_DURATION = 0.55;
/** Damage bonus multiplier applied while the enemy is in a punish window. */
const VULNERABLE_DAMAGE_MULT = 1.6;
/**
 * M14: enemies farther than this from the player run their decision tree at
 * ~20 Hz instead of every frame. Physics, state timers, cooldowns and pose
 * generation still run at full rate — only the branching logic is deferred,
 * and the deferred run replays the banked time so nothing drifts.
 */
const AI_THROTTLE_DISTANCE = 480;
/** Minimum simulated time between deferred AI decision runs. */
const AI_THROTTLE_INTERVAL = 1 / 20;

/**
 * P3-01: free list for GUNNER/SNIPER rounds. `fireBullet` acquires here and
 * CombatDirector releases when a round is spent or culled, so ranged spam
 * stops allocating fresh bullet objects (cap 64 + headroom, see
 * CombatDirector.MAX_ENEMY_BULLETS).
 */
export const enemyBulletPool = new ObjectPool<EnemyBullet>(
  () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, damage: 0, pierceBlock: false }),
  80
);

/**
 * The one place the punish-window bonus is applied, so the number a popup shows
 * and the number that actually lands are always the same value.
 */
export function resolveDamage(enemy: EnemyController, damage: number): number {
  return enemy.isVulnerable ? Math.round(damage * VULNERABLE_DAMAGE_MULT) : damage;
}

export class EnemyController {
  public id: string;
  public type: EnemyType = 'BASIC';
  public position: Vector2;
  public velocity: Vector2 = { x: 0, y: 0 };
  public facingRight: boolean = false;
  public grounded: boolean = true;

  // Combat Stats
  public health: number = 100;
  public maxHealth: number = 100;
  public ghostHealth: number = 100;
  public hpVisibleTimer: number = 0;
  public lastHitTime: number = 0;
  public staggerMeter: number = 0;
  public maxStagger: number = 50;
  public isStaggered: boolean = false;

  // State Machine
  public state: EnemyActionState = 'IDLE';
  public stateTimer: number = 0;
  /** M14: time banked toward the next throttled decision run (staggered). */
  private aiAccumulator: number = Math.random() * AI_THROTTLE_INTERVAL;
  public attackCooldown: number = 1.0;
  public blockCooldown: number = 0;
  /**
   * PHASE 1B 3: seconds this ranged archetype stays disarmed — its gun was
   * knocked loose by a heavy blow, so it closes to melee until the timer runs
   * out. 0 = armed and shooting normally.
   */
  public disarmTimer: number = 0;
  /**
   * PHASE 1B 11: adaptive-difficulty scalar written by GameLoop every half
   * second. 1.0 = shipped baseline (byte-identical behaviour); above speeds
   * the decision cooldowns and sharpens reactions, below softens them.
   */
  public adaptive: number = 1;
  public attackPattern: AttackPattern = 'JAB';

  // Reactive defense (per-archetype): guard chance, dodge chance and the
  // chance to riposte straight out of a successful block / evade.
  public blockChance: number = 0.35;
  public dodgeChance: number = 0;
  public counterChance: number = 0.35;
  public dodgeCooldown: number = 0;
  /** Queued up: release into a COUNTER riposte instead of neutral. */
  public counterQueued: boolean = false;
  /** How fast stagger builds on this archetype (BERSERKER cracks fast). */
  public staggerTakenScale: number = 1;
  /** Flurry string progress (0 = first hit of the chain). */
  private flurryCount: number = 0;
  /** RECOVERY is extra long and punishable for this attack. */
  private recoveryVulnerable: boolean = false;

  /** True while a SNIPER holds its 0.8s charge — Renderer draws the laser. */
  public get sniperCharging(): boolean {
    return this.type === 'SNIPER' && this.state === 'WINDUP' && this.rangedShot;
  }

  /**
   * True only inside the i-frame slice of a DODGE roll. Derived from the live
   * state rather than a flag so it can never go stale if the roll is interrupted.
   */
  public get evading(): boolean {
    return this.state === 'DODGE' && this.stateTimer < DODGE_IFRAMES;
  }

  /**
   * The punish window: the tail of a dodge roll, or the recovery of a heavy
   * commitment. Derived from the live state for the same staleness reason.
   */
  public get isVulnerable(): boolean {
    if (this.state === 'DODGE') {
      return this.stateTimer >= DODGE_IFRAMES && this.stateTimer < DODGE_DURATION;
    }
    if (this.state === 'RECOVERY') return this.recoveryVulnerable;
    return false;
  }

  // Combat Hitbox & Collision
  public activeHitbox: Hitbox | null = null;
  public hasHitPlayerThisAttack: boolean = false;
  public wallImpact: boolean = false;
  public hasDroppedLoot: boolean = false;

  // AI Coordination
  public targetOffset: number = 75; // Preferred distance offset from player (-75 for left, +75 for right)
  public moveSpeed: number = 140;
  public hasAttackToken: boolean = true;
  /**
   * PHASE 1B 6: scratch flag GameLoop uses while handing out attack slots —
   * set during the distance-ordered grant pass, cleared after update().
   */
  public tokenPicked: boolean = false;

  // Ragdoll death physics (spawned on lethal blow, rendered instead of the rig)
  public ragdoll: Ragdoll | null = null;

  // Endless-mode difficulty scaling (applied by GameLoop.spawnSquad)
  public damageScale: number = 1;

  /**
   * Phase 1 C6: multi-phase boss. Shifts at the 66 % / 33 % thresholds —
   * CombatDirector reads the flip to announce the phase banner.
   */
  public bossPhase: number = 1;
  /** Set for exactly one frame when `bossPhase` advances. */
  public phaseChanged: boolean = false;
  /**
   * Phase 1 C5: promoted elite variant of a normal archetype — ×1.8 HP,
   * violet/gold livery, flank slot, better reactions, ★ overhead tag.
   */
  public eliteVariant: boolean = false;

  // GUNNER ranged kit: fired shots queue here and are drained by
  // CombatDirector into combat.enemyBullets (muzzle FX play on drain)
  public pendingShots: EnemyBullet[] = [];
  public strafeDir: number = 1;
  private strafeTimer: number = 0;
  /** True = firing a round this WINDUP (GUNNER sidearm / SNIPER charge). */
  private rangedShot: boolean = false;

  // Procedural Animation
  public pose: StickFigurePose;
  private animTimer: number = 0;
  /** Length of the current telegraph — drives how far the wind-up coils. */
  private windupDuration: number = 0.22;
  /** Length of the current attack — drives the strike curve's peak timing. */
  private attackDuration: number = 0.3;

  // Visual Customization by Archetype
  // JOB 1b: every suit is a READABLE MID-TONE (not near-black) so enemies
  // survive dark stages; High Table ranks wear the crimson/red family and the
  // player stays the only ivory figure, so friend/foe reads at a glance.
  public suitColor: string = '#9b3033'; // High Table crimson
  public shirtColor: string = '#f0d7d7'; // Pale dress shirt
  public tieColor: string = '#311013'; // Blackened maroon tie
  /** Masked face tone — shared by the live rig and the death ragdoll. */
  public skinColor: string = '#6e5a5f';

  constructor(id: string, startX: number, startY: number, type: EnemyType = 'BASIC', sideOffset: number = 75) {
    this.id = id;
    this.type = type;
    this.position = { x: startX, y: startY };
    this.targetOffset = sideOffset;
    this.pose = this.createDefaultPose();
    this.initArchetype(type);
  }

  private initArchetype(type: EnemyType) {
    switch (type) {
      case 'RUSHER':
        this.maxHealth = 75;
        this.health = 75;
        this.moveSpeed = 190;
        this.maxStagger = 35;
        this.suitColor = '#b0512b'; // Ember rust (fast flanker)
        this.shirtColor = '#f7e3c4'; // Warm white shirt
        this.tieColor = '#5f2214'; // Scorch tie
        this.blockChance = 0.12;
        this.dodgeChance = 0.2;
        this.counterChance = 0.35;
        break;

      case 'HEAVY':
        this.maxHealth = 160;
        this.health = 160;
        this.moveSpeed = 95;
        this.maxStagger = 70;
        this.suitColor = '#6d2a3c'; // Oxblood wine (heavy plate)
        this.shirtColor = '#a78bfa'; // Violet dress shirt
        this.tieColor = '#f87171'; // Crimson tie
        this.blockChance = 0.2;
        this.dodgeChance = 0;
        this.counterChance = 0.3;
        break;

      case 'DEFENDER':
        this.maxHealth = 140;
        this.health = 140;
        this.moveSpeed = 115;
        this.maxStagger = 80;
        this.suitColor = '#3a5f8c'; // Steel-blue ballistic weave
        this.shirtColor = '#bfdbfe'; // Tactical cobalt shirt
        this.tieColor = '#fbbf24'; // Gold shield emblem
        this.blockChance = 0.65;
        this.dodgeChance = 0.08;
        this.counterChance = 0.6;
        break;

      case 'ELITE':
        this.maxHealth = 115;
        this.health = 115;
        this.moveSpeed = 230;
        this.maxStagger = 40;
        this.suitColor = '#7e1530'; // High Table shinobi crimson
        this.shirtColor = '#fb7185'; // Rose blood silk
        this.tieColor = '#f8fafc'; // Silver razor
        this.blockChance = 0.45;
        this.dodgeChance = 0.42;
        this.counterChance = 0.6;
        break;

      case 'GUNNER':
        this.maxHealth = 70;
        this.health = 70;
        this.moveSpeed = 200; // fast lateral strafe
        this.maxStagger = 35;
        this.suitColor = '#55663c'; // Tactical olive drab
        this.shirtColor = '#c7d6a8'; // Field olive shirt
        this.tieColor = '#d4a017'; // Brass rangefinder accent
        this.blockChance = 0.25;
        this.dodgeChance = 0.3;
        this.counterChance = 0.3;
        break;

      case 'BERSERKER':
        // Aggressive glass-cannon bruiser: FLURRY strings + overhead SLAM.
        // Weakness: never blocks or dodges and takes DOUBLE stagger damage,
        // so guard pressure and power kicks crack it wide open.
        this.maxHealth = 130;
        this.health = 130;
        this.moveSpeed = 215;
        this.maxStagger = 55;
        this.suitColor = '#a8342a'; // Blood-rust brawler
        this.shirtColor = '#f8fafc'; // Torn white undershirt
        this.tieColor = '#1c1917'; // No tie — stripped for a fight
        this.blockChance = 0;
        this.dodgeChance = 0;
        this.counterChance = 0;
        this.staggerTakenScale = 2;
        break;

      case 'ACROBAT':
        // Evasive duelist: backflips away from strikes, then lunges back in.
        // Weakness: low health and a long, vulnerable dodge recovery — punish it.
        this.maxHealth = 70;
        this.health = 70;
        this.moveSpeed = 245;
        this.maxStagger = 30;
        this.suitColor = '#1f6b74'; // Teal acrobat silks
        this.shirtColor = '#67e8f9'; // Cyan sash
        this.tieColor = '#a5f3fc'; // Pale ribbon
        this.blockChance = 0;
        this.dodgeChance = 0.78;
        this.counterChance = 0.7;
        this.staggerTakenScale = 1.2;
        break;

      case 'SNIPER':
        // Long-range glass cannon: 0.8s charged shot that IGNORES block.
        // Weakness: falls apart in melee and reels for ~0.9s after every shot.
        this.maxHealth = 55;
        this.health = 55;
        this.moveSpeed = 150;
        this.maxStagger = 45;
        this.suitColor = '#4a6a46'; // Ghillie olive
        this.shirtColor = '#bbf7d0'; // Forest shirt
        this.tieColor = '#4ade80'; // Rangefinder green
        this.blockChance = 0;
        this.dodgeChance = 0.22;
        this.counterChance = 0.25;
        break;

      case 'BOSS':
        this.maxHealth = 360;
        this.health = 360;
        this.moveSpeed = 210;
        this.maxStagger = 110;
        this.suitColor = '#7c1b28'; // Obsidian High Table crimson coat
        this.shirtColor = '#e3a54c'; // Burnished gold silk
        this.tieColor = '#ef4444'; // Crimson blood tie
        this.blockChance = 0.6;
        this.dodgeChance = 0.35;
        this.counterChance = 0.6;
        break;

      case 'MARQUIS':
        this.maxHealth = 480;
        this.health = 480;
        this.moveSpeed = 240;
        this.maxStagger = 135;
        this.suitColor = '#4b3a86'; // Imperial Marquis amethyst velvet
        this.shirtColor = '#eab308'; // Burnished sovereign gold
        this.tieColor = '#ffffff'; // French lace jabot cravat
        this.blockChance = 0.72;
        this.dodgeChance = 0.45;
        this.counterChance = 0.65;
        break;

      case 'BASIC':
      default:
        this.maxHealth = 100;
        this.health = 100;
        this.moveSpeed = 140;
        this.maxStagger = 50;
        this.suitColor = '#9b3033';
        this.shirtColor = '#f0d7d7';
        this.tieColor = '#311013';
        this.blockChance = 0.4;
        this.dodgeChance = 0.1;
        this.counterChance = 0.35;
        break;
    }
    this.ghostHealth = this.maxHealth;
  }

  /**
   * Endless-mode wave scaling: multiplies health pool, outgoing damage and
   * (Phase 1 C7) movement speed, so late waves feel faster, not just tankier.
   * Called by GameLoop.spawnSquad for waves beyond the authored milestones.
   */
  public applyWaveScaling(hpMult: number, dmgMult: number, speedMult: number = 1): void {
    this.maxHealth = Math.round(this.maxHealth * hpMult);
    this.health = this.maxHealth;
    this.ghostHealth = this.maxHealth;
    this.damageScale = dmgMult;
    if (speedMult !== 1) {
      this.moveSpeed = Math.round(this.moveSpeed * speedMult);
    }
  }

  /**
   * Phase 1 C5: promote this spawn to an elite variant of its archetype.
   * Bosses and the dedicated ELITE archetype are already the top tier.
   */
  public promoteToElite(): void {
    if (this.eliteVariant || this.type === 'ELITE' || this.type === 'BOSS' || this.type === 'MARQUIS') return;
    this.eliteVariant = true;
    this.maxHealth = Math.round(this.maxHealth * 1.8);
    this.health = this.maxHealth;
    this.ghostHealth = this.maxHealth;
    this.moveSpeed = Math.round(this.moveSpeed * 1.1);
    this.blockChance = Math.min(0.75, this.blockChance + 0.15);
    this.dodgeChance = Math.min(0.6, this.dodgeChance + 0.15);
    this.counterChance = Math.min(0.75, this.counterChance + 0.15);
    this.maxStagger = Math.round(this.maxStagger * 1.15);
    // Flank from the opposite shoulder so elites pressure both sides
    this.targetOffset = this.targetOffset >= 0 ? -95 : 95;
    // Violet + gold High Table livery
    this.suitColor = '#4c1d95';
    this.shirtColor = '#facc15';
    this.tieColor = '#f5f3ff';
  }

  /**
   * Phase 1 C6: advances the boss to the next phase once an HP threshold is
   * crossed — faster gait, tighter telegraphs, meaner hits.
   */
  private checkBossPhase(): void {
    if (this.type !== 'BOSS' && this.type !== 'MARQUIS') return;
    const ratio = this.health / this.maxHealth;
    const target = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (target <= this.bossPhase) return;

    this.bossPhase = target;
    this.phaseChanged = true;
    this.moveSpeed = Math.round(this.moveSpeed * (target === 2 ? 1.12 : 1.22));
    this.blockChance = Math.min(0.9, this.blockChance + 0.1);
    this.dodgeChance = Math.min(0.65, this.dodgeChance + 0.1);
    this.damageScale *= target === 2 ? 1.12 : 1.25;
    this.maxStagger = Math.round(this.maxStagger * 1.1);
    this.attackCooldown = Math.min(this.attackCooldown, 0.4);
    // Shed the hurt state so the phase shift reads as a deliberate power-up
    if (this.state === 'HURT' || this.state === 'KNOCKBACK') {
      this.state = 'IDLE';
      this.stateTimer = 0;
    }
  }

  public update(
    dt: number,
    playerPos: Vector2,
    playerState: string,
    playerGrounded: boolean,
    canAttack: boolean = true
  ) {
    this.stateTimer += dt;
    this.animTimer += dt;
    this.hasAttackToken = canAttack;
    // PHASE 1B: disarm window counts down here (ranged gates read it in AI)
    if (this.disarmTimer > 0) this.disarmTimer = Math.max(0, this.disarmTimer - dt);
    // PHASE 1B 11: adaptive scalar scales cooldown *drain* only — the authored
    // cooldown values themselves never change, so 1.0 matches the shipped AI.
    const coolScale = this.adaptive;
    if (this.attackCooldown > 0) this.attackCooldown -= dt * coolScale;
    if (this.blockCooldown > 0) this.blockCooldown -= dt;
    if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;

    // Health bar visibility countdown (only show when recently hit)
    if (this.hpVisibleTimer > 0) {
      this.hpVisibleTimer = Math.max(0, this.hpVisibleTimer - dt);
    }
    // Smooth ghost health trailing bar
    if (this.ghostHealth > this.health) {
      this.ghostHealth = Math.max(this.health, this.ghostHealth - dt * 55);
    } else {
      this.ghostHealth = this.health;
    }

    const distToPlayer = playerPos.x - this.position.x;
    const absDistToPlayer = Math.abs(distToPlayer);

    // Dynamic Facing: face player in all active combat states
    const canTurn =
      this.state !== 'HURT' &&
      this.state !== 'KNOCKBACK' &&
      this.state !== 'DOWNED' &&
      this.state !== 'GETUP' &&
      this.state !== 'GRAPPLED';

    if (canTurn && absDistToPlayer > 8) {
      this.facingRight = distToPlayer > 0;
    }

    // AI Decision Cycle
    // M14: a distant enemy that is only repositioning (IDLE / APPROACH) runs
    // its decision tree at ~20 Hz; anything in a committed combat state, or
    // anyone inside AI_THROTTLE_DISTANCE, keeps the full 60 Hz cadence.
    const fullRate =
      absDistToPlayer < AI_THROTTLE_DISTANCE ||
      (this.state !== 'IDLE' && this.state !== 'APPROACH');
    if (fullRate) {
      this.aiAccumulator = 0;
      this.updateAI(dt, playerPos, playerState, playerGrounded, distToPlayer, absDistToPlayer);
    } else {
      this.aiAccumulator += dt;
      if (this.aiAccumulator >= AI_THROTTLE_INTERVAL) {
        // Replay the banked time (clamped) so strafeTimer and the
        // per-second dodge roll keep real-time rates across the throttle.
        const banked = Math.min(this.aiAccumulator, AI_THROTTLE_INTERVAL * 2);
        this.aiAccumulator = 0;
        this.updateAI(banked, playerPos, playerState, playerGrounded, distToPlayer, absDistToPlayer);
      }
    }

    // Physics (Gravity, Ground Friction & Arena Wall Bounds)
    this.applyPhysics(dt);

    // Procedural Stick Pose Generation
    this.updatePose(dt);
  }

  private updateAI(
    dt: number,
    playerPos: Vector2,
    playerState: string,
    _playerGrounded: boolean,
    distToPlayer: number,
    absDistToPlayer: number
  ) {
    switch (this.state) {
      case 'IDLE':
      case 'APPROACH': {
        // Compute tactical target position based on assigned flanking offset
        const targetX = playerPos.x + this.targetOffset;
        const diffToTarget = targetX - this.position.x;
        const absDiffToTarget = Math.abs(diffToTarget);

        // Defensive Reaction: if the player is striking right in front of us,
        // raise the guard (archetype-driven chance) or roll clear of the swing.
        const isPlayerAttacking =
          playerState.startsWith('ATTACK_') || playerState === 'SLIDE';
        const guardReach = this.blockChance >= 0.6 ? 130 : 90;

        if (
          isPlayerAttacking &&
          absDistToPlayer < guardReach &&
          this.blockCooldown <= 0 &&
          this.health > 0 &&
          Math.random() < Math.min(0.9, this.blockChance * this.adaptive)
        ) {
          this.state = 'BLOCK';
          this.stateTimer = 0;
          this.counterQueued = false;
          this.blockCooldown = this.type === 'MARQUIS' ? 0.8 : this.type === 'DEFENDER' ? 1.0 : 1.8;
          this.velocity.x = 0;
          break;
        }

        // Evasive Reaction: ACROBATs (and lightly ELITE/GUNNER units) backflip
        // away from a committed strike — rolled on a scaled chance so it reads
        // as a reaction with human-ish latency instead of frame-perfect reflex.
        if (
          isPlayerAttacking &&
          absDistToPlayer < 125 &&
          this.dodgeCooldown <= 0 &&
          this.grounded &&
          this.health > 0 &&
          Math.random() < this.dodgeChance * this.adaptive * dt * 8
        ) {
          this.startDodge(distToPlayer);
          break;
        }

        // SNIPER: hold a long firing lane and charge a block-piercing shot.
        // PHASE 1B 3: a disarmed sniper drops the scope and closes to melee.
        if (this.type === 'SNIPER' && this.disarmTimer <= 0) {
          this.activeHitbox = null;

          if (absDistToPlayer < 320) {
            // Too close for the scope — back off and break the charge
            this.state = 'APPROACH';
            this.velocity.x = -Math.sign(distToPlayer) * this.moveSpeed;
          } else if (absDistToPlayer > 760) {
            this.state = 'APPROACH';
            this.velocity.x = Math.sign(distToPlayer) * this.moveSpeed;
          } else if (this.hasAttackToken && this.attackCooldown <= 0) {
            this.state = 'WINDUP';
            this.stateTimer = 0;
            this.rangedShot = true;
            this.velocity.x = 0;
          } else {
            // Holding the lane, waiting on cooldown
            this.state = 'IDLE';
            this.velocity.x = 0;
          }
          break;
        }

        // GUNNER: hold a 280-380px firing lane, strafe laterally, shoot on cooldown.
        // Falls back to a weak melee jab if the player closes the gap.
        // PHASE 1B 3: a disarmed gunner abandons the firing lane for fists
        if (this.type === 'GUNNER' && this.disarmTimer <= 0) {
          this.activeHitbox = null;

          // Strafe direction flips on a timer or at the arena walls
          this.strafeTimer -= dt;
          if (this.strafeTimer <= 0) {
            this.strafeDir *= -1;
            this.strafeTimer = 1.1 + Math.random() * 1.2;
          }
          if (Math.abs(this.position.x) > 800) {
            this.strafeDir = this.position.x > 0 ? -1 : 1;
          }

          // Weak melee shove when the player gets inside the gun's reach
          if (absDistToPlayer <= 85 && this.hasAttackToken && this.attackCooldown <= 0) {
            this.state = 'WINDUP';
            this.stateTimer = 0;
            this.rangedShot = false;
            this.attackPattern = 'JAB';
            this.attackCooldown = 1.6;
            this.velocity.x = 0;
            break;
          }

          if (absDistToPlayer < 280) {
            // Too close: back away from the player
            this.state = 'APPROACH';
            this.velocity.x = -Math.sign(distToPlayer) * this.moveSpeed;
          } else if (absDistToPlayer > 380) {
            // Too far: close the gap
            this.state = 'APPROACH';
            this.velocity.x = Math.sign(distToPlayer) * this.moveSpeed;
          } else {
            // In the pocket: strafe sideways, keep the gun up
            this.state = 'APPROACH';
            this.velocity.x = this.strafeDir * this.moveSpeed * 0.8;

            // Fire a round on cooldown (respects the coordinated attack token)
            if (this.hasAttackToken && this.attackCooldown <= 0 && absDistToPlayer <= 700) {
              this.state = 'WINDUP';
              this.stateTimer = 0;
              this.rangedShot = true;
              this.velocity.x = 0;
            }
          }
          break;
        }

        // Check if we are in striking range of player
        const inStrikingRange = absDistToPlayer <= (this.type === 'MARQUIS' ? 115 : this.type === 'ELITE' ? 100 : 85);

        if (inStrikingRange && this.hasAttackToken && this.attackCooldown <= 0) {
          // Trigger Attack Sequence
          this.state = 'WINDUP';
          this.stateTimer = 0;
          this.velocity.x = 0;

          // Select attack pattern based on archetype & randomness
          const roll = Math.random();
          if (this.type === 'MARQUIS') {
            this.attackPattern = roll < 0.4 ? 'HEAVY_HOOK' : roll < 0.75 ? 'SWEEP' : 'JAB';
            this.attackCooldown = 0.8 + Math.random() * 0.35;
          } else if (this.type === 'HEAVY') {
            this.attackPattern = roll < 0.65 ? 'HEAVY_HOOK' : 'JAB';
            this.attackCooldown = 1.8 + Math.random() * 0.6;
          } else if (this.type === 'RUSHER') {
            this.attackPattern = roll < 0.4 ? 'SWEEP' : 'JAB';
            this.attackCooldown = 1.2 + Math.random() * 0.4;
          } else if (this.type === 'DEFENDER') {
            this.attackPattern = roll < 0.55 ? 'HEAVY_HOOK' : 'JAB';
            this.attackCooldown = 1.5 + Math.random() * 0.4;
          } else if (this.type === 'ELITE') {
            this.attackPattern = roll < 0.45 ? 'SWEEP' : roll < 0.75 ? 'JAB' : 'HEAVY_HOOK';
            this.attackCooldown = 0.9 + Math.random() * 0.4;
          } else if (this.type === 'BERSERKER') {
            this.attackPattern = roll < 0.55 ? 'FLURRY' : roll < 0.85 ? 'SLAM' : 'JAB';
            this.attackCooldown = this.attackPattern === 'FLURRY' ? 1.15 : 1.9;
          } else if (this.type === 'ACROBAT') {
            this.attackPattern = roll < 0.5 ? 'LUNGE' : roll < 0.75 ? 'JAB' : 'SWEEP';
            this.attackCooldown = 1.0 + Math.random() * 0.35;
          } else {
            this.attackPattern = roll < 0.3 ? 'HEAVY_HOOK' : roll < 0.5 ? 'SWEEP' : 'JAB';
            this.attackCooldown = 1.5 + Math.random() * 0.5;
          }
          break;
        }

        // Locomotion: Move toward our tactical slot
        if (absDiffToTarget > 12) {
          this.state = 'APPROACH';
          const dir = Math.sign(diffToTarget);
          this.velocity.x = dir * this.moveSpeed;
        } else {
          // Reached tactical position: hold stance
          this.state = 'IDLE';
          this.velocity.x = 0;

          // If close enough and ready, attack even if slightly off target
          if (absDistToPlayer <= 90 && this.hasAttackToken && this.attackCooldown <= 0) {
            this.state = 'WINDUP';
            this.stateTimer = 0;
            this.attackPattern = 'JAB';
            this.attackCooldown = 1.5;
          }
        }
        break;
      }

      case 'BLOCK': {
        this.velocity.x = 0;
        this.activeHitbox = null;
        // Hold block for 0.45s or until player stops attacking
        if (this.stateTimer >= 0.48) {
          // A successful parry can be cashed in as a riposte if we queued one
          const riposte = this.counterQueued;
          this.state = riposte ? 'COUNTER' : 'IDLE';
          this.stateTimer = 0;
          this.counterQueued = false;
          if (riposte) this.hasHitPlayerThisAttack = false;
        }
        break;
      }

      case 'COUNTER': {
        // Riposte out of a parry: a fast committed counter-swing
        this.activeHitbox = null;
        this.velocity.x *= 0.85;
        const windup = 0.14;
        if (this.stateTimer < windup) break;

        if (!this.hasHitPlayerThisAttack) {
          this.hasHitPlayerThisAttack = true;
          this.attackPattern = 'RIPOSTE';
          const f = this.facingRight ? 1 : -1;
          SoundFX.playWhoosh(1.15);
          this.velocity.x = f * 260;
          this.activeHitbox = {
            x: this.position.x + f * 46,
            y: this.position.y - 66,
            radius: 30,
            damage: Math.round(20 * this.damageScale),
            knockbackX: f * 420,
            knockbackY: -140,
            hitStopFrames: 7,
          };
        }
        if (this.stateTimer >= windup + 0.26) {
          this.activeHitbox = null;
          this.state = 'RECOVERY';
          this.stateTimer = 0;
        }
        break;
      }

      case 'DODGE': {
        // i-frames / punish window are derived from stateTimer (see getters),
        // so this case only owns motion and the exit.
        this.activeHitbox = null;
        if (this.stateTimer >= DODGE_DURATION && this.grounded) {
          this.state = 'IDLE';
          this.stateTimer = 0;
        }
        break;
      }

      case 'WINDUP': {
        this.velocity.x *= 0.8;
        const telegraphTime =
          this.type === 'SNIPER' ? 0.8 :
          this.type === 'GUNNER' ? (this.rangedShot ? 0.5 : 0.22) :
          this.attackPattern === 'FLURRY' ? 0.12 :
          this.attackPattern === 'LUNGE' ? 0.18 :
          this.attackPattern === 'SLAM' ? 0.42 :
          this.attackPattern === 'HEAVY_HOOK' ? 0.36 : this.attackPattern === 'SWEEP' ? 0.25 : 0.22;
        // Recorded for the pose: the wind-up coils for exactly this long and
        // the strike curve peaks inside the committed attack.
        this.windupDuration = telegraphTime;
        this.attackDuration =
          this.attackPattern === 'FLURRY' ? 0.46 :
          this.attackPattern === 'SLAM' ? 0.34 :
          this.attackPattern === 'LUNGE' ? 0.34 :
          this.attackPattern === 'HEAVY_HOOK' ? 0.38 : 0.30;

        if (this.stateTimer >= telegraphTime) {
          this.state = 'ATTACK';
          this.stateTimer = 0;
          this.hasHitPlayerThisAttack = false;
          this.flurryCount = this.attackPattern === 'FLURRY' ? 1 : 0;
          const f = this.facingRight ? 1 : -1;

          if (this.rangedShot) {
            // Ranged shot: no melee hitbox — the round fires on the first
            // ATTACK frame in the ATTACK case below. Plant feet for the shot.
            this.velocity.x = 0;
          } else if (this.attackPattern === 'HEAVY_HOOK') {
            // Heavy lunging punch
            this.velocity.x = f * 220;
            SoundFX.playWhoosh(0.75);
            this.activeHitbox = {
              x: this.position.x + f * 45,
              y: this.position.y - 70,
              radius: 32,
              damage: Math.round(24 * this.damageScale),
              knockbackX: f * 340,
              knockbackY: -180,
              hitStopFrames: 8,
            };
          } else if (this.attackPattern === 'SLAM') {
            // BERSERKER overhead slam: slow, hits like a truck, floors you
            this.velocity.x = f * 60;
            SoundFX.playWhoosh(0.6);
            this.activeHitbox = {
              x: this.position.x + f * 38,
              y: this.position.y - 46,
              radius: 38,
              damage: Math.round(30 * this.damageScale),
              knockbackX: f * 300,
              knockbackY: -320,
              hitStopFrames: 10,
            };
          } else if (this.attackPattern === 'FLURRY') {
            // BERSERKER three-hit string — re-armed from the ATTACK case
            this.velocity.x = f * 90;
            SoundFX.playWhoosh(1.25);
            this.activeHitbox = {
              x: this.position.x + f * 40,
              y: this.position.y - 68,
              radius: 26,
              damage: Math.round(9 * this.damageScale),
              knockbackX: f * 170,
              knockbackY: -80,
              hitStopFrames: 4,
            };
          } else if (this.attackPattern === 'LUNGE') {
            // ACROBAT gap-closer: covers ground fast with a long lead leg
            this.velocity.x = f * 400;
            SoundFX.playWhoosh(1.05);
            this.activeHitbox = {
              x: this.position.x + f * 52,
              y: this.position.y - 46,
              radius: 30,
              damage: Math.round(16 * this.damageScale),
              knockbackX: f * 300,
              knockbackY: -150,
              hitStopFrames: 6,
            };
          } else if (this.attackPattern === 'SWEEP') {
            // Low sweep kick
            this.velocity.x = f * 180;
            SoundFX.playWhoosh(1.1);
            this.activeHitbox = {
              x: this.position.x + f * 40,
              y: this.position.y - 20,
              radius: 28,
              damage: Math.round(12 * this.damageScale),
              knockbackX: f * 200,
              knockbackY: -160,
              hitStopFrames: 5,
            };
          } else {
            // Fast lead jab (GUNNERs fight weak up close — they'd rather be shooting)
            this.velocity.x = f * 150;
            SoundFX.playWhoosh(0.9);
            this.activeHitbox = {
              x: this.position.x + f * 42,
              y: this.position.y - 70,
              radius: 26,
              damage: Math.round((this.type === 'GUNNER' ? 8 : 14) * this.damageScale),
              knockbackX: f * 220,
              knockbackY: -120,
              hitStopFrames: 5,
            };
          }
        }
        break;
      }

      case 'ATTACK': {
        // Ranged archetypes fire their round on the first frame of the attack
        // PHASE 1B 3: a disarm that lands mid-windup guts the shot outright.
        if (this.rangedShot && this.disarmTimer <= 0 && !this.hasHitPlayerThisAttack) {
          this.hasHitPlayerThisAttack = true;
          if (this.type === 'SNIPER') {
            // Charged round: fast, heavy, and it walks straight through a guard
            this.fireBullet(playerPos, 940, 26, true);
          } else {
            this.fireBullet(playerPos);
          }
        }
        this.velocity.x *= 0.88;

        if (this.attackPattern === 'FLURRY') {
          // Three-hit string: re-arm the fist for each beat of the combo
          const nextBeat = 0.14 * this.flurryCount;
          if (this.stateTimer >= nextBeat) {
            if (this.flurryCount < 3) {
              this.flurryCount++;
              this.hasHitPlayerThisAttack = false;
              const dir = this.facingRight ? 1 : -1;
              this.activeHitbox = {
                x: this.position.x + dir * 40,
                y: this.position.y - 68,
                radius: 26,
                damage: Math.round(9 * this.damageScale),
                knockbackX: dir * 170,
                knockbackY: -80,
                hitStopFrames: 4,
              };
            } else if (this.activeHitbox) {
              this.activeHitbox = null;
            }
          }
        } else if (this.stateTimer >= 0.16) {
          this.activeHitbox = null;
        }

        const activeDuration = this.attackDuration;
        if (this.stateTimer >= activeDuration) {
          this.state = 'RECOVERY';
          this.stateTimer = 0;
          this.activeHitbox = null;
          this.rangedShot = false;
          // A lunge, a slam or a whiffed heavy leaves you wide open — that
          // recovery is the punish window.
          this.recoveryVulnerable =
            this.attackPattern === 'HEAVY_HOOK' ||
            this.attackPattern === 'SLAM' ||
            this.attackPattern === 'LUNGE' ||
            this.type === 'SNIPER';
        }
        break;
      }

      case 'RECOVERY': {
        this.velocity.x *= 0.85;
        const recoveryDuration = this.type === 'RUSHER' ? 0.18 : 0.30;
        if (this.stateTimer >= recoveryDuration) {
          this.recoveryVulnerable = false;
          this.state = 'IDLE';
          this.stateTimer = 0;
        }
        break;
      }

      case 'HURT': {
        this.activeHitbox = null;
        this.velocity.x *= 0.82;
        if (this.stateTimer >= 0.20) {
          if (this.isStaggered) {
            this.state = 'STAGGER';
            this.stateTimer = 0;
          } else {
            this.state = 'IDLE';
            this.stateTimer = 0;
          }
        }
        break;
      }

      case 'STAGGER': {
        this.activeHitbox = null;
        this.velocity.x *= 0.85;
        if (this.stateTimer >= 1.6) {
          this.isStaggered = false;
          this.staggerMeter = 0;
          this.state = 'IDLE';
          this.stateTimer = 0;
        }
        break;
      }

      case 'KNOCKBACK': {
        this.activeHitbox = null;
        // Decelerates via ground friction in applyPhysics
        // Once stopped or grounded after duration, transition to DOWNED
        if (this.grounded && (Math.abs(this.velocity.x) < 25 || this.stateTimer > 0.45)) {
          this.velocity.x = 0;
          this.state = 'DOWNED';
          this.stateTimer = 0;
        }
        break;
      }

      case 'DOWNED': {
        this.velocity.x = 0;
        this.activeHitbox = null;
        // If still alive, get up after knockdown recovery
        if (this.health > 0 && this.stateTimer >= 1.2) {
          this.state = 'GETUP';
          this.stateTimer = 0;
        }
        break;
      }

      case 'GETUP': {
        this.velocity.x = 0;
        this.activeHitbox = null;
        if (this.stateTimer >= 0.45) {
          this.state = 'IDLE';
          this.stateTimer = 0;
          this.isStaggered = false;
          this.staggerMeter = 0;
        }
        break;
      }

      case 'GRAPPLED': {
        this.activeHitbox = null;
        break;
      }
    }
  }

  private applyPhysics(dt: number) {
    const gravity = 1200;
    const floorY = 0;
    const arenaBound = 840;

    // 1. Gravity & Air Drag
    if (!this.grounded) {
      this.velocity.y += gravity * dt;
      this.velocity.x *= Math.pow(0.96, dt * 60);
    } else {
      // 2. Ground Friction: Decelerate knockback and slides cleanly
      const groundFriction = 1300;
      const speed = Math.abs(this.velocity.x);
      if (speed > 0) {
        const newSpeed = Math.max(0, speed - groundFriction * dt);
        this.velocity.x = Math.sign(this.velocity.x) * newSpeed;
      }
    }

    // 3. Integrate Position
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;

    // 4. Arena Boundary Clamp & Wall Bounce
    if (this.position.x < -arenaBound) {
      this.position.x = -arenaBound;
      if (this.state === 'KNOCKBACK' && Math.abs(this.velocity.x) > 80) {
        this.velocity.x = Math.abs(this.velocity.x) * 0.4; // Wall bounce
        this.wallImpact = true;
      } else {
        this.velocity.x = 0;
      }
    } else if (this.position.x > arenaBound) {
      this.position.x = arenaBound;
      if (this.state === 'KNOCKBACK' && Math.abs(this.velocity.x) > 80) {
        this.velocity.x = -Math.abs(this.velocity.x) * 0.4; // Wall bounce
        this.wallImpact = true;
      } else {
        this.velocity.x = 0;
      }
    }

    // 5. Ground Plane Collision
    if (this.position.y >= floorY) {
      this.position.y = floorY;
      if (!this.grounded && Math.abs(this.velocity.y) > 220) {
        SoundFX.playPunch('light');
      }
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  /**
   * Evasive roll away from a committed strike. The first DODGE_IFRAMES seconds
   * are untouchable; the tail of the roll is a guaranteed punish window, which
   * is what keeps the dodge a commitment rather than a free "get out" button.
   */
  private startDodge(distToPlayer: number) {
    this.state = 'DODGE';
    this.stateTimer = 0;
    this.counterQueued = false;
    this.activeHitbox = null;
    this.dodgeCooldown = 1.6 + Math.random() * 0.9;
    // Roll away from the player (away from the side they're on)
    const away = distToPlayer > 0 ? -1 : 1;
    this.velocity.x = away * this.moveSpeed * 3.2;
    this.velocity.y = -180;
    this.grounded = false;
    SoundFX.playWhoosh(1.25);
  }

  /**
   * @returns the damage that actually landed (0 when the hit was phased through
   * by dodge i-frames), so the caller can gate its impact feedback.
   */
  public takeDamage(
    damage: number,
    knockbackX: number,
    knockbackY: number,
    isHeavy: boolean = false
  ): number {
    // Dodge i-frames: the roll ghosts straight through the blow
    if (this.evading) return 0;

    // A shot called off mid-charge must not leave stale ranged state behind
    this.rangedShot = false;

    const applied = resolveDamage(this, damage);
    this.health = Math.max(0, this.health - applied);
    this.hpVisibleTimer = 3.2; // Show health bar only upon taking damage
    this.lastHitTime = performance.now();

    // Phase 1 C6: threshold check on the new health total
    if (this.health > 0) this.checkBossPhase();

    // Lethal blow: detach into a full ragdoll seeded from the current pose
    // with the killing impulse, so the body tumbles instead of vanishing
    // P3-02: recycled shell — released when GameLoop drops the corpse.
    if (this.health <= 0 && !this.ragdoll) {
      this.ragdoll = ragdollPool.acquire();
      this.ragdoll.reset(this.pose, knockbackX, knockbackY);
    }

    this.velocity.x = knockbackX;
    this.velocity.y = knockbackY;
    this.grounded = false;

    // Stagger Build-up
    this.staggerMeter += isHeavy ? 30 : 15;
    if (this.staggerMeter >= this.maxStagger) {
      this.isStaggered = true;
    }

    // Heavy Brute Archetype has Super Armor against light attacks unless staggered
    if (this.type === 'HEAVY' && !isHeavy && !this.isStaggered && this.health > 0) {
      this.velocity.x = knockbackX * 0.3;
      this.velocity.y = 0;
      this.grounded = true;
      return applied;
    }

    // Transition to Knockback (Heavy hits / Launchers / Lethal) or Hurt
    if (isHeavy || Math.abs(knockbackX) > 260 || knockbackY < -140 || this.health <= 0) {
      this.state = 'KNOCKBACK';
      this.stateTimer = 0;
    } else {
      this.state = 'HURT';
      this.stateTimer = 0;
    }
    return applied;
  }

  /**
   * GUNNER ranged attack: queues an EnemyBullet from the muzzle, aimed at the
   * player's torso. CombatDirector drains pendingShots into combat.enemyBullets
   * and plays the muzzle FX on drain. Cooldown shortens slightly on later
   * waves via the endless-mode damageScale.
   */
  private fireBullet(
    playerPos: Vector2,
    speed: number = 520,
    damage: number = 12,
    pierceBlock: boolean = false
  ) {
    const f = this.facingRight ? 1 : -1;
    const muzzleX = this.position.x + f * 22;
    const muzzleY = this.position.y - 72;
    const targetX = playerPos.x;
    const targetY = playerPos.y - 60; // player's torso
    const dx = targetX - muzzleX;
    const dy = targetY - muzzleY;
    const dist = Math.hypot(dx, dy) || 1;

    // P3-01: recycled shell instead of a fresh literal per shot
    const bullet = enemyBulletPool.acquire();
    bullet.x = muzzleX;
    bullet.y = muzzleY;
    bullet.vx = (dx / dist) * speed;
    bullet.vy = (dy / dist) * speed;
    bullet.life = 2.5;
    bullet.maxLife = 2.5;
    bullet.damage = Math.round(damage * this.damageScale);
    bullet.pierceBlock = pierceBlock;
    this.pendingShots.push(bullet);

    this.velocity.x = 0;
    this.attackCooldown = 2.2 / Math.max(1, this.damageScale);
  }

  public guardBreak() {
    this.isStaggered = true;
    this.staggerMeter = this.maxStagger;
    this.hpVisibleTimer = 3.2;
    this.lastHitTime = performance.now();
    this.state = 'STAGGER';
    this.stateTimer = 0;
    this.velocity.x = (this.facingRight ? -1 : 1) * 120;
  }

  // ---- Pose cross-fade ---------------------------------------------------------
  // Poses are authored body-local (root at 0,0) so a state change or a facing
  // pivot can be eased from exactly what was on screen last frame instead of
  // teleporting the limbs.
  private lastLocalPose: StickFigurePose | null = null;
  private poseBlendFrom: StickFigurePose | null = null;
  private poseBlendElapsed = 0;
  private poseBlendDuration = 0;
  private poseState: EnemyActionState | null = null;
  private poseFacingRight: boolean | null = null;
  /** Seconds a state/facing change takes to ease into. */
  /** P6-02: flipped on by GameLoop while the Rig debug stats chip is live. */
  public static profilePose = false;
  /** P6-02: pose-generation ms accumulated since the stats chip last read it. */
  public static poseProfileMs = 0;

  private static readonly POSE_BLEND = 0.09;

  /** Distance-phased enemy gait, so the planted foot doesn't skate at speed. */
  private gaitPhase = 0;
  private gaitActive = false;
  /** Ground covered by one full enemy stride (matches the ±26px foot swing). */
  private static readonly GAIT_STRIDE = 104;

  private updatePose(dt: number) {
    const profileStart = EnemyController.profilePose ? performance.now() : 0;
    if (this.state === 'APPROACH') {
      if (!this.gaitActive) this.gaitPhase = 0.55;
      this.gaitActive = true;
      this.gaitPhase +=
        ((Math.PI * 2) / EnemyController.GAIT_STRIDE) * Math.abs(this.velocity.x) * dt;
    } else {
      this.gaitActive = false;
    }

    const target = this.buildEnemyPose();

    if (
      (this.poseState !== this.state || this.poseFacingRight !== this.facingRight) &&
      this.lastLocalPose
    ) {
      this.poseBlendFrom = this.lastLocalPose;
      // Retarget an in-flight fade rather than restarting it, so trading states
      // frame to frame eases instead of stuttering.
      if (this.poseBlendElapsed >= this.poseBlendDuration) this.poseBlendElapsed = 0;
      this.poseBlendDuration = EnemyController.POSE_BLEND;
    }
    this.poseState = this.state;
    this.poseFacingRight = this.facingRight;

    let local = target;
    if (this.poseBlendFrom && this.poseBlendElapsed < this.poseBlendDuration) {
      this.poseBlendElapsed += dt;
      const t = Math.min(1, this.poseBlendElapsed / this.poseBlendDuration);
      local = mixPose(this.poseBlendFrom, target, smoothstep(t));
      if (t >= 1) this.poseBlendFrom = null;
    } else {
      this.poseBlendFrom = null;
    }
    this.lastLocalPose = local;

    this.pose = translatePose(local, this.position.x, this.position.y);
    if (EnemyController.profilePose) {
      EnemyController.poseProfileMs += performance.now() - profileStart;
    }
  }

  /** Builds the pose for the current state, authored around the origin. */
  private buildEnemyPose(): StickFigurePose {
    const f = this.facingRight ? 1 : -1;
    const px = 0;
    const py = 0;

    if (this.state === 'DOWNED') {
      // Flat on ground
      return {
        head: { x: px - f * 45, y: py - 8 },
        neck: { x: px - f * 30, y: py - 8 },
        torso: { x: px - f * 10, y: py - 8 },
        hips: { x: px + f * 10, y: py - 8 },
        leftShoulder: { x: px - f * 28, y: py - 12 },
        leftElbow: { x: px - f * 35, y: py - 20 },
        leftHand: { x: px - f * 20, y: py - 22 },
        rightShoulder: { x: px - f * 28, y: py - 4 },
        rightElbow: { x: px - f * 15, y: py - 4 },
        rightHand: { x: px, y: py - 4 },
        leftHip: { x: px + f * 10, y: py - 10 },
        leftKnee: { x: px + f * 35, y: py - 8 },
        leftFoot: { x: px + f * 55, y: py - 4 },
        rightHip: { x: px + f * 10, y: py - 6 },
        rightKnee: { x: px + f * 30, y: py - 6 },
        rightFoot: { x: px + f * 48, y: py - 4 },
        tieBase: { x: px - f * 28, y: py - 8 },
        tieMid: { x: px - f * 18, y: py - 6 },
        tieTip: { x: px - f * 8, y: py - 5 },
        coatTailLeft: { x: px + f * 15, y: py - 12 },
        coatTailRight: { x: px + f * 15, y: py - 4 },
      };
    }

    if (this.state === 'GETUP') {
      // Rising from ground onto one knee — eased, so the hips lead the head
      // out of the floor instead of the whole body sliding up evenly.
      const progress = smoothstep(clamp(this.stateTimer / 0.45, 0, 1));
      const riseY = py - progress * 40;
      return {
        head: { x: px - f * 15 + f * progress * 15, y: riseY - 50 },
        neck: { x: px - f * 10 + f * progress * 10, y: riseY - 38 },
        torso: { x: px - f * 5 + f * progress * 5, y: riseY - 25 },
        hips: { x: px, y: riseY - 12 },
        leftShoulder: { x: px - f * 14, y: riseY - 36 },
        leftElbow: { x: px - f * 10, y: riseY - 20 },
        leftHand: { x: px - f * 8, y: py },
        rightShoulder: { x: px + f * 6, y: riseY - 36 },
        rightElbow: { x: px + f * 14, y: riseY - 24 },
        rightHand: { x: px + f * 18, y: riseY - 14 },
        leftHip: { x: px - 8, y: riseY - 12 },
        leftKnee: { x: px - 16, y: py - 10 },
        leftFoot: { x: px - 20, y: py },
        rightHip: { x: px + 8, y: riseY - 12 },
        rightKnee: { x: px + 14, y: py - 14 },
        rightFoot: { x: px + 22, y: py },
        tieBase: { x: px, y: riseY - 38 },
        tieMid: { x: px - f * 2, y: riseY - 26 },
        tieTip: { x: px - f * 3, y: riseY - 14 },
        coatTailLeft: { x: px - 10, y: riseY - 8 },
        coatTailRight: { x: px + 10, y: riseY - 8 },
      };
    }

    if (this.state === 'BLOCK') {
      // Guarded Boxing Defense (forearms crossed in front of face)
      return {
        head: { x: px - f * 4, y: py - 94 },
        neck: { x: px - f * 2, y: py - 82 },
        torso: { x: px, y: py - 66 },
        hips: { x: px, y: py - 48 },
        // Crossed defensive arms
        leftShoulder: { x: px - f * 10, y: py - 80 },
        leftElbow: { x: px + f * 8, y: py - 78 },
        leftHand: { x: px + f * 14, y: py - 92 },
        rightShoulder: { x: px + f * 6, y: py - 80 },
        rightElbow: { x: px + f * 12, y: py - 74 },
        rightHand: { x: px + f * 12, y: py - 96 },
        leftHip: { x: px - 10, y: py - 48 },
        leftKnee: { x: px - 16, y: py - 24 },
        leftFoot: { x: px - 20, y: py },
        rightHip: { x: px + 8, y: py - 48 },
        rightKnee: { x: px + 14, y: py - 24 },
        rightFoot: { x: px + 18, y: py },
        tieBase: { x: px - f * 2, y: py - 82 },
        tieMid: { x: px - f * 1, y: py - 70 },
        tieTip: { x: px, y: py - 58 },
        coatTailLeft: { x: px - 12, y: py - 42 },
        coatTailRight: { x: px + 12, y: py - 42 },
      };
    }

    if (this.state === 'STAGGER') {
      // Groggily wobbling
      const sway = Math.sin(this.animTimer * 9) * 7;
      return {
        head: { x: px - f * 10 + sway, y: py - 95 },
        neck: { x: px - f * 8 + sway * 0.7, y: py - 82 },
        torso: { x: px - f * 5, y: py - 66 },
        hips: { x: px, y: py - 48 },
        leftShoulder: { x: px - f * 14, y: py - 80 },
        leftElbow: { x: px - f * 16, y: py - 60 },
        leftHand: { x: px - f * 14, y: py - 42 },
        rightShoulder: { x: px - f * 2, y: py - 80 },
        rightElbow: { x: px + f * 2, y: py - 60 },
        rightHand: { x: px + f * 6, y: py - 42 },
        leftHip: { x: px - 8, y: py - 48 },
        leftKnee: { x: px - 14, y: py - 24 },
        leftFoot: { x: px - 18, y: py },
        rightHip: { x: px + 8, y: py - 48 },
        rightKnee: { x: px + 12, y: py - 24 },
        rightFoot: { x: px + 16, y: py },
        tieBase: { x: px - f * 8, y: py - 80 },
        tieMid: { x: px - f * 7 + sway * 0.5, y: py - 68 },
        tieTip: { x: px - f * 6 + sway, y: py - 56 },
        coatTailLeft: { x: px - 10, y: py - 44 },
        coatTailRight: { x: px + 10, y: py - 44 },
      };
    }

    if (this.state === 'WINDUP') {
      // Progressive coil through the whole telegraph: the fist keeps pulling
      // back, the weight loads onto the rear foot, the lead heel lightens and
      // the shoulder drops — a readable anticipation the player can read.
      const coil = smoothstep(clamp(this.stateTimer / Math.max(0.05, this.windupDuration), 0, 1));
      return {
        head: { x: px - f * (8 + coil * 3), y: py - 98 + coil * 2 },
        neck: { x: px - f * (5 + coil * 3), y: py - 86 },
        torso: { x: px - f * (2 + coil * 5), y: py - 70 + coil },
        hips: { x: px - f * coil * 3, y: py - 50 + coil },
        // Guard hand extends to measure range while the striking arm coils
        leftShoulder: { x: px - f * 12, y: py - 84 },
        leftElbow: { x: px + f * (6 + coil * 3), y: py - 74 },
        leftHand: { x: px + f * (18 + coil * 8), y: py - 80 },
        rightShoulder: { x: px + f * 4, y: py - 84 },
        rightElbow: { x: px - f * (20 + coil * 12), y: py - 78 + coil * 4 },
        rightHand: { x: px - f * (24 + coil * 18), y: py - 68 + coil * 6 },
        // Weight rocks onto the back leg, front heel peels off the floor
        leftHip: { x: px - 10, y: py - 50 },
        leftKnee: { x: px - f * (16 + coil * 4), y: py - 25 },
        leftFoot: { x: px - f * (18 + coil * 5), y: py },
        rightHip: { x: px + 10, y: py - 50 },
        rightKnee: { x: px + f * (16 - coil * 2), y: py - 25 },
        rightFoot: { x: px + f * (22 - coil * 2), y: py - coil * 6 },
        tieBase: { x: px - f * 5, y: py - 84 },
        tieMid: { x: px - f * (4 + coil * 3), y: py - 72 },
        tieTip: { x: px - f * (3 + coil * 6), y: py - 60 },
        coatTailLeft: { x: px - f * (12 + coil * 4), y: py - 44 },
        coatTailRight: { x: px + f * (12 - coil * 2), y: py - 44 },
      };
    }

    if (this.state === 'ATTACK') {
      // One shared strike curve drives every pattern: coil → snap → hold →
      // recover, peaking inside the committed attack window. The FLURRY beats
      // re-run the curve every 0.14s so each punch of the string snaps.
      const flurry = this.attackPattern === 'FLURRY';
      const beatDur = flurry ? 0.14 : Math.max(0.1, this.attackDuration);
      const beat = flurry ? this.stateTimer % beatDur : this.stateTimer;
      const ext = strikeCurve(beat, beatDur);
      const drive = Math.max(0, ext);
      const lead = Math.max(0, -ext);

      if (this.attackPattern === 'SWEEP') {
        // Low sweep kick: support hand braces, the leg scythes through
        return {
          head: { x: px - f * (6 + lead * 4), y: py - 65 },
          neck: { x: px - f * 4, y: py - 55 },
          torso: { x: px - f * (2 + drive * 4), y: py - 42 },
          hips: { x: px + f * drive * 4, y: py - 28 },
          leftShoulder: { x: px - f * 10, y: py - 52 },
          leftElbow: { x: px - f * 14, y: py - 36 },
          leftHand: { x: px - f * 12, y: py - 18 },
          rightShoulder: { x: px + f * 4, y: py - 52 },
          rightElbow: { x: px + f * 8, y: py - 36 },
          rightHand: { x: px + f * 6, y: py - 20 },
          leftHip: { x: px - 6, y: py - 28 },
          leftKnee: { x: px - 12, y: py - 14 },
          leftFoot: { x: px - 16, y: py },
          rightHip: { x: px + 6, y: py - 28 },
          rightKnee: { x: px + f * (10 + ext * 16), y: py - 16 },
          rightFoot: { x: px + f * (18 + ext * 30), y: py - 4 },
          tieBase: { x: px - f * 4, y: py - 55 },
          tieMid: { x: px - f * 2, y: py - 45 },
          tieTip: { x: px, y: py - 35 },
          coatTailLeft: { x: px - 10, y: py - 22 },
          coatTailRight: { x: px + 10, y: py - 22 },
        };
      }

      if (this.attackPattern === 'SLAM') {
        // Overhead slam: arms ride high through the coil, then drive down
        const armY = py - 92 + ext * 30;
        return {
          head: { x: px - f * (4 + lead * 4 - drive * 6), y: py - 96 + drive * 6 },
          neck: { x: px - f * (2 + lead * 3 - drive * 5), y: py - 84 + drive * 5 },
          torso: { x: px - f * (lead * 5 - drive * 8), y: py - 68 + drive * 4 },
          hips: { x: px + f * drive * 5, y: py - 50 + drive * 4 },
          leftShoulder: { x: px - f * 8, y: py - 82 },
          leftElbow: { x: px - f * (4 - drive * 6), y: armY + 6 },
          leftHand: { x: px + f * (2 + drive * 10), y: armY + 14 },
          rightShoulder: { x: px + f * 8, y: py - 82 },
          rightElbow: { x: px + f * (4 + drive * 8), y: armY },
          rightHand: { x: px + f * (6 + drive * 14), y: armY + 10 },
          leftHip: { x: px - f * 8, y: py - 50 },
          leftKnee: { x: px - f * 14, y: py - 25 },
          leftFoot: { x: px - f * 18, y: py },
          rightHip: { x: px + f * 8, y: py - 50 },
          rightKnee: { x: px + f * (16 + drive * 4), y: py - 25 + drive * 6 },
          rightFoot: { x: px + f * (22 + drive * 6), y: py },
          tieBase: { x: px + f * 2, y: py - 82 },
          tieMid: { x: px + f * 4, y: py - 70 + drive * 4 },
          tieTip: { x: px + f * 6, y: py - 58 + drive * 8 },
          coatTailLeft: { x: px - 14, y: py - 42 },
          coatTailRight: { x: px + 14, y: py - 42 },
        };
      }

      if (this.attackPattern === 'LUNGE') {
        // Acrobat gap-closer: lead leg spears out while the torso pitches in
        return {
          head: { x: px + f * (6 + drive * 8), y: py - 94 },
          neck: { x: px + f * (4 + drive * 6), y: py - 82 },
          torso: { x: px + f * (2 + drive * 8), y: py - 66 },
          hips: { x: px + f * drive * 6, y: py - 48 },
          leftShoulder: { x: px - f * 8, y: py - 82 },
          leftElbow: { x: px - f * (14 - drive * 6), y: py - 70 },
          leftHand: { x: px - f * (16 - drive * 8), y: py - 58 },
          rightShoulder: { x: px + f * 8, y: py - 82 },
          rightElbow: { x: px + f * (14 + drive * 14), y: py - 74 },
          rightHand: { x: px + f * (22 + drive * 24), y: py - 70 },
          leftHip: { x: px - 8, y: py - 48 },
          leftKnee: { x: px - f * 14, y: py - 24 },
          leftFoot: { x: px - f * (18 + lead * 4), y: py },
          rightHip: { x: px + 8, y: py - 48 },
          rightKnee: { x: px + f * (14 + ext * 20), y: py - 26 - drive * 8 },
          rightFoot: { x: px + f * (22 + ext * 34), y: py - drive * 10 },
          tieBase: { x: px + f * 6, y: py - 82 },
          tieMid: { x: px - f * (2 + lead * 8), y: py - 70 },
          tieTip: { x: px - f * (4 + lead * 16), y: py - 58 },
          coatTailLeft: { x: px - f * (14 + lead * 8), y: py - 42 },
          coatTailRight: { x: px + f * 14, y: py - 42 },
        };
      }

      // JAB / HEAVY_HOOK / FLURRY: straight punch or heavy hook.
      // ext = 0 is the END of the wind-up (fist at the ribs, hips loaded), so
      // WINDUP → ATTACK → RECOVERY are all one continuous motion and the
      // curve's own anticipation reads as a deeper coil before the snap.
      const hook = this.attackPattern === 'HEAVY_HOOK';
      const handTravel = hook ? 62 : 92;
      const elbowTravel = hook ? 40 : 55;
      return {
        head: { x: px + f * (-11 + ext * 20), y: py - 96 },
        neck: { x: px + f * (-8 + ext * 15), y: py - 86 + ext * 2 },
        torso: { x: px + f * (-7 + ext * 11), y: py - 69 + ext },
        hips: { x: px + f * (-3 + ext * 7), y: py - 49 + ext },
        // Guard hand measures range on the coil, checks back in at extension
        leftShoulder: { x: px + f * (-12 + ext * 6), y: py - 84 + ext * 2 },
        leftElbow: { x: px + f * (9 - ext * 13), y: py - 74 + ext * 6 },
        leftHand: { x: px + f * (26 - ext * 24), y: py - 80 + ext * 6 },
        // Striking arm: shoulder-deep on the coil, snapped through on the peak
        rightShoulder: { x: px + f * (4 + ext * 8), y: py - 84 + ext * 2 },
        rightElbow: {
          x: px + f * (-32 + ext * elbowTravel),
          y: py - 74 + ext * 3 + (hook ? ext * 6 : 0),
        },
        rightHand: {
          x: px + f * (-42 + ext * handTravel),
          y: py - 62 - ext * 9 - (hook ? ext * 6 : 0),
        },
        // Stance: back foot braces through the coil, front foot drives and
        // the lifted heel replants on the snap
        leftHip: { x: px - 10 - drive * 2, y: py - 49 + ext },
        leftKnee: { x: px - f * 20, y: py - 25 },
        leftFoot: { x: px - f * (23 + drive * 6), y: py },
        rightHip: { x: px + 10 - drive * 2, y: py - 49 + ext },
        rightKnee: { x: px + f * (14 + drive * 6), y: py - 25 },
        rightFoot: {
          x: px + f * (20 + drive * 8),
          y: py - 6 * Math.max(0, 1 - drive),
        },
        tieBase: { x: px + f * (-5 + ext * 13), y: py - 84 + ext * 2 },
        tieMid: { x: px + f * (-7 + ext * 11), y: py - 72 + ext * 2 },
        tieTip: { x: px + f * (-9 + ext * 12), y: py - 60 + ext * 2 },
        coatTailLeft: { x: px - f * (16 + lead * 4), y: py - 44 + drive * 2 },
        coatTailRight: { x: px + f * (10 + drive * 4), y: py - 44 },
      };
    }

    if (this.state === 'HURT' || this.state === 'KNOCKBACK') {
      // Fluid hit reaction: a fast eased IMPACT in (0.08s), an arcing torso
      // bend that peaks just after the hit, then an eased settle back toward
      // guard. A knockback holds the blown-back shape until it lands.
      const impact = smoothstep(clamp(this.stateTimer / 0.08, 0, 1));
      const settle =
        this.state === 'KNOCKBACK'
          ? 0
          : smoothstep(clamp((this.stateTimer - 0.06) / 0.14, 0, 1));
      const k = impact * (1 - settle);
      const bend = k * (1 + 0.25 * Math.sin(clamp(this.stateTimer / 0.2, 0, 1) * Math.PI));
      return {
        head: { x: px - f * 24 * bend, y: py - 98 + k * 4 },
        neck: { x: px - f * 15 * bend, y: py - 86 },
        torso: { x: px - f * 9 * bend, y: py - 68 },
        hips: { x: px - f * 3 * k, y: py - 48 },
        leftShoulder: { x: px - f * 19 * bend, y: py - 84 },
        leftElbow: { x: px - f * 27 * bend, y: py - 70 - k * 4 },
        leftHand: { x: px - f * 25 * bend, y: py - 56 - k * 8 },
        rightShoulder: { x: px - f * 8 * bend, y: py - 84 },
        rightElbow: { x: px - f * 4 * bend, y: py - 70 },
        rightHand: { x: px + f * 5 * bend, y: py - 56 - k * 6 },
        // Weight rocks back, the front knee buckles under the impact
        leftHip: { x: px - 10 - f * 3 * k, y: py - 48 },
        leftKnee: { x: px - f * (16 + k * 4), y: py - 25 },
        leftFoot: { x: px - f * (18 + k * 5), y: py },
        rightHip: { x: px + 10, y: py - 48 },
        rightKnee: { x: px + f * (16 + k * 5), y: py - 25 - k * 5 },
        rightFoot: { x: px + f * (22 + k * 6), y: py - k * 5 },
        tieBase: { x: px - f * 15 * bend, y: py - 84 },
        tieMid: { x: px - f * (7 * bend + k * 6), y: py - 70 },
        tieTip: { x: px - f * (5 * bend + k * 12), y: py - 58 },
        coatTailLeft: { x: px - f * (14 + k * 8), y: py - 42 },
        coatTailRight: { x: px + f * (14 - k * 6), y: py - 42 },
      };
    }


    if (this.state === 'DODGE') {
      // Full tucked roll — the rig rotates 360° around its own centre so the
      // body actually tumbles instead of sliding backward in a crouch.
      const progress = Math.min(1, this.stateTimer / DODGE_DURATION);
      const angle = progress * Math.PI * 2 * (this.facingRight ? -1 : 1);
      const cx = 0;
      const cy = -30;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const rot = (x: number, y: number) => ({
        x: cx + (x - cx) * ca - (y - cy) * sa,
        y: cy + (x - cx) * sa + (y - cy) * ca,
      });

      const tucked: StickFigurePose = {
        head: { x: -f * 16, y: -44 },
        neck: { x: -f * 8, y: -36 },
        torso: { x: f * 4, y: -28 },
        hips: { x: f * 12, y: -24 },
        leftShoulder: { x: -f * 2, y: -34 },
        leftElbow: { x: f * 8, y: -38 },
        leftHand: { x: f * 16, y: -32 },
        rightShoulder: { x: f * 6, y: -30 },
        rightElbow: { x: f * 16, y: -34 },
        rightHand: { x: f * 22, y: -26 },
        leftHip: { x: f * 10, y: -24 },
        leftKnee: { x: f * 2, y: -40 },
        leftFoot: { x: -f * 8, y: -44 },
        rightHip: { x: f * 14, y: -20 },
        rightKnee: { x: f * 8, y: -36 },
        rightFoot: { x: -f * 2, y: -40 },
        tieBase: { x: -f * 4, y: -34 },
        tieMid: { x: -f * 12, y: -30 },
        tieTip: { x: -f * 20, y: -28 },
        coatTailLeft: { x: f * 18, y: -34 },
        coatTailRight: { x: f * 20, y: -22 },
      };

      const rolled = {} as StickFigurePose;
      for (const key of Object.keys(tucked) as (keyof StickFigurePose)[]) {
        rolled[key] = rot(tucked[key].x, tucked[key].y);
      }
      return rolled;
    }

    if (this.state === 'APPROACH') {
      // Walk / run cycle, phased by distance travelled rather than by time
      const walkCycle = this.gaitPhase;
      const legSin = Math.sin(walkCycle);
      const bob = Math.abs(Math.sin(walkCycle * 2)) * 3;
      // Lean INTO the direction of travel (not just the facing) so a strafing
      // reposition reads as commitment rather than sliding on rails.
      const lean = clamp(this.velocity.x * 0.02, -7, 7);

      return {
        head: { x: px + f * 6 + lean * 0.7, y: py - 98 + bob },
        neck: { x: px + f * 4 + lean * 0.5, y: py - 86 + bob },
        torso: { x: px + f * 2 + lean * 0.4, y: py - 70 + bob },
        hips: { x: px + lean * 0.2, y: py - 50 + bob },
        leftShoulder: { x: px - f * 6, y: py - 84 + bob },
        leftElbow: { x: px - f * 14 + f * legSin * 8, y: py - 70 + bob },
        leftHand: { x: px - f * 6 + f * legSin * 14, y: py - 60 + bob },
        rightShoulder: { x: px + f * 6, y: py - 84 + bob },
        rightElbow: { x: px + f * 14 - f * legSin * 8, y: py - 70 + bob },
        rightHand: { x: px + f * 18 - f * legSin * 14, y: py - 60 + bob },
        leftHip: { x: px - 8, y: py - 50 + bob },
        leftKnee: { x: px - 8 - legSin * 16, y: py - 26 + bob },
        leftFoot: { x: px - 8 - legSin * 26, y: py },
        rightHip: { x: px + 8, y: py - 50 + bob },
        rightKnee: { x: px + 8 + legSin * 16, y: py - 26 + bob },
        rightFoot: { x: px + 8 + legSin * 26, y: py },
        tieBase: { x: px + f * 4, y: py - 84 + bob },
        tieMid: { x: px + f * 2, y: py - 72 + bob },
        tieTip: { x: px, y: py - 60 + bob },
        coatTailLeft: { x: px - 12 - f * legSin * 4, y: py - 44 },
        coatTailRight: { x: px + 12 + f * legSin * 4, y: py - 44 },
      };
    }

    if (this.state === 'RECOVERY') {
      // Pulled out of the strike: back = 1 is the exact pose the ATTACK ends
      // on (fist still at the ribs, hips still loaded), so the exit is a
      // continuous retraction — then the whole frame eases to a neutral guard.
      // The punish window made visible.
      const settle = smoothstep(clamp(this.stateTimer / (this.type === 'RUSHER' ? 0.18 : 0.30), 0, 1));
      const back = 1 - settle;
      return {
        head: { x: px + f * (2 - back * 13), y: py - 96 },
        neck: { x: px + f * (1 - back * 9), y: py - 86 },
        torso: { x: px - f * back * 7, y: py - 69 },
        hips: { x: px - f * back * 3, y: py - 49 },
        // Striking arm retracts from the coil back up into the guard
        leftShoulder: { x: px - f * (8 + back * 4), y: py - 84 },
        leftElbow: { x: px + f * (6 + back * 3), y: py - 74 },
        leftHand: { x: px + f * (16 + back * 10), y: py - 80 },
        rightShoulder: { x: px + f * 4, y: py - 84 },
        rightElbow: { x: px + f * (14 - back * 46), y: py - 72 - back * 2 },
        rightHand: { x: px + f * (24 - back * 66), y: py - 80 + back * 18 },
        // Stance re-bases: the front heel lifts back out, the rear foot re-plant
        leftHip: { x: px - 10, y: py - 49 },
        leftKnee: { x: px - f * (14 + back * 6), y: py - 25 },
        leftFoot: { x: px - f * (18 + back * 5), y: py },
        rightHip: { x: px + 10, y: py - 49 },
        rightKnee: { x: px + f * 14, y: py - 25 },
        rightFoot: { x: px + f * (18 + back * 2), y: py - back * 6 },
        tieBase: { x: px + f * (1 - back * 6), y: py - 84 },
        tieMid: { x: px - f * (3 + back * 4), y: py - 72 },
        tieTip: { x: px - f * (4 + back * 5), y: py - 60 },
        coatTailLeft: { x: px - f * (12 + back * 4), y: py - 44 },
        coatTailRight: { x: px + f * (12 - back * 2), y: py - 44 },
      };
    }

    if (this.state === 'COUNTER') {
      // Parry riposte: a fast committed counter-swing on the strike curve,
      // torso rotating hard through the blade while the stance drives in.
      const ext = strikeCurve(Math.max(0, this.stateTimer - 0.1), 0.3);
      const drive = Math.max(0, ext);
      const lead = Math.max(0, -ext);
      return {
        head: { x: px + f * (2 + ext * 8), y: py - 96 },
        neck: { x: px + f * (1 + ext * 7), y: py - 84 },
        torso: { x: px + f * (ext * 10), y: py - 68 },
        hips: { x: px + f * (drive * 7 - lead * 4), y: py - 48 },
        leftShoulder: { x: px - f * 8, y: py - 82 },
        leftElbow: { x: px - f * (12 + lead * 6), y: py - 70 },
        leftHand: { x: px - f * (14 + lead * 10), y: py - 58 },
        rightShoulder: { x: px + f * 10, y: py - 82 },
        rightElbow: { x: px + f * (2 + ext * 34), y: py - 78 + drive * 6 },
        rightHand: { x: px + f * (4 + ext * 54), y: py - 74 + drive * 10 },
        leftHip: { x: px - 12, y: py - 48 },
        leftKnee: { x: px - f * 20, y: py - 24 },
        leftFoot: { x: px - f * (24 + drive * 5), y: py },
        rightHip: { x: px + 8, y: py - 48 },
        rightKnee: { x: px + f * (18 + drive * 4), y: py - 26 },
        rightFoot: { x: px + f * (26 + drive * 8), y: py },
        tieBase: { x: px + f * 4, y: py - 82 },
        tieMid: { x: px - f * (2 - ext * 8), y: py - 70 },
        tieTip: { x: px - f * (4 - ext * 16), y: py - 58 },
        coatTailLeft: { x: px - f * (14 + lead * 6), y: py - 42 },
        coatTailRight: { x: px + f * 14, y: py - 42 },
      };
    }

    if (this.state === 'GRAPPLED') {
      // Held up by the collar: weight hangs off the grip, head bows forward,
      // arms flail lightly and the legs stop carrying the body.
      const sway = Math.sin(this.animTimer * 5) * 3;
      const hang = 6;
      return {
        head: { x: px - f * 12 + sway * 0.6, y: py - 92 + hang * 0.5 },
        neck: { x: px - f * 9 + sway * 0.4, y: py - 80 + hang * 0.5 },
        torso: { x: px - f * 7, y: py - 64 + hang * 0.4 },
        hips: { x: px - f * 3, y: py - 46 + hang * 0.3 },
        leftShoulder: { x: px - f * 14, y: py - 78 },
        leftElbow: { x: px - f * 20, y: py - 60 + sway },
        leftHand: { x: px - f * 16, y: py - 44 + sway * 1.5 },
        rightShoulder: { x: px - f * 2, y: py - 78 },
        rightElbow: { x: px + f * 4, y: py - 60 - sway },
        rightHand: { x: px + f * 10, y: py - 44 - sway * 1.5 },
        leftHip: { x: px - 9, y: py - 46 },
        leftKnee: { x: px - 14, y: py - 24 },
        leftFoot: { x: px - 16, y: py },
        rightHip: { x: px + 7, y: py - 46 },
        rightKnee: { x: px + 14 + sway * 0.5, y: py - 22 },
        rightFoot: { x: px + 18 + sway, y: py - 4 },
        tieBase: { x: px - f * 8, y: py - 78 },
        tieMid: { x: px - f * 10, y: py - 66 },
        tieTip: { x: px - f * 12, y: py - 54 },
        coatTailLeft: { x: px - 13, y: py - 40 },
        coatTailRight: { x: px + 11, y: py - 40 },
      };
    }

    // Default: Brawler Idle Stance — breathing plus a slow weight shift so
    // the guard never reads as a frozen statue.
    const breath = Math.sin(this.animTimer * 3.5) * 2;
    const shift = Math.sin(this.animTimer * 0.85) * 3;
    const guard = Math.sin(this.animTimer * 2.1) * 1.5;
    return {
      head: { x: px + f * 2 + shift * 0.4, y: py - 96 + breath },
      neck: { x: px + f * 1 + shift * 0.3, y: py - 84 + breath },
      torso: { x: px + shift * 0.2, y: py - 68 + breath * 0.8 },
      hips: { x: px + shift * 0.6, y: py - 48 },
      leftShoulder: { x: px - f * 8, y: py - 82 + breath },
      leftElbow: { x: px + f * 6, y: py - 72 + breath + guard },
      leftHand: { x: px + f * 16, y: py - 80 + breath + guard * 1.5 },
      rightShoulder: { x: px + f * 4, y: py - 82 + breath },
      rightElbow: { x: px + f * 14, y: py - 70 + breath - guard },
      rightHand: { x: px + f * 24, y: py - 78 + breath - guard * 1.5 },
      leftHip: { x: px - 8 + shift * 0.6, y: py - 48 },
      leftKnee: { x: px - 14 + shift * 0.3, y: py - 25 },
      leftFoot: { x: px - 18, y: py },
      rightHip: { x: px + 8 + shift * 0.6, y: py - 48 },
      rightKnee: { x: px + 14 + shift * 0.3, y: py - 25 },
      rightFoot: { x: px + 18, y: py },
      tieBase: { x: px + f * 1, y: py - 82 + breath },
      tieMid: { x: px, y: py - 70 + breath },
      tieTip: { x: px - f * 1, y: py - 58 + breath },
      coatTailLeft: { x: px - 12, y: py - 42 },
      coatTailRight: { x: px + 12, y: py - 42 },
    };
  }

  private createDefaultPose(): StickFigurePose {
    return {
      head: { x: 0, y: -96 },
      neck: { x: 0, y: -84 },
      torso: { x: 0, y: -68 },
      hips: { x: 0, y: -48 },
      leftShoulder: { x: -8, y: -82 },
      leftElbow: { x: 6, y: -72 },
      leftHand: { x: 16, y: -80 },
      rightShoulder: { x: 4, y: -82 },
      rightElbow: { x: 14, y: -70 },
      rightHand: { x: 24, y: -78 },
      leftHip: { x: -8, y: -48 },
      leftKnee: { x: -14, y: -25 },
      leftFoot: { x: -18, y: 0 },
      rightHip: { x: 8, y: -48 },
      rightKnee: { x: 14, y: -25 },
      rightFoot: { x: 18, y: 0 },
      tieBase: { x: 0, y: -82 },
      tieMid: { x: 0, y: -70 },
      tieTip: { x: 0, y: -58 },
      coatTailLeft: { x: -12, y: -42 },
      coatTailRight: { x: 12, y: -42 },
    };
  }
}
