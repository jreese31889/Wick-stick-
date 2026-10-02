import { StickFigurePose, RigJoint, WeaponType } from '../types/game';
import { lerp } from './MathUtils';

export interface ClothPhysicsState {
  tieAngle: number;
  tieAngularVel: number;
  coatFlutter: number;
}

export class StickRig {
  private clothState: ClothPhysicsState = {
    tieAngle: 0,
    tieAngularVel: 0,
    coatFlutter: 0,
  };

  /**
   * Updates dynamic secondary physics on the tie and jacket coat tails
   */
  public updatePhysics(
    vx: number,
    vy: number,
    facingRight: boolean,
    dt: number
  ): void {
    // Tie behaves like an angular pendulum responding to horizontal acceleration and air drag
    const moveSpeed = Math.abs(vx);
    const facingSign = facingRight ? 1 : -1;
    
    // Wind push opposite to velocity
    const targetTieAngle = (-vx * 0.05) - (facingSign * (moveSpeed > 50 ? 0.25 : 0.05));
    const springForce = (targetTieAngle - this.clothState.tieAngle) * 35;
    const damping = this.clothState.tieAngularVel * 12;
    
    this.clothState.tieAngularVel += (springForce - damping) * dt;
    this.clothState.tieAngle += this.clothState.tieAngularVel * dt;

    // Clamp tie angle so it doesn't spin wildly
    this.clothState.tieAngle = Math.max(-1.4, Math.min(1.4, this.clothState.tieAngle));

    // Jacket tails flutter based on speed and vertical velocity
    const targetFlutter = (Math.sin(performance.now() * 0.015) * Math.min(1, moveSpeed / 200)) * 0.4;
    this.clothState.coatFlutter = lerp(this.clothState.coatFlutter, targetFlutter, 0.2);
  }

  /**
   * Renders the stylized stick figure in a fitted black suit, white shirt, black tie, and dress shoes
   */
  public render(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    facingRight: boolean,
    debugMode: boolean = false,
    weaponType: WeaponType = 'UNARMED'
  ): void {
    ctx.save();

    // Line caps and joins for pristine limb aesthetic
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Limb thickness constants
    const bodyStroke = 6.5;
    const suitBlack = '#14151a';
    const suitHighlight = '#252834';
    const shirtWhite = '#ffffff';
    const tieBlack = '#0a0a0c';
    const skinBlack = '#111216';

    // 1. BACK LEG (Drawn behind body for proper depth)
    this.renderLeg(ctx, pose.leftHip, pose.leftKnee, pose.leftFoot, facingRight, suitBlack, '#0f1015');

    // 2. BACK ARM (Drawn behind body)
    this.renderArm(ctx, pose.leftShoulder, pose.leftElbow, pose.leftHand, suitBlack);

    // 3. SUIT JACKET LOWER COAT TAILS (Flaring behind legs)
    this.renderCoatTails(ctx, pose.hips, pose.torso, facingRight, suitBlack);

    // 4. TORSO & FITTED SUIT WITH SHIRT AND TIE
    this.renderTorsoAndSuit(ctx, pose, facingRight, suitBlack, suitHighlight, shirtWhite, tieBlack);

    // 5. FRONT LEG (In front of torso)
    this.renderLeg(ctx, pose.rightHip, pose.rightKnee, pose.rightFoot, facingRight, suitBlack, '#181a22');

    // 6. FRONT ARM (In front of torso)
    this.renderArm(ctx, pose.rightShoulder, pose.rightElbow, pose.rightHand, suitBlack);

    // 7. WEAPON IN HAND (Katana or Knife)
    if (weaponType === 'KATANA') {
      this.renderKatana(ctx, pose.rightHand, pose.rightElbow, facingRight);
    } else if (weaponType === 'KNIFE') {
      this.renderKnife(ctx, pose.rightHand, pose.rightElbow, facingRight);
    }

    // 8. HEAD & SILHOUETTE
    this.renderHead(ctx, pose.head, skinBlack);

    // 9. OPTIONAL DEBUG SKELETAL OVERLAY
    if (debugMode) {
      this.renderDebugSkeleton(ctx, pose);
    }

    ctx.restore();
  }

  private renderKatana(
    ctx: CanvasRenderingContext2D,
    hand: RigJoint,
    elbow: RigJoint,
    facingRight: boolean
  ): void {
    const dx = hand.x - elbow.x;
    const dy = hand.y - elbow.y;
    let angle = Math.atan2(dy, dx);
    if (!facingRight && Math.abs(dx) < 2) {
      angle = Math.PI - angle;
    }

    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(angle);

    // Handle (Tsuka)
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(2, 0);
    ctx.stroke();

    // Guard (Tsuba)
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(2, -6);
    ctx.lineTo(2, 6);
    ctx.stroke();

    // Polished steel blade (Hawatari)
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(3, 0);
    // Slight authentic Katana curve
    ctx.quadraticCurveTo(28, -2, 52, -4);
    ctx.stroke();

    // Blade glow
    ctx.strokeStyle = 'rgba(217, 249, 157, 0.4)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(3, 0);
    ctx.quadraticCurveTo(28, -2, 52, -4);
    ctx.stroke();

    ctx.restore();
  }

  private renderKnife(
    ctx: CanvasRenderingContext2D,
    hand: RigJoint,
    elbow: RigJoint,
    facingRight: boolean
  ): void {
    const dx = hand.x - elbow.x;
    const dy = hand.y - elbow.y;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(angle);

    // Handle
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(2, 0);
    ctx.stroke();

    // Blade
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(18, 0);
    ctx.stroke();

    ctx.restore();
  }

  private renderHead(ctx: CanvasRenderingContext2D, head: RigJoint, color: string): void {
    const headRadius = 14;

    ctx.beginPath();
    ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Subtle edge rim light for cinematic silhouette contrast
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#4a5168';
    ctx.stroke();
  }

  private renderTorsoAndSuit(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    facingRight: boolean,
    suitBlack: string,
    suitHighlight: string,
    shirtWhite: string,
    tieBlack: string
  ): void {
    const { neck, torso, hips } = pose;

    // Torso angle & orientation
    const dx = torso.x - neck.x;
    const dy = torso.y - neck.y;
    const torsoLen = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / torsoLen; // Normal vector perpendicular to spine
    const ny = dx / torsoLen;

    const shoulderWidth = 14;
    const waistWidth = 11;
    const hipWidth = 12;

    // Points for fitted suit jacket silhouette
    const leftShoulder = { x: neck.x - nx * shoulderWidth, y: neck.y - ny * shoulderWidth };
    const rightShoulder = { x: neck.x + nx * shoulderWidth, y: neck.y + ny * shoulderWidth };
    const leftWaist = { x: torso.x - nx * waistWidth, y: torso.y - ny * waistWidth };
    const rightWaist = { x: torso.x + nx * waistWidth, y: torso.y + ny * waistWidth };
    const leftHip = { x: hips.x - nx * hipWidth, y: hips.y - ny * hipWidth };
    const rightHip = { x: hips.x + nx * hipWidth, y: hips.y + ny * hipWidth };

    // Draw tailored Suit Jacket Body
    ctx.beginPath();
    ctx.moveTo(leftShoulder.x, leftShoulder.y);
    ctx.lineTo(rightShoulder.x, rightShoulder.y);
    ctx.lineTo(rightWaist.x, rightWaist.y);
    ctx.lineTo(rightHip.x, rightHip.y);
    ctx.lineTo(leftHip.x, leftHip.y);
    ctx.lineTo(leftWaist.x, leftWaist.y);
    ctx.closePath();
    ctx.fillStyle = suitBlack;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = suitHighlight;
    ctx.stroke();

    // Draw Crisp White Shirt V-Neck Collar
    const chestCenter = { x: (neck.x + torso.x) * 0.5, y: (neck.y + torso.y) * 0.5 };
    const shirtWidth = 7;
    const shirtDepth = 15;
    const shirtBase = {
      x: neck.x + (torso.x - neck.x) * 0.45,
      y: neck.y + (torso.y - neck.y) * 0.45,
    };

    ctx.beginPath();
    ctx.moveTo(neck.x - nx * shirtWidth, neck.y - ny * shirtWidth);
    ctx.lineTo(neck.x + nx * shirtWidth, neck.y + ny * shirtWidth);
    ctx.lineTo(shirtBase.x, shirtBase.y);
    ctx.closePath();
    ctx.fillStyle = shirtWhite;
    ctx.fill();

    // Draw Dynamic Black Necktie
    this.renderTie(ctx, neck, shirtBase, facingRight, tieBlack);

    // Suit Lapel Lines
    ctx.beginPath();
    ctx.moveTo(neck.x - nx * (shirtWidth + 1), neck.y - ny * (shirtWidth + 1));
    ctx.lineTo(shirtBase.x - nx * 2, shirtBase.y);
    ctx.lineTo(torso.x, torso.y);
    ctx.strokeStyle = suitHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(neck.x + nx * (shirtWidth + 1), neck.y + ny * (shirtWidth + 1));
    ctx.lineTo(shirtBase.x + nx * 2, shirtBase.y);
    ctx.lineTo(torso.x, torso.y);
    ctx.strokeStyle = suitHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private renderTie(
    ctx: CanvasRenderingContext2D,
    tieBase: RigJoint,
    shirtBase: RigJoint,
    facingRight: boolean,
    tieColor: string
  ): void {
    const tieLength = 22;
    const angle = this.clothState.tieAngle;
    
    // Tie base knot
    ctx.beginPath();
    ctx.arc(tieBase.x, tieBase.y + 2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = tieColor;
    ctx.fill();

    // Tie blade with angular swing
    const midX = tieBase.x + Math.sin(angle) * (tieLength * 0.5);
    const midY = tieBase.y + Math.cos(angle) * (tieLength * 0.5);
    const tipX = tieBase.x + Math.sin(angle * 1.2) * tieLength;
    const tipY = tieBase.y + Math.cos(angle * 1.2) * tieLength;

    ctx.beginPath();
    ctx.moveTo(tieBase.x - 2, tieBase.y + 2);
    ctx.lineTo(tieBase.x + 2, tieBase.y + 2);
    ctx.lineTo(midX + 3.2, midY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(midX - 3.2, midY);
    ctx.closePath();
    ctx.fillStyle = tieColor;
    ctx.fill();

    // Tie edge highlight
    ctx.strokeStyle = '#2c2e3b';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  private renderCoatTails(
    ctx: CanvasRenderingContext2D,
    hips: RigJoint,
    torso: RigJoint,
    facingRight: boolean,
    suitBlack: string
  ): void {
    const flutter = this.clothState.coatFlutter;
    const tailOffset = (facingRight ? -1 : 1) * (10 + flutter * 20);
    const tailY = hips.y + 16 + Math.abs(flutter) * 6;

    ctx.beginPath();
    ctx.moveTo(hips.x - 9, hips.y);
    ctx.lineTo(hips.x + 9, hips.y);
    ctx.lineTo(hips.x + tailOffset + 6, tailY);
    ctx.lineTo(hips.x + tailOffset - 6, tailY);
    ctx.closePath();
    ctx.fillStyle = suitBlack;
    ctx.fill();
    ctx.strokeStyle = '#222530';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderArm(
    ctx: CanvasRenderingContext2D,
    shoulder: RigJoint,
    elbow: RigJoint,
    hand: RigJoint,
    suitColor: string
  ): void {
    // Upper Arm (Jacket sleeve)
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.strokeStyle = suitColor;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Forearm (Jacket sleeve)
    ctx.beginPath();
    ctx.moveTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.strokeStyle = suitColor;
    ctx.lineWidth = 5.2;
    ctx.stroke();

    // White Shirt Cuff at wrist
    const armAngle = Math.atan2(hand.y - elbow.y, hand.x - elbow.x);
    const cuffX = hand.x - Math.cos(armAngle) * 3;
    const cuffY = hand.y - Math.sin(armAngle) * 3;
    ctx.beginPath();
    ctx.arc(cuffX, cuffY, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Hand / Fist
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#111216';
    ctx.fill();
    ctx.strokeStyle = '#323746';
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
    // Thigh (Suit Trousers)
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.strokeStyle = pantsColor;
    ctx.lineWidth = 7;
    ctx.stroke();

    // Shin (Suit Trousers)
    ctx.beginPath();
    ctx.moveTo(knee.x, knee.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.strokeStyle = pantsColor;
    ctx.lineWidth = 5.8;
    ctx.stroke();

    // Tapered Dress Shoe
    const facingSign = facingRight ? 1 : -1;
    const toeX = foot.x + facingSign * 11;
    const heelX = foot.x - facingSign * 4;

    ctx.beginPath();
    ctx.moveTo(heelX, foot.y - 2);
    ctx.lineTo(toeX, foot.y);
    ctx.lineTo(toeX, foot.y + 4.5);
    ctx.lineTo(heelX, foot.y + 4.5);
    ctx.closePath();
    ctx.fillStyle = shoeColor;
    ctx.fill();

    // Polished shoe rim highlight
    ctx.strokeStyle = '#3c4155';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderDebugSkeleton(ctx: CanvasRenderingContext2D, pose: StickFigurePose): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 180, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';

    const joints: RigJoint[] = [
      pose.head, pose.neck, pose.torso, pose.hips,
      pose.leftShoulder, pose.leftElbow, pose.leftHand,
      pose.rightShoulder, pose.rightElbow, pose.rightHand,
      pose.leftHip, pose.leftKnee, pose.leftFoot,
      pose.rightHip, pose.rightKnee, pose.rightFoot
    ];

    // Draw joints
    for (const j of joints) {
      ctx.beginPath();
      ctx.arc(j.x, j.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
