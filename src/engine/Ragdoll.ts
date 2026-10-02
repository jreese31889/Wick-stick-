import { StickFigurePose, RigJoint } from '../types/game';
import { ObjectPool } from './ObjectPool';

/**
 * Full-body verlet ragdoll for death sequences.
 *
 * Spawned from a character's keyframed pose at the killing blow: 16 verlet
 * points (head, neck, chest, hips, upper/fore arms x2, thighs/shins/feet x2)
 * linked by distance constraints, with gravity, ground-plane collision
 * (bounce + friction) and the killing impulse baked in as initial velocity.
 *
 * Beyond the rigid bone links the solver carries a set of soft *limit*
 * constraints that mimic real joint anatomy: elbows/knees cannot hyperextend
 * past straight or fold flat, the pelvis and shoulder girdle resist shearing,
 * the neck cannot double back, and limbs cannot pass through the torso.
 * Bodies also bounce off the arena side walls and ceiling, not just the
 * floor, and report hard impacts so the Renderer can kick up dust/sparks.
 * Solver is kept cheap for mobile: 16 points, ~26 constraints,
 * 3 relaxation iterations (1 once the body has settled to sleep).
 */
interface RagdollPoint {
  x: number;
  y: number;
  px: number;
  py: number;
}

interface RagdollConstraint {
  a: number;
  b: number;
  rest: number;
  /** Lower/upper distance bounds — a limit constraint only corrects when out of range */
  min: number;
  max: number;
  /** 1 = rigid bone, <1 = soft anatomical limit */
  stiff: number;
}

/** Arena interior half-width (ARENA_BOUND 840 minus the point radius) */
const WALL_X = 836;
/** Highest a flung body may travel before it is capped */
const CEILING_Y = -620;

export class Ragdoll {
  private pts: RagdollPoint[] = [];
  private cons: RagdollConstraint[] = [];
  public age = 0;
  public dead = false;
  private readonly fadeStart = 4.5;
  private readonly maxAge = 7;

  // Sleep state: once every point has been nearly still for a beat, the
  // solver drops to a single cheap relaxation pass (the body just fades out)
  private sleepTimer = 0;
  private asleep = false;
  /** M14: frame divider so a settled body solves at ~15 Hz, not 60 Hz. */
  private sleepFrame = 0;

  constructor(pose?: StickFigurePose, impulseVX: number = 0, impulseVY: number = 0) {
    // P3-02: the pooled path calls reset() on an acquired shell, so seeding is
    // optional here (ragdollPool's factory builds an empty shell).
    if (pose !== undefined) this.reset(pose, impulseVX, impulseVY);
  }

  /**
   * P3-02: (re)seeds the body from a character's pose and killing impulse.
   * A recycled shell overwrites everything in place: the 16 point slots and
   * the fixed ~30-constraint skeleton are both reused, so a death after the
   * pool has warmed up allocates nothing (~45 objects previously).
   */
  public reset(pose: StickFigurePose, impulseVX: number, impulseVY: number): void {
    // Sanitize the seed: a degenerate joint (NaN/Infinity from a pose that
    // was never generated) falls back to the last good joint, and a bad
    // impulse becomes zero — one bad value must not poison the whole solver.
    const ivx = Number.isFinite(impulseVX) ? impulseVX : 0;
    const ivy = Number.isFinite(impulseVY) ? impulseVY : 0;
    this.age = 0;
    this.dead = false;
    this.sleepTimer = 0;
    this.asleep = false;
    this.sleepFrame = 0;

    const dt0 = 1 / 60;
    let lastX = 0;
    let lastY = -60; // sane above-ground default
    const setPoint = (i: number, j: RigJoint): void => {
      let cx: number;
      let cy: number;
      if (Number.isFinite(j.x) && Number.isFinite(j.y)) {
        lastX = cx = j.x;
        lastY = cy = j.y;
      } else {
        cx = lastX;
        cy = lastY;
      }
      // Per-point variation so bodies don't tumble identically
      const wobble = 1 + (Math.random() - 0.5) * 0.35;
      let p = this.pts[i];
      if (p === undefined) {
        p = { x: 0, y: 0, px: 0, py: 0 };
        this.pts[i] = p;
      }
      p.x = cx;
      p.y = cy;
      p.px = cx - ivx * wobble * dt0;
      p.py = cy - ivy * wobble * dt0;
    };
    setPoint(0, pose.head);          // 0
    setPoint(1, pose.neck);          // 1
    setPoint(2, pose.torso);         // 2 (chest)
    setPoint(3, pose.hips);          // 3
    setPoint(4, pose.leftShoulder);  // 4
    setPoint(5, pose.leftElbow);     // 5
    setPoint(6, pose.leftHand);      // 6
    setPoint(7, pose.rightShoulder); // 7
    setPoint(8, pose.rightElbow);    // 8
    setPoint(9, pose.rightHand);     // 9
    setPoint(10, pose.leftHip);      // 10
    setPoint(11, pose.leftKnee);     // 11
    setPoint(12, pose.leftFoot);     // 12
    setPoint(13, pose.rightHip);     // 13
    setPoint(14, pose.rightKnee);    // 14
    setPoint(15, pose.rightFoot);    // 15
    this.pts.length = 16;

    // The constraint skeleton is structurally fixed (same a/b pairs and
    // stiffness every time) — slots are updated in place, new ones pushed
    // only while the shell is fresh.
    let ci = 0;
    const setCon = (
      a: number, b: number, rest: number,
      min: number, max: number, stiff: number
    ): void => {
      const c = this.cons[ci++];
      if (c === undefined) {
        this.cons.push({ a, b, rest, min, max, stiff });
      } else {
        c.a = a;
        c.b = b;
        c.rest = rest;
        c.min = min;
        c.max = max;
        c.stiff = stiff;
      }
    };

    // --- Rigid bone links (slight slack keeps the solver stable) ---
    const bone = (a: number, b: number) => {
      const rest = this.dist(a, b);
      setCon(a, b, rest, rest * 0.98, rest * 1.02, 1);
    };
    bone(0, 1);
    bone(1, 2);
    bone(2, 3); // spine
    bone(1, 4);
    bone(4, 5);
    bone(5, 6); // arm L
    bone(1, 7);
    bone(7, 8);
    bone(8, 9); // arm R
    bone(3, 10);
    bone(10, 11);
    bone(11, 12); // leg L
    bone(3, 13);
    bone(13, 14);
    bone(14, 15); // leg R

    // --- Anatomical limit constraints (soft, only act when violated) ---
    const armL = this.len(4, 5) + this.len(5, 6);
    const armR = this.len(7, 8) + this.len(8, 9);
    const legL = this.len(10, 11) + this.len(11, 12);
    const legR = this.len(13, 14) + this.len(14, 15);
    const limit = (a: number, b: number, min: number, max: number, stiff: number) => {
      setCon(a, b, this.dist(a, b), min, max, stiff);
    };

    // Elbows & knees: never hyperextend past straight, never fold to zero
    limit(4, 6, armL * 0.32, armL * 1.0, 0.6);
    limit(7, 9, armR * 0.32, armR * 1.0, 0.6);
    limit(10, 12, legL * 0.3, legL * 1.0, 0.6);
    limit(13, 15, legR * 0.3, legR * 1.0, 0.6);

    // Pelvis & shoulder girdle: resist shearing so the torso stays a slab
    limit(10, 13, this.dist(10, 13) * 0.86, this.dist(10, 13) * 1.14, 0.85);
    limit(4, 7, this.dist(4, 7) * 0.84, this.dist(4, 7) * 1.16, 0.8);
    // Torso cross-braces (shoulder -> opposite hip)
    limit(4, 13, this.dist(4, 13) * 0.74, this.dist(4, 13) * 1.14, 0.55);
    limit(7, 10, this.dist(7, 10) * 0.74, this.dist(7, 10) * 1.14, 0.55);

    // Neck: may flex but cannot fold flat or snap backwards
    limit(0, 2, this.dist(0, 2) * 0.6, this.dist(0, 2) * 1.06, 0.5);

    // Limbs cannot punch through the torso core
    limit(6, 3, this.dist(6, 3) * 0.42, this.dist(6, 3) * 1.4, 0.45);
    limit(9, 3, this.dist(9, 3) * 0.42, this.dist(9, 3) * 1.4, 0.45);
    limit(12, 1, this.dist(12, 1) * 0.5, this.dist(12, 1) * 1.35, 0.45);
    limit(15, 1, this.dist(15, 1) * 0.5, this.dist(15, 1) * 1.35, 0.45);
    this.cons.length = ci;
  }

  private len(a: number, b: number): number {
    return Math.max(4, this.dist(a, b));
  }

  private dist(a: number, b: number): number {
    return Math.max(4, Math.hypot(this.pts[b].x - this.pts[a].x, this.pts[b].y - this.pts[a].y));
  }

  public update(dt: number): void {
    // Guard degenerate timesteps (tab-switch glitches, slow-mo edge cases):
    // a bad dt must freeze the body for a frame, not explode it
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const step = Math.min(dt, 0.033);
    this.age += step;
    if (this.age >= this.maxAge) {
      this.dead = true;
      return;
    }

    // Sleep check: everything nearly at rest -> single relaxation pass only
    let maxSpeed = 0;
    for (const p of this.pts) {
      const s = Math.abs(p.x - p.px) + Math.abs(p.y - p.py);
      if (s > maxSpeed) maxSpeed = s;
    }
    if (maxSpeed < 1.1) {
      this.sleepTimer += step;
      if (this.sleepTimer > 0.35) this.asleep = true;
    } else {
      this.sleepTimer = 0;
      this.asleep = false;
      this.sleepFrame = 0;
    }

    if (this.asleep) {
      // Frozen body: one soft pass keeps the pose from creeping, no physics.
      // M14: a settled body cannot actually move, so the pass only needs to
      // run every 4th frame (~15 Hz); `age` still advances every frame, so
      // the fade-out timing is untouched.
      this.sleepFrame = (this.sleepFrame + 1) & 3;
      if (this.sleepFrame === 0) this.solve(1, 0.5);
      return;
    }

    const gravity = 2400;
    const damping = 0.992;
    // Max per-step travel: stops fast bodies tunneling deep past the ground
    // plane between collision passes (substep-equivalent, far cheaper)
    const maxDisp = 96;

    for (const p of this.pts) {
      // Backstop: a poisoned point snaps to a safe above-ground spot with
      // zero velocity instead of corrupting its neighbors
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.px) ||
        !Number.isFinite(p.py)
      ) {
        p.x = 0;
        p.y = -60;
        p.px = 0;
        p.py = -60;
        continue;
      }
      const tx = p.x;
      const ty = p.y;
      let nx = p.x + (p.x - p.px) * damping;
      let ny = p.y + (p.y - p.py) * damping + gravity * step * step;
      const dx = nx - tx;
      const dy = ny - ty;
      if (dx > maxDisp) nx = tx + maxDisp;
      else if (dx < -maxDisp) nx = tx - maxDisp;
      if (dy > maxDisp) ny = ty + maxDisp;
      else if (dy < -maxDisp) ny = ty - maxDisp;
      p.x = nx;
      p.y = ny;
      p.px = tx;
      p.py = ty;
    }

    // Distance + joint-limit relaxation (3 iterations is cheap & stable)
    this.solve(3, 1);

    // Collision pass AFTER relaxation so bounce + friction apply once/frame.
    for (const p of this.pts) {
      const vx = p.x - p.px;
      const vy = p.y - p.py;

      // Floor (y = 0): bounce with restitution, bleed tangential speed
      if (p.y > 0) {
        p.y = 0;
        p.py = p.y + vy * 0.36;            // reflect normal velocity
        p.px += (p.x - p.px) * 0.25;       // ground friction
        if (Math.abs(p.x - p.px) < 0.25 && Math.abs(p.y - p.py) < 0.25) {
          p.px = p.x;
          p.py = p.y; // kill micro jitter so the body can sleep
        }
      } else if (p.y < CEILING_Y) {
        // Ceiling cap keeps flung bodies inside the play space
        p.y = CEILING_Y;
        p.py = p.y + vy * 0.4;
      }

      // Arena side walls: reflect + wall friction (the body bounces, not sticks)
      if (p.x > WALL_X) {
        p.x = WALL_X;
        p.px = p.x + vx * 0.5;              // reflect horizontal velocity
        p.py += (p.y - p.py) * 0.18;        // wall friction
      } else if (p.x < -WALL_X) {
        p.x = -WALL_X;
        p.px = p.x + vx * 0.5;
        p.py += (p.y - p.py) * 0.18;
      }
    }
  }

  /** Relaxation sweep: rigid bones always, limit constraints only when out of range. */
  private solve(iterations: number, strength: number): void {
    for (let k = 0; k < iterations; k++) {
      for (const c of this.cons) {
        const a = this.pts[c.a];
        const b = this.pts[c.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (!(dist > 0.0001)) continue; // degenerate/NaN segment: skip

        let target = dist;
        if (dist > c.max) target = c.max;
        else if (dist < c.min) target = c.min;
        else continue; // inside the allowed range: no work

        const diff = ((target - dist) / dist) * 0.5 * c.stiff * strength;
        a.x += dx * diff;
        a.y += dy * diff;
        b.x -= dx * diff;
        b.y -= dy * diff;
      }
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    limbColor: string,
    headColor: string,
    accentColor?: string
  ): void {
    let alpha = 1;
    if (this.age > this.fadeStart) {
      alpha = Math.max(
        0,
        1 - (this.age - this.fadeStart) / (this.maxAge - this.fadeStart)
      );
    }
    if (alpha <= 0 || this.dead || this.pts.length === 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- Ground contact shadow (grounds the body against the floor plane) ---
    let lowX = 0;
    let lowY = -1e9;
    for (const p of this.pts) {
      if (p.y > lowY) {
        lowY = p.y;
        lowX = p.x;
      }
    }
    if (lowY > -420) {
      const near = Math.max(0, 1 - Math.max(0, -lowY) / 420);
      ctx.globalAlpha = alpha * 0.4 * near;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.beginPath();
      ctx.ellipse(lowX, 0, 34 * (0.55 + near * 0.45), 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }

    const seg = (a: number, b: number) => {
      ctx.beginPath();
      ctx.moveTo(this.pts[a].x, this.pts[a].y);
      ctx.lineTo(this.pts[b].x, this.pts[b].y);
      ctx.stroke();
    };

    // Pass 1: soft dark under-stroke — cheap depth without shadowBlur
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 11;
    seg(1, 2);
    seg(2, 3);
    ctx.lineWidth = 8;
    seg(1, 4); seg(4, 5); seg(5, 6);
    seg(1, 7); seg(7, 8); seg(8, 9);
    ctx.lineWidth = 9;
    seg(3, 10); seg(10, 11); seg(11, 12);
    seg(3, 13); seg(13, 14); seg(14, 15);

    // Pass 2: body strokes
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = 8;
    seg(1, 2);
    seg(2, 3);
    ctx.lineWidth = 5.5;
    seg(1, 4);
    seg(4, 5);
    seg(5, 6);
    seg(1, 7);
    seg(7, 8);
    seg(8, 9);
    ctx.lineWidth = 6.5;
    seg(3, 10);
    seg(10, 11);
    seg(11, 12);
    seg(3, 13);
    seg(13, 14);
    seg(14, 15);

    // Joint caps hide the stroke seams and read as articulation points
    ctx.fillStyle = limbColor;
    for (const i of [1, 2, 3, 5, 8, 11, 14]) {
      ctx.beginPath();
      ctx.arc(this.pts[i].x, this.pts[i].y, i === 1 || i === 3 ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Optional accent rim (used by the player skin's glow colour)
    if (accentColor) {
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      seg(1, 2);
      seg(3, 10);
      seg(3, 13);
      ctx.globalAlpha = alpha;
    }

    // Head
    ctx.fillStyle = headColor;
    ctx.beginPath();
    ctx.arc(this.pts[0].x, this.pts[0].y, 9, 0, Math.PI * 2);
    ctx.fill();
    // Skull highlight so the head doesn't read as a flat hole
    ctx.globalAlpha = alpha * 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.pts[0].x - 3, this.pts[0].y - 3.5, 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

/**
 * P3-02: free list for death bodies. Call sites acquire + reset() on the
 * killing blow and release the shell when the owner drops the corpse
 * (GameLoop.spawnSquad / resetFight / fullReset), so a fight that ends 20
 * bodies keeps recycling the same ~16-point / ~30-constraint shells instead
 * of allocating ~45 objects per death.
 */
export const ragdollPool = new ObjectPool<Ragdoll>(() => new Ragdoll(), 24);
