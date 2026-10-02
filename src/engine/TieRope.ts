/**
 * Verlet rope simulation for John Wick's necktie — and now the jacket
 * coat tails too.
 *
 * Generic: the constructor takes segment count, segment length, damping and
 * gravity so coat tails can reuse the same solver with heavier cloth
 * settings. The collar node is pinned to the neck joint every frame; the
 * remaining segments swing with verlet momentum, lag behind sudden movement
 * via constraint relaxation, and flutter from body velocity + attack
 * agitation. Rendered as a tapered strip (narrow knot -> wide blade)
 * through the points.
 */
export interface TiePoint {
  x: number;
  y: number;
  px: number;
  py: number;
}

export class TieRope {
  private points: TiePoint[] = [];
  private readonly segments: number;
  private readonly segLen: number;
  private readonly damping: number;
  private readonly gravity: number;
  private time = 0;
  private initialized = false;

  // Preallocated strip buffers — render stays allocation-free per frame
  private readonly bufLX: number[];
  private readonly bufLY: number[];
  private readonly bufRX: number[];
  private readonly bufRY: number[];

  constructor(segments = 7, segLen = 4.6, damping = 0.985, gravity = 1500) {
    this.segments = Math.max(1, Math.floor(segments));
    this.segLen = Math.max(1, segLen);
    this.damping = damping;
    this.gravity = gravity;
    const n = this.segments + 1;
    this.bufLX = new Array<number>(n).fill(0);
    this.bufLY = new Array<number>(n).fill(0);
    this.bufRX = new Array<number>(n).fill(0);
    this.bufRY = new Array<number>(n).fill(0);
  }

  /**
   * @param pinX pinY  collar anchor in world space (neck joint)
   * @param vx vy     character velocity (drives relative wind)
   * @param facingRight biases the resting hang slightly forward
   * @param flutter   0..1 attack/speed agitation for turbulence
   */
  public update(
    pinX: number,
    pinY: number,
    vx: number,
    vy: number,
    facingRight: boolean,
    dt: number,
    flutter: number
  ): void {
    // NaN / degenerate input guards: a bad frame must never poison the rope
    if (!Number.isFinite(pinX) || !Number.isFinite(pinY)) return;
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (!Number.isFinite(vx)) vx = 0;
    if (!Number.isFinite(vy)) vy = 0;
    if (!Number.isFinite(flutter)) flutter = 0;
    flutter = Math.max(0, Math.min(1, flutter));

    const step = Math.min(dt, 0.033);
    this.time += step;

    if (!this.initialized) {
      for (let i = 0; i <= this.segments; i++) {
        this.points.push({
          x: pinX,
          y: pinY + i * this.segLen,
          px: pinX,
          py: pinY + i * this.segLen,
        });
      }
      this.initialized = true;
    }

    const dirSign = facingRight ? 1 : -1;

    for (let i = 1; i < this.points.length; i++) {
      const p = this.points[i];
      const tempX = p.x;
      const tempY = p.y;

      // Verlet integration with damping
      p.x += (p.x - p.px) * this.damping;
      p.y += (p.y - p.py) * this.damping;

      // Gravity
      p.y += this.gravity * step * step;

      // Relative wind: streams the cloth opposite to body velocity,
      // plus high-frequency turbulence scaled by attack agitation.
      // A small forward bias keeps it resting in front of the chest, and
      // speed lift streams it up over the legs during slides/crouches
      // instead of clipping through them.
      let windX =
        -vx * 1.7 +
        dirSign * 34 +
        Math.sin(this.time * 27 + i * 0.9) * flutter * 640;
      let windY =
        -vy * 0.35 +
        Math.cos(this.time * 33 + i * 1.4) * flutter * 300 -
        Math.abs(vx) * 0.22;
      // Clamp wind so a velocity spike can never explode the solver
      if (windX > 2600) windX = 2600;
      else if (windX < -2600) windX = -2600;
      if (windY > 2600) windY = 2600;
      else if (windY < -2600) windY = -2600;
      p.x += windX * step * step;
      p.y += windY * step * step;

      // NaN self-heal: a poisoned point snaps back under the pin (with zero
      // velocity) instead of corrupting its neighbors through the constraints
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        p.x = pinX;
        p.y = pinY + i * this.segLen;
        p.px = p.x;
        p.py = p.y;
      } else {
        p.px = tempX;
        p.py = tempY;
      }
    }

    // Pin the collar node hard
    const pin = this.points[0];
    pin.x = pinX;
    pin.y = pinY;
    pin.px = pinX;
    pin.py = pinY;

    // Distance constraints — 3 relaxation iterations (cheap, stable)
    for (let k = 0; k < 3; k++) {
      pin.x = pinX;
      pin.y = pinY;
      for (let i = 0; i < this.segments; i++) {
        const a = this.points[i];
        const b = this.points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (!(dist > 0.0001)) continue; // degenerate/NaN segment: skip
        const diff = (dist - this.segLen) / dist;
        if (i === 0) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          const half = diff * 0.5;
          a.x += dx * half;
          a.y += dy * half;
          b.x -= dx * half;
          b.y -= dy * half;
        }
      }
      // Ground plane (y = 0): cloth never sinks below the floor
      for (let i = 1; i < this.points.length; i++) {
        const p = this.points[i];
        if (p.y > 0) p.y = 0;
      }
    }
  }

  /**
   * Tie-style render: tapered strip + edge highlight + collar knot.
   */
  public render(ctx: CanvasRenderingContext2D, color: string): void {
    if (this.points.length === 0) return;
    this.renderStrip(ctx, color, 2.1, 7.5, '#2c2e3b', 0.8);

    // Knot at the collar
    ctx.beginPath();
    ctx.arc(this.points[0].x, this.points[0].y + 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * Generic cloth render: tapered strip through the rope points, no knot.
   * Used for the jacket coat tails.
   */
  public renderCloth(
    ctx: CanvasRenderingContext2D,
    color: string,
    startWidth: number,
    endWidth: number,
    edgeColor: string,
    edgeWidth: number
  ): void {
    if (this.points.length === 0) return;
    this.renderStrip(ctx, color, startWidth, endWidth, edgeColor, edgeWidth);
  }

  /**
   * Builds a tapered strip through the rope points into the preallocated
   * buffers and fills/strokes it. Half-width lerps from startWidth at the
   * pin to endWidth at the tip.
   */
  private renderStrip(
    ctx: CanvasRenderingContext2D,
    color: string,
    startWidth: number,
    endWidth: number,
    edgeColor: string,
    edgeWidth: number
  ): void {
    const n = this.points.length;
    const denom = n > 1 ? n - 1 : 1;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const q = this.points[Math.min(i + 1, n - 1)];
      const r = this.points[Math.max(i - 1, 0)];
      let dx = q.x - r.x;
      let dy = q.y - r.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const w = startWidth + (i / denom) * (endWidth - startWidth);
      this.bufLX[i] = p.x - dy * w;
      this.bufLY[i] = p.y + dx * w;
      this.bufRX[i] = p.x + dy * w;
      this.bufRY[i] = p.y - dx * w;
    }

    ctx.beginPath();
    ctx.moveTo(this.bufLX[0], this.bufLY[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(this.bufLX[i], this.bufLY[i]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(this.bufRX[i], this.bufRY[i]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }

  public reset(): void {
    this.points = [];
    this.initialized = false;
    this.time = 0;
  }
}
