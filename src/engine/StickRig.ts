import { StickFigurePose, RigJoint, WeaponType } from '../types/game';
import { TieRope } from './TieRope';
import { PLAYER_STYLE, WEAPON_TINT } from './Palettes';

/**
 * JOB 1 (visibility) + OWNER CHARACTER DESIGN (2026-10-03):
 * John Stick is a CLEAN PLAIN STICK FIGURE — thin limbs, round head, no suit,
 * no jacket, no lapels, no shirt, no shoes. Exactly ONE garment: the red
 * cloth-physics necktie, which keeps its verlet swing (movement, attacks,
 * landings) and reads as the signature against the ivory body.
 *
 * Readability contract (why the figure is still big on screen):
 *   - bright ivory silhouette + dark under-stroke (outline pass) on any stage
 *   - warm rim/halo behind the figure
 *   - larger round head (16 px) so the head/shoulders mass reads at a glance
 *   - bold spine + shoulder bar carry the silhouette now that the suit slab is
 *     gone, while limbs stay deliberately THIN
 *   - FIGURE_SCALE grows the whole rig about its ground-contact point, so the
 *     character owns more of the frame without touching any hitbox (combat
 *     reads physics/pose joints, never this transform)
 *
 * Enemies keep their suited, bulky silhouette (EnemyRig) — friend/foe still
 * separates at a glance: lean ivory stick vs. mid-tone suited bodies.
 *
 * PHASE 2: the live palette + weapon tint live in ./Palettes as module state,
 * so a skin/tint swap repaints on the next frame with no render-code edits.
 */

/** Dark under-stroke growth applied in the outline pass (half = rim width). */
const OUTLINE_GROW = 3.6;

/**
 * Owner mandate: bigger, more readable silhouette. Uniform visual scale about
 * the ground-contact point (feet), so the head/torso extend upward while the
 * feet stay planted. Purely presentational — no combat value reads this.
 */
export const FIGURE_SCALE = 1.07;

/** Plain-stick body weights — thin limbs, bold spine, big round head. */
const SPINE_W = 8.5;
const SHOULDER_W = 6.5;
const UPPER_ARM_W = 5;
const FOREARM_W = 4.4;
const THIGH_W = 6;
const SHIN_W = 5;
const HAND_R = 3.8;
const HEAD_R = 16;
const FOOT_TOE = 8;
const FOOT_HEEL = 3;
const FOOT_W = 4.5;

export class StickRig {
  private tieRope = new TieRope();
  /** Constant-shape rim halo, rebuilt only for a new context or palette. */
  private rimGlow: CanvasGradient | null = null;
  private rimGlowCtx: CanvasRenderingContext2D | null = null;
  private rimGlowColor = '';

  /**
   * Updates the cloth-physics necktie: verlet rope pinned at the collar,
   * swinging with momentum, lagging sudden movement, fluttering on attacks.
   * (The jacket coat tails are gone with the suit — the tie is the only
   * secondary cloth left.)
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
    this.tieRope.update(pinX, pinY, vx, vy, facingRight, dt, flutter);
  }

  /**
   * Renders the plain stick figure: rim glow → dark outline pass → bright body
   * pass (spine, thin limbs, red tie, round head), all uniformly scaled about
   * the ground-contact point for the owner's bigger silhouette.
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
    ghost: boolean = false,
    deformX: number = 1,
    deformY: number = 1
  ): void {
    ctx.save();

    // Line caps and joins for pristine limb aesthetic
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Bigger readable silhouette: scale about the ground-contact point so the
    // feet never lift off the floor. Everything drawn after this (tie included)
    // shares the transform, so the figure stays internally consistent.
    // deformX/Y layer P2 squash-and-stretch (landing / hit) on top of it.
    const pivotX = pose.hips.x;
    const feetY = Math.max(pose.leftFoot.y, pose.rightFoot.y);
    const pivotY = Number.isFinite(feetY) ? feetY : pose.hips.y;
    const sx = FIGURE_SCALE * deformX;
    const sy = FIGURE_SCALE * deformY;
    if (Number.isFinite(pivotX) && Number.isFinite(pivotY)) {
      ctx.translate(pivotX, pivotY);
      ctx.scale(sx, sy);
      ctx.translate(-pivotX, -pivotY);
    }

    // 0. Faint rim/glow so the silhouette pops off dark backdrops
    if (!ghost) this.renderRimGlow(ctx, pose);

    // 1. DARK OUTLINE PASS (wider strokes, drawn underneath everything)
    this.renderBody(ctx, pose, facingRight, weaponType, true);

    // 2. BRIGHT IVORY BODY PASS on top — leaves the dark rim around every limb
    this.renderBody(ctx, pose, facingRight, weaponType, false);

    // 3. RIM-LIGHT PASS — one warm key-light edge so the figure reads as lit,
    //    not flat. Skipped on afterimage ghosts (they pay for the glow already).
    if (!ghost) this.renderRimLight(ctx, pose);

    // 4. OPTIONAL DEBUG SKELETAL OVERLAY
    if (debugMode) {
      this.renderDebugSkeleton(ctx, pose);
    }

    ctx.restore();
  }

  /**
   * P2 rim light — a thin warm stroke offset toward the scene key light
   * (upper right), tracing spine, head and the lead arm. Three strokes per
   * frame: the cheapest possible "lit from the front" read on a stick figure.
   */
  private renderRimLight(ctx: CanvasRenderingContext2D, pose: StickFigurePose): void {
    ctx.save();
    ctx.translate(2.6, -2.6);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = `rgba(${PLAYER_STYLE.glow}, 1)`;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';

    // Spine edge
    ctx.beginPath();
    ctx.moveTo(pose.neck.x, pose.neck.y);
    ctx.lineTo(pose.torso.x, pose.torso.y);
    ctx.lineTo(pose.hips.x, pose.hips.y);
    ctx.stroke();

    // Head crown arc (right half — matches the global key light)
    ctx.beginPath();
    ctx.arc(pose.head.x, pose.head.y, HEAD_R - 1, -1.15, 1.15);
    ctx.stroke();

    // Lead arm + lead thigh edges
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pose.rightShoulder.x, pose.rightShoulder.y);
    ctx.lineTo(pose.rightElbow.x, pose.rightElbow.y);
    ctx.moveTo(pose.rightHip.x, pose.rightHip.y);
    ctx.lineTo(pose.rightKnee.x, pose.rightKnee.y);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * One full figure pass. `outline === true` draws every shape a few pixels
   * wider in near-black (no interior detail — the tie skips it too); `false`
   * draws the bright body: thin limbs, bold spine, red tie, round head.
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

    // 1. BACK LEG (behind the body for proper depth)
    this.renderLeg(ctx, pose.leftHip, pose.leftKnee, pose.leftFoot, facingRight, backColor, outline, grow);

    // 2. BACK ARM (behind the torso)
    this.renderArm(ctx, pose.leftShoulder, pose.leftElbow, pose.leftHand, backColor, outline, grow);

    // 3. TORSO — plain spine + shoulder bar (the suit slab is gone)
    this.renderTorso(ctx, pose, frontColor, outline, grow);

    // 4. THE RED TIE (verlet cloth, body pass only — the outline pass leaves
    //    the chest dark so the tie keeps its edge without a second render)
    if (!outline) this.renderTie(ctx, PLAYER_STYLE.tie);

    // 5. FRONT LEG (in front of the torso)
    this.renderLeg(ctx, pose.rightHip, pose.rightKnee, pose.rightFoot, facingRight, frontColor, outline, grow);

    // 6. FRONT ARM (in front of the torso + tie)
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

  /** Soft warm halo behind the figure — cached radial gradient, drawn first. */
  private renderRimGlow(ctx: CanvasRenderingContext2D, pose: StickFigurePose): void {
    const cx = (pose.neck.x + pose.hips.x) * 0.5;
    const cy = (pose.neck.y + pose.hips.y) * 0.5 - 14;
    const radius = 96;
    if (!this.rimGlow || this.rimGlowCtx !== ctx || this.rimGlowColor !== PLAYER_STYLE.glow) {
      const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, radius);
      glow.addColorStop(0, `rgba(${PLAYER_STYLE.glow}, 0.20)`);
      glow.addColorStop(0.5, `rgba(${PLAYER_STYLE.glow}, 0.08)`);
      glow.addColorStop(1, `rgba(${PLAYER_STYLE.glow}, 0)`);
      this.rimGlow = glow;
      this.rimGlowCtx = ctx;
      this.rimGlowColor = PLAYER_STYLE.glow;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = this.rimGlow;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
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
    ctx.strokeStyle = WEAPON_TINT.grip;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(2, 0);
    ctx.stroke();

    // Guard (Tsuba)
    ctx.strokeStyle = WEAPON_TINT.guard;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(2, -6);
    ctx.lineTo(2, 6);
    ctx.stroke();

    // Polished steel blade (Hawatari)
    ctx.strokeStyle = WEAPON_TINT.blade;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(3, 0);
    // Slight authentic Katana curve
    ctx.quadraticCurveTo(28, -2, 52, -4);
    ctx.stroke();

    // Blade glow
    ctx.strokeStyle = WEAPON_TINT.glow;
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
    ctx.strokeStyle = WEAPON_TINT.grip;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(2, 0);
    ctx.stroke();

    // Blade
    ctx.strokeStyle = WEAPON_TINT.blade;
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
    if (outline) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, HEAD_R + 2, 0, Math.PI * 2);
      ctx.fillStyle = PLAYER_STYLE.outline;
      ctx.fill();
      return;
    }

    // Bright ivory skull — big enough to read as a head at phone size
    ctx.beginPath();
    ctx.arc(head.x, head.y, HEAD_R, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_STYLE.ivory;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = PLAYER_STYLE.outline;
    ctx.stroke();

    // Eye/brow mark toward the facing so the head never reads as a blank dot
    const f = facingRight ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(head.x + f * 3, head.y - 3);
    ctx.lineTo(head.x + f * 9, head.y - 2);
    ctx.strokeStyle = PLAYER_STYLE.detail;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * Plain stick torso: a bold spine (neck → torso → hips) plus a shoulder bar
   * through the shoulder joints. No jacket, no shirt, no lapels — the tie and
   * the outline do the rest of the talking.
   */
  private renderTorso(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    color: string,
    outline: boolean,
    grow: number
  ): void {
    const { neck, torso, hips, leftShoulder, rightShoulder } = pose;

    // Shoulder bar — gives the silhouette width where the jacket used to
    ctx.strokeStyle = color;
    ctx.lineWidth = SHOULDER_W + grow;
    ctx.beginPath();
    ctx.moveTo(leftShoulder.x, leftShoulder.y);
    ctx.lineTo(rightShoulder.x, rightShoulder.y);
    ctx.stroke();

    // Spine: neck → mid-chest → hips, one continuous bold stroke
    ctx.lineWidth = SPINE_W + grow;
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    ctx.lineTo(torso.x, torso.y);
    ctx.lineTo(hips.x, hips.y);
    ctx.stroke();

    if (outline) return;

    // Neck knob so head/spine seam doesn't read as a break
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(neck.x, neck.y, SHOULDER_W * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The ONE garment: verlet-simulated red necktie through the rope points. */
  private renderTie(
    ctx: CanvasRenderingContext2D,
    tieColor: string
  ): void {
    this.tieRope.render(ctx, tieColor);
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
      ctx.lineWidth = UPPER_ARM_W + grow;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.stroke();
      ctx.lineWidth = FOREARM_W + grow;
      ctx.beginPath();
      ctx.moveTo(elbow.x, elbow.y);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, HAND_R + grow * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = limbColor;
      ctx.fill();
      return;
    }

    // Upper arm
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = UPPER_ARM_W;
    ctx.stroke();

    // Forearm
    ctx.beginPath();
    ctx.moveTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = FOREARM_W;
    ctx.stroke();

    // Hand / fist knob
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, HAND_R, 0, Math.PI * 2);
    ctx.fillStyle = limbColor;
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
      ctx.lineWidth = THIGH_W + grow;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.stroke();
      ctx.lineWidth = SHIN_W + grow;
      ctx.beginPath();
      ctx.moveTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
      // Foot halo (plain foot stroke, no dress shoe)
      ctx.beginPath();
      this.footPath(ctx, foot.x, foot.y, facingRight ? 1 : -1, grow);
      ctx.lineWidth = FOOT_W + grow;
      ctx.strokeStyle = limbColor;
      ctx.stroke();
      return;
    }

    // Thigh
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = THIGH_W;
    ctx.stroke();

    // Shin
    ctx.beginPath();
    ctx.moveTo(knee.x, knee.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = SHIN_W;
    ctx.stroke();

    // Plain foot: a short heel→toe stroke (no shoe silhouette)
    ctx.beginPath();
    this.footPath(ctx, foot.x, foot.y, facingRight ? 1 : -1, 0);
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = FOOT_W;
    ctx.stroke();
  }

  /** Plain foot stroke (heel → toe) — grow expands the outline pass outward. */
  private footPath(
    ctx: CanvasRenderingContext2D,
    footX: number,
    footY: number,
    facingSign: number,
    grow: number
  ): void {
    ctx.moveTo(footX - facingSign * (FOOT_HEEL + grow * 0.4), footY);
    ctx.lineTo(footX + facingSign * (FOOT_TOE + grow * 0.4), footY - 1.5);
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
