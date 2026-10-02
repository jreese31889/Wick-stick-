import { InputManager } from './InputManager';
import { PlayerController } from './PlayerController';
import { EnemyController } from './EnemyController';
import { CombatDirector } from './CombatDirector';
import { Camera } from './Camera';
import { Renderer } from './Renderer';
import { SoundFX } from './SoundFX';
import { EnvironmentManager } from './EnvironmentManager';

export class GameLoop {
  public inputManager = new InputManager();
  public player = new PlayerController(0, 0);
  public camera = new Camera();
  public renderer = new Renderer();
  public combatDirector = new CombatDirector();
  public environmentManager = new EnvironmentManager();
  public enemies: EnemyController[] = [];
  public squadSize: number = 1;
  public waveNumber: number = 1;

  private isRunning = false;
  private animFrameId: number | null = null;
  private lastTime = 0;
  public isPaused = false;
  public debugMode = false;
  public soundMuted = false;

  // Performance telemetry
  public fps = 60;
  private frameCount = 0;
  private fpsTimer = 0;

  // Callback to sync state with React HUD
  private onStateChange?: () => void;

  constructor() {
    this.environmentManager.setupRoomForWave(1);
    this.spawnSquad(1);
  }

  public togglePause(): boolean {
    this.isPaused = !this.isPaused;
    if (!this.isPaused) {
      this.lastTime = performance.now();
    }
    if (this.onStateChange) this.onStateChange();
    return this.isPaused;
  }

  public setPaused(paused: boolean): void {
    if (this.isPaused === paused) return;
    this.isPaused = paused;
    if (!this.isPaused) {
      this.lastTime = performance.now();
    }
    if (this.onStateChange) this.onStateChange();
  }

  public spawnSquad(size: number = 1, isBoss: boolean = false) {
    this.squadSize = size;
    const px = this.player.physics.position.x;
    this.environmentManager.setupRoomForWave(this.waveNumber);

    if (isBoss || size === 4) {
      // Milestone 6: High Table Master Duel!
      this.enemies = [
        new EnemyController('boss-zero', px + 210, 0, 'BOSS', 85)
      ];
    } else if (size === 7) {
      // Milestone 8: The Marquis Grandmaster Sovereign Duel!
      this.enemies = [
        new EnemyController('marquis-de-gramont', px + 230, 0, 'MARQUIS', 95)
      ];
    } else if (size === 5) {
      // Milestone 7: Elite Infiltration (Defender with riot guard + Shadow Elite Assassin)
      this.enemies = [
        new EnemyController('defender-1', px + 175, 0, 'DEFENDER', 70),
        new EnemyController('elite-1', px - 210, 0, 'ELITE', -85)
      ];
    } else if (size === 6) {
      // Milestone 7: Apex Syndicate Gauntlet (Defender + Elite + Heavy Brute)
      this.enemies = [
        new EnemyController('defender-1', px + 165, 0, 'DEFENDER', 65),
        new EnemyController('elite-1', px - 200, 0, 'ELITE', -80),
        new EnemyController('heavy-1', px + 270, 0, 'HEAVY', 140)
      ];
    } else if (size === 1) {
      // 1v1 Martial Arts Duel
      this.enemies = [
        new EnemyController('enforcer-1', px + 180, 0, 'BASIC', 75)
      ];
    } else if (size === 2) {
      // 1v2 Flank: Enforcer in front, fast Rusher flanking behind
      this.enemies = [
        new EnemyController('enforcer-1', px + 180, 0, 'BASIC', 75),
        new EnemyController('rusher-1', px - 200, 0, 'RUSHER', -85)
      ];
    } else {
      // 1v3 Syndicate Ambush: Enforcer, Rusher, and Heavy Brute
      this.enemies = [
        new EnemyController('enforcer-1', px + 180, 0, 'BASIC', 70),
        new EnemyController('rusher-1', px - 210, 0, 'RUSHER', -80),
        new EnemyController('heavy-1', px + 260, 0, 'HEAVY', 140)
      ];
    }
    if (this.onStateChange) this.onStateChange();
  }

  public spawnBossDuel() {
    this.waveNumber = 4;
    this.spawnSquad(4, true);
  }

  public spawnEliteDuo() {
    this.waveNumber = 5;
    this.spawnSquad(5);
  }

  public spawnMarquisDuel() {
    this.waveNumber = 6;
    this.spawnSquad(7);
  }

  public nextWave() {
    this.waveNumber++;
    if (this.waveNumber === 4) {
      this.spawnSquad(4, true); // Wave 4: High Table Boss Encounter
    } else if (this.waveNumber === 5) {
      this.spawnSquad(5); // Wave 5: Milestone 7 Elite Syndicate Duo
    } else if (this.waveNumber === 6) {
      this.spawnSquad(7); // Wave 6: Milestone 8 The Marquis Sovereign Duel
    } else if (this.waveNumber >= 7) {
      const patterns = [7, 6, 4, 5];
      const pick = patterns[(this.waveNumber - 7) % patterns.length];
      this.spawnSquad(pick, pick === 4);
    } else {
      const nextSize = Math.min(3, Math.max(1, (this.waveNumber % 3) || 3));
      this.spawnSquad(nextSize);
    }
  }

  public resetFight() {
    this.player.physics.position = { x: 0, y: 0 };
    this.player.physics.velocity = { x: 0, y: 0 };
    this.player.physics.health = this.player.physics.maxHealth;
    this.player.physics.stamina = this.player.physics.maxStamina;
    this.player.physics.state = 'IDLE';
    this.player.equipWeapon('UNARMED');

    this.combatDirector.stats.comboCount = 0;
    this.combatDirector.stats.comboTimer = 0;
    this.combatDirector.isGrappling = false;
    this.combatDirector.grappledEnemy = null;
    this.combatDirector.hitStopFrames = 0;

    this.environmentManager.reset();
    this.environmentManager.setupRoomForWave(this.waveNumber);
    this.spawnSquad(this.squadSize);
    if (this.onStateChange) this.onStateChange();
  }

  public toggleSound(): boolean {
    this.soundMuted = !this.soundMuted;
    SoundFX.enabled = !this.soundMuted;
    return !this.soundMuted;
  }

  public start(canvas: HTMLCanvasElement, onStateChange?: () => void): void {
    this.onStateChange = onStateChange;
    this.isRunning = true;
    this.lastTime = performance.now();

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const loop = (timestamp: number) => {
      if (!this.isRunning) return;

      const rawDt = (timestamp - this.lastTime) / 1000;
      this.lastTime = timestamp;
      const baseDt = Math.min(rawDt, 0.05); // Cap to 50ms to prevent tunneling

      // FPS tracking
      this.frameCount++;
      this.fpsTimer += baseDt;
      if (this.fpsTimer >= 0.5) {
        this.fps = Math.round(this.frameCount / this.fpsTimer);
        this.frameCount = 0;
        this.fpsTimer = 0;
        if (this.onStateChange) this.onStateChange();
      }

      // Tactical Pause: freeze game simulation while keeping frame rendered
      if (this.isPaused) {
        this.renderer.render(
          ctx,
          canvas.width,
          canvas.height,
          this.camera,
          this.player,
          this.enemies,
          this.combatDirector,
          this.environmentManager,
          this.debugMode
        );
        this.animFrameId = requestAnimationFrame(loop);
        return;
      }

      // Hit-stop / Freeze frames check
      if (this.combatDirector.hitStopFrames > 0) {
        this.combatDirector.hitStopFrames--;
        // Re-render current frame without advancing physics
        this.renderer.render(
          ctx,
          canvas.width,
          canvas.height,
          this.camera,
          this.player,
          this.enemies,
          this.combatDirector,
          this.environmentManager,
          this.debugMode
        );
        this.animFrameId = requestAnimationFrame(loop);
        return;
      }

      // Apply Slow Motion if active (e.g. perfect parry)
      const effectiveDt = baseDt * this.combatDirector.slowMoFactor;

      // 1. INPUT
      const input = this.inputManager.poll();

      // 2. PLAYER UPDATE
      this.player.update(input, effectiveDt);

      // 3. ENVIRONMENT & DESTRUCTIBLES UPDATE
      const allEnemiesDefeated =
        this.enemies.length > 0 &&
        this.enemies.every(e => e.health <= 0 && e.state === 'DOWNED');
      this.environmentManager.setDoorOpen(allEnemiesDefeated);
      this.environmentManager.update(effectiveDt, this.player.physics);

      // Check door transition to next chamber
      const enteredDoor = this.environmentManager.checkDoorInteraction(
        this.player.physics.position.x,
        input.grab || input.interact
      );
      if (enteredDoor) {
        this.player.physics.position.x = -200;
        this.nextWave();
        SoundFX.playDoorOpen();
        if (this.onStateChange) this.onStateChange();
      }

      // Particle triggers based on player actions
      if (this.player.physics.isSliding) {
        const dir = this.player.physics.facingRight ? -1 : 1;
        this.renderer.spawnDust(
          this.player.physics.position.x + dir * 18,
          this.player.physics.position.y,
          dir * 120,
          -30,
          2,
          'rgba(210, 220, 240, 0.45)'
        );
      } else if (this.player.physics.state === 'RUN' && Math.random() < 0.35) {
        const dir = this.player.physics.facingRight ? -1 : 1;
        this.renderer.spawnDust(
          this.player.physics.position.x + dir * 14,
          this.player.physics.position.y,
          dir * 40,
          -15,
          1,
          'rgba(160, 175, 200, 0.25)'
        );
      } else if (this.player.physics.state === 'LAND' && this.player.physics.stateTimer < 0.04) {
        this.renderer.spawnDust(this.player.physics.position.x - 12, this.player.physics.position.y, -60, -35, 3);
        this.renderer.spawnDust(this.player.physics.position.x + 12, this.player.physics.position.y, 60, -35, 3);
        this.camera.addTrauma(0.18);
      }

      // 4. ENEMIES UPDATE (Coordinated Attack Token Allocation)
      // Check if any enemy is currently executing an attack
      const isAnyAttacking = this.enemies.some(
        e => e.state === 'WINDUP' || e.state === 'ATTACK'
      );
      let tokenGranted = false;

      for (const enemy of this.enemies) {
        let canAttack = false;
        if (!isAnyAttacking && !tokenGranted && enemy.health > 0 && enemy.state !== 'DOWNED' && enemy.state !== 'STAGGER') {
          canAttack = true;
          tokenGranted = true;
        }

        enemy.update(
          effectiveDt,
          this.player.physics.position,
          this.player.physics.state,
          this.player.physics.grounded,
          canAttack
        );
      }

      // 5. COMBAT DIRECTOR RESOLUTION (Hits, Parries, Grabs, Hit-Stop, Projectiles)
      this.combatDirector.update(
        effectiveDt,
        this.player,
        this.enemies,
        this.camera,
        this.environmentManager
      );

      // 6. CAMERA UPDATE (Frames player and nearest active hostile)
      let activeEnemies = this.enemies.filter(e => e.health > 0 && e.state !== 'DOWNED');
      let targetCameraX = this.player.physics.position.x;
      if (activeEnemies.length > 0) {
        // Find closest active enemy
        let closest = activeEnemies[0];
        let minDist = Math.abs(closest.position.x - this.player.physics.position.x);
        for (let i = 1; i < activeEnemies.length; i++) {
          const d = Math.abs(activeEnemies[i].position.x - this.player.physics.position.x);
          if (d < minDist) {
            minDist = d;
            closest = activeEnemies[i];
          }
        }
        targetCameraX = this.player.physics.position.x * 0.65 + closest.position.x * 0.35;
      }

      this.camera.update(
        targetCameraX,
        this.player.physics.position.y,
        this.player.physics.velocity.x,
        this.player.physics.facingRight,
        baseDt
      );

      // 7. PARTICLES UPDATE
      this.renderer.updateParticles(baseDt);

      // 8. RENDER SCENE
      this.renderer.render(
        ctx,
        canvas.width,
        canvas.height,
        this.camera,
        this.player,
        this.enemies,
        this.combatDirector,
        this.environmentManager,
        this.debugMode
      );

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.inputManager.destroy();
  }
}
