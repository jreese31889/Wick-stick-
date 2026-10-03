import { InputManager } from './InputManager';
import { PlayerController } from './PlayerController';
import { EnemyController, setProfileDamageMult } from './EnemyController';
import { CombatDirector } from './CombatDirector';
import { Camera } from './Camera';
import { Renderer } from './Renderer';
import { SoundFX } from './SoundFX';
import { Haptics } from './Haptics';
import { EnvironmentManager } from './EnvironmentManager';
import { GUNS } from './Weapons';
import { ragdollPool } from './Ragdoll';
import { ObjectPool } from './ObjectPool';
import { emitProgress, PROGRESS_EVENTS } from '../profile/ProgressEvents';
import type { RunProfile } from '../profile/Progression';

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
  /** PHASE 2: profile stats painted onto the fighter at run start (read by the HUD/debug). */
  public runProfile: RunProfile | null = null;

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

  // PHASE 3 4 — aim magnetism level mirrored from settings (like quality, it
  // has to survive fullReset's CombatDirector swap, so it lives here too).
  private _aimAssist: 'off' | 'low' | 'high' = 'low';
  public get aimAssist(): 'off' | 'low' | 'high' {
    return this._aimAssist;
  }
  public set aimAssist(level: 'off' | 'low' | 'high') {
    this._aimAssist = level;
    this.combatDirector.aimAssist = level;
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

  // PHASE 1B 6 — squad pacing: armed while a swing is committed, then held
  // for one breath so volleys land as staggered beats, not a dogpile.
  private attackGapTimer = 0;
  // PHASE 1B 11 — adaptive difficulty scalar; 1.0 = shipped baseline.
  private adaptiveScale = 1;

  // P6B-02: opaque overlays (pause / game-over) repaint at 10 Hz, not 60
  private lastIdleRenderTime = 0;
  private idleRenderDue = true;

  // P6B-03: auto-pause while the tab/app is hidden
  private visibilityHandler: (() => void) | null = null;

  // P6-03: one spawn→clear performance measure per wave
  private waveSpawnMark = '';
  private waveClearMarked = false;

  // Signature-move HUD bookkeeping
  private lastPlayerStateForBanner = '';
  private flyingKickAirborne = false;

  // PHASE 4 E6 — countdown to the next low-HP heartbeat thump.
  private heartTimer = 0;

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

  /**
   * PHASE 3 1 — one input entry point. Pushes this frame's context (facing,
   * door reach, reload state) down first so the pad's context button and ADS
   * hold resolve against the live simulation, then merges every device into
   * the shared action state.
   */
  private pollInput() {
    const physics = this.player.physics;
    this.inputManager.hint.facingRight = physics.facingRight;
    this.inputManager.hint.nearDoor =
      this.environmentManager.doorOpen &&
      Math.abs(physics.position.x - this.environmentManager.doorX) < 80;
    this.inputManager.hint.canReload =
      !physics.isReloading && physics.ammo < physics.maxAmmo && physics.reserveAmmo > 0;
    return this.inputManager.poll();
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

    // Phase 1 C5: elite promotion — later waves mint violet/gold variants of
    // the normal archetypes (bosses and the ELITE rank are exempt inside).
    const eliteChance = this.waveNumber >= 7 ? 0.4 : this.waveNumber >= 3 ? 0.2 : 0;
    if (eliteChance > 0) {
      for (const e of this.enemies) {
        if (Math.random() < eliteChance) e.promoteToElite();
      }
    }

    // Endless-mode difficulty scaling beyond the authored milestones (wave 7+)
    if (this.waveNumber >= 7) {
      const over = this.waveNumber - 6;
      const hpMult = 1 + over * 0.15;
      const dmgMult = 1 + over * 0.08;
      const speedMult = 1 + over * 0.05; // Phase 1 C7: the speed leg
      for (const e of this.enemies) {
        e.applyWaveScaling(hpMult, dmgMult, speedMult);
      }
    }

    if (isBoss || size === 4) {
      this.combatDirector.announceMove('⚔️ HIGH TABLE MASTER DESCENDS', 2.4);
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

  /**
   * PHASE 2: paints the profile's run stats (damage / health / speed / focus /
   * loadout) onto the current fighter. Call right after fullReset(), which
   * builds a fresh PlayerController — idempotent per player instance because
   * fullReset clears the stored block.
   */
  public applyRunProfile(run: RunProfile): void {
    this.runProfile = run;
    setProfileDamageMult(run.damageMult);
    this.player.applyRunProfile(run);
    if (this.onStateChange) this.onStateChange();
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
      this.player.pendingSalvoShot = false;
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
    // PHASE 2: the replacement starts unpainted — App re-applies via
    // applyRunProfile, and a stale block here would double-dip the bonuses.
    this.runProfile = null;
    setProfileDamageMult(1);
    this.combatDirector = new CombatDirector();
    // P5-02: the replacement starts at high — carry the current tier over
    this.combatDirector.quality = this._quality;
    // PHASE 3 4: ...and the aim magnetism level with it
    this.combatDirector.aimAssist = this._aimAssist;
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

    // P6B-03 + PHASE 3 6: freeze the sim while the tab/app is hidden instead
    // of letting rAF keep burning battery in the background. Returning to the
    // foreground LANDS IN PAUSE — the run never resumes under the player's
    // thumb, they pick it up from the pause menu (or it was already paused).
    this.visibilityHandler = () => {
      if (document.hidden) {
        if (!this.isPaused && !this.isGameOver) {
          this.setPaused(true);
          // No held buttons while the app sits in the background.
          this.inputManager.releaseAll();
        }
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
        // PHASE 1B 11: resample the adaptive scalar on the same half-second
        // cadence as the perf window (cheap: two scans, no allocation).
        this.sampleAdaptive();
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
        // PHASE 3 1: keep the pad alive while the sim is held so Start can
        // resume from the pause menu (its footer promises it) — the state
        // this produces is never read by the frozen simulation.
        if (this.isPaused) this.pollInput();
        if (renderFrame) renderScene();
        this.animFrameId = requestAnimationFrame(loop);
        return;
      }

      const simStart = performance.now();

      // PHASE 4: the world is heard from wherever the fighter is standing —
      // one field write, read by SoundFX when a spatial voice is placed.
      SoundFX.setListenerX(this.player.physics.position.x);

      // Apply Slow Motion if active (e.g. perfect parry)
      const effectiveDt = baseDt * this.combatDirector.slowMoFactor;

      // 1. INPUT
      const input = this.pollInput();

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
        this.player.restockAmmo();
        // PHASE 2: Focus grant (ratio 0 at upgrade tier 0) + one progression
        // event per wave — XP, banking, achievements and toasts fan out there.
        this.player.grantFocus(this.player.focusGainRatio);
        const damageTaken = this.player.waveDamageTaken;
        this.player.waveDamageTaken = 0;
        emitProgress(PROGRESS_EVENTS.WAVE_CLEAR, {
          wave: this.waveNumber,
          styleRank: this.combatDirector.styleRank,
          maxCombo: this.combatDirector.stats.maxCombo,
          damageTaken,
        });
      }
      this.environmentManager.setDoorOpen(allEnemiesDefeated);
      this.environmentManager.update(effectiveDt, this.player.physics);

      // 3b. Phase-1 inventory pickups queued by the environment (guns + ammo)
      const queuedGun = this.player.physics.pendingGunPickup;
      if (queuedGun) {
        this.player.physics.pendingGunPickup = null;
        this.player.pickupGun(queuedGun);
        this.combatDirector.announceMove(`${GUNS[queuedGun].name} ACQUIRED`);
      }
      const queuedAmmo = this.player.physics.pendingAmmo;
      if (queuedAmmo && queuedAmmo > 0) {
        this.player.physics.pendingAmmo = 0;
        this.player.pickupAmmo(queuedAmmo);
        this.combatDirector.addAmmoPopup(this.player.physics.position.x, this.player.physics.position.y - 120, queuedAmmo);
      }

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

      // 4. ENEMIES UPDATE (PHASE 1B 6 — group AI coordination)
      //   • attacker slots: one by default, two once the squad is large
      //     enough that serialising everyone reads as a queue, not a fight
      //   • a breathing gap after the last swing lands, so pressure comes
      //     in beats (design §8) instead of all at once
      //   • the token goes to the eligible body closest to the player, so
      //     the same enemy never opens every dance
      //   • flank slots: alternate shoulders in depth rings, so the squad
      //     forms a line around John instead of queueing on one side
      let attacking = 0;
      let alive = 0;
      for (const e of this.enemies) {
        if (e.state === 'WINDUP' || e.state === 'ATTACK') attacking++;
        if (e.health > 0 && e.state !== 'DOWNED') alive++;
      }
      if (attacking > 0) {
        this.attackGapTimer = 0.22; // hold the door while anyone is committed
      } else if (this.attackGapTimer > 0) {
        this.attackGapTimer -= effectiveDt;
      }
      const maxAttackers = alive >= 6 ? 2 : 1;
      const openSlots =
        this.attackGapTimer > 0 ? 0 : Math.max(0, maxAttackers - attacking);

      // Distance-ordered grant: pass k picks the (k+1)-th closest candidate.
      let slotsLeft = openSlots;
      while (slotsLeft > 0) {
        let pick: EnemyController | null = null;
        let pickDist = Infinity;
        for (const e of this.enemies) {
          if (e.tokenPicked) continue;
          if (e.health <= 0 || e.state === 'DOWNED' || e.state === 'STAGGER') continue;
          const d = Math.abs(e.position.x - this.player.physics.position.x);
          if (d < pickDist) {
            pickDist = d;
            pick = e;
          }
        }
        if (!pick) break;
        pick.tokenPicked = true;
        slotsLeft--;
      }

      // Flank slots: two alternating sides, two depth rings — deterministic
      // per frame, so nobody flickers between positions.
      if (alive >= 3) {
        let flankSlot = 0;
        for (const e of this.enemies) {
          if (e.health <= 0 || e.state === 'DOWNED') continue;
          if (e.type === 'SNIPER') continue; // holds its own long lane
          const side = flankSlot % 2 === 0 ? 1 : -1;
          const ring = Math.floor(flankSlot / 2) % 2;
          e.targetOffset = side * (70 + ring * 55);
          flankSlot++;
        }
      }

      for (const enemy of this.enemies) {
        const canAttack =
          enemy.tokenPicked &&
          enemy.health > 0 &&
          enemy.state !== 'DOWNED' &&
          enemy.state !== 'STAGGER';
        enemy.adaptive = this.adaptiveScale;

        enemy.update(
          effectiveDt,
          this.player.physics.position,
          this.player.physics.state,
          this.player.physics.grounded,
          canAttack
        );
        enemy.tokenPicked = false;
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

      // 5c. PHASE 4 E6 — low-HP heartbeat warning. One boolean test while
      // the haptics setting is off, so a disabled toggle costs nothing here.
      if (Haptics.enabled) this.updateHeartbeat(baseDt);
      else this.heartTimer = 0;

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

      // PHASE 1B aim model: precision aim (gamepad right stick / touch aim
      // pad) tightens the framing; mouse aim keeps the shipped behaviour.
      this.camera.aimZoom =
        this.player.precisionAim && !this.combatDirector.isGrappling;

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
   * PHASE 4 E6 — the low-HP warning: a lub-dub rumble that beats faster the
   * closer to death the fighter is (0.95 s at 29 % health, 0.60 s on the
   * ropes). Only ever reached while Haptics.enabled is true — the caller
   * gates it — so turning the setting off costs one boolean per frame.
   */
  private updateHeartbeat(dt: number): void {
    const physics = this.player.physics;
    const frac = physics.maxHealth > 0 ? physics.health / physics.maxHealth : 1;
    if (frac <= 0 || frac >= 0.3 || this.isDying) {
      this.heartTimer = 0;
      return;
    }
    this.heartTimer -= dt;
    if (this.heartTimer <= 0) {
      Haptics.heartbeat();
      this.heartTimer = 0.6 + 0.35 * (frac / 0.3);
    }
  }

  /**
   * PHASE 1B 11 — adaptive difficulty. Every half second the squad scalar is
   * re-aimed at where the player actually is: health on the ropes and fresh
   * bullet wounds pull it toward 0.8 (slower cooldowns, softer reactions),
   * long combos and unbroken health push it toward 1.3. 1.0 is the shipped
   * baseline and the spawn anchor — full health, empty combo, no pressure
   * resolves to exactly 1.0, so a clean run starts untouched.
   */
  private sampleAdaptive(): void {
    const p = this.player.physics;
    const cd = this.combatDirector;
    const healthFrac = p.maxHealth > 0 ? p.health / p.maxHealth : 1;
    const comboSkill = Math.min(1, cd.stats.comboCount / 12);
    // damage taken since the last sample; 40+ inside 0.5 s = full pressure
    const pressure = Math.min(1, cd.playerDamageWindow / 40);
    cd.playerDamageWindow = 0;

    const target = Math.min(
      1.3,
      Math.max(0.8, 1 + (healthFrac - 1) * 0.45 + comboSkill * 0.2 - pressure * 0.35)
    );
    this.adaptiveScale += (target - this.adaptiveScale) * 0.35;
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
      ` · pose ${poseMs.toFixed(2)}ms` +
      ` · adr ${this.adaptiveScale.toFixed(2)}`
    );
  }
}
