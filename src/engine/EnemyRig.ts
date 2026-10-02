import { StickFigurePose, RigJoint } from '../types/game';
import { EnemyController } from './EnemyController';

export class EnemyRig {
  public render(
    ctx: CanvasRenderingContext2D,
    enemy: EnemyController,
    debugMode: boolean = false
  ): void {
    const pose = enemy.pose;
    const facingRight = enemy.facingRight;
    const suitDark = enemy.suitColor;
    const shirtRed = enemy.shirtColor;
    const tieColor = enemy.tieColor;
    const isStaggered = enemy.isStaggered;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Back Leg
    this.renderLeg(ctx, pose.leftHip, pose.leftKnee, pose.leftFoot, facingRight, suitDark, '#11141c');

    // 2. Back Arm
    this.renderArm(ctx, pose.leftShoulder, pose.leftElbow, pose.leftHand, suitDark);

    // 3. Coat Tails
    this.renderCoatTails(ctx, pose.hips, facingRight, suitDark);

    // 4. Torso & Crimson Shirt
    this.renderTorso(ctx, pose, facingRight, suitDark, shirtRed, tieColor);

    // 5. Front Leg
    this.renderLeg(ctx, pose.rightHip, pose.rightKnee, pose.rightFoot, facingRight, suitDark, '#191e2b');

    // 6. Front Arm
    this.renderArm(ctx, pose.rightShoulder, pose.rightElbow, pose.rightHand, suitDark);

    // 7. Head with Syndicate Enforcer red glint
    this.renderHead(ctx, pose.head, isStaggered);

    // 8. Overhead Health & Stun Bar
    this.renderStatusOverhead(ctx, enemy);

    // 9. Debug Bone Overlay
    if (debugMode) {
      this.renderDebug(ctx, pose);
    }

    ctx.restore();
  }

  private renderHead(ctx: CanvasRenderingContext2D, head: RigJoint, isStaggered: boolean): void {
    const headRadius = 14;

    ctx.beginPath();
    ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#181b24';
    ctx.fill();

    // Dark crimson outline
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = isStaggered ? '#f59e0b' : '#7f1d1d';
    ctx.stroke();

    // Enforcer glowing eye glint (red or dizzy stars if staggered)
    if (isStaggered) {
      // Stun stars
      ctx.fillStyle = '#fbbf24';
      ctx.font = '10px sans-serif';
      ctx.fillText('💫', head.x - 7, head.y - 16);
    } else {
      // Red hostile eye pinprick
      ctx.beginPath();
      ctx.arc(head.x + 4, head.y - 2, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
    }
  }

  private renderTorso(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    facingRight: boolean,
    suitDark: string,
    shirtRed: string,
    tieColor: string
  ): void {
    const { neck, torso, hips } = pose;

    const dx = torso.x - neck.x;
    const dy = torso.y - neck.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    const shoulderWidth = 16; // Broader street-brawler build
    const waistWidth = 13;
    const hipWidth = 14;

    const ls = { x: neck.x - nx * shoulderWidth, y: neck.y - ny * shoulderWidth };
    const rs = { x: neck.x + nx * shoulderWidth, y: neck.y + ny * shoulderWidth };
    const lw = { x: torso.x - nx * waistWidth, y: torso.y - ny * waistWidth };
    const rw = { x: torso.x + nx * waistWidth, y: torso.y + ny * waistWidth };
    const lh = { x: hips.x - nx * hipWidth, y: hips.y - ny * hipWidth };
    const rh = { x: hips.x + nx * hipWidth, y: hips.y + ny * hipWidth };

    // Suit Vest / Jacket
    ctx.beginPath();
    ctx.moveTo(ls.x, ls.y);
    ctx.lineTo(rs.x, rs.y);
    ctx.lineTo(rw.x, rw.y);
    ctx.lineTo(rh.x, rh.y);
    ctx.lineTo(lh.x, lh.y);
    ctx.lineTo(lw.x, lw.y);
    ctx.closePath();
    ctx.fillStyle = suitDark;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#323746';
    ctx.stroke();

    // Crimson Shirt V-Neck
    const shirtWidth = 8;
    const shirtBase = {
      x: neck.x + (torso.x - neck.x) * 0.45,
      y: neck.y + (torso.y - neck.y) * 0.45,
    };

    ctx.beginPath();
    ctx.moveTo(neck.x - nx * shirtWidth, neck.y - ny * shirtWidth);
    ctx.lineTo(neck.x + nx * shirtWidth, neck.y + ny * shirtWidth);
    ctx.lineTo(shirtBase.x, shirtBase.y);
    ctx.closePath();
    ctx.fillStyle = shirtRed;
    ctx.fill();

    // Tie
    ctx.beginPath();
    ctx.moveTo(neck.x - 2, neck.y + 2);
    ctx.lineTo(neck.x + 2, neck.y + 2);
    ctx.lineTo(shirtBase.x, shirtBase.y + 8);
    ctx.strokeStyle = tieColor;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private renderArm(
    ctx: CanvasRenderingContext2D,
    shoulder: RigJoint,
    elbow: RigJoint,
    hand: RigJoint,
    suitColor: string
  ): void {
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.strokeStyle = suitColor;
    ctx.lineWidth = 6.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.strokeStyle = suitColor;
    ctx.lineWidth = 5.8;
    ctx.stroke();

    // Fist with knuckle wraps
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = '#b91c1c';
    ctx.fill();
    ctx.strokeStyle = '#450a0a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderLeg(
    ctx: CanvasRenderingContext2D,
    hip: RigJoint,
    knee: RigJoint,
    foot: RigJoint,
    facingRight: boolean,
    pantsColor: string,
    shoeColor: string
  ): void {
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.strokeStyle = pantsColor;
    ctx.lineWidth = 7.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(knee.x, knee.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.strokeStyle = pantsColor;
    ctx.lineWidth = 6.2;
    ctx.stroke();

    // Combat Boot
    const dir = facingRight ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(foot.x - dir * 4, foot.y - 3);
    ctx.lineTo(foot.x + dir * 12, foot.y);
    ctx.lineTo(foot.x + dir * 12, foot.y + 5);
    ctx.lineTo(foot.x - dir * 4, foot.y + 5);
    ctx.closePath();
    ctx.fillStyle = shoeColor;
    ctx.fill();
    ctx.strokeStyle = '#323746';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderCoatTails(
    ctx: CanvasRenderingContext2D,
    hips: RigJoint,
    facingRight: boolean,
    suitColor: string
  ): void {
    const dir = facingRight ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(hips.x - 10, hips.y);
    ctx.lineTo(hips.x + 10, hips.y);
    ctx.lineTo(hips.x + dir * 12 + 6, hips.y + 18);
    ctx.lineTo(hips.x + dir * 12 - 6, hips.y + 18);
    ctx.closePath();
    ctx.fillStyle = suitColor;
    ctx.fill();
  }

  private renderStatusOverhead(ctx: CanvasRenderingContext2D, enemy: EnemyController): void {
    if (enemy.health <= 0 && enemy.state === 'DOWNED') return;

    // Direct User Mandate: Only display health bar when enemy has taken damage recently!
    const isVisible = enemy.hpVisibleTimer > 0 || enemy.isStaggered || enemy.state === 'BLOCK';
    if (!isVisible) return;

    ctx.save();
    // Smooth fade out when the timer is expiring
    const alpha = enemy.hpVisibleTimer > 0 ? Math.min(1, enemy.hpVisibleTimer / 0.4) : 1;
    ctx.globalAlpha = alpha;

    const barWidth = 46;
    const barHeight = 4.5;
    const x = enemy.position.x - barWidth / 2;
    const y = enemy.position.y - 120; // Above enemy head

    // Background track
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    // Ghost health bar (yellow damage preview that drains down smoothly)
    const ghostRatio = Math.max(0, enemy.ghostHealth / enemy.maxHealth);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x, y, barWidth * ghostRatio, barHeight);

    // Current health bar (crimson red)
    const hpRatio = Math.max(0, enemy.health / enemy.maxHealth);
    ctx.fillStyle = hpRatio > 0.3 ? '#ef4444' : '#f87171';
    ctx.fillRect(x, y, barWidth * hpRatio, barHeight);

    // Stagger / Stun bar underneath
    const stWidth = barWidth;
    const stHeight = 2.5;
    const stY = y + barHeight + 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x - 1, stY - 1, stWidth + 2, stHeight + 2);

    const stRatio = Math.min(1, enemy.staggerMeter / enemy.maxStagger);
    ctx.fillStyle = enemy.isStaggered ? '#fbbf24' : '#38bdf8';
    ctx.fillRect(x, stY, stWidth * stRatio, stHeight);

    // Tag label
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';

    if (enemy.isStaggered) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('STAGGERED [GRAB!]', enemy.position.x, y - 5);
    } else if (enemy.state === 'BLOCK') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('🛡️ GUARD', enemy.position.x, y - 5);
    } else if (enemy.state === 'WINDUP') {
      ctx.fillStyle = '#ef4444';
      ctx.fillText('⚠️ ATTACK!', enemy.position.x, y - 5);
    } else {
      const typeLabel =
        enemy.type === 'BOSS'
          ? '👑 ZERO [BOSS]'
          : enemy.type === 'HEAVY'
          ? 'BRUTE'
          : enemy.type === 'RUSHER'
          ? 'RUSHER'
          : 'ENFORCER';
      ctx.fillStyle =
        enemy.type === 'BOSS'
          ? '#f59e0b'
          : enemy.type === 'HEAVY'
          ? '#a855f7'
          : enemy.type === 'RUSHER'
          ? '#eab308'
          : '#94a3b8';
      ctx.fillText(typeLabel, enemy.position.x, y - 5);
    }

    ctx.restore();
  }

  private renderDebug(ctx: CanvasRenderingContext2D, pose: StickFigurePose): void {
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.8)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';

    const joints = [
      pose.head, pose.neck, pose.torso, pose.hips,
      pose.leftShoulder, pose.leftElbow, pose.leftHand,
      pose.rightShoulder, pose.rightElbow, pose.rightHand,
      pose.leftHip, pose.leftKnee, pose.leftFoot,
      pose.rightHip, pose.rightKnee, pose.rightFoot
    ];

    for (const j of joints) {
      ctx.beginPath();
      ctx.arc(j.x, j.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
