import { PlayerController } from './PlayerController';
import { EnemyController } from './EnemyController';
import { Camera } from './Camera';
import { SoundFX } from './SoundFX';
import { DamagePopup, ImpactSpark, ShockwaveRing, BulletTracer, CasingParticle, BloodDecal, BladeSlashArc } from '../types/game';
import { EnvironmentManager } from './EnvironmentManager';

export interface CombatStats {
  comboCount: number;
  comboTimer: number;
  maxCombo: number;
  totalDamageDealt: number;
  parryCount: number;
  takedownCount: number;
  styleRating: string;
}

export class CombatDirector {
  public popups: DamagePopup[] = [];
  public sparks: ImpactSpark[] = [];
  public shockwaves: ShockwaveRing[] = [];
  public tracers: BulletTracer[] = [];
  public casings: CasingParticle[] = [];
  public bloodDecals: BloodDecal[] = [];
  public bladeArcs: BladeSlashArc[] = [];
  
  public hitStopFrames: number = 0;
  public slowMoFactor: number = 1.0;
  public slowMoTimer: number = 0;

  public stats: CombatStats = {
    comboCount: 0,
    comboTimer: 0,
    maxCombo: 0,
    totalDamageDealt: 0,
    parryCount: 0,
    takedownCount: 0,
    styleRating: 'NOIR'
  };

  private popupIdCounter = 0;
  private tracerIdCounter = 0;
  private playerAttackRegistered = false;
  private lastPlayerState = '';

  // Grapple sequence state
  public isGrappling: boolean = false;
  public grappleTimer: number = 0;
  public grappledEnemy: EnemyController | null = null;

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

    // 2. Hit-stop frame countdown
    if (this.hitStopFrames > 0) {
      this.hitStopFrames--;
      return; // Skip combat logic during freeze frames
    }

    // 3. Combo timer decay
    if (this.stats.comboTimer > 0) {
      this.stats.comboTimer -= dt;
      if (this.stats.comboTimer <= 0) {
        this.stats.comboCount = 0;
        this.updateStyleRating();
      }
    }

    // 4. Update visual FX particles
    this.updateParticles(dt);

    // 5. Handle active Grapple / Takedown
    if (this.isGrappling && this.grappledEnemy) {
      this.updateGrapple(dt, player, this.grappledEnemy, camera);
      return;
    }

    // 6. Reset attack register on player state change
    if (player.physics.state !== this.lastPlayerState) {
      this.playerAttackRegistered = false;
      this.lastPlayerState = player.physics.state;
    }

    // Handle Knife Throw
    if (player.hasThrownKnifeThisFrame && environmentManager) {
      const dir = player.physics.facingRight ? 1 : -1;
      environmentManager.throwKnife(player.physics.position.x, player.physics.position.y, dir);
    }

    // Check Projectiles hitting enemies
    if (environmentManager) {
      environmentManager.checkProjectilesAgainstEnemies(enemies, (enemy, damage, px, py) => {
        const dir = player.physics.facingRight ? 1 : -1;
        enemy.takeDamage(damage, dir * 340, -140, false);
        this.hitStopFrames = 7;
        camera.addTrauma(0.35);
        SoundFX.playPunch('heavy');
        this.spawnShockwave(px, py, 45, '#fef08a');
        this.spawnSparks(px, py, dir, 14, '#ffffff');
        this.addPopup(px, py - 25, `KNIFE IMPALE -${damage}!`, '#fef08a', 20);
        this.stats.comboCount++;
        this.stats.comboTimer = 3.2;
        this.updateStyleRating();
      });
    }

    // Check Wall Bounce / Splat for any knocked enemies
    for (const enemy of enemies) {
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
        const coinCount = enemy.type === 'BOSS' ? 6 : enemy.type === 'HEAVY' ? 3 : 1;
        for (let c = 0; c < coinCount; c++) {
          environmentManager.dropCoin(enemy.position.x + (c - (coinCount - 1) / 2) * 16, enemy.position.y - 35, 1);
        }
        if (enemy.type === 'BOSS' || (enemy.type === 'HEAVY' && Math.random() > 0.4)) {
          environmentManager.dropWeapon(enemy.type === 'BOSS' ? 'KATANA' : 'KNIFE', enemy.position.x, enemy.position.y - 40);
        }
      }
    }

    // 7. Check Player Attacks hitting Enemies & Destructibles
    this.checkPlayerAttacks(player, enemies, camera, environmentManager);

    // 8. Check Player Tactical Gunfire (Gun-Fu)
    this.checkPlayerGunfire(player, enemies, camera);

    // 9. Check Enemy Attacks hitting Player
    this.checkEnemyAttacks(player, enemies, camera);

    // 10. Check Player Grab / Takedown trigger
    this.checkPlayerGrab(player, enemies, camera);
  }

  private checkPlayerGunfire(
    player: PlayerController,
    enemies: EnemyController[],
    camera: Camera
  ) {
    if (!player.hasFiredBulletThisShot) return;
    player.hasFiredBulletThisShot = false;

    const facingRight = player.physics.facingRight;
    const dir = facingRight ? 1 : -1;
    const originX = player.physics.position.x + dir * 34;
    const originY = player.physics.position.y - 62; // Tactical pistol muzzle height

    // 1. Eject spent brass casing with realistic tumbling physics
    this.casings.push({
      x: originX - dir * 10,
      y: originY + 2,
      vx: -dir * (90 + Math.random() * 60),
      vy: -(120 + Math.random() * 80),
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 24,
      life: 1.4,
    });

    // 2. Raycast against active enemies along bullet trajectory
    let closestEnemy: EnemyController | null = null;
    let closestDist = 99999;

    for (const enemy of enemies) {
      if (enemy.health <= 0 && enemy.state === 'DOWNED') continue;
      const enemyDistX = (enemy.position.x - originX) * dir;
      // Must be in front of the gun
      if (enemyDistX > 0 && enemyDistX < closestDist) {
        // Vertical hit check (head to feet)
        const enemyTopY = enemy.position.y - 110;
        const enemyBottomY = enemy.position.y + 10;
        if (originY >= enemyTopY && originY <= enemyBottomY) {
          closestDist = enemyDistX;
          closestEnemy = enemy;
        }
      }
    }

    if (closestEnemy) {
      const impactX = closestEnemy.position.x - dir * 14;
      const impactY = originY;

      // Create glowing supersonic bullet tracer to impact point
      this.tracers.push({
        id: ++this.tracerIdCounter,
        x1: originX,
        y1: originY,
        x2: impactX,
        y2: impactY,
        life: 0.12,
        maxLife: 0.12,
        color: '#fef08a',
        width: 3.5,
      });

      // Close-Quarters Gun-Fu Double Tap execution check (< 95px)
      const isPointBlank = closestDist < 95;

      if (closestEnemy.state === 'BLOCK' && !isPointBlank) {
        // Guarded by enemy
        closestEnemy.takeDamage(10, dir * 160, -60, false);
        this.hitStopFrames = 4;
        camera.addTrauma(0.18);
        SoundFX.playPunch('light');
        this.spawnSparks(impactX, impactY, -dir, 8, '#94a3b8');
        this.addPopup(impactX, impactY - 20, 'BLOCKED', '#94a3b8', 14);
      } else if (isPointBlank) {
        // == POINT-BLANK GUN-FU EXECUTION ==
        const damage = 42;
        closestEnemy.takeDamage(damage, dir * 520, -220, true);
        closestEnemy.state = 'KNOCKBACK';
        this.hitStopFrames = 10;
        this.slowMoFactor = 0.28;
        this.slowMoTimer = 0.38;
        camera.addTrauma(0.55);
        SoundFX.playPunch('heavy');
        this.spawnShockwave(impactX, impactY, 55, '#f59e0b');
        this.spawnSparks(impactX, impactY, dir, 18, '#fbbf24');
        this.spawnBlood(impactX, impactY, dir, 12); // Godot blood particle spray
        this.addPopup(impactX, impactY - 30, 'GUN-FU CRIT!', '#f59e0b', 22);

        this.stats.comboCount += 2;
        this.stats.comboTimer = 3.5;
        this.stats.takedownCount++;
        this.updateStyleRating();
      } else {
        // Standard bullet impact
        const damage = 28;
        closestEnemy.takeDamage(damage, dir * 340, -140, false);
        this.hitStopFrames = 6;
        camera.addTrauma(0.28);
        SoundFX.playPunch('heavy');
        this.spawnShockwave(impactX, impactY, 32, '#fbbf24');
        this.spawnSparks(impactX, impactY, dir, 12, '#fbbf24');
        this.spawnBlood(impactX, impactY, dir, 6);
        this.addPopup(impactX, impactY - 20, `-${damage}`, '#fde047', 17);

        this.stats.comboCount++;
        this.stats.comboTimer = 3.0;
        this.updateStyleRating();
      }
    } else {
      // No enemy hit: bullet travels to arena boundary wall and creates sparks
      const arenaBound = 840;
      const endX = dir > 0 ? arenaBound : -arenaBound;
      this.tracers.push({
        id: ++this.tracerIdCounter,
        x1: originX,
        y1: originY,
        x2: endX,
        y2: originY,
        life: 0.10,
        maxLife: 0.10,
        color: '#fef08a',
        width: 3,
      });

      // Wall ricochet sparks
      this.spawnSparks(endX, originY, -dir, 10, '#fef08a');
      camera.addTrauma(0.12);
    }
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
      player.physics.isSliding;

    if (!isAttacking || this.playerAttackRegistered) return;

    // Active attack strike windows (normalized timing)
    let attackWindowStart = 0.08;
    let attackWindowEnd = 0.28;
    let damage = 14;
    let knockbackX = player.physics.facingRight ? 180 : -180;
    let knockbackY = -80;
    let hitStop = 5;
    let soundType: 'light' | 'heavy' | 'kick' = 'light';
    let isHeavy = false;

    if (pState === 'ATTACK_LIGHT_1') {
      damage = 14;
      hitStop = 4;
      soundType = 'light';
    } else if (pState === 'ATTACK_LIGHT_2') {
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
    } else if (pState === 'ATTACK_HEAVY') {
      damage = 38;
      knockbackX = player.physics.facingRight ? 450 : -450;
      knockbackY = -220;
      hitStop = 11;
      soundType = 'heavy';
      isHeavy = true;
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

    // Check collision against all alive enemies
    const f = player.physics.facingRight ? 1 : -1;
    const strikeX = player.physics.position.x + f * (42 + strikeBonus);
    const strikeY = player.physics.isSliding
      ? player.physics.position.y - 18
      : player.physics.position.y - 68;
    const strikeRadius = (player.physics.isSliding ? 34 : 36) + strikeBonus;

    // Check hit against destructible environmental objects
    if (environmentManager) {
      const shattered = environmentManager.checkHitboxAgainstDestructibles({
        x: strikeX,
        y: strikeY,
        radius: strikeRadius + 15,
        damage,
        knockbackX,
        knockbackY,
        hitStopFrames: hitStop,
        soundType: 'heavy'
      });
      if (shattered) {
        this.playerAttackRegistered = true;
        this.hitStopFrames = 4;
        camera.addTrauma(0.22);
      }
    }

    for (const enemy of enemies) {
      if (enemy.state === 'DOWNED' && !player.physics.isSliding) continue;

      const ex = enemy.position.x;
      const ey = enemy.position.y - 50; // Center of enemy mass
      const dx = strikeX - ex;
      const dy = strikeY - ey;
      const dist = Math.hypot(dx, dy);

      if (dist < strikeRadius + 30) {
        // HIT CONNECTED!
        this.playerAttackRegistered = true;

        // Ensure knockback is ALWAYS directed away from player
        const dirAway = enemy.position.x >= player.physics.position.x ? 1 : -1;
        const finalKnockbackX = dirAway * Math.abs(knockbackX);
        const impactX = (strikeX + ex) / 2;
        const impactY = (strikeY + ey) / 2;

        // Check if enemy is guarding (BLOCK state)
        if (enemy.state === 'BLOCK') {
          if (pState === 'ATTACK_HEAVY') {
            // == GUARD CRUSH! Heavy attack shatters defense ==
            enemy.guardBreak();
            this.hitStopFrames = 12;
            camera.addTrauma(0.42);
            SoundFX.playPunch('heavy');
            this.spawnShockwave(impactX, impactY, 55, '#f59e0b');
            this.spawnSparks(impactX, impactY, f, 18, '#fbbf24');
            this.addPopup(impactX, impactY - 18, 'GUARD CRUSH!', '#fbbf24', 19);

            this.stats.comboCount++;
            this.stats.comboTimer = 3.0;
            this.updateStyleRating();
            break;
          } else if (player.physics.isSliding) {
            // == SLIDE SWEEP! Trips under blocking enemy ==
            enemy.takeDamage(damage, finalKnockbackX, knockbackY, false);
            enemy.state = 'KNOCKBACK';
            this.hitStopFrames = 6;
            camera.addTrauma(0.25);
            SoundFX.playPunch('kick');
            this.spawnShockwave(impactX, impactY, 35, '#38bdf8');
            this.spawnSparks(impactX, impactY, f, 10, '#38bdf8');
            this.addPopup(impactX, impactY - 15, 'TRIP!', '#38bdf8', 16);

            this.stats.comboCount++;
            this.stats.comboTimer = 2.8;
            this.updateStyleRating();
            break;
          } else {
            // == BLOCKED! Light attacks absorbed with reduced damage ==
            const chipDamage = Math.max(2, Math.round(damage * 0.2));
            enemy.health = Math.max(0, enemy.health - chipDamage);
            enemy.hpVisibleTimer = 3.2;
            enemy.lastHitTime = performance.now();
            enemy.velocity.x = finalKnockbackX * 0.2;
            player.physics.velocity.x = -f * 90; // Minor recoil on player
            this.hitStopFrames = 4;
            camera.addTrauma(0.12);
            SoundFX.playPunch('light');
            this.spawnSparks(impactX, impactY, f, 7, '#94a3b8');
            this.addPopup(impactX, impactY - 15, 'BLOCKED', '#94a3b8', 14);
            break;
          }
        }

        // Standard clean unblocked hit
        this.hitStopFrames = hitStop;
        enemy.takeDamage(damage, finalKnockbackX, knockbackY, isHeavy);

        // Sound FX
        SoundFX.playPunch(soundType);

        // Camera Shake Trauma
        camera.addTrauma(isHeavy ? 0.42 : 0.22);

        // Combo & Scoring
        this.stats.comboCount++;
        this.stats.comboTimer = 2.8;
        this.stats.totalDamageDealt += damage;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.comboCount);
        this.updateStyleRating();

        // Particles & Popups
        this.spawnSparks(impactX, impactY, f, isHeavy ? 14 : 8, isHeavy ? '#f59e0b' : '#ef4444');
        this.spawnShockwave(impactX, impactY, isHeavy ? 45 : 30, isHeavy ? '#f59e0b' : '#ffffff');
        this.spawnBlood(ex, ey, dirAway, isHeavy ? 9 : 5);
        if (player.physics.equippedWeapon === 'KATANA') {
          this.spawnBladeArc(player.physics.position.x + f * 25, player.physics.position.y - 50, f > 0 ? 0.3 : Math.PI - 0.3, 62, '#f59e0b');
        }

        this.addPopup(
          impactX,
          impactY - 10,
          isHeavy ? `CRIT ${damage}` : `${damage}`,
          isHeavy ? '#fbbf24' : '#f87171',
          isHeavy ? 20 : 15
        );

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
            this.addPopup(hb.x, hb.y - 15, 'PERFECT PARRY!', '#38bdf8', 19);
            this.spawnShockwave(hb.x, hb.y, 50, '#38bdf8');
            this.spawnSparks(hb.x, hb.y, 1, 16, '#38bdf8');
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
        this.stats.comboCount = 0; // Combo interrupted
        this.updateStyleRating();

        this.addPopup(px, py - 20, `-${hb.damage}`, '#ef4444', 18);
        this.spawnSparks(hb.x, hb.y, Math.sign(hb.knockbackX), 10, '#ef4444');
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
        enemy.state = 'GRAPPLED';
        SoundFX.playWhoosh(1.2);
        camera.addTrauma(0.15);
        break;
      }
    }
  }

  private updateGrapple(
    dt: number,
    player: PlayerController,
    enemy: EnemyController,
    camera: Camera
  ) {
    this.grappleTimer += dt;
    const f = player.physics.facingRight ? 1 : -1;
    const px = player.physics.position.x;
    const py = player.physics.position.y;

    player.physics.velocity.x = 0;
    player.physics.velocity.y = 0;

    // 0.0s to 0.25s: Lock onto enemy collar and pull them in
    if (this.grappleTimer < 0.25) {
      enemy.position.x = px + f * 25;
      enemy.position.y = py;
    }
    // 0.25s to 0.45s: Pivot and hoist enemy overhead in judo shoulder throw
    else if (this.grappleTimer < 0.45) {
      const progress = (this.grappleTimer - 0.25) / 0.2;
      const angle = progress * Math.PI; // Arc overhead
      const throwRadius = 38;
      enemy.position.x = px + f * Math.cos(angle) * throwRadius;
      enemy.position.y = py - 40 - Math.sin(angle) * 35;
    }
    // 0.45s: SLAM onto the floor!
    else if (this.grappleTimer < 0.7) {
      if (this.grappleTimer - dt < 0.45) {
        // SLAM IMPACT FRAME!
        enemy.position.x = px - f * 42;
        enemy.position.y = py;
        SoundFX.playPunch('slam');
        camera.addTrauma(0.55);
        this.hitStopFrames = 12;

        const damage = 42;
        enemy.takeDamage(damage, -f * 120, 0, true);
        enemy.state = 'DOWNED';
        enemy.stateTimer = 0;

        this.stats.takedownCount++;
        this.stats.comboCount += 2;
        this.stats.comboTimer = 3.2;
        this.stats.totalDamageDealt += damage;
        this.updateStyleRating();

        this.spawnShockwave(enemy.position.x, py - 5, 55, '#f59e0b');
        this.spawnSparks(enemy.position.x, py - 8, -f, 18, '#fbbf24');
        this.addPopup(enemy.position.x, py - 35, 'TAKEDOWN 42', '#f59e0b', 20);

        if (player.physics.perks['VAMPIRIC_TAKEDOWN']) {
          player.physics.health = Math.min(player.physics.maxHealth, player.physics.health + 25);
          this.addPopup(player.physics.position.x, py - 65, '+25 HP (VAMPIRIC)', '#10b981', 18);
        }
      }
    }
    // 0.7s: Takedown complete, resume free control
    else {
      this.isGrappling = false;
      this.grappledEnemy = null;
      this.grappleTimer = 0;
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
    this.popups.push({
      id: ++this.popupIdCounter,
      x,
      y,
      text,
      color,
      size,
      life: 0.8,
      maxLife: 0.8,
      vy: -55
    });
  }

  public spawnSparks(x: number, y: number, dir: number, count: number, color: string) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * 1.6 + (dir > 0 ? 0 : Math.PI);
      const speed = 120 + Math.random() * 220;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.6,
        color,
        size: 2 + Math.random() * 2.5
      });
    }
  }

  public spawnShockwave(x: number, y: number, maxRadius: number, color: string) {
    this.shockwaves.push({
      x,
      y,
      radius: 6,
      maxRadius,
      life: 0.28,
      maxLife: 0.28,
      color,
      lineWidth: 3
    });
  }

  public spawnBlood(x: number, y: number, dir: number, count: number = 8) {
    for (let i = 0; i < count; i++) {
      const angle = (dir > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.4;
      const speed = 100 + Math.random() * 240;
      this.bloodDecals.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (50 + Math.random() * 70),
        radius: 2.2 + Math.random() * 3.2,
        alpha: 0.95,
        life: 0,
        maxLife: 6.5,
        isStuck: false,
      });
    }
  }

  public spawnBladeArc(x: number, y: number, angle: number, radius = 55, color = '#f59e0b') {
    this.bladeArcs.push({
      id: Math.random(),
      x,
      y,
      angle,
      radius,
      arcLength: Math.PI * 0.75,
      color,
      life: 0,
      maxLife: 0.16,
    });
  }

  private updateParticles(dt: number) {
    // Popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= 0.94;
      if (p.life <= 0) this.popups.splice(i, 1);
    }

    // Sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 650 * dt; // Gravity
      s.vx *= 0.96;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }

    // Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      const progress = 1 - sw.life / sw.maxLife;
      sw.radius = 6 + progress * (sw.maxRadius - 6);
      if (sw.life <= 0) this.shockwaves.splice(i, 1);
    }

    // Bullet Tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) this.tracers.splice(i, 1);
    }

    // Blade Slash Arc Meshes
    for (let i = this.bladeArcs.length - 1; i >= 0; i--) {
      const arc = this.bladeArcs[i];
      arc.life += dt;
      if (arc.life >= arc.maxLife) this.bladeArcs.splice(i, 1);
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

      if (c.life <= 0) this.casings.splice(i, 1);
    }
  }
}
