import { StickFigurePose, RigJoint, EnemyType } from '../types/game';
import type { Ragdoll } from './Ragdoll';

/**
 * DEATH CAM — the exact shape an enemy silhouette needs to be drawn.
 *
 * Declared structurally (no EnemyController import) so the replay player can
 * hand the rig a body it built from recorded states: the live controller
 * satisfies it unchanged, and a reconstruction never has to fake an AI object.
 */
export interface EnemyRigTarget {
  pose: StickFigurePose;
  facingRight: boolean;
  suitColor: string;
  skinColor: string;
  shirtColor: string;
  tieColor: string;
  isStaggered: boolean;
  /** Live tumbling body — never drawn during a replay (records have no ragdoll). */
  ragdoll: Ragdoll | null;
  health: number;
  maxHealth: number;
  ghostHealth: number;
  staggerMeter: number;
  maxStagger: number;
  state: string;
  position: { x: number; y: number };
  hpVisibleTimer: number;
  disarmTimer: number;
  type: EnemyType;
  eliteVariant: boolean;
  lastHitTime: number;
}

export interface EnemyRigOptions {
  /** Drop the overhead HP/stagger HUD (the replay overlay owns the screen). */
  showStatus?: boolean;
  /** Draw the keyframed pose even when a live ragdoll is attached. */
  ignoreRagdoll?: boolean;
}

/** HUD tag + accent colour for every archetype, so new recruits read correctly. */
const ARCHETYPE_TAGS: Record<EnemyType, [string, string]> = {
  BASIC: ['ENFORCER', '#94a3b8'],
  RUSHER: ['RUSHER', '#eab308'],
  HEAVY: ['BRUTE', '#a855f7'],
  DEFENDER: ['DEFENDER', '#60a5fa'],
  ELITE: ['ELITE', '#f472b6'],
  GUNNER: ['SHARPSHOOTER', '#7dd3fc'],
  BOSS: ['👑 ZERO [BOSS]', '#f59e0b'],
  MARQUIS: ['MARQUIS', '#d97706'],
  BERSERKER: ['BERSERKER', '#ef4444'],
  ACROBAT: ['ACROBAT', '#22d3ee'],
  SNIPER: ['SNIPER', '#4ade80'],
};

/**
 * JOB 1b (visibility): enemies render like the player — a dark outline pass
 * drawn WIDER underneath, then the mid-tone body on top — so silhouettes hold
 * up on dark stages and separate from the ivory player at a glance.
 */
const OUTLINE = '#0a0709';
const OUTLINE_GROW = 3.4;
/** Warm crimson rim behind the body so a figure never melts into the backdrop. */
const RIM_GLOW = '255, 92, 92';

/** Mix a #rrggbb toward black by t in [0,1] — used for boots / back limbs. */
function shade(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - t));
  const g = Math.round(((n >> 8) & 255) * (1 - t));
  const b = Math.round((n & 255) * (1 - t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Pre-built HP labels so the per-enemy readout never allocates a string. */
const HP_PCT_LABELS: string[] = (() => {
  const labels: string[] = new Array(101);
  for (let i = 0; i <= 100; i++) labels[i] = `${i}%`;
  return labels;
})();

export class EnemyRig {
  /** Constant-shape rim halo, rebuilt only when the drawing context changes. */
  private rimGlow: CanvasGradient | null = null;
  private rimGlowCtx: CanvasRenderingContext2D | null = null;

  public render(
    ctx: CanvasRenderingContext2D,
    enemy: EnemyRigTarget,
    debugMode: boolean = false,
    opts?: EnemyRigOptions
  ): void {
    const pose = enemy.pose;
    const isStaggered = enemy.isStaggered;
    const showStatus = opts?.showStatus !== false;
    const ignoreRagdoll = opts?.ignoreRagdoll === true;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Ragdoll death: render the tumbling body instead of the keyframed rig
    // (Ragdoll already draws its own dark under-stroke)
    if (!ignoreRagdoll && enemy.ragdoll && !enemy.ragdoll.dead) {
      enemy.ragdoll.render(ctx, enemy.suitColor, enemy.skinColor);
      ctx.restore();
      return;
    }

    // 0. Crimson rim glow — one gradient, sized to the figure
    this.renderRimGlow(ctx, pose);

    // 1. Dark outline pass (every shape a few px wider, drawn underneath)
    this.renderBody(ctx, enemy, true);

    // 2. Mid-tone body pass on top
    this.renderBody(ctx, enemy, false);

    // 2b. RIM-LIGHT PASS — a thin cool stroke on the shared key-light edge
    // (upper right) so the suited body reads as lit instead of flat.
    this.renderRimLight(ctx, pose);

    // 3. Overhead Health & Stun Bar
    if (showStatus) this.renderStatusOverhead(ctx, enemy);

    // 3b. Hit-flash: brief white glow on recent damage (cheap: one radial
    // gradient for ~90ms, alpha falls off as the flash expires)
    const sinceHit = performance.now() - enemy.lastHitTime;
    if (sinceHit < 90 && enemy.health > 0) {
      const flashAlpha = 0.55 * (1 - sinceHit / 90);
      const tx = pose.torso.x;
      const ty = pose.torso.y;
      const glow = ctx.createRadialGradient(tx, ty, 4, tx, ty, 48);
      glow.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha.toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(tx - 48, ty - 48, 96, 96);
    }

    // 4. Debug Bone Overlay
    if (debugMode) {
      this.renderDebug(ctx, pose);
    }

    ctx.restore();
  }

  /** One full figure pass: back limbs → coat → torso → front limbs → head. */
  private renderBody(ctx: CanvasRenderingContext2D, enemy: EnemyRigTarget, outline: boolean): void {
    const pose = enemy.pose;
    const facingRight = enemy.facingRight;
    const suit = enemy.suitColor;
    const grow = outline ? OUTLINE_GROW : 0;
    const backSuit = outline ? OUTLINE : shade(suit, 0.22);
    const frontSuit = outline ? OUTLINE : suit;
    const boots = outline ? OUTLINE : shade(suit, 0.42);

    // 1. Back Leg
    this.renderLeg(ctx, pose.leftHip, pose.leftKnee, pose.leftFoot, facingRight, backSuit, boots, outline, grow);

    // 2. Back Arm
    this.renderArm(ctx, pose.leftShoulder, pose.leftElbow, pose.leftHand, backSuit, outline, grow);

    // 3. Coat Tails
    this.renderCoatTails(ctx, pose.hips, facingRight, backSuit, outline, grow);

    // 4. Torso & dress shirt
    this.renderTorso(ctx, pose, frontSuit, enemy.shirtColor, enemy.tieColor, outline, grow);

    // 5. Front Leg
    this.renderLeg(ctx, pose.rightHip, pose.rightKnee, pose.rightFoot, facingRight, frontSuit, boots, outline, grow);

    // 6. Front Arm
    this.renderArm(ctx, pose.rightShoulder, pose.rightElbow, pose.rightHand, frontSuit, outline, grow);

    // 7. Head with Syndicate Enforcer red glint
    this.renderHead(ctx, pose.head, enemy.isStaggered, enemy.skinColor, outline, grow);
  }

  /**
   * P2 rim light — same key-light direction as the player (upper right) but
   * cool white, so the warm player rim and the cool enemy rim never blur
   * together. Three strokes, no gradient, no state beyond one save.
   */
  private renderRimLight(ctx: CanvasRenderingContext2D, pose: StickFigurePose): void {
    ctx.save();
    ctx.translate(2.4, -2.4);
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = 'rgba(226, 240, 255, 1)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';

    // Spine edge
    ctx.beginPath();
    ctx.moveTo(pose.neck.x, pose.neck.y);
    ctx.lineTo(pose.torso.x, pose.torso.y);
    ctx.lineTo(pose.hips.x, pose.hips.y);
    ctx.stroke();

    // Head crown arc (right half — matches the key light)
    ctx.beginPath();
    ctx.arc(pose.head.x, pose.head.y, 13, -1.15, 1.15);
    ctx.stroke();

    // Lead arm + lead thigh edges
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(pose.rightShoulder.x, pose.rightShoulder.y);
    ctx.lineTo(pose.rightElbow.x, pose.rightElbow.y);
    ctx.moveTo(pose.rightHip.x, pose.rightHip.y);
    ctx.lineTo(pose.rightKnee.x, pose.rightKnee.y);
    ctx.stroke();

    ctx.restore();
  }

  /** Soft crimson halo behind the figure — reads as a hostile tell on dark stages. */
  private renderRimGlow(ctx: CanvasRenderingContext2D, pose: StickFigurePose): void {
    const cx = (pose.neck.x + pose.hips.x) * 0.5;
    const cy = (pose.neck.y + pose.hips.y) * 0.5 - 8;
    const radius = 78;
    if (!this.rimGlow || this.rimGlowCtx !== ctx) {
      const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, radius);
      glow.addColorStop(0, `rgba(${RIM_GLOW}, 0.16)`);
      glow.addColorStop(0.5, `rgba(${RIM_GLOW}, 0.06)`);
      glow.addColorStop(1, `rgba(${RIM_GLOW}, 0)`);
      this.rimGlow = glow;
      this.rimGlowCtx = ctx;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = this.rimGlow;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  }

  private renderHead(
    ctx: CanvasRenderingContext2D,
    head: RigJoint,
    isStaggered: boolean,
    maskColor: string,
    outline: boolean,
    grow: number
  ): void {
    const headRadius = 14;

    if (outline) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, headRadius + 2, 0, Math.PI * 2);
      ctx.fillStyle = OUTLINE;
      ctx.fill();
      return;
    }

    // Masked face (mid-tone, never near-black)
    ctx.beginPath();
    ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
    ctx.fillStyle = maskColor;
    ctx.fill();

    // Dark rim so the head still separates from the suit
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Enforcer glowing eye glint (red or dizzy stars if staggered)
    if (isStaggered) {
      // Stun stars
      ctx.fillStyle = '#fbbf24';
      ctx.font = `${10 + grow * 0.4}px sans-serif`;
      ctx.fillText('💫', head.x - 7, head.y - 16);
    } else {
      // Red hostile eye pinprick
      ctx.beginPath();
      ctx.arc(head.x + 4, head.y - 2, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3b3b';
      ctx.fill();
    }
  }

  private renderTorso(
    ctx: CanvasRenderingContext2D,
    pose: StickFigurePose,
    suitColor: string,
    shirtColor: string,
    tieColor: string,
    outline: boolean,
    grow: number
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

    if (outline) {
      ctx.fillStyle = OUTLINE;
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      return;
    }

    ctx.fillStyle = suitColor;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Dress shirt V-neck
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
    ctx.fillStyle = shirtColor;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Tie
    ctx.beginPath();
    ctx.moveTo(neck.x - 2, neck.y + 2);
    ctx.lineTo(neck.x + 2, neck.y + 2);
    ctx.lineTo(shirtBase.x, shirtBase.y + 8);
    ctx.strokeStyle = tieColor;
    ctx.lineWidth = 3 + grow * 0.2;
    ctx.stroke();
  }

  private renderArm(
    ctx: CanvasRenderingContext2D,
    shoulder: RigJoint,
    elbow: RigJoint,
    hand: RigJoint,
    suitColor: string,
    outline: boolean,
    grow: number
  ): void {
    if (outline) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 6.5 + grow;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.stroke();
      ctx.lineWidth = 5.8 + grow;
      ctx.beginPath();
      ctx.moveTo(elbow.x, elbow.y);
      ctx.lineTo(hand.x, hand.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 4.2 + grow * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = OUTLINE;
      ctx.fill();
      return;
    }

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
    ctx.fillStyle = '#d1462f';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
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
    shoeColor: string,
    outline: boolean,
    grow: number
  ): void {
    if (outline) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 7.5 + grow;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.stroke();
      ctx.lineWidth = 6.2 + grow;
      ctx.beginPath();
      ctx.moveTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
      ctx.stroke();
      ctx.beginPath();
      this.bootPath(ctx, foot.x, foot.y, facingRight ? 1 : -1, grow);
      ctx.fillStyle = OUTLINE;
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      return;
    }

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
    ctx.beginPath();
    this.bootPath(ctx, foot.x, foot.y, facingRight ? 1 : -1, 0);
    ctx.fillStyle = shoeColor;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Shared combat-boot silhouette (grow expands the outline pass outward). */
  private bootPath(
    ctx: CanvasRenderingContext2D,
    footX: number,
    footY: number,
    dir: number,
    grow: number
  ): void {
    ctx.moveTo(footX - dir * (4 + grow), footY - 3 - grow);
    ctx.lineTo(footX + dir * (12 + grow), footY + grow);
    ctx.lineTo(footX + dir * (12 + grow), footY + 5 + grow);
    ctx.lineTo(footX - dir * (4 + grow), footY + 5 + grow);
    ctx.closePath();
  }

  private renderCoatTails(
    ctx: CanvasRenderingContext2D,
    hips: RigJoint,
    facingRight: boolean,
    suitColor: string,
    outline: boolean,
    grow: number
  ): void {
    const dir = facingRight ? -1 : 1;
    const g = grow * 0.6;
    ctx.beginPath();
    ctx.moveTo(hips.x - 10 - g, hips.y - g);
    ctx.lineTo(hips.x + 10 + g, hips.y - g);
    ctx.lineTo(hips.x + dir * 12 + 6 + g, hips.y + 18 + g);
    ctx.lineTo(hips.x + dir * 12 - 6 - g, hips.y + 18 + g);
    ctx.closePath();
    ctx.fillStyle = suitColor;
    ctx.fill();
    if (outline) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
  }

  private renderStatusOverhead(ctx: CanvasRenderingContext2D, enemy: EnemyRigTarget): void {
    if (enemy.health <= 0 && enemy.state === 'DOWNED') return;

    // Direct User Mandate: Only display health bar when enemy has taken damage recently!
    // PHASE 1B 3: a disarmed archer/gunner shows its tag for the whole window,
    // so the player can see the opening (visible even with no recent damage).
    const isVisible =
      enemy.hpVisibleTimer > 0 ||
      enemy.isStaggered ||
      enemy.state === 'BLOCK' ||
      enemy.disarmTimer > 0;
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

    // P4 colour-blind cue: a hard 50% notch across the bar reads as a shape
    // landmark, so remaining health never depends on the red fill alone.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillRect(x + barWidth * 0.5 - 0.5, y, 1, barHeight);

    // Stagger / Stun bar underneath
    const stWidth = barWidth;
    const stHeight = 2.5;
    const stY = y + barHeight + 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x - 1, stY - 1, stWidth + 2, stHeight + 2);

    const stRatio = Math.min(1, enemy.staggerMeter / enemy.maxStagger);
    ctx.fillStyle = enemy.isStaggered ? '#fbbf24' : '#38bdf8';
    ctx.fillRect(x, stY, stWidth * stRatio, stHeight);

    // P4 colour-blind cue: numeric HP so the red/amber fills are never the
    // only signal. Sits clear of the status tag above the bar.
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e5e7eb';
    const hpPct = Math.max(0, Math.min(100, Math.ceil(hpRatio * 100)));
    ctx.fillText(HP_PCT_LABELS[hpPct], x + barWidth + 3, y + barHeight);

    // Tag label
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';

    if (enemy.isStaggered) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('STAGGERED [GRAB!]', enemy.position.x, y - 5);
    } else if (enemy.state === 'WINDUP') {
      ctx.fillStyle = '#ef4444';
      ctx.fillText('⚠️ ATTACK!', enemy.position.x, y - 5);
    } else if (enemy.disarmTimer > 0) {
      // PHASE 1B 3: gun gone — its own blinking tag marks the punish window
      const blink = Math.sin(performance.now() * 0.01) > -0.2;
      ctx.fillStyle = blink ? '#fb923c' : '#7c2d12';
      ctx.fillText('💥 DISARMED', enemy.position.x, y - 5);
    } else if (enemy.state === 'BLOCK') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('🛡️ GUARD', enemy.position.x, y - 5);
    } else {
      const [typeLabel, tagColor] = ARCHETYPE_TAGS[enemy.type] ?? ARCHETYPE_TAGS.BASIC;
      // Phase 1 C5: promoted elites carry a violet ★ in front of their rank
      ctx.fillStyle = enemy.eliteVariant ? '#f472b6' : tagColor;
      ctx.fillText(
        enemy.eliteVariant ? `★ ${typeLabel}` : typeLabel,
        enemy.position.x,
        y - 5
      );
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
