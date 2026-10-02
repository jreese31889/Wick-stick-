import { lerp } from './MathUtils';

export class Camera {
  public x = 0;
  public y = -60;
  public targetX = 0;
  public targetY = -60;
  public zoom = 1.0;
  public targetZoom = 1.0;

  // Camera shake / trauma
  private trauma = 0; // 0 to 1
  public shakeOffsetX = 0;
  public shakeOffsetY = 0;

  public update(
    playerX: number,
    playerY: number,
    vx: number,
    facingRight: boolean,
    dt: number
  ): void {
    // Look-ahead based on velocity and direction
    const facingOffset = (facingRight ? 1 : -1) * 80;
    const velocityLead = vx * 0.25;
    this.targetX = playerX + facingOffset + velocityLead;
    this.targetY = playerY - 70; // Keep ground in lower half of screen

    // Smooth camera damping
    this.x = lerp(this.x, this.targetX, 6 * dt);
    this.y = lerp(this.y, this.targetY, 6 * dt);
    this.zoom = lerp(this.zoom, this.targetZoom, 5 * dt);

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
