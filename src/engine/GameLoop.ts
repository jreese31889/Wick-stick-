import { InputManager } from './InputManager';
import { PlayerController } from './PlayerController';
import { EnemyController } from './EnemyController';
import { CombatDirector } from './CombatDirector';
import { Camera } from './Camera';
import { Renderer } from './Renderer';
import { SoundFX } from './SoundFX';
import { EnvironmentManager } from './EnvironmentManager';
import { ragdollPool } from './Ragdoll';
import { ObjectPool } from './ObjectPool';

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

  // Game-over flow
  public isGameOver = false;
  private isDying = false;
  private dyingTimer = 0;

  // Performance telemetry
  public fps = 60;

  /**
   * P5-01: logical (DPR-capped) view the renderer lays out in — set by
   * GameCanvas.updateSize. The backing store may be smaller (medium/low
   * tiers); renderScene scales the view onto it, so framing never changes.
   */
  public viewWidth = 0;
  public viewHeight = 0;

  // P5-01 + P5-02: one quality knob — pushes the tier to the renderer
  // (resolution scaling, blur gates, dust/afterimage/rain budgets) and to
  // the combat FX budgets (sparks/blood).
  private _quality: 'low' | 'medium' | 'high' = 'high';
  public get quality(): 'low' | 'medium' | 'high' {
    return this._quality;
  }
  public set quality(q: 'low' | 'medium' | 'high') {
    this._quality = q;
    this.renderer.quality = q;
    this.combatDirector.quality = q;
  }
  /** P6-01: averaged sim-ms and render-ms over the last 0.5 s window. */
  public updateMs = 0;
  public renderMs = 0;
  /** P6B-05: HUD perf chip, written straight to the DOM (no React churn). */
  public perfSpanEl: HTMLElement | null = null;
  /** P6-02: App flips this with the Rig debug toggle to surface the counters. */
  public debugStatsEnabled = false;
  private frameCount = 0;
  private fpsTimer = 0;
  private updateMsAccum = 0;
  private renderMsAccum = 0;
  private perfFrames = 0;

  // P6B-02: opaque overlays (pause / game-over) repaint at 10 Hz, not 60
  private lastIdleRenderTime = 0;
  private idleRenderDue = true;

  // P6B-03: auto-pause while the tab/app is hidden
  private visibilityHandler: (() => void) | null = null;
  private autoPausedByVisibility = false;

  // P6-03: one spawn→clear performance measure per wave
  private waveSpawnMark = '';
  private waveClearMarked = false;

  // Signature-move HUD bookkeeping
  private lastPlayerStateForBanner = '';
  private flyingKickAirborne = false;

  // Callback to sync state with React HUD
  private onStateChange?: () => void;

  constructor() {
    // Warm the real SFX sample bank (fetch + decode) before the first fight.
    SoundFX.preload();
    this.environmentManager.setupRoomForWave(1);
    this.spawnSquad(1);
  }

  public togglePause(): boolean {
    this.setPaused(!this.isPaused);
    return this.isPaused;
  }

  public setPaused(paused: boolean): void {
    if (this.isPaused === paused) return;
    this.isPaused = paused;
    if (this.isPaused) {
      // P6B-02: repaint immediately when the overlay lands, then 10 Hz.
      this.idleRenderDue = true;
    } else {
      this.lastTime = performance.now();
    }
    if (this.onStateChange) this.onStateChange();
  }

  /** P6B-02: forces the next paused/idle frame to repaint (used on resize). */
  public requestIdleRender(): void {
    this.idleRenderDue = true;
  }

  /** P6-03: opens a spawn→clear measure window for the current wave. */
  private markWaveSpawn(): void {
    if (typeof performance === 'undefined' || !performance.mark) return;
    if (this.waveSpawnMark) performance.clearMarks(this.waveSpawnMark);
    this.waveSpawnMark = `wave-${this.waveNumber}-spawn`;
    performance.mark(this.waveSpawnMark);
    this.waveClearMarked = false;
  }

  /** P6-03: closes the window once the wave is wiped out. */
  private markWaveClear(): void {
    if (typeof performance === 'undefined' || !performance.mark || !this.waveSpawnMark) return;
    const clearMark = `wave-${this.waveNumber}-clear`;
    performance.mark(clearMark);
    performance.measure(`wave-${this.waveNumber}`, this.waveSpawnMark, clearMark);
    performance.clearMarks(clearMark);
  }

  public spawnSquad(size: number = 1, isBoss: boolean = false) {
    // P3-02: the corpse refs are about to be dropped with the old squad —
    // recycle their ragdolls back to the pool instead of leaving them to GC.
    for (const old of this.enemies) {
      if (old.ragdoll) {
        ragdollPool.release(old.ragdoll);
        old.ragdoll = null;
      }
    }
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
    } else if (size === 8) {
      // Endless reserve roster: pressure bruiser, evasive duelist, overwatch sniper
      this.enemies = [
        new EnemyController(`berserker-${this.waveNumber}`, px + 200, 0, 'BERSERKER', 90),
        new EnemyController(`acrobat-${this.waveNumber}`, px - 210, 0, 'ACROBAT', -90),
        new EnemyController(`sniper-${this.waveNumber}`, px - 440, 0, 'SNIPER', -150)
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

    // Ranged harassment: one GUNNER joins size-3+ ambush squads from wave 3 onward,
    // and every endless pattern from wave 7+ (mobile-sane: at most +1 enemy).
    // Authored milestone duels (waves 4-6) keep their fixed compositions.
    const isAuthoredMilestone = this.waveNumber >= 4 && this.waveNumber <= 6;
    const isReserveRoster = size === 8; // already carries its own ranged threat
    if (
      !isReserveRoster &&
      (this.waveNumber >= 7 || (this.waveNumber >= 3 && !isAuthoredMilestone && !isBoss && size === 3))
    ) {
      this.enemies.push(
        new EnemyController(`gunner-wave-${this.waveNumber}`, px - 420, 0, 'GUNNER', -140)
      );
    }

    // Endless-mode difficulty scaling beyond the authored milestones (wave 7+)
    if (this.waveNumber >= 7) {
      const over = this.waveNumber - 6;
      const hpMult = 1 + over * 0.15;
      const dmgMult = 1 + over * 0.08;
      for (const e of this.enemies) {
        e.applyWaveScaling(hpMult, dmgMult);
      }
    }

    this.markWaveSpawn();
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
      const patterns = [7, 6, 8, 4, 5];
      const pick = patterns[(this.waveNumber - 7) % patterns.length];
      this.spawnSquad(pick, pick === 4);
    } else {
      const nextSize = Math.min(3, Math.max(1, (this.waveNumber % 3) || 3));
      this.spawnSquad(nextSize);
    }
  }

  public resetFight() {
    this.isGameOver = false;
    this.isDying = false;
    this.dyingTimer = 0;
    // P3-02: hand the kill-cam body back to the pool before dropping it
    if (this.player.ragdoll) {
      ragdollPool.release(this.player.ragdoll);
      this.player.ragdoll = null;
    }
    this.player.physics.position = { x: 0, y: 0 };
    this.player.physics.velocity = { x: 0, y: 0 };
    this.player.physics.health = this.player.physics.maxHealth;
    this.player.physics.stamina = this.player.physics.maxStamina;
    this.player.physics.state = 'IDLE';
    this.player.equipWeapon('UNARMED');

    this.combatDirector.stats.comboCount = 0;
    this.combatDirector.stats.comboTimer = 0;
      this.combatDirector.stats.finisherArmed = false;
      this.player.finisherArmed = false;
      this.combatDirector.resetTransientState();
      this.player.pendingPistolShot = false;
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

  /**
   * Full run restart: back to wave 1 with a fresh fighter, stats and arena.
   * Used by the game-over screen.
   */
  public fullReset() {
    this.waveNumber = 1;
    this.isGameOver = false;
    this.isDying = false;
    this.dyingTimer = 0;
    this.isPaused = false;
    // P3-02: recycle the old fighter's kill-cam body before the replacement
    if (this.player.ragdoll) {
      ragdollPool.release(this.player.ragdoll);
    }
    this.player = new PlayerController(0, 0);
    this.combatDirector = new CombatDirector();
    // P5-02: the replacement starts at high — carry the current tier over
    this.combatDirector.quality = this._quality;
    this.renderer.clearAfterimages();
    this.environmentManager.reset();
    this.environmentManager.setupRoomForWave(1);
    this.spawnSquad(1);
    if (this.onStateChange) this.onStateChange();
  }

  public start(canvas: HTMLCanvasElement, onStateChange?: () => void): void {
    this.onStateChange = onStateChange;
    this.isRunning = true;
    this.lastTime = performance.now();

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // P6B-03: freeze the sim while the tab/app is hidden instead of letting
    // rAF keep burning battery in the background. Only pauses this handler
    // opened itself are auto-resumed, so a manual pause stays paused.
    this.visibilityHandler = () => {
      if (document.hidden) {
        if (!this.isPaused && !this.isGameOver) {
          this.setPaused(true);
          this.autoPausedByVisibility = true;
        }
      } else if (this.autoPausedByVisibility) {
        this.autoPausedByVisibility = false;
        this.setPaused(false);
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // P6B-01: the single render call site for all four loop states. Defined
    // once, outside the frame callback, so it never allocates per frame.
    const renderScene = () => {
      const renderStart = performance.now();
      // P5-01: map the logical view onto the backing store (they only differ
      // on medium/low tiers). Assigning canvas.width resets the CTM, so this
      // is re-applied every frame — an identity transform at the high tier.
      const viewW = this.viewWidth > 0 ? this.viewWidth : canvas.width;
      const viewH = this.viewHeight > 0 ? this.viewHeight : canvas.height;
      ctx.setTransform(canvas.width / viewW, 0, 0, canvas.height / viewH, 0, 0);
      this.renderer.render(
        ctx,
        viewW,
        viewH,
        this.camera,
        this.player,
        this.enemies,
        this.combatDirector,
        this.environmentManager,
        this.debugMode
      );
      this.renderMsAccum += performance.now() - renderStart;
    };

    const loop = (timestamp: number) => {
      if (!this.isRunning) return;

      const rawDt = (timestamp - this.lastTime) / 1000;
      this.lastTime = timestamp;
      const baseDt = Math.min(rawDt, 0.05); // Cap to 50ms to prevent tunneling

      // FPS tracking + perf window (P6-01 update-vs-render split)
      this.frameCount++;
      this.fpsTimer += baseDt;
      if (this.fpsTimer >= 0.5) {
        this.fps = Math.round(this.frameCount / this.fpsTimer);
        if (this.perfFrames > 0) {
          this.updateMs = this.updateMsAccum / this.perfFrames;
          this.renderMs = this.renderMsAccum / this.perfFrames;
        }
        this.updateMsAccum = 0;
        this.renderMsAccum = 0;
        this.perfFrames = 0;
        this.frameCount = 0;
        this.fpsTimer = 0;
        this.updatePerfSpan();
        // The HUD only needs React while gameplay can change; behind the
        // opaque pause / game-over overlays it is static (the perf chip is
        // DOM-driven now, so it keeps ticking without a re-render).
        if (!this.isPaused && !this.isGameOver && this.onStateChange) this.onStateChange();
      }

      // skipSim freezes the simulation but still paints (pause / game-over /
      // hit-stop); renderFrame throttles the paint while an opaque overlay
      // covers the canvas (10 Hz instead of every rAF).
      let skipSim = false;
      let renderFrame = true;

      if (this.isPaused || this.isGameOver) {
        skipSim = true;
        renderFrame = this.idleRenderDue || timestamp - this.lastIdleRenderTime >= 100;
        if (renderFrame) {
          this.idleRenderDue = false;
          this.lastIdleRenderTime = timestamp;
        }
      } else if (this.combatDirector.hitStopFrames > 0) {
        // Hit-stop / freeze frames: physics held, but speed lines and trails
        // animate off the wall clock — this path still renders every frame.
        this.combatDirector.hitStopFrames--;
        skipSim = true;
      }

      if (skipSim) {
        if (renderFrame) renderScene();
        this.animFrameId = requestAnimationFrame(loop);
        return;
      }

      const simStart = performance.now();

      // Apply Slow Motion if active (e.g. perfect parry)
      const effectiveDt = baseDt * this.combatDirector.slowMoFactor;

      // 1. INPUT
      const input = this.inputManager.poll();

      // 1b. Share the armed chain-finisher flag so the next press plays it
      this.player.finisherArmed = this.combatDirector.stats.finisherArmed;

      // 2. PLAYER UPDATE
      this.player.update(input, effectiveDt);

      // 2b. Signature-move callouts — fired once, on the state's first frame
      if (this.player.physics.state !== this.lastPlayerStateForBanner) {
        const s = this.player.physics.state;
        if (s === 'ATTACK_FLYING_KICK') this.combatDirector.announceMove('FLYING KICK');
        else if (s === 'ATTACK_SWEEP') this.combatDirector.announceMove('LEG SWEEP');
        this.lastPlayerStateForBanner = s;
      }

      // 3. ENVIRONMENT & DESTRUCTIBLES UPDATE
      // P2-03: plain scan — the closure version allocated every frame
      let allEnemiesDefeated = this.enemies.length > 0;
      for (const e of this.enemies) {
        if (e.health > 0 || e.state !== 'DOWNED') {
          allEnemiesDefeated = false;
          break;
        }
      }
      // P6-03: close the wave measure the first frame the squad is wiped
      if (allEnemiesDefeated && !this.waveClearMarked) {
        this.waveClearMarked = true;
        this.markWaveClear();
      }
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
      if (this.player.physics.isSliding) {        const dir = this.player.physics.facingRight ? -1 : 1;
        this.renderer.spawnDust(
          this.player.physics.position.x + dir * 18,
          this.player.physics.position.y,
          dir * 120,
          -30,
          2,
          'rgba(210, 220, 240, 0.45)'
        );
      } else if ((this.player.physics.state === 'RUN' || this.player.physics.state === 'WALK') && Math.random() < 0.35) {
        const dir = this.player.physics.facingRight ? -1 : 1;
        this.renderer.spawnDust(
          this.player.physics.position.x + dir * 14,
          this.player.physics.position.y,
          dir * 40,
          -15,
          1,
          'rgba(160, 175, 200, 0.25)'
        );
      } else if (
        this.player.physics.state === 'ATTACK_FLYING_KICK' &&
        this.player.physics.grounded &&
        this.flyingKickAirborne
      ) {
        // FLYING KICK touchdown: skid the landing in a burst of dust
        this.flyingKickAirborne = false;
        const landDir = this.player.physics.facingRight ? 1 : -1;
        this.renderer.spawnDust(this.player.physics.position.x - landDir * 16, this.player.physics.position.y, -80 * landDir, -40, 3);
        this.renderer.spawnDust(this.player.physics.position.x + landDir * 16, this.player.physics.position.y, 90 * landDir, -34, 3);
        this.camera.addTrauma(0.2);
      } else if (this.player.physics.state === 'LAND' && this.player.physics.stateTimer < 0.04) {
        this.renderer.spawnDust(this.player.physics.position.x - 12, this.player.physics.position.y, -60, -35, 3);
        this.renderer.spawnDust(this.player.physics.position.x + 12, this.player.physics.position.y, 60, -35, 3);
        this.camera.addTrauma(0.18);
      }

      // Afterimage motion trails during dodge rolls and heavy attacks
      const pAnimState = this.player.physics.state;
      if (pAnimState === 'ATTACK_FLYING_KICK' && !this.player.physics.grounded) {
        this.flyingKickAirborne = true;
      }
      if (
        this.player.physics.isDodging ||
        pAnimState === 'DODGE_ROLL' ||
        pAnimState === 'ATTACK_HEAVY' ||
        pAnimState === 'ATTACK_KICK' ||
        pAnimState === 'ATTACK_SWEEP' ||
        pAnimState === 'ATTACK_FLYING_KICK'
      ) {
        this.renderer.spawnAfterimage(
          this.player.currentPose,
          this.player.physics.facingRight
        );
      }

      // 4. ENEMIES UPDATE (Coordinated Attack Token Allocation)
      // Check if any enemy is currently executing an attack
      // P2-03: plain scan instead of `.some(closure)`
      let isAnyAttacking = false;
      for (const e of this.enemies) {
        if (e.state === 'WINDUP' || e.state === 'ATTACK') {
          isAnyAttacking = true;
          break;
        }
      }
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

      // 5a. Push a HUD sync the instant a signature-move banner flips (the
      // normal onStateChange cadence only ticks twice a second).
      if (this.combatDirector.bannerChanged) {
        this.combatDirector.bannerChanged = false;
        if (this.onStateChange) this.onStateChange();
      }

      // 5b. PLAYER DEATH -> cinematic slow-mo kill cam, then game-over freeze
      if (!this.isGameOver && !this.isDying && this.player.physics.health <= 0) {
        this.isDying = true;
        this.dyingTimer = 1.4;
        this.combatDirector.slowMoFactor = 0.22;
        this.combatDirector.slowMoTimer = 1.4;
        this.combatDirector.speedLinesTimer = 1.2;
        this.camera.addTrauma(0.7);
        SoundFX.playPunch('slam');
        // Detach the player into a ragdoll for the kill-cam
        // P3-02: recycled shell — released on resetFight/fullReset
        if (!this.player.ragdoll) {
          this.player.ragdoll = ragdollPool.acquire();
          this.player.ragdoll.reset(
            this.player.currentPose,
            this.player.lastHitKbx,
            this.player.lastHitKby
          );
        }
      }
      if (this.isDying) {
        this.dyingTimer -= baseDt;
        if (this.dyingTimer <= 0) {
          this.isDying = false;
          this.isGameOver = true;
          if (this.onStateChange) this.onStateChange();
        }
      }

      // 6. CAMERA UPDATE (Frames player and nearest active hostile)
      // Single pass over this.enemies — no per-frame filter() allocation,
      // which was a guaranteed garbage-collector hit every single frame.
      let targetCameraX = this.player.physics.position.x;
      let closestDist = Infinity;
      for (const e of this.enemies) {
        if (e.health <= 0 || e.state === 'DOWNED') continue;
        const d = Math.abs(e.position.x - this.player.physics.position.x);
        if (d < closestDist) {
          closestDist = d;
          targetCameraX = this.player.physics.position.x * 0.65 + e.position.x * 0.35;
        }
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

      // 7b. RAGDOLL PHYSICS UPDATE (dead enemies + player kill-cam)
      for (const enemy of this.enemies) {
        if (enemy.ragdoll && !enemy.ragdoll.dead) {
          enemy.ragdoll.update(effectiveDt);
        }
      }
      if (this.player.ragdoll && !this.player.ragdoll.dead) {
        this.player.ragdoll.update(effectiveDt);
      }

      // 8. RENDER SCENE (P6-01 timing wraps sim vs render)
      this.updateMsAccum += performance.now() - simStart;
      this.perfFrames++;
      renderScene();

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
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.inputManager.destroy();
  }

  /**
   * P6B-05: paints the perf chip straight into the DOM — fps + the P6-01
   * update/render split (and, in Rig debug, the P6-02 counters) without
   * waking React up twice a second.
   */
  public updatePerfSpan(): void {
    const el = this.perfSpanEl;
    EnemyController.profilePose = this.debugStatsEnabled;
    if (!el) return;
    el.className =
      this.fps >= 55 ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold';
    let text = `${this.fps} · ${this.updateMs.toFixed(1)}/${this.renderMs.toFixed(1)}ms`;
    if (this.debugStatsEnabled) text += ` · ${this.debugStatsText()}`;
    el.textContent = text;
  }

  /** P6-02: live FX / pool / pose counters, only built while Rig debug is on. */
  private debugStatsText(): string {
    const poseMs = EnemyController.poseProfileMs;
    EnemyController.poseProfileMs = 0;
    const fx = this.renderer.fxStats();
    const cd = this.combatDirector;
    let ragdolls = this.player.ragdoll ? 1 : 0;
    for (const e of this.enemies) if (e.ragdoll) ragdolls++;
    return (
      `dust ${fx.dust}/${fx.dustCap} · spark ${cd.sparks.length}/${cd.sparkCap}` +
      ` · blood ${cd.bloodDecals.length}/${cd.bloodCap}` +
      ` · bul ${cd.enemyBullets.length} · rag ${ragdolls}` +
      ` · pool ${ObjectPool.hits}/${ObjectPool.misses}` +
      ` · pose ${poseMs.toFixed(2)}ms`
    );
  }
}
