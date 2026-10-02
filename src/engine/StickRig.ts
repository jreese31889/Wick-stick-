import { StickFigurePose, RigJoint, WeaponType } from '../types/game';
import { TieRope } from './TieRope';

/**
 * JOB 1 (visibility): the player is authored as a bright ivory silhouette so
 * he reads on any stage (nightclub, rooftop night, rainy alley). Every limb is
 * drawn twice — a WIDER dark outline stroke first, the bright body stroke on
 * top — which both separates him from the background and keeps the crisp
 * stick-figure edge. A faint warm rim/glow sits behind the whole figure.
 */
const PLAYER_STYLE = {
  /** Bright body stroke — front limbs and torso fill */
  ivory: '#f6efdf',
  /** Back limbs sit one shade deeper for depth without going dark */
  ivoryBack: '#e3dbc7',
  /** Dress shoes / fist shade: mid-tone so they never sink into a dark floor */
  shoe: '#c9c0aa',
  /** Dark outline pass drawn underneath everything */
  outline: '#08090e',
  shirt: '#ffffff',
  shirtEdge: '#14151c',
  tie: '#0b0c11',
  cuff: '#ffffff',
  /** Rim glow rgb prefix (alpha appended per draw) */
  glow: '255, 240, 206',
  /** Soft interior edge for the shirt / lapel work */
  detail: '#1b1c24',
};

/** Dark under-stroke growth applied in the outline pass (half = rim width). */
const OUTLINE_GROW = 3.6;

export class StickRig {
  private tieRope = new TieRope();
  // Jacket coat tails: one short verlet rope per hip, driven by the same
  // wind/flutter as the tie but with higher damping so the jacket reads
  // heavier than the tie
  private coatRopeL = new TieRope(4, 5.5, 0.993);
  private coatRopeR = new TieRope(4, 5.5, 0.993);
  // Coat pins captured from the live player render. updatePhysics runs before
  // the fresh pose is generated, so pins lag one frame — exactly like the tie
  // pin. The armed flag gates capture to the first render() after an update:
  // afterimage ghosts render later in the same frame and must not steal pins.
  private coatPinL = { x: 0, y: 0 };
  private coatPinR = { x: 0, y: 0 };
  private coatPinArmed = false;
  private hasCoatPins = false;

  /**
   * Updates dynamic secondary physics: verlet necktie rope + verlet coat tails
   */
  public updatePhysics(
    vx: number,
    vy: number,
    facingRight: boolean,
    dt: number,
    pinX: number,
    pinY: number,
    flutter: number
  ): void {
    // Verlet necktie pinned at the collar — swings with momentum,
    // lags sudden movement, flutters during fast attacks
    this.tieRope.update(pinX, pinY, vx, vy, facingRight, dt, flutter);

    // Jacket coat tails pinned at the hip joints — same wind/flutter inputs
    // as the tie; heavier damping makes the jacket read weightier
    const pinLx = this.hasCoatPins ? this.coatPinL.x : pinX;
    const pinLy = this.hasCoatPins ? this.coatPinL.y : pinY + 48;
    const pinRx = this.hasCoatPins ? this.coatPinR.x : pinX;
    const pinRy = this.hasCoatPins ? this.coatPinR.y : pinY + 48;
    this.coatRopeL.update(pinLx, pinLy, vx, vy, facingRight, dt, flutter);
    this.coatRopeR.update(pinRx, pinRy, vx, vy, facingRight, dt, flutter);

    // Arm coat-pin capture: the first render() after this update is the live
    // player render (afterimage ghosts come later)
    this.coatPinArmed = true;
  }

  /**
   * Renders the stylized stick figure as a bright ivory silhouette in a fitted
   * suit: rim glow → dark outline pass → bright body pass.
   *
   * @param ghost afterimage trail frames skip the (relatively pricey) glow so
   *              a full dash trail stays cheap on mobile.
   */
  public render(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    facingRight: boolean,
    debugMode: boolean = false,
    weaponType: WeaponType = 'UNARMED',
    ghost: boolean = false
  ): void {
    // Capture coat pins from the live player render only (first render per
    // frame). Afterimage ghosts render after this and must not overwrite them.
    if (this.coatPinArmed) {
      this.coatPinArmed = false;
      const lh = pose.leftHip;
      const rh = pose.rightHip;
      if (
        Number.isFinite(lh.x) &&
        Number.isFinite(lh.y) &&
        Number.isFinite(rh.x) &&
        Number.isFinite(rh.y)
      ) {
        this.coatPinL.x = lh.x;
        this.coatPinL.y = lh.y;
        this.coatPinR.x = rh.x;
        this.coatPinR.y = rh.y;
        this.hasCoatPins = true;
      }
    }

    ctx.save();

    // Line caps and joins for pristine limb aesthetic
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 0. Faint rim/glow so the silhouette pops off dark backdrops
    if (!ghost) this.renderRimGlow(ctx, pose);

    // 1. DARK OUTLINE PASS (wider strokes, drawn underneath everything)
    this.renderBody(ctx, pose, facingRight, weaponType, true);

    // 2. BRIGHT IVORY BODY PASS on top — leaves the dark rim around every limb
    this.renderBody(ctx, pose, facingRight, weaponType, false);

    // 3. OPTIONAL DEBUG SKELETAL OVERLAY
    if (debugMode) {
      this.renderDebugSkeleton(ctx, pose);
    }

    ctx.restore();
  }

  /**
   * One full figure pass. `outline === true` draws every shape a few pixels
   * wider in near-black (no interior detail); `false` draws the bright body
   * with its shirt, tie, cuffs and shoe highlights.
   */
  private renderBody(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    facingRight: boolean,
    weaponType: WeaponType,
    outline: boolean
  ): void {
    const backColor = outline ? PLAYER_STYLE.outline : PLAYER_STYLE.ivoryBack;
    const frontColor = outline ? PLAYER_STYLE.outline : PLAYER_STYLE.ivory;
    const grow = outline ? OUTLINE_GROW : 0;

    // 1. BACK LEG (Drawn behind body for proper depth)
    this.renderLeg(ctx, pose.leftHip, pose.leftKnee, pose.leftFoot, facingRight, backColor, outline, grow);

    // 2. BACK ARM (Drawn behind body)
    this.renderArm(ctx, pose.leftShoulder, pose.leftElbow, pose.leftHand, backColor, outline, grow);

    // 3. SUIT JACKET LOWER COAT TAILS (Flaring behind legs)
    this.renderCoatTails(ctx, outline);

    // 4. TORSO & FITTED SUIT WITH SHIRT AND TIE
    this.renderTorsoAndSuit(ctx, pose, outline);

    // 5. FRONT LEG (In front of torso)
    this.renderLeg(ctx, pose.rightHip, pose.rightKnee, pose.rightFoot, facingRight, frontColor, outline, grow);

    // 6. FRONT ARM (In front of torso)
    this.renderArm(ctx, pose.rightShoulder, pose.rightElbow, pose.rightHand, frontColor, outline, grow);

    // 7. WEAPON IN HAND (Katana or Knife)
    if (weaponType === 'KATANA') {
      this.renderKatana(ctx, pose.rightHand, pose.rightElbow, facingRight, outline);
    } else if (weaponType === 'KNIFE') {
      this.renderKnife(ctx, pose.rightHand, pose.rightElbow, facingRight, outline);
    }

    // 8. HEAD & SILHOUETTE
    this.renderHead(ctx, pose.head, facingRight, outline);
  }

  /** Soft warm halo behind the figure — cheap radial gradient, drawn first. */
  private renderRimGlow(ctx: CanvasRenderingContext2D, pose: StickFigurePose): void {
    const cx = (pose.neck.x + pose.hips.x) * 0.5;
    const cy = (pose.neck.y + pose.hips.y) * 0.5 - 14;
    const radius = 96;
    const glow = ctx.createRadialGradient(cx, cy, 6, cx, cy, radius);
    glow.addColorStop(0, `rgba(${PLAYER_STYLE.glow}, 0.20)`);
    glow.addColorStop(0.5, `rgba(${PLAYER_STYLE.glow}, 0.08)`);
    glow.addColorStop(1, `rgba(${PLAYER_STYLE.glow}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  private renderKatana(
    ctx: CanvasRenderingContext2D,
    hand: RigJoint,
    elbow: RigJoint,
    facingRight: boolean,
    outline: boolean
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

    if (outline) {
      // Dark under-stroke so the blade keeps an edge against the backdrop
      ctx.strokeStyle = PLAYER_STYLE.outline;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.quadraticCurveTo(28, -2, 52, -4);
      ctx.stroke();
      ctx.restore();
      return;
    }

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
    facingRight: boolean,
    outline: boolean
  ): void {
    const dx = hand.x - elbow.x;
    const dy = hand.y - elbow.y;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(angle);

    if (outline) {
      ctx.strokeStyle = PLAYER_STYLE.outline;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(18, 0);
      ctx.stroke();
      ctx.restore();
      return;
    }

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

  private renderHead(
    ctx: CanvasRenderingContext2D,
    head: RigJoint,
    facingRight: boolean,
    outline: boolean
  ): void {
    const headRadius = 14;

    if (outline) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, headRadius + 2, 0, Math.PI * 2);
      ctx.fillStyle = PLAYER_STYLE.outline;
      ctx.fill();
      return;
    }

    // Bright ivory skull
    ctx.beginPath();
    ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_STYLE.ivory;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = PLAYER_STYLE.outline;
    ctx.stroke();

    // Eye/brow mark toward the facing so the head never reads as a blank dot
    const f = facingRight ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(head.x + f * 3, head.y - 3);
    ctx.lineTo(head.x + f * 8, head.y - 2);
    ctx.strokeStyle = PLAYER_STYLE.detail;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private renderTorsoAndSuit(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    outline: boolean
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

    if (outline) {
      // Wide dark slab + stroke: the silhouette's dark rim comes from this
      ctx.fillStyle = PLAYER_STYLE.outline;
      ctx.fill();
      ctx.lineWidth = OUTLINE_GROW;
      ctx.strokeStyle = PLAYER_STYLE.outline;
      ctx.stroke();
      return;
    }

    ctx.fillStyle = PLAYER_STYLE.ivory;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = PLAYER_STYLE.outline;
    ctx.stroke();

    // Draw Crisp White Shirt V-Neck Collar
    const shirtWidth = 7;
    const shirtBase = {
      x: neck.x + (torso.x - neck.x) * 0.45,
      y: neck.y + (torso.y - neck.y) * 0.45,
    };

    ctx.beginPath();
    ctx.moveTo(neck.x - nx * shirtWidth, neck.y - ny * shirtWidth);
    ctx.lineTo(neck.x + nx * shirtWidth, neck.y + ny * shirtWidth);
    ctx.lineTo(shirtBase.x, shirtBase.y);
    ctx.closePath();
    ctx.fillStyle = PLAYER_STYLE.shirt;
    ctx.fill();
    // Dark edge so the white shirt still reads against the ivory jacket
    ctx.lineWidth = 1;
    ctx.strokeStyle = PLAYER_STYLE.shirtEdge;
    ctx.stroke();

    // Draw Dynamic Black Necktie (verlet rope simulation)
    this.renderTie(ctx, PLAYER_STYLE.tie);

    // Suit Lapel Lines
    ctx.beginPath();
    ctx.moveTo(neck.x - nx * (shirtWidth + 1), neck.y - ny * (shirtWidth + 1));
    ctx.lineTo(shirtBase.x - nx * 2, shirtBase.y);
    ctx.lineTo(torso.x, torso.y);
    ctx.strokeStyle = PLAYER_STYLE.detail;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(neck.x + nx * (shirtWidth + 1), neck.y + ny * (shirtWidth + 1));
    ctx.lineTo(shirtBase.x + nx * 2, shirtBase.y);
    ctx.lineTo(torso.x, torso.y);
    ctx.strokeStyle = PLAYER_STYLE.detail;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private renderTie(
    ctx: CanvasRenderingContext2D,
    tieColor: string
  ): void {
    // Verlet-simulated necktie: tapered strip through the rope points
    this.tieRope.render(ctx, tieColor);
  }

  private renderCoatTails(
    ctx: CanvasRenderingContext2D,
    outline: boolean
  ): void {
    // Two verlet coat tails pinned at the hips, drawn as tapered cloth
    // strips: narrow at the hip, flaring toward the hem. Widths match the old
    // quad's proportions (18px at the hip tapering to 12px at the hem) with
    // the same dark suit fill and edge stroke. Back-hip tail draws first so
    // the front-hip tail overlaps it correctly.
    if (outline) {
      this.coatRopeL.renderCloth(ctx, PLAYER_STYLE.outline, 9 + 3, 6 + 3, PLAYER_STYLE.outline, 3);
      this.coatRopeR.renderCloth(ctx, PLAYER_STYLE.outline, 9 + 3, 6 + 3, PLAYER_STYLE.outline, 3);
      return;
    }
    this.coatRopeL.renderCloth(ctx, PLAYER_STYLE.ivoryBack, 9, 6, PLAYER_STYLE.outline, 1.2);
    this.coatRopeR.renderCloth(ctx, PLAYER_STYLE.ivory, 9, 6, PLAYER_STYLE.outline, 1.2);
  }

  private renderArm(
    ctx: CanvasRenderingContext2D,
    shoulder: RigJoint,
    elbow: RigJoint,
    hand: RigJoint,
    limbColor: string,
    outline: boolean,
    grow: number
  ): void {
    if (outline) {
      // Dark under-stroke: whole arm in one wide pass
      ctx.strokeStyle = limbColor;
      ctx.lineWidth = 6 + grow;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.stroke();
      ctx.lineWidth = 5.2 + grow;
      ctx.beginPath();
      ctx.moveTo(elbow.x, elbow.y);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 4 + grow * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = limbColor;
      ctx.fill();
      return;
    }

    // Upper Arm (Jacket sleeve)
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Forearm (Jacket sleeve)
    ctx.beginPath();
    ctx.moveTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = 5.2;
    ctx.stroke();

    // White Shirt Cuff at wrist
    const armAngle = Math.atan2(hand.y - elbow.y, hand.x - elbow.x);
    const cuffX = hand.x - Math.cos(armAngle) * 3;
    const cuffY = hand.y - Math.sin(armAngle) * 3;
    ctx.beginPath();
    ctx.arc(cuffX, cuffY, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_STYLE.cuff;
    ctx.fill();

    // Hand / Fist
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_STYLE.shoe;
    ctx.fill();
    ctx.strokeStyle = PLAYER_STYLE.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderLeg(
    ctx: CanvasRenderingContext2D,
    hip: RigJoint,
    knee: RigJoint,
    foot: RigJoint,
    facingRight: boolean,
    limbColor: string,
    outline: boolean,
    grow: number
  ): void {
    if (outline) {
      ctx.strokeStyle = limbColor;
      ctx.lineWidth = 7 + grow;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.stroke();
      ctx.lineWidth = 5.8 + grow;
      ctx.beginPath();
      ctx.moveTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
      // Shoe halo
      const f0 = facingRight ? 1 : -1;
      ctx.beginPath();
      this.shoePath(ctx, foot.x, foot.y, f0, 1.4);
      ctx.fillStyle = limbColor;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = limbColor;
      ctx.stroke();
      return;
    }

    // Thigh (Suit Trousers)
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = 7;
    ctx.stroke();

    // Shin (Suit Trousers)
    ctx.beginPath();
    ctx.moveTo(knee.x, knee.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = 5.8;
    ctx.stroke();

    // Tapered Dress Shoe
    ctx.beginPath();
    this.shoePath(ctx, foot.x, foot.y, facingRight ? 1 : -1, 0);
    ctx.fillStyle = PLAYER_STYLE.shoe;
    ctx.fill();

    // Polished shoe rim highlight
    ctx.strokeStyle = PLAYER_STYLE.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Shared shoe silhouette (grow expands the outline pass outward). */
  private shoePath(
    ctx: CanvasRenderingContext2D,
    footX: number,
    footY: number,
    facingSign: number,
    grow: number
  ): void {
    const toeX = footX + facingSign * (11 + grow);
    const heelX = footX - facingSign * (4 + grow);
    const top = footY - 2 - grow;
    const bottom = footY + 4.5 + grow;
    ctx.moveTo(heelX, top);
    ctx.lineTo(toeX, footY);
    ctx.lineTo(toeX, bottom);
    ctx.lineTo(heelX, bottom);
    ctx.closePath();
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
