import { damp, clamp } from './MathUtils';

export class Camera {
  /**
   * World→screen scale for the whole scene (JOB 3: characters read ~30%
   * bigger on a phone). This is a pure projection knob: hit ranges, spacing,
   * AI distances, arena bounds and the level are all authored in world units,
   * so combat stays byte-for-byte identical while everything on screen grows
   * together — player, enemies, FX, damage numbers and the floor.
   * The React HUD and the canvas combo HUD are drawn in screen space, so they
   * keep their size and stay readable. Renderer's frustum culling divides by
   * `zoom`, so the tighter view still culls correctly.
   */
  public static readonly BASE_ZOOM = 1.3;

  public x = 0;
  public y = -60;
  public targetX = 0;
  public targetY = -60;
  public zoom = Camera.BASE_ZOOM;
  public targetZoom = Camera.BASE_ZOOM;

  // Camera shake / trauma
  private trauma = 0; // 0 to 1
  public shakeOffsetX = 0;
  public shakeOffsetY = 0;

  // Look-ahead. Both components are eased independently so a hard turn never
  // slams the whole target by 160-320px in a single frame.
  private lookFacing = 0;
  private lookVelocity = 0;

  /** Hard cap on velocity lead so a knockback doesn't whip the camera off. */
  private static readonly MAX_LEAD = 110;

  public update(
    playerX: number,
    playerY: number,
    vx: number,
    facingRight: boolean,
    dt: number
  ): void {
    // Look-ahead based on velocity and direction
    const facingOffset = (facingRight ? 1 : -1) * 80;
    const velocityLead = clamp(vx * 0.25, -Camera.MAX_LEAD, Camera.MAX_LEAD);
    this.lookFacing = damp(this.lookFacing, facingOffset, 4.5, dt);
    this.lookVelocity = damp(this.lookVelocity, velocityLead, 3.5, dt);

    this.targetX = playerX + this.lookFacing + this.lookVelocity;
    this.targetY = playerY - 70; // Keep ground in lower half of screen

    // Smooth camera damping (exponential, never overshoots at low frame rates)
    this.x = damp(this.x, this.targetX, 6, dt);
    this.y = damp(this.y, this.targetY, 6, dt);
    this.zoom = damp(this.zoom, this.targetZoom, 5, dt);

    // Camera shake calculation (trauma squared for punchy decay)
    if (this.trauma > 0) {
      const shakeAmount = this.trauma * this.trauma * 16;
      this.shakeOffsetX = (Math.random() * 2 - 1) * shakeAmount;
      this.shakeOffsetY = (Math.random() * 2 - 1) * shakeAmount;
      this.trauma = Math.max(0, this.trauma - 2.5 * dt);
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }
}
