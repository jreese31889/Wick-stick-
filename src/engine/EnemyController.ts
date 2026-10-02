import { Vector2, StickFigurePose, EnemyActionState, EnemyType, Hitbox } from '../types/game';
import { clamp, lerp } from './MathUtils';
import { SoundFX } from './SoundFX';

export type AttackPattern = 'JAB' | 'HEAVY_HOOK' | 'SWEEP';

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
  public aiTimer: number = 0;
  public attackCooldown: number = 1.0;
  public blockCooldown: number = 0;
  public attackPattern: AttackPattern = 'JAB';

  // Combat Hitbox & Collision
  public activeHitbox: Hitbox | null = null;
  public hasHitPlayerThisAttack: boolean = false;
  public wallImpact: boolean = false;
  public hasDroppedLoot: boolean = false;

  // AI Coordination
  public targetOffset: number = 75; // Preferred distance offset from player (-75 for left, +75 for right)
  public moveSpeed: number = 140;
  public hasAttackToken: boolean = true;

  // Procedural Animation
  public pose: StickFigurePose;
  private animTimer: number = 0;

  // Visual Customization by Archetype
  public suitColor: string = '#1f242d'; // Dark slate charcoal
  public shirtColor: string = '#8a1c1c'; // Crimson dress shirt
  public tieColor: string = '#0d0f12'; // Black tie
  public skinColor: string = '#e2e8f0';

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
        this.suitColor = '#2b313d'; // Charcoal grey
        this.shirtColor = '#e2e8f0'; // White shirt
        this.tieColor = '#eab308'; // Gold accent tie
        break;

      case 'HEAVY':
        this.maxHealth = 160;
        this.health = 160;
        this.moveSpeed = 95;
        this.maxStagger = 70;
        this.suitColor = '#151922'; // Heavy midnight navy
        this.shirtColor = '#4a154b'; // Deep violet
        this.tieColor = '#dc2626'; // Crimson tie
        break;

      case 'DEFENDER':
        this.maxHealth = 140;
        this.health = 140;
        this.moveSpeed = 115;
        this.maxStagger = 80;
        this.suitColor = '#1e293b'; // Slate ballistic armor weave
        this.shirtColor = '#1d4ed8'; // Tactical cobalt
        this.tieColor = '#f59e0b'; // Gold shield emblem
        break;

      case 'ELITE':
        this.maxHealth = 115;
        this.health = 115;
        this.moveSpeed = 230;
        this.maxStagger = 40;
        this.suitColor = '#09090b'; // High Table Shinobi Obsidian
        this.shirtColor = '#e11d48'; // Rose blood silk
        this.tieColor = '#f8fafc'; // Silver razor
        break;

      case 'BOSS':
        this.maxHealth = 360;
        this.health = 360;
        this.moveSpeed = 210;
        this.maxStagger = 110;
        this.suitColor = '#0d0f14'; // Obsidian High Table trench coat
        this.shirtColor = '#b45309'; // Burnished Gold silk
        this.tieColor = '#ef4444'; // Crimson blood tie
        break;

      case 'MARQUIS':
        this.maxHealth = 480;
        this.health = 480;
        this.moveSpeed = 240;
        this.maxStagger = 135;
        this.suitColor = '#1e1138'; // Imperial Marquis Amethyst Velvet
        this.shirtColor = '#d97706'; // Burnished Sovereign Gold
        this.tieColor = '#ffffff'; // French lace jabot cravat
        break;

      case 'BASIC':
      default:
        this.maxHealth = 100;
        this.health = 100;
        this.moveSpeed = 140;
        this.maxStagger = 50;
        this.suitColor = '#1f242d';
        this.shirtColor = '#8a1c1c';
        this.tieColor = '#0d0f12';
        break;
    }
    this.ghostHealth = this.maxHealth;
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
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.blockCooldown > 0) this.blockCooldown -= dt;

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
    this.updateAI(dt, playerPos, playerState, playerGrounded, distToPlayer, absDistToPlayer);

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
    this.aiTimer += dt;

    switch (this.state) {
      case 'IDLE':
      case 'APPROACH': {
        // Compute tactical target position based on assigned flanking offset
        const targetX = playerPos.x + this.targetOffset;
        const diffToTarget = targetX - this.position.x;
        const absDiffToTarget = Math.abs(diffToTarget);

        // Defensive Reaction: If player is striking right in front of us, chance to BLOCK!
        const isPlayerAttacking =
          playerState.startsWith('ATTACK_') || playerState === 'SLIDE';
        const blockChance =
          this.type === 'MARQUIS' ? 0.72 :
          this.type === 'DEFENDER' ? 0.65 :
          this.type === 'HEAVY' ? 0.2 :
          this.type === 'ELITE' ? 0.45 : 0.4;

        if (
          isPlayerAttacking &&
          absDistToPlayer < 90 &&
          this.blockCooldown <= 0 &&
          this.health > 0 &&
          Math.random() < blockChance
        ) {
          this.state = 'BLOCK';
          this.stateTimer = 0;
          this.blockCooldown = this.type === 'MARQUIS' ? 0.8 : this.type === 'DEFENDER' ? 1.2 : 1.8;
          this.velocity.x = 0;
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
          this.state = 'IDLE';
          this.stateTimer = 0;
        }
        break;
      }

      case 'WINDUP': {
        this.velocity.x *= 0.8;
        const telegraphTime =
          this.attackPattern === 'HEAVY_HOOK' ? 0.36 : this.attackPattern === 'SWEEP' ? 0.25 : 0.22;

        if (this.stateTimer >= telegraphTime) {
          this.state = 'ATTACK';
          this.stateTimer = 0;
          this.hasHitPlayerThisAttack = false;

          const f = this.facingRight ? 1 : -1;

          if (this.attackPattern === 'HEAVY_HOOK') {
            // Heavy lunging punch
            this.velocity.x = f * 220;
            SoundFX.playWhoosh(0.75);
            this.activeHitbox = {
              x: this.position.x + f * 45,
              y: this.position.y - 70,
              radius: 32,
              damage: 24,
              knockbackX: f * 340,
              knockbackY: -180,
              hitStopFrames: 8,
              soundType: 'heavy',
            };
          } else if (this.attackPattern === 'SWEEP') {
            // Low sweep kick
            this.velocity.x = f * 180;
            SoundFX.playWhoosh(1.1);
            this.activeHitbox = {
              x: this.position.x + f * 40,
              y: this.position.y - 20,
              radius: 28,
              damage: 12,
              knockbackX: f * 200,
              knockbackY: -160,
              hitStopFrames: 5,
              soundType: 'kick',
            };
          } else {
            // Fast lead jab
            this.velocity.x = f * 150;
            SoundFX.playWhoosh(0.9);
            this.activeHitbox = {
              x: this.position.x + f * 42,
              y: this.position.y - 70,
              radius: 26,
              damage: 14,
              knockbackX: f * 220,
              knockbackY: -120,
              hitStopFrames: 5,
              soundType: 'punch',
            };
          }
        }
        break;
      }

      case 'ATTACK': {
        this.velocity.x *= 0.88;
        if (this.stateTimer >= 0.16) {
          this.activeHitbox = null;
        }
        const activeDuration = this.attackPattern === 'HEAVY_HOOK' ? 0.38 : 0.30;
        if (this.stateTimer >= activeDuration) {
          this.state = 'RECOVERY';
          this.stateTimer = 0;
          this.activeHitbox = null;
        }
        break;
      }

      case 'RECOVERY': {
        this.velocity.x *= 0.85;
        const recoveryDuration = this.type === 'RUSHER' ? 0.18 : 0.30;
        if (this.stateTimer >= recoveryDuration) {
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

  public takeDamage(
    damage: number,
    knockbackX: number,
    knockbackY: number,
    isHeavy: boolean = false
  ) {
    this.health = Math.max(0, this.health - damage);
    this.hpVisibleTimer = 3.2; // Show health bar only upon taking damage
    this.lastHitTime = performance.now();
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
      return;
    }

    // Transition to Knockback (Heavy hits / Launchers / Lethal) or Hurt
    if (isHeavy || Math.abs(knockbackX) > 260 || knockbackY < -140 || this.health <= 0) {
      this.state = 'KNOCKBACK';
      this.stateTimer = 0;
    } else {
      this.state = 'HURT';
      this.stateTimer = 0;
    }
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

  private updatePose(_dt: number) {
    const f = this.facingRight ? 1 : -1;
    const px = this.position.x;
    const py = this.position.y;

    if (this.state === 'DOWNED') {
      // Flat on ground
      this.pose = {
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
      return;
    }

    if (this.state === 'GETUP') {
      // Rising from ground onto one knee
      const progress = Math.min(1, this.stateTimer / 0.45);
      const riseY = py - progress * 40;
      this.pose = {
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
      return;
    }

    if (this.state === 'BLOCK') {
      // Guarded Boxing Defense (forearms crossed in front of face)
      this.pose = {
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
      return;
    }

    if (this.state === 'STAGGER') {
      // Groggily wobbling
      const sway = Math.sin(this.animTimer * 9) * 7;
      this.pose = {
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
      return;
    }

    if (this.state === 'WINDUP') {
      // Pull back right fist ready to deliver heavy punch
      this.pose = {
        head: { x: px - f * 8, y: py - 98 },
        neck: { x: px - f * 5, y: py - 86 },
        torso: { x: px - f * 2, y: py - 70 },
        hips: { x: px, y: py - 50 },
        leftShoulder: { x: px - f * 12, y: py - 84 },
        leftElbow: { x: px + f * 6, y: py - 74 },
        leftHand: { x: px + f * 18, y: py - 80 },
        rightShoulder: { x: px + f * 4, y: py - 84 },
        rightElbow: { x: px - f * 20, y: py - 78 },
        rightHand: { x: px - f * 24, y: py - 68 },
        leftHip: { x: px - 10, y: py - 50 },
        leftKnee: { x: px - 16, y: py - 25 },
        leftFoot: { x: px - 18, y: py },
        rightHip: { x: px + 10, y: py - 50 },
        rightKnee: { x: px + 16, y: py - 25 },
        rightFoot: { x: px + 22, y: py },
        tieBase: { x: px - f * 5, y: py - 84 },
        tieMid: { x: px - f * 4, y: py - 72 },
        tieTip: { x: px - f * 3, y: py - 60 },
        coatTailLeft: { x: px - 12, y: py - 44 },
        coatTailRight: { x: px + 12, y: py - 44 },
      };
      return;
    }

    if (this.state === 'ATTACK') {
      if (this.attackPattern === 'SWEEP') {
        // Low sweep kick pose
        this.pose = {
          head: { x: px - f * 6, y: py - 65 },
          neck: { x: px - f * 4, y: py - 55 },
          torso: { x: px - f * 2, y: py - 42 },
          hips: { x: px, y: py - 28 },
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
          rightKnee: { x: px + f * 26, y: py - 16 },
          rightFoot: { x: px + f * 52, y: py - 6 },
          tieBase: { x: px - f * 4, y: py - 55 },
          tieMid: { x: px - f * 2, y: py - 45 },
          tieTip: { x: px, y: py - 35 },
          coatTailLeft: { x: px - 10, y: py - 22 },
          coatTailRight: { x: px + 10, y: py - 22 },
        };
        return;
      }

      // Extended straight punch or heavy hook
      this.pose = {
        head: { x: px + f * 12, y: py - 96 },
        neck: { x: px + f * 8, y: py - 84 },
        torso: { x: px + f * 4, y: py - 68 },
        hips: { x: px, y: py - 48 },
        leftShoulder: { x: px - f * 6, y: py - 82 },
        leftElbow: { x: px - f * 4, y: py - 68 },
        leftHand: { x: px + f * 4, y: py - 74 },
        rightShoulder: { x: px + f * 10, y: py - 82 },
        rightElbow: { x: px + f * 30, y: py - 76 },
        rightHand: { x: px + f * 48, y: py - 72 },
        leftHip: { x: px - 12, y: py - 48 },
        leftKnee: { x: px - 20, y: py - 24 },
        leftFoot: { x: px - 24, y: py },
        rightHip: { x: px + 8, y: py - 48 },
        rightKnee: { x: px + 20, y: py - 26 },
        rightFoot: { x: px + 28, y: py },
        tieBase: { x: px + f * 8, y: py - 82 },
        tieMid: { x: px + f * 2, y: py - 70 },
        tieTip: { x: px - f * 4, y: py - 58 },
        coatTailLeft: { x: px - 14, y: py - 42 },
        coatTailRight: { x: px + 14, y: py - 42 },
      };
      return;
    }

    if (this.state === 'HURT' || this.state === 'KNOCKBACK') {
      // Flinched backwards with head snapping back
      const snap = Math.min(1, this.stateTimer * 4);
      this.pose = {
        head: { x: px - f * 22 * snap, y: py - 98 + snap * 4 },
        neck: { x: px - f * 14 * snap, y: py - 86 },
        torso: { x: px - f * 8 * snap, y: py - 68 },
        hips: { x: px, y: py - 48 },
        leftShoulder: { x: px - f * 18 * snap, y: py - 84 },
        leftElbow: { x: px - f * 26 * snap, y: py - 70 },
        leftHand: { x: px - f * 24 * snap, y: py - 56 },
        rightShoulder: { x: px - f * 8 * snap, y: py - 84 },
        rightElbow: { x: px - f * 4 * snap, y: py - 70 },
        rightHand: { x: px + f * 4 * snap, y: py - 56 },
        leftHip: { x: px - 10, y: py - 48 },
        leftKnee: { x: px - 16, y: py - 25 },
        leftFoot: { x: px - 18, y: py },
        rightHip: { x: px + 10, y: py - 48 },
        rightKnee: { x: px + 16, y: py - 25 },
        rightFoot: { x: px + 22, y: py },
        tieBase: { x: px - f * 14 * snap, y: py - 84 },
        tieMid: { x: px - f * 6 * snap, y: py - 70 },
        tieTip: { x: px + f * 4 * snap, y: py - 56 },
        coatTailLeft: { x: px - 14, y: py - 42 },
        coatTailRight: { x: px + 14, y: py - 42 },
      };
      return;
    }

    if (this.state === 'APPROACH') {
      // Walk / run cycle
      const walkCycle = this.animTimer * 10;
      const legSin = Math.sin(walkCycle);
      const bob = Math.abs(Math.sin(walkCycle * 2)) * 3;

      this.pose = {
        head: { x: px + f * 6, y: py - 98 + bob },
        neck: { x: px + f * 4, y: py - 86 + bob },
        torso: { x: px + f * 2, y: py - 70 + bob },
        hips: { x: px, y: py - 50 + bob },
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
      return;
    }

    // Default: Brawler Idle Stance
    const breath = Math.sin(this.animTimer * 3.5) * 2;
    this.pose = {
      head: { x: px + f * 2, y: py - 96 + breath },
      neck: { x: px + f * 1, y: py - 84 + breath },
      torso: { x: px, y: py - 68 + breath * 0.8 },
      hips: { x: px, y: py - 48 },
      leftShoulder: { x: px - f * 8, y: py - 82 + breath },
      leftElbow: { x: px + f * 6, y: py - 72 + breath },
      leftHand: { x: px + f * 16, y: py - 80 + breath },
      rightShoulder: { x: px + f * 4, y: py - 82 + breath },
      rightElbow: { x: px + f * 14, y: py - 70 + breath },
      rightHand: { x: px + f * 24, y: py - 78 + breath },
      leftHip: { x: px - 8, y: py - 48 },
      leftKnee: { x: px - 14, y: py - 25 },
      leftFoot: { x: px - 18, y: py },
      rightHip: { x: px + 8, y: py - 48 },
      rightKnee: { x: px + 14, y: py - 25 },
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
