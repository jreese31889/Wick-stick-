import { AnimationState, StickFigurePose, RigJoint } from '../types/game';
import { lerp } from './MathUtils';

export class AnimationController {
  private runPhase = 0;
  private breathPhase = 0;
  private actionTimer = 0;

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
    baseY: number
  ): StickFigurePose {
    const facingSign = facingRight ? 1 : -1;
    this.breathPhase += dt * 3.5;
    
    // Increment run cycle phase based on horizontal velocity
    const speed = Math.abs(vx);
    if (state === 'RUN' || state === 'WALK') {
      this.runPhase += (speed * 0.04) * dt * 60;
    }

    // Default neutral skeleton coordinates centered around baseX, baseY (feet on ground)
    const spineHeight = 72;
    const groundY = baseY;

    switch (state) {
      case 'RUN':
        return this.createRunPose(baseX, groundY, facingSign, this.runPhase, speed);

      case 'SLIDE':
        return this.createSlidePose(baseX, groundY, facingSign, stateTimer);

      case 'DODGE_ROLL':
        return this.createRollPose(baseX, groundY, facingSign, stateTimer);

      case 'JUMP_ASCENT':
        return this.createJumpAscentPose(baseX, groundY, facingSign, vy);

      case 'FALL':
        return this.createFallPose(baseX, groundY, facingSign, vy);

      case 'LAND':
        return this.createLandPose(baseX, groundY, facingSign, stateTimer);

      case 'BLOCK':
        return this.createBlockPose(baseX, groundY, facingSign);

      case 'ATTACK_LIGHT_1':
        return this.createPunch1Pose(baseX, groundY, facingSign, stateTimer);

      case 'ATTACK_LIGHT_2':
        return this.createPunch2Pose(baseX, groundY, facingSign, stateTimer);

      case 'ATTACK_LIGHT_3':
      case 'ATTACK_KICK':
        return this.createKickPose(baseX, groundY, facingSign, stateTimer);

      case 'ATTACK_HEAVY':
        return this.createHeavyStrikePose(baseX, groundY, facingSign, stateTimer);

      case 'ATTACK_GUN_SHOT':
        return this.createGunShotPose(baseX, groundY, facingSign, stateTimer);

      case 'IDLE':
      default:
        return this.createIdlePose(baseX, groundY, facingSign, this.breathPhase);
    }
  }

  // --- PROCEDURAL POSES ---

  private createIdlePose(x: number, y: number, f: number, phase: number): StickFigurePose {
    const breathe = Math.sin(phase) * 1.5;
    const hipY = y - 48 + breathe * 0.5;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    const hipX = x;
    const torsoX = x - f * 2;
    const neckX = x - f * 1;
    const headX = neckX + f * 1;

    // Relaxed martial guard
    return {
      head: { x: headX, y: headY },
      neck: { x: neckX, y: neckY },
      torso: { x: torsoX, y: torsoY },
      hips: { x: hipX, y: hipY },
      // Left arm (lead guard)
      leftShoulder: { x: neckX - f * 6, y: neckY + 2 },
      leftElbow: { x: neckX + f * 10, y: neckY + 12 },
      leftHand: { x: neckX + f * 14, y: neckY + 2 + breathe },
      // Right arm (rear guard)
      rightShoulder: { x: neckX + f * 6, y: neckY + 2 },
      rightElbow: { x: neckX + f * 6, y: neckY + 14 },
      rightHand: { x: neckX + f * 18, y: neckY + 8 },
      // Left leg (back foot)
      leftHip: { x: hipX - f * 5, y: hipY },
      leftKnee: { x: hipX - f * 12, y: hipY + 24 },
      leftFoot: { x: hipX - f * 14, y: y },
      // Right leg (front foot slightly forward)
      rightHip: { x: hipX + f * 5, y: hipY },
      rightKnee: { x: hipX + f * 8, y: hipY + 24 },
      rightFoot: { x: hipX + f * 12, y: y },
      // Tie & cloth anchors
      tieBase: { x: neckX, y: neckY + 3 },
      tieMid: { x: neckX, y: neckY + 14 },
      tieTip: { x: neckX, y: neckY + 24 },
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
    const extend = Math.sin(Math.min(1, timer / 0.18) * Math.PI);
    const hipY = y - 48;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    return {
      head: { x: x + f * 4, y: headY },
      neck: { x: x + f * 2, y: neckY },
      torso: { x: x + f * 2, y: torsoY },
      hips: { x: x, y: hipY },
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
      leftFoot: { x: x - f * 16, y: y },
      rightHip: { x: x + f * 6, y: hipY },
      rightKnee: { x: x + f * 12, y: hipY + 22 },
      rightFoot: { x: x + f * 16, y: y },
      tieBase: { x: x + f * 2, y: neckY + 2 },
      tieMid: { x: x, y: neckY + 12 },
      tieTip: { x: x - f * 4, y: neckY + 20 },
      coatTailLeft: { x: x - f * 12, y: hipY + 14 },
      coatTailRight: { x: x + f * 6, y: hipY + 14 }
    };
  }

  private createPunch2Pose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Powerful rear cross punch with torso rotation
    const extend = Math.sin(Math.min(1, timer / 0.2) * Math.PI);
    const hipY = y - 48;
    const torsoY = hipY - 20;
    const neckY = torsoY - 14;
    const headY = neckY - 14;

    return {
      head: { x: x + f * 8, y: headY },
      neck: { x: x + f * 6, y: neckY },
      torso: { x: x + f * 4, y: torsoY },
      hips: { x: x + f * 2, y: hipY },
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
      leftFoot: { x: x - f * 14, y: y },
      rightHip: { x: x + f * 8, y: hipY },
      rightKnee: { x: x + f * 16, y: hipY + 22 },
      rightFoot: { x: x + f * 22, y: y },
      tieBase: { x: x + f * 6, y: neckY + 2 },
      tieMid: { x: x + f * 2, y: neckY + 12 },
      tieTip: { x: x - f * 2, y: neckY + 20 },
      coatTailLeft: { x: x - f * 10, y: hipY + 14 },
      coatTailRight: { x: x + f * 10, y: hipY + 14 }
    };
  }

  private createKickPose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Dynamic high roundhouse kick
    const extend = Math.sin(Math.min(1, timer / 0.24) * Math.PI);
    const hipY = y - 50;
    const torsoY = hipY - 18;
    const neckY = torsoY - 12;
    const headY = neckY - 12;

    return {
      head: { x: x - f * 6, y: headY },
      neck: { x: x - f * 4, y: neckY },
      torso: { x: x - f * 2, y: torsoY },
      hips: { x: x, y: hipY },
      // Guarding arms during kick
      leftShoulder: { x: x - f * 4, y: neckY + 2 },
      leftElbow: { x: x - f * 12, y: neckY + 12 },
      leftHand: { x: x - f * 14, y: neckY + 4 },
      rightShoulder: { x: x + f * 2, y: neckY + 2 },
      rightElbow: { x: x + f * 10, y: neckY + 8 },
      rightHand: { x: x + f * 16, y: neckY + 14 },
      // Standing support leg
      leftHip: { x: x - f * 4, y: hipY },
      leftKnee: { x: x - f * 2, y: hipY + 24 },
      leftFoot: { x: x - f * 2, y: y },
      // High horizontal whip kick
      rightHip: { x: x + f * 4, y: hipY },
      rightKnee: { x: x + f * (18 + extend * 12), y: hipY - 6 },
      rightFoot: { x: x + f * (34 + extend * 24), y: hipY - 14 },
      tieBase: { x: x - f * 4, y: neckY + 2 },
      tieMid: { x: x - f * 12, y: neckY + 10 },
      tieTip: { x: x - f * 20, y: neckY + 16 },
      coatTailLeft: { x: x - f * 14, y: hipY + 12 },
      coatTailRight: { x: x - f * 8, y: hipY + 14 }
    };
  }

  private createHeavyStrikePose(x: number, y: number, f: number, timer: number): StickFigurePose {
    // Devastating lunge elbow strike / palm thrust
    const extend = Math.sin(Math.min(1, timer / 0.28) * Math.PI);
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
}
