import { AnimationState, StickFigurePose, RigJoint } from '../types/game';
import { lerp, clamp } from './MathUtils';

/** Every joint of a pose, used by the cross-fade helpers below. */
export const POSE_JOINTS: (keyof StickFigurePose)[] = [
  'head', 'neck', 'torso', 'hips',
  'leftShoulder', 'leftElbow', 'leftHand',
  'rightShoulder', 'rightElbow', 'rightHand',
  'leftHip', 'leftKnee', 'leftFoot',
  'rightHip', 'rightKnee', 'rightFoot',
  'tieBase', 'tieMid', 'tieTip',
  'coatTailLeft', 'coatTailRight',
];

export function smoothstep(t: number): number {
  const c = t * t * (3 - 2 * t);
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** Linear blend of two poses expressed in the same (body-local) space. */
export function mixPose(a: StickFigurePose, b: StickFigurePose, t: number): StickFigurePose {
  const out = {} as StickFigurePose;
  for (const key of POSE_JOINTS) {
    const ja = a[key];
    const jb = b[key];
    out[key] = { x: ja.x + (jb.x - ja.x) * t, y: ja.y + (jb.y - ja.y) * t };
  }
  return out;
}

/** Offsets a body-local pose into world space around the character's root. */
export function translatePose(pose: StickFigurePose, dx: number, dy: number): StickFigurePose {
  if (dx === 0 && dy === 0) return pose;
  const out = {} as StickFigurePose;
  for (const key of POSE_JOINTS) {
    const j = pose[key];
    out[key] = { x: j.x + dx, y: j.y + dy };
  }
  return out;
}

/** Rotates every joint of a body-local pose about (cx, cy). */
export function rotatePose(
  pose: StickFigurePose,
  cx: number,
  cy: number,
  angle: number
): StickFigurePose {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const out = {} as StickFigurePose;
  for (const key of POSE_JOINTS) {
    const j = pose[key];
    const dx = j.x - cx;
    const dy = j.y - cy;
    out[key] = { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca };
  }
  return out;
}

/**
 * The martial-arts strike curve every attack rides, in four phases:
 *
 *   1. ANTICIPATION (0 → 0.26)  the limb coils BACK past neutral
 *   2. SNAP        (0.26 → 0.5) whips through full extension with a ~14% overshoot
 *   3. FOLLOW-THROUGH (0.5 → 0.68) settles back to a held extension
 *   4. RECOVERY    (0.68 → 1) eases home so the pose is at neutral exactly when
 *                              the attack state ends and cross-fades to guard
 *
 * The peak lands mid-action, inside every combat strike window (0.08–0.42s),
 * so the on-screen extension and the actual hit still read as one event.
 * Shared with EnemyController so player and enemy strikes snap identically.
 */
export function strikeCurve(timer: number, duration: number): number {
  if (duration <= 0 || timer <= 0 || timer >= duration) return 0;
  const t = timer / duration;
  const coil = 0.3; // how far the limb pulls back before the whip
  const peak = 1.14; // slight overshoot past full extension
  const hold = 0.96; // follow-through settle point
  const a = 0.26;
  const b = 0.5;
  const c = 0.68;

  if (t < a) {
    const u = t / a;
    return -coil * (1 - (1 - u) * (1 - u));
  }
  if (t < b) {
    const u = (t - a) / (b - a);
    return -coil + (peak + coil) * smoothstep(u);
  }
  if (t < c) {
    const u = (t - b) / (c - b);
    return peak + (hold - peak) * u;
  }
  const u = (t - c) / (1 - c);
  const eased = 1 - (1 - u) * (1 - u);
  return hold * (1 - eased);
}


export class AnimationController {
  private runPhase = 0;
  private breathPhase = 0;
  private actionTimer = 0;
  /** Slow secondary phase driving idle weight shifts & head glances */
  private stancePhase = 0;
  private hurtSeed = Math.random() * Math.PI * 2;

  // ---- State-change cross-fade -------------------------------------------------
  // Poses are generated in body-local space (root at 0,0) so a transition can be
  // eased from exactly what was on screen last frame. Blending in world space
  // instead would drag the fighter behind its own position.
  /** Final blended local pose emitted last frame — the blend source. */
  private lastLocal: StickFigurePose | null = null;
  /** Pose the in-flight cross-fade started from. */
  private blendFrom: StickFigurePose | null = null;
  private blendElapsed = 0;
  private blendDuration = 0;
  private prevState: AnimationState | null = null;
  private prevFacingRight: boolean | null = null;

  /**
   * Ground covered by one full gait cycle. The cycle is phased by distance
   * travelled rather than by raw time, so the planted foot stays locked to the
   * floor at any speed, any frame rate — no skating, no strobing.
   */
  private static readonly RUN_STRIDE = 112;
  private static readonly WALK_STRIDE = 68;
  /** Neutral split stance a gait opens on, so stride one never starts crossed. */
  private static readonly GAIT_START_PHASE = 0.55;

  /**
   * Footwork cue for the current frame: a small weight-shift envelope fired on
   * a gait change so the body *steps into* and *brakes out of* movement instead
   * of gliding. Kinds: START (push off), STOP (plant and settle), PIVOT (shuffle
   * through a turn). Decays to 0 by itself — nothing to clear.
   */
  private stepKind: 'START' | 'STOP' | 'PIVOT' | null = null;
  private stepTimer = 0;
  private stepEnvelope = 0;
  private static readonly STEP_START = 0.26;
  private static readonly STEP_STOP = 0.32;
  private static readonly STEP_PIVOT = 0.2;

  /**
   * Generates a StickFigurePose based on current animation state, movement, facing, and time
   */
  public generatePose(
    state: AnimationState,
    stateTimer: number,
    vx: number,
    vy: number,
    facingRight: boolean,
    dt: number,
    baseX: number,
    baseY: number,
    grounded: boolean = true
  ): StickFigurePose {
    const facingSign = facingRight ? 1 : -1;
    this.breathPhase += dt * 3.5;
    this.stancePhase += dt * 1.15;

    const speed = Math.abs(vx);
    const wasGaiting = this.prevState === 'RUN' || this.prevState === 'WALK';
    const isGaiting = state === 'RUN' || state === 'WALK';
    if (isGaiting) {
      const stride = state === 'WALK' ? AnimationController.WALK_STRIDE : AnimationController.RUN_STRIDE;
      if (!wasGaiting) this.runPhase = AnimationController.GAIT_START_PHASE;
      this.runPhase += ((Math.PI * 2) / stride) * speed * dt;
    }

    // ---- cross-fade bookkeeping (state change or a facing pivot) ----
    const transitioned =
      this.prevState !== state || this.prevFacingRight !== facingRight;
    if (transitioned) {
      // Footwork cue tied to the same transition: launch, brake, or shuffle.
      if (isGaiting && !wasGaiting) {
        this.stepKind = 'START';
        this.stepTimer = 0;
      } else if (wasGaiting && !isGaiting && state === 'IDLE') {
        this.stepKind = 'STOP';
        this.stepTimer = 0;
      } else if (isGaiting && this.prevFacingRight !== facingRight) {
        this.stepKind = 'PIVOT';
        this.stepTimer = 0;
      } else if (state === 'IDLE' && this.prevFacingRight !== facingRight) {
        // Standing turn: a small shuffle so the feet plant around the turn
        // instead of the stance mirroring in place.
        this.stepKind = 'PIVOT';
        this.stepTimer = 0;
      }
    }
    const stepDuration =
      this.stepKind === 'START' ? AnimationController.STEP_START :
      this.stepKind === 'STOP' ? AnimationController.STEP_STOP :
      this.stepKind === 'PIVOT' ? AnimationController.STEP_PIVOT : 0;
    if (stepDuration > 0) {
      this.stepTimer += dt;
      const done = this.stepTimer >= stepDuration;
      this.stepEnvelope = done
        ? 0
        : Math.sin((this.stepTimer / stepDuration) * Math.PI);
      // Only retire the cue once it has actually run out — a paused frame
      // (dt = 0) reads sin(0) = 0 but must not cancel an in-flight step.
      if (done) this.stepKind = null;
    } else {
      this.stepEnvelope = 0;
    }

    const groundY = 0;
    const target = this.buildPose(state, stateTimer, vx, vy, facingSign, groundY, grounded);
    const stepped = this.applyFootwork(target, facingSign, state);

    if (transitioned && this.lastLocal) {
      const wanted = this.blendTimeFor(state);
      this.blendFrom = this.lastLocal;
      // Don't restart an in-flight fade: retargeting mid-fade keeps the limbs
      // easing instead of stuttering when two states trade blows frame to frame.
      if (this.blendElapsed >= this.blendDuration) {
        this.blendElapsed = 0;
        this.blendDuration = wanted;
      } else {
        // Guarantee the new target still gets its full window, otherwise a fast
        // strike arriving mid-locomotion-fade would snap to its end pose.
        this.blendDuration = Math.max(this.blendDuration, this.blendElapsed + wanted);
      }
    }
    this.prevState = state;
    this.prevFacingRight = facingRight;

    let local = stepped;
    if (this.blendFrom && this.blendElapsed < this.blendDuration) {
      this.blendElapsed += dt;
      const t = Math.min(1, this.blendElapsed / this.blendDuration);
      local = mixPose(this.blendFrom, stepped, smoothstep(t));
      if (t >= 1) this.blendFrom = null;
    } else {
      this.blendFrom = null;
    }

    this.lastLocal = local;
    return translatePose(local, baseX, baseY);
  }

  /**
   * Applies the footwork envelope: small start/stop/pivot weight shifts on top
   * of the authored stance. Only locomotion poses take it — a strike's
   * anticipation is its own footwork.
   */
  private applyFootwork(pose: StickFigurePose, f: number, state: AnimationState): StickFigurePose {
    const s = this.stepEnvelope;
    if (s <= 0 || (state !== 'IDLE' && state !== 'WALK' && state !== 'RUN')) return pose;

    const kind = this.stepKind;
    // Reach: front foot pushes out, back foot braces — START most, PIVOT least.
    const reach = kind === 'START' ? 5 : kind === 'STOP' ? 4.5 : 3;
    // Dip: knees absorb on every cue, hardest on the pivot shuffle.
    const dip = kind === 'START' ? 2.4 : kind === 'STOP' ? 3.4 : 4;
    // Lean: forward driving out of a start, back braking into a stop.
    const lean = kind === 'START' ? 5 : kind === 'STOP' ? -3.5 : 0;

    const out = {} as StickFigurePose;
    for (const key of POSE_JOINTS) out[key] = { x: pose[key].x, y: pose[key].y };

    out.hips.y += dip * s;
    out.neck.x += f * lean * s;
    out.torso.x += f * lean * 0.6 * s;
    out.head.x += f * lean * 0.4 * s;

    if (state === 'IDLE') {
      // Standing: widen the stance through the cue (front forward, back back).
      out.rightFoot.x += f * reach * s;
      out.leftFoot.x -= f * reach * 0.8 * s;
      out.rightKnee.x += f * reach * 0.35 * s;
      out.leftKnee.x -= f * reach * 0.3 * s;
    } else {
      // Gaiting: the cycle owns the feet, so the cue only rides the hips down.
      out.torso.y += dip * 0.5 * s;
    }
    return out;
  }

  /** Fade length per target state: strikes stay snappy, locomotion eases. */
  private blendTimeFor(state: AnimationState): number {
    if (state.startsWith('ATTACK_')) return 0.055;
    switch (state) {
      case 'HURT':
      case 'KNOCKBACK':
      case 'DODGE_ROLL':
      case 'SLIDE':
        return 0.075;
      case 'JUMP_ASCENT':
      case 'FALL':
      case 'LAND':
        return 0.09;
      default:
        return 0.12;
    }
  }

  /** Routes a state to its procedural pose, always authored around (0, 0). */
  private buildPose(
    state: AnimationState,
    stateTimer: number,
    vx: number,
    vy: number,
    facingSign: number,
    groundY: number,
    grounded: boolean
  ): StickFigurePose {
    const speed = Math.abs(vx);

    switch (state) {
      case 'RUN':
        return this.createRunPose(0, groundY, facingSign, this.runPhase, speed);

      case 'WALK':
        return this.createWalkPose(0, groundY, facingSign, this.runPhase, speed);

      case 'HURT':
        return this.createHurtPose(0, groundY, facingSign, stateTimer, grounded);

      case 'KNOCKBACK':
        return this.createKnockbackPose(0, groundY, facingSign, vy);

      case 'SLIDE':
        return this.createSlidePose(0, groundY, facingSign, stateTimer);

      case 'DODGE_ROLL':
        return this.createRollPose(0, groundY, facingSign, stateTimer);

      case 'JUMP_ASCENT':
        return this.createJumpAscentPose(0, groundY, facingSign, vy);

      case 'FALL':
        return this.createFallPose(0, groundY, facingSign, vy);

      case 'LAND':
        return this.createLandPose(0, groundY, facingSign, stateTimer);

      case 'BLOCK':
        return this.createBlockPose(0, groundY, facingSign);

      case 'CROUCH':
        return this.createCrouchPose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_LIGHT_1':
        return this.createPunch1Pose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_LIGHT_2':
        return this.createPunch2Pose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_LIGHT_3':
        // Punch-chain finisher reads as a spinning back kick (heavy kick SFX,
        // knock-down arc) — distinct from the KICK button's roundhouse.
        return this.createSpinBackKickPose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_KICK':
        return this.createKickPose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_SWEEP':
        return this.createSweepPose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_FLYING_KICK':
        return this.createFlyingKickPose(0, groundY, facingSign, stateTimer);

      // OWNER 2026-10-03 — joystick jump/crouch kit
      case 'ATTACK_AIR_LIGHT':
        return this.createAirLightPose(0, groundY, facingSign, stateTimer, vy);
      case 'ATTACK_AIR_HEAVY':
        return this.createAirHeavyPose(0, groundY, facingSign, stateTimer, vy);
      case 'ATTACK_CROUCH_POKE':
        return this.createCrouchPokePose(0, groundY, facingSign, stateTimer);
      case 'ATTACK_LAUNCHER':
        return this.createLauncherPose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_HEAVY':
        return this.createHeavyStrikePose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_GUN_SHOT':
        return this.createGunShotPose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_SPECIAL':
        // SPIN_SLASH: one grounded 360° whirl with the blade arm swept out.
        return this.createSpinSlashPose(0, groundY, facingSign, stateTimer);

      case 'ATTACK_SUPER':
        // EXECUTIONER: deep overhead wind-up → knee/elbow slam → settle.
        return this.createExecutionerPose(0, groundY, facingSign, stateTimer);

      case 'IDLE':
      default:
        return this.createIdlePose(0, groundY, facingSign, this.breathPhase);
    }
  }

  // --- PROCEDURAL POSES ---

  private createIdlePose(x: number, y: number, f: number, phase: number): StickFigurePose {
    const breathe = Math.sin(phase) * 1.5;
    // Slow weight transfer + micro head glance so the guard never reads static
    const shift = Math.sin(this.stancePhase) * 2.4;
    const glance = Math.sin(this.stancePhase * 0.63) * 1.8;
    const roll = Math.sin(phase * 0.5) * 1.1;
    const hipY = y - 48 + breathe * 0.5;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    const hipX = x + shift * 0.5;
    const torsoX = x - f * 2 + shift * 0.3;
    const neckX = x - f * 1 + shift * 0.15;
    const headX = neckX + f * 1 + glance;

    // Relaxed martial guard
    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Left arm (lead guard)
      leftShoulder: { x: neckX - f * 6, y: neckY + 2 + roll },
      leftElbow: { x: neckX + f * 10, y: neckY + 12 },
      leftHand: { x: neckX + f * 14, y: neckY + 2 + breathe },
      // Right arm (rear guard)
      rightShoulder: { x: neckX + f * 6, y: neckY + 2 - roll },
      rightElbow: { x: neckX + f * 6, y: neckY + 14 },
      rightHand: { x: neckX + f * 18, y: neckY + 8 },
      // Left leg (back foot stays planted while the hips shift)
      leftHip: { x: hipX - f * 5, y: hipY },
      leftKnee: { x: hipX - f * 12, y: hipY + 24 },
      leftFoot: { x: x - f * 14, y: y },
      // Right leg (front foot slightly forward)
      rightHip: { x: hipX + f * 5, y: hipY },
      rightKnee: { x: hipX + f * 8, y: hipY + 24 },
      rightFoot: { x: x + f * 12, y: y },
      // Tie & cloth anchors
      tieBase: { x: neckX, y: neckY + 3 },
      tieMid: { x: neckX, y: neckY + 14 },
      tieTip: { x: neckX + shift * 0.4, y: neckY + 24 },
      coatTailLeft: { x: hipX - f * 8, y: hipY + 14 },
      coatTailRight: { x: hipX + f * 8, y: hipY + 14 }
    };
  }

  private createRunPose(x: number, y: number, f: number, phase: number, speed: number): StickFigurePose {
    // Lean forward based on run speed
    const lean = f * 12;
    const bounce = Math.abs(Math.sin(phase)) * 5;

    const hipY = y - 48 + bounce;
    const hipX = x;
    const torsoX = hipX + lean * 0.6;
    const torsoY = hipY - 20;
    const neckX = hipX + lean;
    const neckY = torsoY - 14;
    const headX = neckX + f * 4;
    const headY = neckY - 14;

    // Running legs sine/cosine oscillation
    const sinCycle = Math.sin(phase);
    const cosCycle = Math.cos(phase);

    // Left leg
    const lFootX = hipX - sinCycle * 28;
    const lFootY = y - Math.max(0, cosCycle * 16);
    const lKneeX = (hipX + lFootX) * 0.5 - f * 5;
    const lKneeY = hipY + 22 - Math.max(0, cosCycle * 8);

    // Right leg (opposite phase)
    const rFootX = hipX + sinCycle * 28;
    const rFootY = y - Math.max(0, -cosCycle * 16);
    const rKneeX = (hipX + rFootX) * 0.5 + f * 5;
    const rKneeY = hipY + 22 - Math.max(0, -cosCycle * 8);

    // Arms swing counter to legs
    const armSwing = sinCycle * 22;

    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      leftShoulder: { x: neckX - f * 5, y: neckY + 2 },
      leftElbow: { x: neckX - f * 2 - armSwing * 0.6, y: neckY + 12 },
      leftHand: { x: neckX - armSwing, y: neckY + 14 },
      rightShoulder: { x: neckX + f * 5, y: neckY + 2 },
      rightElbow: { x: neckX + f * 2 + armSwing * 0.6, y: neckY + 12 },
      rightHand: { x: neckX + armSwing, y: neckY + 14 },
      leftHip: { x: hipX - f * 4, y: hipY },
      leftKnee: { x: lKneeX, y: lKneeY },
      leftFoot: { x: lFootX, y: lFootY },
      rightHip: { x: hipX + f * 4, y: hipY },
      rightKnee: { x: rKneeX, y: rKneeY },
      rightFoot: { x: rFootX, y: rFootY },
      tieBase: { x: neckX, y: neckY + 3 },
      tieMid: { x: neckX - f * 8, y: neckY + 12 },
      tieTip: { x: neckX - f * 16, y: neckY + 20 },
      coatTailLeft: { x: hipX - f * 14, y: hipY + 18 },
      coatTailRight: { x: hipX - f * 12, y: hipY + 18 }
    };
  }

  private createSlidePose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Low aerodynamic slide posture
    const hipY = y - 18;
    const hipX = x;
    const torsoX = hipX - f * 18;
    const torsoY = hipY - 6;
    const neckX = torsoX - f * 12;
    const neckY = torsoY - 6;
    const headX = neckX - f * 8;
    const headY = neckY - 8;

    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Support hand planted on ground
      leftShoulder: { x: neckX, y: neckY },
      leftElbow: { x: neckX - f * 8, y: y - 10 },
      leftHand: { x: neckX - f * 14, y: y - 2 },
      // Leading guard arm
      rightShoulder: { x: torsoX, y: torsoY },
      rightElbow: { x: torsoX + f * 14, y: torsoY - 2 },
      rightHand: { x: torsoX + f * 24, y: torsoY },
      // Extended front sliding leg
      rightHip: { x: hipX, y: hipY },
      rightKnee: { x: hipX + f * 24, y: y - 8 },
      rightFoot: { x: hipX + f * 44, y: y - 2 },
      // Folded back leg tucked under
      leftHip: { x: hipX - f * 6, y: hipY },
      leftKnee: { x: hipX - f * 12, y: y - 6 },
      leftFoot: { x: hipX - f * 4, y: y - 2 },
      tieBase: { x: neckX, y: neckY + 2 },
      tieMid: { x: neckX - f * 14, y: neckY + 4 },
      tieTip: { x: neckX - f * 24, y: neckY + 6 },
      coatTailLeft: { x: hipX - f * 22, y: hipY + 4 },
      coatTailRight: { x: hipX - f * 26, y: hipY + 4 }
    };
  }

  private createRollPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Tumble roll: rotational interpolation based on progress (0 to 0.4s)
    const progress = Math.min(1, timer / 0.35);
    const angle = progress * Math.PI * 2 * f;

    const centerY = y - 24;
    const radius = 22;

    const rotPoint = (cx: number, cy: number, px: number, py: number) => {
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      return {
        x: cx + px * cosA - py * sinA,
        y: cy + px * sinA + py * cosA
      };
    };

    const head = rotPoint(x, centerY, 0, -radius);
    const neck = rotPoint(x, centerY, 0, -radius * 0.7);
    const torso = rotPoint(x, centerY, 0, 0);
    const hips = rotPoint(x, centerY, 0, radius * 0.7);

    return {
      head,
      neck,
      torso,
      hips,
      leftShoulder: rotPoint(x, centerY, -8, -radius * 0.6),
      leftElbow: rotPoint(x, centerY, -16, -4),
      leftHand: rotPoint(x, centerY, -12, 10),
      rightShoulder: rotPoint(x, centerY, 8, -radius * 0.6),
      rightElbow: rotPoint(x, centerY, 16, -4),
      rightHand: rotPoint(x, centerY, 12, 10),
      leftHip: rotPoint(x, centerY, -6, radius * 0.7),
      leftKnee: rotPoint(x, centerY, -14, radius * 0.5),
      leftFoot: rotPoint(x, centerY, -4, 0),
      rightHip: rotPoint(x, centerY, 6, radius * 0.7),
      rightKnee: rotPoint(x, centerY, 14, radius * 0.5),
      rightFoot: rotPoint(x, centerY, 4, 0),
      tieBase: neck,
      tieMid: torso,
      tieTip: hips,
      coatTailLeft: hips,
      coatTailRight: hips
    };
  }

  private createJumpAscentPose(x: number, y: number, f: number, vy: number): StickFigurePose {
    const hipY = y - 56;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    return {
      head: { x: x + f * 4, y: headY },
      neck: { x: x + f * 2, y: neckY },
      torso: { x: x, y: torsoY },
      hips: { x: x, y: hipY },
      // Dynamic jumping arms
      leftShoulder: { x: x - f * 6, y: neckY + 2 },
      leftElbow: { x: x - f * 12, y: neckY - 10 },
      leftHand: { x: x - f * 16, y: neckY - 20 },
      rightShoulder: { x: x + f * 6, y: neckY + 2 },
      rightElbow: { x: x + f * 14, y: neckY - 8 },
      rightHand: { x: x + f * 20, y: neckY - 18 },
      // Legs tucked upward
      leftHip: { x: x - f * 5, y: hipY },
      leftKnee: { x: x - f * 12, y: hipY + 14 },
      leftFoot: { x: x - f * 8, y: hipY + 32 },
      rightHip: { x: x + f * 5, y: hipY },
      rightKnee: { x: x + f * 12, y: hipY + 12 },
      rightFoot: { x: x + f * 10, y: hipY + 28 },
      tieBase: { x: x + f * 2, y: neckY + 2 },
      tieMid: { x: x - f * 6, y: neckY + 12 },
      tieTip: { x: x - f * 10, y: neckY + 20 },
      coatTailLeft: { x: x - f * 12, y: hipY + 12 },
      coatTailRight: { x: x - f * 8, y: hipY + 12 }
    };
  }

  private createFallPose(x: number, y: number, f: number, vy: number): StickFigurePose {
    const hipY = y - 54;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    return {
      head: { x: x + f * 2, y: headY },
      neck: { x: x, y: neckY },
      torso: { x: x, y: torsoY },
      hips: { x: x, y: hipY },
      // Arms flared outward for air balance
      leftShoulder: { x: x - f * 8, y: neckY },
      leftElbow: { x: x - f * 18, y: neckY + 4 },
      leftHand: { x: x - f * 24, y: neckY - 6 },
      rightShoulder: { x: x + f * 8, y: neckY },
      rightElbow: { x: x + f * 18, y: neckY + 4 },
      rightHand: { x: x + f * 24, y: neckY - 6 },
      // Trailing legs ready for landing
      leftHip: { x: x - f * 5, y: hipY },
      leftKnee: { x: x - f * 8, y: hipY + 22 },
      leftFoot: { x: x - f * 6, y: hipY + 44 },
      rightHip: { x: x + f * 5, y: hipY },
      rightKnee: { x: x + f * 8, y: hipY + 20 },
      rightFoot: { x: x + f * 10, y: hipY + 42 },
      tieBase: { x: x, y: neckY + 2 },
      tieMid: { x: x - f * 4, y: neckY + 12 },
      tieTip: { x: x - f * 8, y: neckY + 22 },
      coatTailLeft: { x: x - f * 10, y: hipY + 14 },
      coatTailRight: { x: x + f * 4, y: hipY + 14 }
    };
  }

  private createLandPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Deep knee compression impact absorption
    const compression = Math.max(0, 1 - timer / 0.15) * 14;
    const hipY = y - 36 + compression;
    const torsoY = hipY - 18;
    const neckY = torsoY - 12;
    const headY = neckY - 12;

    return {
      head: { x: x + f * 6, y: headY },
      neck: { x: x + f * 4, y: neckY },
      torso: { x: x + f * 2, y: torsoY },
      hips: { x: x, y: hipY },
      leftShoulder: { x: x - f * 6, y: neckY },
      leftElbow: { x: x - f * 12, y: neckY + 14 },
      leftHand: { x: x - f * 10, y: y - 4 },
      rightShoulder: { x: x + f * 6, y: neckY },
      rightElbow: { x: x + f * 14, y: neckY + 14 },
      rightHand: { x: x + f * 18, y: y - 2 },
      leftHip: { x: x - f * 8, y: hipY },
      leftKnee: { x: x - f * 16, y: y - 10 },
      leftFoot: { x: x - f * 18, y: y },
      rightHip: { x: x + f * 8, y: hipY },
      rightKnee: { x: x + f * 18, y: y - 12 },
      rightFoot: { x: x + f * 14, y: y },
      tieBase: { x: x + f * 4, y: neckY + 2 },
      tieMid: { x: x + f * 2, y: neckY + 10 },
      tieTip: { x: x, y: neckY + 16 },
      coatTailLeft: { x: x - f * 12, y: hipY + 10 },
      coatTailRight: { x: x + f * 10, y: hipY + 10 }
    };
  }

  private createBlockPose(x: number, y: number, f: number): StickFigurePose {
    const hipY = y - 46;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    // Cross arm guard covering vitals
    return {
      head: { x: x - f * 4, y: headY },
      neck: { x: x - f * 2, y: neckY },
      torso: { x: x - f * 3, y: torsoY },
      hips: { x: x, y: hipY },
      // Crossed forearms guarding head
      leftShoulder: { x: x - f * 4, y: neckY + 2 },
      leftElbow: { x: x + f * 8, y: neckY + 10 },
      leftHand: { x: x + f * 12, y: neckY - 4 },
      rightShoulder: { x: x + f * 4, y: neckY + 2 },
      rightElbow: { x: x + f * 10, y: neckY + 12 },
      rightHand: { x: x + f * 14, y: neckY },
      // Solid braced stance
      leftHip: { x: x - f * 6, y: hipY },
      leftKnee: { x: x - f * 16, y: hipY + 24 },
      leftFoot: { x: x - f * 18, y: y },
      rightHip: { x: x + f * 6, y: hipY },
      rightKnee: { x: x + f * 10, y: hipY + 24 },
      rightFoot: { x: x + f * 12, y: y },
      tieBase: { x: x - f * 2, y: neckY + 2 },
      tieMid: { x: x - f * 2, y: neckY + 12 },
      tieTip: { x: x - f * 2, y: neckY + 20 },
      coatTailLeft: { x: x - f * 10, y: hipY + 12 },
      coatTailRight: { x: x + f * 6, y: hipY + 12 }
    };
  }

  private createPunch1Pose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Fast straight lead jab
    const extend = strikeCurve(timer, 0.20);
    const hipY = y - 48;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    // Hip rotation + weight transfer: the jab is pushed off the back foot and
    // the lead shoulder arrives with the fist, so the whole body backs it.
    const drive = Math.max(0, extend);

    return {
      head: { x: x + f * (4 + drive * 2), y: headY },
      neck: { x: x + f * (2 + drive * 2), y: neckY },
      torso: { x: x + f * (2 + drive * 3), y: torsoY },
      hips: { x: x + f * (drive * 4), y: hipY },
      // Left arm punches forward with full extension
      leftShoulder: { x: x - f * 4, y: neckY + 2 },
      leftElbow: { x: x + f * (12 + extend * 16), y: neckY + 2 },
      leftHand: { x: x + f * (24 + extend * 28), y: neckY + 2 },
      // Right arm guards jaw
      rightShoulder: { x: x + f * 4, y: neckY + 2 },
      rightElbow: { x: x + f * 6, y: neckY + 12 },
      rightHand: { x: x + f * 10, y: neckY + 4 },
      leftHip: { x: x - f * 6, y: hipY },
      leftKnee: { x: x - f * 12, y: hipY + 24 },
      leftFoot: { x: x - f * (16 + drive * 3), y: y },
      rightHip: { x: x + f * 6, y: hipY },
      rightKnee: { x: x + f * 12, y: hipY + 22 },
      rightFoot: { x: x + f * (16 + drive * 4), y: y },
      tieBase: { x: x + f * 2, y: neckY + 2 },
      tieMid: { x: x, y: neckY + 12 },
      tieTip: { x: x - f * 4, y: neckY + 20 },
      coatTailLeft: { x: x - f * 12, y: hipY + 14 },
      coatTailRight: { x: x + f * 6, y: hipY + 14 }
    };
  }

  private createPunch2Pose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Powerful rear cross punch with torso rotation
    const extend = strikeCurve(timer, 0.22);
    const hipY = y - 48;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    // Rear-side rotation: hips fire first, torso follows, the shoulder and
    // fist arrive last — and the stance foot pivots so the hip can clear.
    const drive = Math.max(0, extend);

    return {
      head: { x: x + f * (8 + drive * 3), y: headY },
      neck: { x: x + f * (6 + drive * 3), y: neckY },
      torso: { x: x + f * (4 + drive * 5), y: torsoY },
      hips: { x: x + f * (2 + drive * 7), y: hipY },
      // Left arm guards
      leftShoulder: { x: x - f * 2, y: neckY + 2 },
      leftElbow: { x: x + f * 4, y: neckY + 12 },
      leftHand: { x: x + f * 10, y: neckY + 6 },
      // Right arm drives through with cross
      rightShoulder: { x: x + f * 8, y: neckY + 2 },
      rightElbow: { x: x + f * (16 + extend * 16), y: neckY + 4 },
      rightHand: { x: x + f * (30 + extend * 28), y: neckY + 4 },
      leftHip: { x: x - f * 4, y: hipY },
      leftKnee: { x: x - f * 10, y: hipY + 24 },
      leftFoot: { x: x - f * (14 + drive * 4), y: y },
      rightHip: { x: x + f * 8, y: hipY },
      rightKnee: { x: x + f * 16, y: hipY + 22 },
      rightFoot: { x: x + f * (22 + drive * 5), y: y },
      tieBase: { x: x + f * 6, y: neckY + 2 },
      tieMid: { x: x + f * 2, y: neckY + 12 },
      tieTip: { x: x - f * 2, y: neckY + 20 },
      coatTailLeft: { x: x - f * 10, y: hipY + 14 },
      coatTailRight: { x: x + f * 10, y: hipY + 14 }
    };
  }

  private createKickPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Dynamic high roundhouse: the hips drive THROUGH the target while the
    // shoulders counter-rotate, the support foot pivots on the ball and the
    // lead arm swings down for balance — classic hip-over-knee mechanics.
    const extend = strikeCurve(timer, 0.34);
    const drive = Math.max(0, extend);
    const hipY = y - 50 - drive * 2;
    const torsoY = hipY - 18;
    const neckY = torsoY - 12;
    const headY = neckY - 12;

    return {
      // Head leans away from the kick as the hip comes through
      head: { x: x - f * (6 + drive * 5), y: headY },
      neck: { x: x - f * (4 + drive * 4), y: neckY },
      torso: { x: x - f * (2 + drive * 5), y: torsoY },
      hips: { x: x + f * (drive * 7), y: hipY },
      // Lead arm swings down/back as a counterweight, rear arm stays tight
      leftShoulder: { x: x - f * (4 + drive * 6), y: neckY + 2 },
      leftElbow: { x: x - f * (12 + drive * 14), y: neckY + 12 + drive * 8 },
      leftHand: { x: x - f * (14 + drive * 20), y: neckY + 4 + drive * 14 },
      rightShoulder: { x: x + f * 2, y: neckY + 2 },
      rightElbow: { x: x + f * (10 + drive * 4), y: neckY + 8 },
      rightHand: { x: x + f * (16 + drive * 6), y: neckY + 14 - drive * 4 },
      // Support leg pivots on the ball of the foot, heel lifting through the whip
      leftHip: { x: x - f * (4 + drive * 3), y: hipY },
      leftKnee: { x: x - f * (2 + drive * 3), y: hipY + 24 },
      leftFoot: { x: x - f * (2 + drive * 5), y: y - drive * 3 },
      // High horizontal whip kick: knee and foot rise through the arc
      rightHip: { x: x + f * (4 + drive * 6), y: hipY },
      rightKnee: { x: x + f * (18 + extend * 12), y: hipY - 6 - drive * 6 },
      rightFoot: { x: x + f * (34 + extend * 24), y: hipY - 14 - drive * 8 },
      tieBase: { x: x - f * 4, y: neckY + 2 },
      tieMid: { x: x - f * 12, y: neckY + 10 },
      tieTip: { x: x - f * 20, y: neckY + 16 },
      coatTailLeft: { x: x - f * 14, y: hipY + 12 },
      coatTailRight: { x: x - f * 8, y: hipY + 14 }
    };
  }

  /**
   * LEG SWEEP (PUNCH, PUNCH, KICK ender): crouched support hand on the floor
   * with the lead leg scything through the ankles.
   */
  private createSweepPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    const extend = strikeCurve(timer, 0.30);
    const hipY = y - 24;
    const torsoX = x - f * 8;
    const torsoY = hipY - 14;
    const neckX = torsoX - f * 6;
    const neckY = torsoY - 10;
    const headX = neckX - f * 4;
    const headY = neckY - 12;

    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: x, y: hipY },
      // Rear hand plants on the floor for balance
      leftShoulder: { x: torsoX - f * 2, y: neckY + 2 },
      leftElbow: { x: x - f * 16, y: y - 16 },
      leftHand: { x: x - f * 26, y: y - 2 },
      // Lead arm counterbalances behind the sweep
      rightShoulder: { x: torsoX + f * 2, y: neckY + 2 },
      rightElbow: { x: x - f * 4, y: neckY + 12 },
      rightHand: { x: x - f * 14, y: neckY + 20 },
      // Folded support leg under the crouch
      leftHip: { x: x - f * 4, y: hipY },
      leftKnee: { x: x - f * 16, y: y - 10 },
      leftFoot: { x: x - f * 8, y: y },
      // Scything front leg hooks the ankles at floor height
      rightHip: { x: x + f * 4, y: hipY },
      rightKnee: { x: x + f * (20 + extend * 16), y: y - 12 + extend * 4 },
      rightFoot: { x: x + f * (40 + extend * 24), y: y - 2 },
      tieBase: { x: neckX, y: neckY + 2 },
      tieMid: { x: neckX - f * 14, y: neckY + 8 },
      tieTip: { x: neckX - f * 26, y: neckY + 12 },
      coatTailLeft: { x: x - f * 18, y: hipY + 6 },
      coatTailRight: { x: x - f * 24, y: hipY + 8 }
    };
  }

  /**
   * JOYSTICK CROUCH (owner 2026-10-03): held while the movement stick is
   * pushed DOWN. Weight drops onto folded legs, torso packs down between the
   * knees and the guard stays up — a small, readable silhouette so a high
   * strike visibly passes over the head.
   */
  private createCrouchPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    const breathe = Math.sin(this.breathPhase) * 1.1;
    const hipY = y - 26 + breathe * 0.5;
    const torsoY = hipY - 16;
    const neckY = torsoY - 12;
    const headY = neckY - 13;

    return {
      head: { x: x + f * 3, y: headY },
      neck: { x: x + f * 1, y: neckY },
      torso: { x: x - f * 2, y: torsoY },
      hips: { x: x, y: hipY },
      // Guard stays high — the point of the crouch is that arms still defend
      leftShoulder: { x: x - f * 5, y: neckY + 2 },
      leftElbow: { x: x + f * 6, y: neckY + 8 },
      leftHand: { x: x + f * 12, y: neckY - 4 },
      rightShoulder: { x: x + f * 5, y: neckY + 2 },
      rightElbow: { x: x + f * 11, y: neckY + 10 },
      rightHand: { x: x + f * 15, y: neckY + 1 },
      // Deep knee fold, feet planted wide for a stable base
      leftHip: { x: x - f * 7, y: hipY },
      leftKnee: { x: x - f * 17, y: y - 14 },
      leftFoot: { x: x - f * 20, y: y },
      rightHip: { x: x + f * 7, y: hipY },
      rightKnee: { x: x + f * 16, y: y - 16 },
      rightFoot: { x: x + f * 15, y: y },
      tieBase: { x: x + f * 1, y: neckY + 2 },
      tieMid: { x: x - f * 5, y: neckY + 10 },
      tieTip: { x: x - f * 9, y: neckY + 18 },
      coatTailLeft: { x: x - f * 14, y: hipY + 8 },
      coatTailRight: { x: x + f * 10, y: hipY + 8 },
    };
  }

  /**
   * AIR LIGHT (owner 2026-10-03): fast airborne poke — lead hand snaps out on
   * a straight line while the legs stay tucked, so it reads as a quick jab
   * thrown off a jump rather than a ground punch played in the air.
   */
  private createAirLightPose(
    x: number, y: number, f: number, timer: number, vy: number
  ): StickFigurePose {
    const extend = strikeCurve(timer, 0.22);
    const hipY = y - 56;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    return {
      head: { x: x + f * (5 + extend * 2), y: headY },
      neck: { x: x + f * 3, y: neckY },
      torso: { x: x + f * 2, y: torsoY },
      hips: { x: x, y: hipY },
      leftShoulder: { x: x - f * 5, y: neckY + 2 },
      leftElbow: { x: x + f * (10 + extend * 14), y: neckY },
      leftHand: { x: x + f * (22 + extend * 30), y: neckY - 2 },
      rightShoulder: { x: x + f * 5, y: neckY + 2 },
      rightElbow: { x: x + f * 8, y: neckY + 12 },
      rightHand: { x: x + f * 12, y: neckY + 2 },
      leftHip: { x: x - f * 5, y: hipY },
      leftKnee: { x: x - f * 13, y: hipY + 14 },
      leftFoot: { x: x - f * 9, y: hipY + 32 },
      rightHip: { x: x + f * 5, y: hipY },
      rightKnee: { x: x + f * 13, y: hipY + 12 },
      rightFoot: { x: x + f * 12, y: hipY + 30 },
      tieBase: { x: x + f * 2, y: neckY + 2 },
      tieMid: { x: x - f * 7, y: neckY + 13 },
      tieTip: { x: x - f * 13, y: neckY + 24 },
      coatTailLeft: { x: x - f * 12, y: hipY + 14 },
      coatTailRight: { x: x - f * 6, y: hipY + 14 },
    };
  }

  /**
   * AIR HEAVY (owner 2026-10-03): overhead slam. Both arms load above the
   * head on the way up, then drive straight down through the target while the
   * body stacks vertically — the pose holds the loaded frame until the floor
   * arrives so the commitment reads (Shadow Fight weight).
   */
  private createAirHeavyPose(
    x: number, y: number, f: number, timer: number, vy: number
  ): StickFigurePose {
    // Load (arms up) for the first 0.16s, then hammer down and hold.
    const load = 1 - clamp(timer / 0.16, 0, 1);
    const drive = clamp((timer - 0.16) / 0.14, 0, 1);
    const hipY = y - 58;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;
    const armY = neckY - 18 - load * 26 + drive * 34;

    return {
      head: { x: x + f * 2, y: headY },
      neck: { x: x, y: neckY },
      torso: { x: x - f * 2 + drive * 3, y: torsoY },
      hips: { x: x, y: hipY },
      leftShoulder: { x: x - f * 7, y: neckY + 2 },
      leftElbow: { x: x - f * (6 + load * 4), y: armY + 6 },
      leftHand: { x: x + f * (4 + drive * 12), y: armY },
      rightShoulder: { x: x + f * 7, y: neckY + 2 },
      rightElbow: { x: x + f * (8 + load * 6), y: armY + 8 },
      rightHand: { x: x + f * (14 + drive * 16), y: armY + 2 },
      leftHip: { x: x - f * 5, y: hipY },
      leftKnee: { x: x - f * 10, y: hipY + 20 },
      leftFoot: { x: x - f * 6, y: hipY + 40 },
      rightHip: { x: x + f * 5, y: hipY },
      rightKnee: { x: x + f * 11, y: hipY + 18 },
      rightFoot: { x: x + f * 14, y: hipY + 38 },
      tieBase: { x: x, y: neckY + 2 },
      tieMid: { x: x - f * 5, y: neckY + 13 },
      tieTip: { x: x - f * 9, y: neckY + 24 },
      coatTailLeft: { x: x - f * 11, y: hipY + 14 },
      coatTailRight: { x: x - f * 3, y: hipY + 14 },
    };
  }

  /**
   * CROUCH POKE (owner 2026-10-03): fast, safe low strike thrown from the
   * crouch — hips stay folded, only the lead arm fires and it retracts inside
   * the window, which is why the recovery is so short.
   */
  private createCrouchPokePose(
    x: number, y: number, f: number, timer: number
  ): StickFigurePose {
    const extend = strikeCurve(timer, 0.16);
    const hipY = y - 26;
    const torsoY = hipY - 15;
    const neckY = torsoY - 12;
    const headY = neckY - 13;

    return {
      head: { x: x + f * (4 + extend * 2), y: headY },
      neck: { x: x + f * 2, y: neckY },
      torso: { x: x - f * 2 + f * extend * 4, y: torsoY },
      hips: { x: x, y: hipY },
      leftShoulder: { x: x - f * 5, y: neckY + 2 },
      leftElbow: { x: x + f * (8 + extend * 16), y: neckY + 4 },
      leftHand: { x: x + f * (20 + extend * 28), y: neckY + 4 },
      rightShoulder: { x: x + f * 5, y: neckY + 2 },
      rightElbow: { x: x + f * 10, y: neckY + 10 },
      rightHand: { x: x + f * 13, y: neckY + 1 },
      leftHip: { x: x - f * 7, y: hipY },
      leftKnee: { x: x - f * 17, y: y - 14 },
      leftFoot: { x: x - f * 20, y: y },
      rightHip: { x: x + f * 7, y: hipY },
      rightKnee: { x: x + f * 15, y: y - 16 },
      rightFoot: { x: x + f * 14, y: y },
      tieBase: { x: x + f * 2, y: neckY + 2 },
      tieMid: { x: x - f * 4, y: neckY + 10 },
      tieTip: { x: x - f * 8, y: neckY + 18 },
      coatTailLeft: { x: x - f * 13, y: hipY + 8 },
      coatTailRight: { x: x + f * 9, y: hipY + 8 },
    };
  }

  /**
   * LAUNCHER (owner 2026-10-03): crouch heavy — a rising uppercut that starts
   * fully folded and uncoils upward, the whole body extending through the
   * fist. The vertical drive is what the juggle reads off.
   */
  private createLauncherPose(
    x: number, y: number, f: number, timer: number
  ): StickFigurePose {
    const extend = strikeCurve(timer, 0.30);
    const rise = Math.max(0, extend);
    // Fold for the anticipation, then uncoil: hips lift, torso stacks tall.
    const hipY = y - 26 - rise * 22;
    const torsoY = hipY - 20 - rise * 6;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    return {
      head: { x: x + f * (3 - rise * 3), y: headY },
      neck: { x: x + f * 1, y: neckY },
      torso: { x: x - f * 2 + f * rise * 4, y: torsoY },
      hips: { x: x + f * rise * 4, y: hipY },
      // Rear hand drives the uppercut, lead arm pulls back as counterweight
      leftShoulder: { x: x - f * 6, y: neckY + 4 },
      leftElbow: { x: x - f * 12, y: neckY + 16 },
      leftHand: { x: x - f * 16, y: neckY + 8 },
      rightShoulder: { x: x + f * 6, y: neckY + 4 },
      rightElbow: { x: x + f * (10 + rise * 6), y: neckY + (10 - rise * 26) },
      rightHand: { x: x + f * (16 + rise * 14), y: neckY + (4 - rise * 44) },
      // Drive leg extends, trail heel lifts — the uncoil pushed off the floor
      leftHip: { x: x - f * 7, y: hipY },
      leftKnee: { x: x - f * (16 - rise * 6), y: y - 14 - rise * 4 },
      leftFoot: { x: x - f * (18 - rise * 4), y: y - rise * 8 },
      rightHip: { x: x + f * 7, y: hipY },
      rightKnee: { x: x + f * (14 + rise * 4), y: y - 16 - rise * 8 },
      rightFoot: { x: x + f * (13 + rise * 6), y: y - rise * 10 },
      tieBase: { x: x + f * 1, y: neckY + 2 },
      tieMid: { x: x - f * 5, y: neckY + 10 },
      tieTip: { x: x - f * 9, y: neckY + 19 },
      coatTailLeft: { x: x - f * 13, y: hipY + 8 },
      coatTailRight: { x: x + f * 9, y: hipY + 8 },
    };
  }

  /**
   * XIAO XIAO FLYING KICK: airborne, torso pitched forward, lead leg spearing
   * out while the rear leg trails down toward the floor.
   */
  private createFlyingKickPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    const extend = strikeCurve(timer, 0.40);
    const hipY = y - 52;
    const torsoX = x + f * 6;
    const torsoY = hipY - 16;
    const neckX = torsoX + f * 8;
    const neckY = torsoY - 12;
    const headX = neckX + f * 6;
    const headY = neckY - 12;

    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: x, y: hipY },
      // Arms flung wide for air balance
      leftShoulder: { x: torsoX - f * 6, y: neckY + 4 },
      leftElbow: { x: torsoX - f * 20, y: neckY + 8 },
      leftHand: { x: torsoX - f * 30, y: neckY + 2 },
      rightShoulder: { x: torsoX + f * 4, y: neckY + 4 },
      rightElbow: { x: torsoX + f * 16, y: neckY - 6 },
      rightHand: { x: torsoX + f * 26, y: neckY - 16 },
      // Trailing leg drags toward the floor
      leftHip: { x: x - f * 5, y: hipY },
      leftKnee: { x: x - f * 16, y: y - 26 },
      leftFoot: { x: x - f * 10, y: y - 6 },
      // Lead leg spearing straight out of the launch
      rightHip: { x: x + f * 5, y: hipY },
      rightKnee: { x: x + f * (24 + extend * 16), y: hipY - 6 },
      rightFoot: { x: x + f * (46 + extend * 26), y: hipY - 10 },
      tieBase: { x: neckX, y: neckY + 2 },
      tieMid: { x: neckX - f * 12, y: neckY + 12 },
      tieTip: { x: neckX - f * 26, y: neckY + 18 },
      coatTailLeft: { x: x - f * 22, y: hipY + 8 },
      coatTailRight: { x: x - f * 16, y: hipY + 12 }
    };
  }

  private createHeavyStrikePose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Devastating lunge elbow strike / palm thrust
    const extend = strikeCurve(timer, 0.32);
    const hipY = y - 44;
    const torsoY = hipY - 16;
    const neckY = torsoY - 12;
    const headY = neckY - 12;

    return {
      head: { x: x + f * 12, y: headY },
      neck: { x: x + f * 10, y: neckY },
      torso: { x: x + f * 8, y: torsoY },
      hips: { x: x + f * 4, y: hipY },
      // Lead arm drives heavy elbow forward
      leftShoulder: { x: x + f * 10, y: neckY },
      leftElbow: { x: x + f * (28 + extend * 22), y: neckY + 6 },
      leftHand: { x: x + f * (20 + extend * 16), y: neckY - 2 },
      rightShoulder: { x: x + f * 6, y: neckY + 2 },
      rightElbow: { x: x + f * 2, y: neckY + 14 },
      rightHand: { x: x + f * 8, y: neckY + 18 },
      leftHip: { x: x - f * 2, y: hipY },
      leftKnee: { x: x - f * 12, y: hipY + 22 },
      leftFoot: { x: x - f * 20, y: y },
      rightHip: { x: x + f * 8, y: hipY },
      rightKnee: { x: x + f * 20, y: hipY + 22 },
      rightFoot: { x: x + f * 26, y: y },
      tieBase: { x: x + f * 10, y: neckY + 2 },
      tieMid: { x: x + f * 4, y: neckY + 12 },
      tieTip: { x: x - f * 4, y: neckY + 22 },
      coatTailLeft: { x: x - f * 12, y: hipY + 12 },
      coatTailRight: { x: x + f * 4, y: hipY + 14 }
    };
  }

  /**
   * SPINNING BACK KICK — the punch-chain finisher (ATTACK_LIGHT_3).
   * The body coils away from the target, the rear heel chambers, then whips
   * through on the strike curve with the torso counter-rotating for balance.
   */
  private createSpinBackKickPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    const ext = strikeCurve(timer, 0.26);
    const drive = Math.max(0, ext);       // extension phase
    const chamber = Math.max(0, -ext);    // anticipation: knee tucked in

    const hipY = y - 47 - drive * 4;
    const torsoY = hipY - 19 + drive * 1;
    const neckY = torsoY - 13;
    const headY = neckY - 13;

    // Hips counter-rotate back as the heel drives out; the head stays locked on
    const hipX = x + f * (2 - drive * 5 + chamber * 3);
    const torsoX = x - f * (3 + drive * 7);
    const neckX = x - f * (5 + drive * 6);
    const headX = neckX + f * (10 + drive * 4);

    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Lead arm swings across for counterbalance, rear arm guards the jaw
      leftShoulder: { x: neckX - f * 6, y: neckY + 2 },
      leftElbow: { x: neckX - f * (12 + drive * 10), y: neckY + 10 },
      leftHand: { x: neckX - f * (16 + drive * 20), y: neckY + 4 + drive * 8 },
      rightShoulder: { x: neckX + f * 6, y: neckY + 2 },
      rightElbow: { x: neckX + f * 4, y: neckY + 12 },
      rightHand: { x: neckX + f * 12, y: neckY + 2 },
      // Support leg planted, knee soft, foot pivoting through the spin
      leftHip: { x: hipX - f * 5, y: hipY },
      leftKnee: { x: hipX - f * (11 + drive * 4), y: hipY + 24 },
      leftFoot: { x: x - f * (14 + drive * 6), y: y },
      // Striking leg: chambered under the hip, then heel whipped out and up
      rightHip: { x: hipX + f * 5, y: hipY },
      rightKnee: { x: x + f * (4 + ext * 20), y: hipY + 14 - drive * 24 - chamber * 4 },
      rightFoot: { x: x + f * (8 + ext * 42), y: hipY + 10 - drive * 26 - chamber * 2 },
      tieBase: { x: neckX, y: neckY + 2 },
      tieMid: { x: neckX - f * (2 + drive * 8), y: neckY + 11 },
      tieTip: { x: neckX - f * (4 + drive * 16), y: neckY + 19 },
      coatTailLeft: { x: hipX - f * (12 + drive * 8), y: hipY + 13 },
      coatTailRight: { x: hipX + f * (6 + drive * 4), y: hipY + 14 }
    };
  }

  /**
   * SPIN_SLASH special (ATTACK_SPECIAL): one grounded 360° whirl with the
   * blade arm swept wide, settling back into guard as the spin lands.
   */
  private createSpinSlashPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    const u = clamp(timer / 0.58, 0, 1);
    const spinPhase = Math.min(1, u / 0.64);
    const angle = smoothstep(spinPhase) * Math.PI * 2 * (f > 0 ? 1 : -1);
    // Rides up through the middle of the whirl, back down as it lands
    const lift = Math.sin(spinPhase * Math.PI) * 8;
    const flare = Math.sin(spinPhase * Math.PI); // arms sweep out through the spin

    const hipY = y - 48 - lift;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    const base: StickFigurePose = {
      head: { x: x + f * 3, y: headY },
      neck: { x: x + f * 1, y: neckY },
      torso: { x: x, y: torsoY },
      hips: { x: x, y: hipY },
      // Blade arm swept wide through the whirl, free arm tucked in close
      leftShoulder: { x: x - f * 6, y: neckY + 2 },
      leftElbow: { x: x - f * (10 + flare * 8), y: neckY + 10 },
      leftHand: { x: x - f * (12 + flare * 18), y: neckY + 6 },
      rightShoulder: { x: x + f * 6, y: neckY + 2 },
      rightElbow: { x: x + f * (14 + flare * 12), y: neckY },
      rightHand: { x: x + f * (18 + flare * 30), y: neckY - 4 },
      // Legs gathered under the spin, heels lifted off the floor
      leftHip: { x: x - f * 5, y: hipY },
      leftKnee: { x: x - f * 9, y: hipY + 20 },
      leftFoot: { x: x - f * 11, y: y - 4 - lift },
      rightHip: { x: x + f * 5, y: hipY },
      rightKnee: { x: x + f * 10, y: hipY + 20 },
      rightFoot: { x: x + f * 13, y: y - 4 - lift },
      tieBase: { x: x + f * 1, y: neckY + 2 },
      tieMid: { x: x - f * (4 + flare * 8), y: neckY + 12 },
      tieTip: { x: x - f * (7 + flare * 16), y: neckY + 20 },
      coatTailLeft: { x: x - f * (10 + flare * 10), y: hipY + 14 },
      coatTailRight: { x: x + f * (8 + flare * 10), y: hipY + 14 }
    };

    return rotatePose(base, x, hipY, angle);
  }

  /**
   * EXECUTIONER super (ATTACK_SUPER): a 0.95s three-beat special —
   * deep overhead wind-up → knee-and-elbow slam on the strike curve →
   * slow settle back into guard.
   */
  private createExecutionerPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    const wind = smoothstep(clamp(timer / 0.36, 0, 1));
    const slam = timer > 0.36 ? strikeCurve(timer - 0.36, 0.2) : 0;
    const settle = smoothstep(clamp((timer - 0.56) / 0.39, 0, 1));
    const authority = 1 - settle;
    const w = wind * authority;           // wind-up hold
    const hit = Math.max(0, slam) * authority;  // slam extension
    const coil = Math.max(0, -slam) * authority; // extra pre-slam coil

    const hipY = y - 47 - w * 3 + hit * 2;
    const torsoY = hipY - 19 + w * 2 + hit * 3;
    const neckY = torsoY - 13;
    const headY = neckY - 13;

    const hipX = x - f * 5 * w + f * 7 * hit;
    const torsoX = x - f * 6 * w + f * (10 * hit - 6 * coil);
    const neckX = x - f * 5 * w + f * (9 * hit - 5 * coil);

    return {
      head: { x: neckX + f * (2 + hit * 6 - coil * 3), y: headY - w * 2 },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Striking arm: overhead on the wind-up, driven down and through on the slam
      leftShoulder: { x: neckX - f * 6, y: neckY + 2 },
      leftElbow: { x: neckX - f * (6 + w * 4 - hit * 22), y: neckY + 10 - w * 26 + hit * 16 },
      leftHand: { x: neckX - f * (10 - w * 2 + hit * 34), y: neckY + 8 - w * 34 + hit * 34 },
      // Free arm counterbalances high, then whips down with the strike
      rightShoulder: { x: neckX + f * 6, y: neckY + 2 },
      rightElbow: { x: neckX + f * (10 + w * 6 + hit * 8), y: neckY + 12 - w * 30 + hit * 18 },
      rightHand: { x: neckX + f * (14 + w * 4 + hit * 24), y: neckY + 8 - w * 38 + hit * 36 },
      // Rear leg loads on the wind-up, front knee drives up on the slam
      leftHip: { x: hipX - f * 5, y: hipY },
      leftKnee: { x: hipX - f * 12, y: hipY + 24 },
      leftFoot: { x: x - f * 16, y: y },
      rightHip: { x: hipX + f * 5, y: hipY },
      rightKnee: { x: x + f * (8 + hit * 14), y: hipY + 24 - hit * 26 + w * 4 },
      rightFoot: { x: x + f * (14 + hit * 8), y: y - hit * 16 + w * 6 },
      tieBase: { x: neckX, y: neckY + 2 },
      tieMid: { x: neckX - f * (2 + w * 3 - hit * 6), y: neckY + 12 },
      tieTip: { x: neckX - f * (4 + w * 6 - hit * 12), y: neckY + 20 },
      coatTailLeft: { x: hipX - f * 12, y: hipY + 13 },
      coatTailRight: { x: hipX + f * (6 + hit * 6), y: hipY + 14 }
    };
  }

  private createGunShotPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Sharp recoil kickback that settles quickly (0.22s duration)
    const recoil = timer < 0.07 ? Math.sin((timer / 0.07) * Math.PI) * 10 : 0;
    const hipY = y - 46;
    const torsoY = hipY - 18;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    return {
      head: { x: x - f * recoil * 0.4, y: headY },
      neck: { x: x - f * recoil * 0.3, y: neckY },
      torso: { x: x - f * recoil * 0.2, y: torsoY },
      hips: { x: x, y: hipY },
      // Support hand tucked under or cradling wrist in Center Axis Relock (CAR)
      leftShoulder: { x: x - f * 4, y: neckY + 2 },
      leftElbow: { x: x + f * 10, y: neckY + 10 },
      leftHand: { x: x + f * (22 - recoil * 0.5), y: neckY + 2 },
      // Firing arm extended forward holding pistol with vertical recoil kick
      rightShoulder: { x: x + f * 8, y: neckY + 1 },
      rightElbow: { x: x + f * (22 - recoil * 0.4), y: neckY + 2 - recoil * 0.3 },
      rightHand: { x: x + f * (36 - recoil * 0.6), y: neckY - recoil * 0.6 },
      // Stable tactical shooting stance
      leftHip: { x: x - f * 6, y: hipY },
      leftKnee: { x: x - f * 12, y: hipY + 22 },
      leftFoot: { x: x - f * 18, y: y },
      rightHip: { x: x + f * 6, y: hipY },
      rightKnee: { x: x + f * 16, y: hipY + 22 },
      rightFoot: { x: x + f * 22, y: y },
      tieBase: { x: x, y: neckY + 2 },
      tieMid: { x: x - f * 6, y: neckY + 12 },
      tieTip: { x: x - f * (12 + recoil), y: neckY + 22 },
      coatTailLeft: { x: x - f * (14 + recoil), y: hipY + 12 },
      coatTailRight: { x: x - f * 8, y: hipY + 14 }
    };
  }

  private createWalkPose(x: number, y: number, f: number, phase: number, speed: number): StickFigurePose {
    // Upright stroll: shorter stride, no aggressive lean, relaxed arm swing
    const bounce = Math.abs(Math.sin(phase)) * 2;
    const lean = f * 4 * Math.min(1, speed / 90);
    const hipY = y - 48 + bounce;
    const hipX = x;
    const torsoX = hipX + lean * 0.5;
    const torsoY = hipY - 20;
    const neckX = hipX + lean;
    const neckY = torsoY - 14;
    const headX = neckX + f * 2;
    const headY = neckY - 14;

    const sinCycle = Math.sin(phase);
    const cosCycle = Math.cos(phase);

    const lFootX = hipX - sinCycle * 17;
    const lFootY = y - Math.max(0, cosCycle * 7);
    const lKneeX = (hipX + lFootX) * 0.5 - f * 3;
    const lKneeY = hipY + 24 - Math.max(0, cosCycle * 5);

    const rFootX = hipX + sinCycle * 17;
    const rFootY = y - Math.max(0, -cosCycle * 7);
    const rKneeX = (hipX + rFootX) * 0.5 + f * 3;
    const rKneeY = hipY + 24 - Math.max(0, -cosCycle * 5);

    const armSwing = sinCycle * 12;

    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      leftShoulder: { x: neckX - f * 5, y: neckY + 2 },
      leftElbow: { x: neckX - f * 4 - armSwing * 0.7, y: neckY + 14 },
      leftHand: { x: neckX - armSwing * 0.9, y: neckY + 24 },
      rightShoulder: { x: neckX + f * 5, y: neckY + 2 },
      rightElbow: { x: neckX + f * 4 + armSwing * 0.7, y: neckY + 14 },
      rightHand: { x: neckX + armSwing * 0.9, y: neckY + 24 },
      leftHip: { x: hipX - f * 4, y: hipY },
      leftKnee: { x: lKneeX, y: lKneeY },
      leftFoot: { x: lFootX, y: lFootY },
      rightHip: { x: hipX + f * 4, y: hipY },
      rightKnee: { x: rKneeX, y: rKneeY },
      rightFoot: { x: rFootX, y: rFootY },
      tieBase: { x: neckX, y: neckY + 3 },
      tieMid: { x: neckX - f * 5, y: neckY + 12 },
      tieTip: { x: neckX - f * 9, y: neckY + 21 },
      coatTailLeft: { x: hipX - f * 9, y: hipY + 16 },
      coatTailRight: { x: hipX + f * 7, y: hipY + 16 }
    };
  }

  private createHurtPose(
    x: number,
    y: number,
    f: number,
    timer: number,
    grounded: boolean
  ): StickFigurePose {
    // Impact flinch: an INSTANT head snap and arching recoil, then an eased
    // settle back toward guard (squared decay, never a linear slide) with a
    // short tremble riding on top. The spine takes a separate arcing curve so
    // the torso bends through the hit instead of just leaning.
    const u = clamp(timer / 0.6, 0, 1);
    const k = (1 - u) * (1 - u);
    const arc = Math.sin(clamp(timer / 0.45, 0, 1) * Math.PI) * 0.9;
    const bend = Math.max(k, arc * 0.75);
    const tremor = k * Math.sin(timer * 42 + this.hurtSeed) * 2.2;
    const hipY = y - 47 - k * 4;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 13 - k * 3;

    const hipX = x - f * 4 * k;
    const torsoX = hipX - f * 6 * bend;
    const neckX = torsoX - f * 5 * bend;
    const headX = neckX - f * (7 * k) + tremor * 0.5;

    const flinch: StickFigurePose = {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Arms fly up and out, fingers splayed from the shock
      leftShoulder: { x: neckX - f * 6, y: neckY + 2 },
      leftElbow: { x: neckX - f * (10 + k * 8), y: neckY + 6 - k * 6 },
      leftHand: { x: neckX - f * (16 + k * 14), y: neckY - 6 - k * 12 },
      rightShoulder: { x: neckX + f * 6, y: neckY + 2 },
      rightElbow: { x: neckX + f * (8 + k * 10), y: neckY + 8 - k * 4 },
      rightHand: { x: neckX + f * (14 + k * 16), y: neckY - 2 - k * 8 + tremor },
      // Weight rocked onto the back foot, front foot lifted
      leftHip: { x: hipX - f * 5, y: hipY },
      leftKnee: { x: hipX - f * 11, y: hipY + 24 },
      leftFoot: { x: x - f * 15, y: y },
      rightHip: { x: hipX + f * 5, y: hipY },
      rightKnee: { x: hipX + f * (9 + k * 6), y: hipY + 20 - k * 6 },
      rightFoot: { x: x + f * (11 + k * 8), y: y - k * 8 },
      tieBase: { x: neckX, y: neckY + 2 },
      tieMid: { x: neckX - f * (5 + k * 8), y: neckY + 11 },
      tieTip: { x: neckX - f * (9 + k * 16), y: neckY + 19 },
      coatTailLeft: { x: hipX - f * (10 + k * 8), y: hipY + 13 },
      coatTailRight: { x: hipX + f * (7 + k * 6), y: hipY + 13 }
    };

    // Quick ground recover: once the launch has landed, catch low in a crouch
    // (hand to the floor) and rise smoothly back up through the flinch.
    if (!grounded || timer < 0.12) return flinch;
    const rise = smoothstep(clamp((timer - 0.12) / 0.26, 0, 1));
    if (rise >= 1) return flinch;
    return mixPose(this.createCrouchRecoverPose(x, y, f), flinch, rise);
  }

  /** Lowest point of the hit reaction: braced on one hand, knees folded. */
  private createCrouchRecoverPose(x: number, y: number, f: number): StickFigurePose {
    const hipX = x - f * 3;
    const hipY = y - 26;
    const torsoY = hipY - 15;
    const neckY = torsoY - 12;
    const headY = neckY - 12;

    return {
      head: { x: x - f * 9, y: headY },
      neck: { x: x - f * 7, y: neckY },
      torso: { x: x - f * 5, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Bracing hand planted, free arm still riding the shock
      leftShoulder: { x: hipX - f * 6, y: neckY + 3 },
      leftElbow: { x: hipX - f * 14, y: y - 16 },
      leftHand: { x: hipX - f * 20, y: y - 3 },
      rightShoulder: { x: hipX + f * 4, y: neckY + 3 },
      rightElbow: { x: hipX + f * 12, y: neckY + 14 },
      rightHand: { x: hipX + f * 18, y: neckY + 8 },
      leftHip: { x: hipX - f * 6, y: hipY },
      leftKnee: { x: hipX - f * 15, y: y - 8 },
      leftFoot: { x: x - f * 15, y: y },
      rightHip: { x: hipX + f * 6, y: hipY },
      rightKnee: { x: hipX + f * 15, y: y - 10 },
      rightFoot: { x: x + f * 13, y: y },
      tieBase: { x: hipX - f * 5, y: neckY + 3 },
      tieMid: { x: hipX - f * 12, y: neckY + 12 },
      tieTip: { x: hipX - f * 20, y: neckY + 20 },
      coatTailLeft: { x: hipX - f * 14, y: hipY + 8 },
      coatTailRight: { x: hipX + f * 8, y: hipY + 8 }
    };
  }

  private createKnockbackPose(x: number, y: number, f: number, vy: number): StickFigurePose {
    // Launch ragdoll-lite: torso blown backwards, limbs trailing the motion.
    const lift = Math.max(0, Math.min(1, -vy / 320)); // rises as upward speed grows
    const hipY = y - 48 - lift * 6;
    const torsoY = hipY - 19;
    const neckY = torsoY - 13;
    const headY = neckY - 13;

    const hipX = x - f * 6;
    const torsoX = hipX - f * (7 + lift * 6);
    const neckX = torsoX - f * (5 + lift * 5);
    const headX = neckX - f * (6 + lift * 8);

    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Arms blown forward/up by the momentum
      leftShoulder: { x: neckX - f * 5, y: neckY + 2 },
      leftElbow: { x: neckX + f * (4 - lift * 14), y: neckY - 2 - lift * 8 },
      leftHand: { x: neckX + f * (10 - lift * 20), y: neckY - 6 - lift * 14 },
      rightShoulder: { x: neckX + f * 5, y: neckY + 2 },
      rightElbow: { x: neckX + f * (12 - lift * 12), y: neckY + 4 - lift * 6 },
      rightHand: { x: neckX + f * (20 - lift * 18), y: neckY - 4 - lift * 10 },
      // Legs kicked ahead of the body
      leftHip: { x: hipX - f * 5, y: hipY },
      leftKnee: { x: hipX + f * (2 + lift * 14), y: hipY + 20 - lift * 6 },
      leftFoot: { x: hipX + f * (8 + lift * 26), y: y - lift * 12 },
      rightHip: { x: hipX + f * 5, y: hipY },
      rightKnee: { x: hipX + f * (10 + lift * 16), y: hipY + 22 - lift * 4 },
      rightFoot: { x: hipX + f * (18 + lift * 30), y: y - lift * 6 },
      tieBase: { x: neckX, y: neckY + 2 },
      tieMid: { x: neckX - f * (6 + lift * 10), y: neckY + 10 },
      tieTip: { x: neckX - f * (11 + lift * 20), y: neckY + 17 },
      coatTailLeft: { x: hipX - f * (12 + lift * 14), y: hipY + 12 },
      coatTailRight: { x: hipX - f * (4 + lift * 10), y: hipY + 14 }
    };
  }
}
