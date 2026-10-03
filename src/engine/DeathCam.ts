/**
 * DEATH CAM — playback half of the kill-replay system (owner spec §3-§6, §8-§9).
 *
 * The recorder half lives in ReplayBuffer / Elimination. This module owns the
 * sequence a player sees after a lethal blow:
 *
 *   FREEZE      0.6 s of slow-motion on the final moment while the death
 *               animation and ragdoll play out (the shipped kill-cam).
 *   TRANSITION  first 0.7 s of the replay: the camera eases off the live pose
 *               into the chosen framing while a short black fades away, so the
 *               cut from "live world" to "recorded world" is never visible.
 *   REPLAY      the rest of the window, playing recorded states forward.
 *
 * Everything here is RECONSTRUCTION, never video: each frame re-samples the
 * ring buffer at a timestamp and re-poses the shipped rigs from the recorded
 * state id + phase (spec §9 — enemy actions are the recorded truth, the AI is
 * never re-run; `EnemyController.poseFromRecorded` exists purely for this).
 *
 * MULTIPLAYER-READY (spec §8): the module only ever talks to a `ReplaySource`.
 * Today that is the local `ReplayBuffer`; a future authoritative server can
 * push the same snapshot/event shape into another implementation and this
 * player — camera modes, overlay data, FX and SFX — consumes it unchanged.
 * No networking code lives here.
 */

import { AnimationController } from './AnimationController';
import { StickRig } from './StickRig';
import { Camera } from './Camera';
import { damp } from './MathUtils';
import { SoundFX } from './SoundFX';
import type { EnemyController } from './EnemyController';
import {
  REPLAY_EVENT_DAMAGE,
  REPLAY_EVENT_ELIMINATION,
  REPLAY_EVENT_SHOT,
  REPLAY_MAX_ACTORS,
  makeReplayEvents,
  makeReplaySample,
  replayBuffer,
} from './ReplayBuffer';
import type {
  ReplayActorState,
  ReplayEvent,
  ReplayProjectileState,
  ReplaySample,
  ReplaySource,
} from './ReplayBuffer';
import type {
  AnimationState,
  EnemyActionState,
  EliminationRecord,
  StickFigurePose,
  WeaponType,
} from '../types/game';

// ------------------------------------------------------------------ timing

/** Slow-motion beat on the final moment before the replay takes over (§3). */
export const DEATH_CAM_FREEZE_SECONDS = 0.6;
/** Camera easing window at the head of the replay (§3 "3-6 s transition"). */
export const DEATH_CAM_TRANSITION_SECONDS = 0.7;
const FADE_IN_SECONDS = 0.35;
const FADE_OUT_SECONDS = 0.45;
/** Share of the replay spent BEFORE the killing blow (the run-up). */
const LEAD_FRACTION = 0.7;
/** Minimum history the ring must hold before the replay is worth starting. */
const MIN_COVERAGE_SECONDS = 1.5;

// ------------------------------------------------------------- camera modes

/**
 * Framings for this 2D engine. They are not 3D camera rigs — each mode is a
 * (target x, target y, zoom) triple the shipped Camera eases toward, which is
 * exactly how the live game already frames a fight.
 */
export type ReplayCameraMode = 'KILLER_CLOSE' | 'KILLER_WIDE' | 'CINEMATIC' | 'OVERHEAD';

/** Order the overlay buttons render in. */
export const REPLAY_CAMERA_MODES: ReplayCameraMode[] = [
  'KILLER_CLOSE',
  'KILLER_WIDE',
  'CINEMATIC',
  'OVERHEAD',
];

export const REPLAY_CAMERA_LABELS: Record<ReplayCameraMode, string> = {
  KILLER_CLOSE: 'CLOSE',
  KILLER_WIDE: 'WIDE',
  CINEMATIC: 'CINEMA',
  OVERHEAD: 'OVERHEAD',
};

export type DeathCamPhase = 'OFF' | 'FREEZE' | 'TRANSITION' | 'REPLAY';

// ---------------------------------------------------------------- settings

export interface DeathCamSettings {
  /** Master switch — off means the death flow is byte-for-byte the legacy one. */
  enabled: boolean;
  /** Replay length in seconds (spec §7: 3 / 4 / 5 / 6, default 4). */
  duration: number;
  /** Cinematic flourishes: the CINEMATIC framing, vignette push, extra shake. */
  cinematic: boolean;
  /** Slow-motion ramp across the lethal moment (+ matched audio rate). */
  slowMotion: boolean;
  /** Trauma shake on replay impacts. Off = the camera never jitters. */
  shake: boolean;
  /** Skip the replay entirely after the 0.6 s freeze beat. */
  autoSkip: boolean;
}

export const DEATH_CAM_DURATIONS = [3, 4, 5, 6];

export const DEFAULT_DEATH_CAM_SETTINGS: DeathCamSettings = {
  enabled: true,
  duration: 4,
  cinematic: true,
  slowMotion: true,
  shake: true,
  autoSkip: false,
};

/** Clamps a persisted value onto one of the four authored durations. */
export function sanitizeDeathCamDuration(value: unknown, fallback: number): number {
  return DEATH_CAM_DURATIONS.includes(value as number) ? (value as number) : fallback;
}

// ------------------------------------------------------------ render payload

/** One replay-owned visual. Preallocated pool — never grows at runtime. */
export interface DeathCamFx {
  kind: number;
  x: number;
  y: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export const DEATH_CAM_FX_FLASH = 1;
export const DEATH_CAM_FX_RING = 2;
export const DEATH_CAM_FX_SPARK = 3;
export const DEATH_CAM_FX_AIM = 4;

const FX_POOL = 64;

/**
 * Everything the Renderer needs to paint one reconstructed frame. Built once
 * and mutated in place, so the replay never allocates per frame.
 */
export interface DeathCamFrame {
  playerPose: StickFigurePose | null;
  playerFacingRight: boolean;
  playerWeapon: WeaponType;
  playerRig: StickRig;
  /** Recorded player origin — shadow / floor anchoring for the ghost. */
  playerX: number;
  playerY: number;
  /** Enemy bodies whose pose was just re-generated from records — draw these. */
  enemies: EnemyController[];
  enemyCount: number;
  fx: DeathCamFx[];
  fxCount: number;
  projectiles: ReplayProjectileState[];
  projectileCount: number;
  /** 1 = solid black, 0 = clear. Eased across the head and tail of the replay. */
  fade: number;
}

/** Minimal sink the Death Cam needs from the renderer (no import cycle). */
export interface DeathCamFxSink {
  spawnMuzzleBloom(x: number, y: number): void;
}

// ------------------------------------------------------------------- module

const GUN_REPORTS = new Set(['PISTOL', 'SMG', 'SHOTGUN', 'RIFLE']);

function newFx(): DeathCamFx {
  return { kind: 0, x: 0, y: 0, x2: 0, y2: 0, life: 0, maxLife: 1, size: 0, color: '#fff' };
}

export class DeathCam {
  private readonly source: ReplaySource;
  private readonly sample: ReplaySample = makeReplaySample();
  /** Read-only scratch for overlay/tests — never the frame the renderer uses. */
  private readonly scratch: ReplaySample = makeReplaySample();
  private readonly events: ReplayEvent = makeReplayEvents(1)[0];

  private readonly playerAnim = new AnimationController();
  private readonly ghostRig = new StickRig();

  private readonly slotToEnemy: (EnemyController | null)[] = new Array(REPLAY_MAX_ACTORS).fill(null);
  private readonly prevRecoil: boolean[] = new Array(REPLAY_MAX_ACTORS).fill(false);
  private readonly fxPool: DeathCamFx[] = (() => {
    const out: DeathCamFx[] = [];
    for (let i = 0; i < FX_POOL; i++) out.push(newFx());
    return out;
  })();
  private readonly enemyList: EnemyController[] = new Array(REPLAY_MAX_ACTORS).fill(
    null as unknown as EnemyController
  );

  private record: EliminationRecord | null = null;
  private killerSlot = -1;
  private phaseValue: DeathCamPhase = 'OFF';
  private phaseTimer = 0;
  private t0 = 0;
  private tEnd = 1;
  private replayClock = 0;
  private killTime = 0;
  private manualMode: ReplayCameraMode | null = null;
  private modeValue: ReplayCameraMode = 'KILLER_WIDE';
  private finishedLatch = false;
  private shotSeenThisFrame = false;

  private fxCount = 0;
  private enemyCount = 0;

  // Camera easing targets (kept as fields so the hot path never allocates).
  private tCamX = 0;
  private tCamY = -60;
  private tCamZoom = 1;

  // Reusable render payload — mutated in place, never re-allocated.
  private readonly frameValue: DeathCamFrame = {
    playerPose: null,
    playerFacingRight: true,
    playerWeapon: 'UNARMED',
    playerRig: new StickRig(),
    playerX: 0,
    playerY: 0,
    enemies: [],
    enemyCount: 0,
    fx: [],
    fxCount: 0,
    projectiles: [],
    projectileCount: 0,
    fade: 1,
  };

  private settingsValue: DeathCamSettings = { ...DEFAULT_DEATH_CAM_SETTINGS };

  /** Optional hook so phase changes can wake the React HUD immediately. */
  public onPhaseChange: (() => void) | null = null;

  constructor(source: ReplaySource = replayBuffer) {
    this.source = source;
    this.frameValue.playerRig = this.ghostRig;
  }

  // ------------------------------------------------------------- settings

  public applySettings(patch: Partial<DeathCamSettings>): void {
    const next = { ...this.settingsValue, ...patch };
    next.duration = sanitizeDeathCamDuration(next.duration, DEFAULT_DEATH_CAM_SETTINGS.duration);
    this.settingsValue = next;
    // The CINEMATIC framing is itself a cinematic effect — turning the setting
    // off drops an armed choice back to the clearest two-shot.
    if (!next.cinematic && this.manualMode === 'CINEMATIC') this.manualMode = null;
  }

  public get settings(): Readonly<DeathCamSettings> {
    return this.settingsValue;
  }

  // ------------------------------------------------------------- lifecycle

  public get phase(): DeathCamPhase {
    return this.phaseValue;
  }

  /** True while any part of the sequence owns the screen. */
  public get running(): boolean {
    return this.phaseValue !== 'OFF';
  }

  /** True while the reconstruction is on screen (sim must be held). */
  public get replaying(): boolean {
    return this.phaseValue === 'TRANSITION' || this.phaseValue === 'REPLAY';
  }

  public get overlayVisible(): boolean {
    return this.replaying;
  }

  /** 0..1 through the replay window — drives the overlay progress bar. */
  public get progress(): number {
    if (!this.replaying) return 0;
    const span = Math.max(1e-4, this.tEnd - this.t0);
    return Math.max(0, Math.min(1, (this.replayClock - this.t0) / span));
  }

  public get mode(): ReplayCameraMode {
    return this.modeValue;
  }

  /** Length of the window actually on screen (clamped to buffer coverage). */
  public get windowSeconds(): number {
    return Math.max(0, this.tEnd - this.t0);
  }

  public get killerName(): string {
    return this.record?.killerName || 'THE ENVIRONMENT';
  }

  public get killerWeapon(): string {
    return this.record?.weaponName || 'ENVIRONMENT';
  }

  public get killerDistanceM(): number {
    return this.record?.distanceM ?? 0;
  }

  public get eliminationType(): string {
    return this.record?.type ?? 'ENVIRONMENT';
  }

  /**
   * Opens the sequence on a player death.
   *
   * @returns false when the Death Cam should not run (setting off, no resolved
   *          record, or the buffer has no usable history) — the caller keeps
   *          the shipped legacy death flow untouched (spec §7).
   */
  public start(record: EliminationRecord | null): boolean {
    if (!this.settingsValue.enabled) return false;
    if (!record || !record.onPlayer) return false;
    if (this.source.count < 4) return false;
    this.record = record;
    this.killerSlot = record.killerSlot;
    this.killTime = record.timestamp;
    this.phaseValue = 'FREEZE';
    this.phaseTimer = DEATH_CAM_FREEZE_SECONDS;
    this.finishedLatch = false;
    this.manualMode = null;
    this.replayClock = 0;
    SoundFX.timeScale = 1;
    this.resetFrame();
    this.notify();
    return true;
  }

  /**
   * Enters the reconstruction once the freeze beat has played.
   * Returns false when the replay cannot run (auto-skip, or the ring no longer
   * covers the window) — the caller falls through to game-over.
   */
  public beginReplay(enemies: EnemyController[], viewWidth: number): boolean {
    if (this.phaseValue !== 'FREEZE') return false;
    if (this.settingsValue.autoSkip) {
      this.finish();
      return false;
    }
    const duration = this.settingsValue.duration;
    if (this.source.endTime - this.source.startTime < MIN_COVERAGE_SECONDS) {
      this.finish();
      return false;
    }

    // Window: `duration` seconds ending shortly after the killing blow, so the
    // run-up dominates and the lethal moment lands ~70 % of the way through.
    let start = this.killTime - LEAD_FRACTION * duration;
    start = Math.max(start, this.source.startTime);
    const end = Math.min(start + duration, this.source.endTime);
    start = Math.max(start, end - duration);
    this.t0 = start;
    this.tEnd = Math.max(this.t0 + 0.2, end);
    this.replayClock = this.t0;

    // Identity map: which live body renders each recorded actor slot.
    for (let i = 0; i < this.slotToEnemy.length; i++) this.slotToEnemy[i] = null;
    for (const enemy of enemies) {
      const slot = this.source.slotOf(enemy.id);
      if (slot >= 0 && slot < REPLAY_MAX_ACTORS) this.slotToEnemy[slot] = enemy;
    }

    const auto = DeathCam.autoSelectMode(this.scratchAt(this.killTime), viewWidth, this.killerSlot);
    this.modeValue = this.manualMode ?? auto;
    if (!this.settingsValue.cinematic && this.modeValue === 'CINEMATIC') this.modeValue = 'KILLER_WIDE';

    this.phaseValue = 'TRANSITION';
    this.phaseTimer = DEATH_CAM_TRANSITION_SECONDS;
    this.source.seekEvents(this.t0);
    for (let i = 0; i < this.prevRecoil.length; i++) this.prevRecoil[i] = false;
    this.resetFrame();
    this.notify();
    return true;
  }

  /** Ends the sequence (normal completion or skip) and latches the hand-off. */
  public finish(): void {
    if (this.phaseValue === 'OFF') return;
    this.phaseValue = 'OFF';
    this.phaseTimer = 0;
    SoundFX.timeScale = 1;
    this.finishedLatch = true;
    this.notify();
  }

  /** Drops the sequence without latching a hand-off (error / reset path). */
  public abort(): void {
    this.phaseValue = 'OFF';
    this.phaseTimer = 0;
    SoundFX.timeScale = 1;
    this.finishedLatch = false;
  }

  /** Overlay SKIP — exits instantly, straight into the existing flow (§5). */
  public skip(): void {
    if (this.replaying) this.finish();
  }

  /** True exactly once after the sequence ends, so GameLoop can flip game-over. */
  public consumeFinished(): boolean {
    if (!this.finishedLatch) return false;
    this.finishedLatch = false;
    return true;
  }

  // ------------------------------------------------------------- camera

  /** Player switch (overlay button). Unknown picks are ignored. */
  public setMode(mode: ReplayCameraMode): void {
    if (!REPLAY_CAMERA_MODES.includes(mode)) return;
    if (mode === 'CINEMATIC' && !this.settingsValue.cinematic) return;
    this.manualMode = mode;
    this.modeValue = mode;
  }

  /**
   * Auto-pick the clearest framing (§4): no killer actor → overhead, both
   * bodies fit → two-shot, else tight on the killer.
   */
  public static autoSelectMode(
    sample: ReplaySample,
    viewWidth: number,
    killerSlot: number
  ): ReplayCameraMode {
    const killer = findActorBySlot(sample, killerSlot);
    if (!killer) return 'OVERHEAD';
    const victim = findPlayer(sample);
    if (!victim) return 'KILLER_CLOSE';
    const span = Math.hypot(killer.x - victim.x, killer.y - victim.y);
    // Would a two-shot at the base framing still leave both bodies readable?
    const fits = viewWidth > 0 ? span * 1.3 < viewWidth * 0.6 : span < 380;
    return fits ? 'KILLER_WIDE' : 'KILLER_CLOSE';
  }

  /** Recorded position of the killer at `t`, or null when it left the window. */
  public killerPositionAt(t: number): { x: number; y: number } | null {
    if (this.source.sampleAt(t, this.scratch)) {
      const killer = findActorBySlot(this.scratch, this.killerSlot);
      if (killer) return { x: killer.x, y: killer.y };
    }
    if (this.record) return { x: this.record.killerX, y: this.record.killerY };
    return null;
  }

  /** Recorded position of the player at `t`, or null. */
  public playerPositionAt(t: number): { x: number; y: number } | null {
    if (this.source.sampleAt(t, this.scratch)) {
      const player = findPlayer(this.scratch);
      if (player) return { x: player.x, y: player.y };
    }
    if (this.record) return { x: this.record.lethalX, y: this.record.lethalY };
    return null;
  }

  // ------------------------------------------------------------- update

  /**
   * Advances one frame of the sequence: replay clock (with the optional
   * slow-motion ramp), event pump (flashes + SFX on their recorded
   * timestamps), ghost posing from records and camera easing.
   *
   * @returns false once the sequence has ended this frame.
   */
  public update(
    dt: number,
    viewWidth: number,
    viewHeight: number,
    camera: Camera,
    enemies: EnemyController[],
    fxSink: DeathCamFxSink | null
  ): boolean {
    if (this.phaseValue === 'OFF' || this.phaseValue === 'FREEZE') return this.running;

    const wasPhase = this.phaseValue;
    if (this.phaseValue === 'TRANSITION') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phaseValue = 'REPLAY';
        this.phaseTimer = 0;
      }
    }

    this.replayClock += dt * this.clockRate();
    if (this.replayClock >= this.tEnd) this.replayClock = this.tEnd;
    // Spec §6 — the mix rides the replay clock: every voice started from here
    // on is scaled by the same ramp the frames are (reset in finish/abort).
    SoundFX.timeScale = this.settingsValue.slowMotion ? this.clockRate() : 1;

    this.shotSeenThisFrame = false;
    this.decayFx(dt);
    this.pumpEvents(camera, fxSink);
    this.prepareFrame(dt, fxSink);
    this.frameCamera(dt, viewWidth, viewHeight, camera);

    if (this.replayClock >= this.tEnd) {
      this.finish();
      return false;
    }

    if (wasPhase !== this.phaseValue) this.notify();
    return this.running;
  }

  /**
   * Slow-motion ramp across the lethal moment (§6). Returns the playback rate
   * for the buffer clock — 1 outside the window, easing down to 0.45 over it.
   * Gated by the `slow motion` setting; the audio engine follows via
   * `SoundFX.timeScale`.
   */
  private clockRate(): number {
    if (!this.settingsValue.slowMotion) return 1;
    const ramp = 0.28;
    const d = Math.abs(this.replayClock - this.killTime);
    if (d >= ramp) return 1;
    return 0.45 + 0.55 * (d / ramp);
  }

  // ------------------------------------------------------------- events

  private pumpEvents(camera: Camera, fxSink: DeathCamFxSink | null): void {
    const ev = this.events;
    while (this.source.nextEvent(this.replayClock, ev)) {
      switch (ev.kind) {
        case REPLAY_EVENT_SHOT: {
          this.shotSeenThisFrame = true;
          fxSink?.spawnMuzzleBloom(ev.x, ev.y);
          this.spawnFx(DEATH_CAM_FX_FLASH, ev.x, ev.y, 0, 0, 0.14, 46, '#fde68a');
          this.playShotSfx(ev);
          break;
        }
        case REPLAY_EVENT_DAMAGE: {
          this.spawnFx(DEATH_CAM_FX_FLASH, ev.x, ev.y, 0, 0, 0.16, 40, '#ffffff');
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + ev.x * 0.01;
            this.spawnFx(
              DEATH_CAM_FX_SPARK,
              ev.x,
              ev.y,
              ev.x + Math.cos(a) * 34,
              ev.y + Math.sin(a) * 34,
              0.2,
              0,
              '#f87171'
            );
          }
          SoundFX.playPunch('light', ev.x);
          break;
        }
        case REPLAY_EVENT_ELIMINATION: {
          this.spawnFx(DEATH_CAM_FX_FLASH, ev.x, ev.y, 0, 0, 0.3, 92, '#ffffff');
          this.spawnFx(DEATH_CAM_FX_RING, ev.x, ev.y, 0, 0, 0.35, 74, '#f59e0b');
          SoundFX.playPunch('slam', ev.x);
          if (this.settingsValue.shake) camera.addTrauma(0.3);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Re-fires the recorded report, mapped onto the shipped sample bank. */
  private playShotSfx(ev: ReplayEvent): void {
    const weapon = this.source.weaponAt(ev.weaponId);
    if (GUN_REPORTS.has(weapon)) {
      SoundFX.playGunReport(weapon as 'PISTOL' | 'SMG' | 'SHOTGUN' | 'RIFLE', ev.x);
    } else if (weapon === 'KNIFE') {
      SoundFX.playKnifeThrow();
    } else {
      SoundFX.playGunshot(ev.x);
    }
  }

  // ------------------------------------------------------------- ghosts

  /**
   * Rebuilds every visible body from the buffer at the current replay time.
   *
   * The player pose is generated here from the recorded state id + phase. The
   * enemy poses are pushed into their live controllers (position / velocity /
   * state / phase) and handed to `poseFromRecorded`, which runs ONLY the pose
   * generator — no AI, no physics, no damage (spec §9). The bodies are written
   * after the run is already over, so nothing live can be disturbed.
   */
  private prepareFrame(dt: number, fxSink: DeathCamFxSink | null): void {
    if (!this.source.sampleAt(this.replayClock, this.sample)) return;
    const sample = this.sample;
    this.enemyCount = 0;

    for (let i = 0; i < sample.actorCount; i++) {
      const actor = sample.actors[i];
      if (actor.slot < 0 || actor.slot >= this.prevRecoil.length) continue;

      if (actor.kind === 'player') {
        this.frameValue.playerPose = this.playerAnim.generatePose(
          actor.state as AnimationState,
          actor.stateTimer,
          actor.vx,
          actor.vy,
          actor.facingRight,
          dt,
          actor.x,
          actor.y,
          actor.grounded
        );
        this.frameValue.playerFacingRight = actor.facingRight;
        this.frameValue.playerWeapon = actor.weapon as WeaponType;
        this.frameValue.playerX = actor.x;
        this.frameValue.playerY = actor.y;
        const pose = this.frameValue.playerPose;
        this.ghostRig.updatePhysics(
          actor.vx,
          actor.vy,
          actor.facingRight,
          dt,
          pose.neck.x,
          pose.neck.y,
          actor.state.startsWith('ATTACK_') || actor.state === 'DODGE_ROLL' ? 0.7 : 0.25
        );
        continue;
      }

      const enemy = this.slotToEnemy[actor.slot];
      if (!enemy) continue; // body no longer in the scene — nothing to draw with

      enemy.position.x = actor.x;
      enemy.position.y = actor.y;
      enemy.velocity.x = actor.vx;
      enemy.velocity.y = actor.vy;
      enemy.facingRight = actor.facingRight;
      enemy.state = actor.state as EnemyActionState;
      enemy.stateTimer = actor.stateTimer;
      enemy.health = actor.health;
      enemy.maxHealth = actor.maxHealth;
      enemy.poseFromRecorded(dt);
      if (this.enemyCount < this.enemyList.length) this.enemyList[this.enemyCount++] = enemy;

      // Recorded weapon state (§1): a rising recoil edge with no muzzle event
      // in the same frame still gets its flash (events are the primary source).
      const recoil = actor.recoil;
      if (recoil && !this.prevRecoil[actor.slot] && !this.shotSeenThisFrame && fxSink) {
        const dir = actor.facingRight ? 1 : -1;
        fxSink.spawnMuzzleBloom(actor.x + dir * 30, actor.y - 62);
        this.spawnFx(DEATH_CAM_FX_FLASH, actor.x + dir * 34, actor.y - 62, 0, 0, 0.12, 40, '#fde68a');
      }
      this.prevRecoil[actor.slot] = recoil;

      // Recorded aim state (§1): a faint lane so precision aim reads on replay.
      // Lifespan is deliberately ~one frame — the lane is re-spawned from the
      // recorded flag every frame, so it must not pile up in the pool.
      if (actor.aiming) {
        const dir = actor.facingRight ? 1 : -1;
        this.spawnFx(
          DEATH_CAM_FX_AIM,
          actor.x + dir * 34,
          actor.y - 62,
          actor.x + dir * 560,
          actor.y - 62,
          0.05,
          0,
          'rgba(244, 63, 94, 0.35)'
        );
      }
    }

    this.frameValue.projectiles = sample.projectiles;
    this.frameValue.projectileCount = sample.projectileCount;
  }

  // ------------------------------------------------------------- camera

  private frameCamera(dt: number, viewWidth: number, viewHeight: number, camera: Camera): void {
    const sample = this.sample;
    const killer = findActorBySlot(sample, this.killerSlot);
    const victim = findPlayer(sample);
    const killerX = killer ? killer.x : (this.record?.killerX ?? 0);
    const killerY = killer ? killer.y : (this.record?.killerY ?? 0);
    const victimX = victim ? victim.x : (this.record?.lethalX ?? 0);
    const victimY = victim ? victim.y : (this.record?.lethalY ?? 0);

    switch (this.modeValue) {
      case 'KILLER_CLOSE': {
        this.tCamX = killerX;
        this.tCamY = killerY - 70;
        this.tCamZoom = Camera.BASE_ZOOM * 1.5;
        break;
      }
      case 'KILLER_WIDE': {
        this.tCamX = (killerX + victimX) / 2;
        this.tCamY = (killerY + victimY) / 2 - 70;
        this.tCamZoom = this.fitZoom(
          viewWidth,
          viewHeight,
          Math.abs(killerX - victimX),
          Math.abs(killerY - victimY) + 150,
          1.15
        );
        break;
      }
      case 'CINEMATIC': {
        // Bias the two-shot toward the killer so the frame reads "who did it",
        // then push in slightly across the lethal moment for the drama beat.
        this.tCamX = killerX * 0.62 + victimX * 0.38;
        this.tCamY = (killerY + victimY) / 2 - 70;
        this.tCamZoom = this.fitZoom(
          viewWidth,
          viewHeight,
          Math.abs(killerX - victimX) + 60,
          Math.abs(killerY - victimY) + 150,
          1.1
        );
        const d = Math.abs(this.replayClock - this.killTime);
        if (d < 0.5) this.tCamZoom *= 1 + 0.16 * (1 - d / 0.5);
        break;
      }
      default: {
        // OVERHEAD: whole-scene bounding box of everything the buffer holds.
        let minX = killerX;
        let maxX = killerX;
        let minY = killerY;
        let maxY = killerY;
        let seen = 0;
        for (let i = 0; i < sample.actorCount; i++) {
          const a = sample.actors[i];
          if (!a.alive && a.kind !== 'player') continue;
          if (a.x < minX) minX = a.x;
          if (a.x > maxX) maxX = a.x;
          if (a.y < minY) minY = a.y;
          if (a.y > maxY) maxY = a.y;
          seen++;
        }
        if (seen === 0) {
          minX = Math.min(killerX, victimX);
          maxX = Math.max(killerX, victimX);
          minY = Math.min(killerY, victimY);
          maxY = Math.max(killerY, victimY);
        }
        this.tCamX = (minX + maxX) / 2;
        this.tCamY = (minY + maxY) / 2 - 60;
        this.tCamZoom = Math.min(
          Camera.BASE_ZOOM * 0.62,
          this.fitZoom(viewWidth, viewHeight, maxX - minX, maxY - minY + 160, 9)
        );
        break;
      }
    }

    // Smooth easing between modes (§4) — the shipped damp, gentler than the
    // live follow so a mode switch reads as a glide, never a cut.
    const head = this.phaseValue === 'TRANSITION';
    camera.aimZoom = false;
    camera.targetX = this.tCamX;
    camera.targetY = this.tCamY;
    camera.targetZoom = this.tCamZoom;
    camera.x = damp(camera.x, this.tCamX, head ? 3.4 : 5, dt);
    camera.y = damp(camera.y, this.tCamY, head ? 3.4 : 5, dt);
    camera.zoom = damp(camera.zoom, this.tCamZoom, head ? 3.2 : 4.5, dt);
  }

  /** Zoom that still fits `spanX × spanY` inside the logical view. */
  private fitZoom(
    viewWidth: number,
    viewHeight: number,
    spanX: number,
    spanY: number,
    capMul: number
  ): number {
    let zoom = Camera.BASE_ZOOM * capMul;
    const padX = Math.max(0, spanX) + 160;
    const padY = Math.max(0, spanY) + 120;
    if (viewWidth > 0) zoom = Math.min(zoom, viewWidth / padX);
    if (viewHeight > 0) zoom = Math.min(zoom, viewHeight / padY);
    return Math.max(0.3, zoom);
  }

  // ------------------------------------------------------------- FX pool

  /**
   * Frame-driven lifetimes for the pooled FX. Entries are filtered in place,
   * so a flash spawned at its recorded timestamp keeps playing for its authored
   * duration instead of vanishing the frame it fired (spec §6).
   */
  private decayFx(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.fxCount; i++) {
      const fx = this.fxPool[i];
      fx.life -= dt;
      if (fx.life > 0) {
        if (live !== i) this.fxPool[live] = fx;
        live++;
      }
    }
    this.fxCount = live;
  }

  private spawnFx(
    kind: number,
    x: number,
    y: number,
    x2: number,
    y2: number,
    life: number,
    size: number,
    color: string
  ): void {
    if (this.fxCount >= this.fxPool.length) return;
    const slot = this.fxPool[this.fxCount++];
    slot.kind = kind;
    slot.x = x;
    slot.y = y;
    slot.x2 = x2;
    slot.y2 = y2;
    slot.life = life;
    slot.maxLife = life;
    slot.size = size;
    slot.color = color;
  }

  private resetFrame(): void {
    this.fxCount = 0;
    this.enemyCount = 0;
    this.frameValue.playerPose = null;
    this.frameValue.projectileCount = 0;
    this.frameValue.fade = 1;
  }

  // ------------------------------------------------------------- frame out

  /** Stable, allocation-free payload the Renderer paints one frame from. */
  public frame(): DeathCamFrame {
    const f = this.frameValue;
    f.enemies = this.enemyList;
    f.enemyCount = this.enemyCount;
    f.fx = this.fxPool;
    f.fxCount = this.fxCount;
    f.fade = this.fadeAmount();
    return f;
  }

  private fadeAmount(): number {
    if (this.phaseValue === 'TRANSITION') {
      const elapsed = DEATH_CAM_TRANSITION_SECONDS - Math.max(0, this.phaseTimer);
      return Math.max(0, 1 - elapsed / FADE_IN_SECONDS);
    }
    const left = (1 - this.progress) * (this.tEnd - this.t0);
    return Math.max(0, Math.min(1, 1 - left / FADE_OUT_SECONDS));
  }

  // ------------------------------------------------------------- helpers

  private notify(): void {
    if (this.onPhaseChange) this.onPhaseChange();
  }

  private scratchAt(t: number): ReplaySample {
    if (this.source.sampleAt(t, this.scratch)) return this.scratch;
    return this.sample;
  }
}

function findPlayer(sample: ReplaySample): ReplayActorState | null {
  for (let i = 0; i < sample.actorCount; i++) {
    if (sample.actors[i].kind === 'player') return sample.actors[i];
  }
  return null;
}

function findActorBySlot(sample: ReplaySample, slot: number): ReplayActorState | null {
  if (slot < 0 || slot >= REPLAY_MAX_ACTORS) return null;
  for (let i = 0; i < sample.actorCount; i++) {
    if (sample.actors[i].slot === slot) return sample.actors[i];
  }
  return null;
}
