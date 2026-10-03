import { Camera } from './Camera';
import { PlayerController } from './PlayerController';
import { EnemyController } from './EnemyController';
import { EnemyRig } from './EnemyRig';
import { CombatDirector } from './CombatDirector';
import { EnvironmentManager } from './EnvironmentManager';
import { ObjectPool } from './ObjectPool';
import { POSE_JOINTS } from './AnimationController';
import { StickFigurePose, EnemyBullet } from '../types/game';

export interface DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface Afterimage {
  pose: StickFigurePose;
  facingRight: boolean;
  life: number;
  maxLife: number;
}

export interface MuzzleBloom {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

const MAX_MUZZLE_BLOOMS = 8;
const MUZZLE_BLOOM_LIFE = 0.12;
/** Global hard cap on live dust particles (M14) — pooled, see dustPool. */
const MAX_DUST_PARTICLES = 220;
/** Cap on motion-trail ghosts, as before (poses are pooled too). */
const MAX_AFTERIMAGES = 14;
/**
 * M14 frustum culling: world-space padding added to the camera view before
 * anything is skipped. Deliberately generous (walls, ragdolls near the arena
 * edge, particles drifting upward) so a culled object is always off-canvas.
 */
const CULL_PADDING = 240;
/** Retained dust shells: live cap + slack so the pool never thrashes. */
const MAX_DUST_POOL = MAX_DUST_PARTICLES + 64;

// P1-05: shared dash patterns. setLineDash copies the sequence it is handed,
// so module constants are safe to reuse and never allocate in the draw path.
const DASH_LASER = [6, 4];
const DASH_SNIPER = [10, 8];

// P1-05: pre-stringified speed-line alpha steps — was `fade.toFixed(3)` ×18
// per frame while the effect is on. Index = round(fade * 1000), clamped.
const SPEED_FADE_ALPHA: string[] = [];
for (let i = 0; i <= 300; i++) {
  SPEED_FADE_ALPHA.push(`rgba(255, 255, 255, ${(i / 1000).toFixed(3)})`);
}

/** Fresh pose with every joint allocated — pool shells are filled in place. */
function makeEmptyPose(): StickFigurePose {
  const pose = {} as StickFigurePose;
  for (const key of POSE_JOINTS) {
    pose[key] = { x: 0, y: 0 };
  }
  return pose;
}

/** In-place joint copy — replaces the old JSON deep clone per afterimage. */
function copyPoseInto(src: StickFigurePose, dst: StickFigurePose): void {
  for (const key of POSE_JOINTS) {
    const s = src[key];
    const d = dst[key];
    d.x = s.x;
    d.y = s.y;
  }
}

export class Renderer {
  private particles: DustParticle[] = [];
  private afterimages: Afterimage[] = [];
  private afterimageCooldown = 0;
  private enemyRig: EnemyRig = new EnemyRig();

  // M14: free lists so particles/ghosts are recycled instead of reallocated
  private dustPool = new ObjectPool<DustParticle>(
    () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, color: '' }),
    MAX_DUST_POOL
  );
  private afterimagePosePool = new ObjectPool<StickFigurePose>(makeEmptyPose, MAX_AFTERIMAGES + 4);

  // M14 frustum: world-space bounds of the frame being rendered (set in render())
  private viewLeft = -1e7;
  private viewRight = 1e7;
  private viewTop = -1e7;
  private viewBottom = 1e7;

  // Cached full-screen vignette gradient (identity transform, redrawn each frame)
  private vignetteGradient: CanvasGradient | null = null;
  private vignetteW = 0;
  private vignetteH = 0;

  // P1-02: gradients whose inputs only change per room (or never) are built
  // once. Per the canvas spec a gradient is transformed by the CTM at render
  // time, so a cached object paints exactly like one rebuilt with the same
  // stops — the coordinates below are all constant across frames.
  private gradCtx: CanvasRenderingContext2D | null = null;
  private bgGrad: CanvasGradient | null = null;
  private bgGradAmbience = '';
  private skyGrad: CanvasGradient | null = null;
  private skyGradAmbience = '';
  private floorGrad: CanvasGradient | null = null;
  private floorGradColor = '';
  private sconceGradL: CanvasGradient | null = null;
  private sconceGradR: CanvasGradient | null = null;
  private sconceAccentL = '';
  private sconceAccentR = '';
  private doorGrad: CanvasGradient | null = null;
  private doorGradAccent = '';
  private doorGradH = 0;
  private beamGrad: CanvasGradient | null = null;
  private beamGradAccent = '';
  private beamGradX = 0;
  private beamGradH = 0;
  private healthGlowGrad: CanvasGradient | null = null;
  private weaponGlowGrad: CanvasGradient | null = null;
  private ammoGlowGrad: CanvasGradient | null = null;

  // P1-05: HUD labels are string-built only when their inputs actually change
  // (the label itself is drawn twice per frame — stroke + fill).
  private comboLabel = '';
  private comboLabelCount = -1;
  private dmgLabel = '';
  private dmgLabelKey = NaN;
  private ratingLabel = '';
  private ratingLabelKey = '';
  // PHASE 1B 8 — style meter (rank glyph rebuilt only on a rank flip; the
  // flash decays per frame, and no strings are built while it idles)
  private styleRankKey = '';
  private styleRankLabel = '';
  private styleRankFlash = 0;
  private bossPctLabel = '';
  private bossPctValue = -1;

  // P1-06: GPU blur is the expensive part of the aim-laser / boss-HUD glows —
  // only the Cinematic tier keeps them. P5-02 drives this from settings.
  public quality: 'low' | 'medium' | 'high' = 'high';
  private get glowBlur(): boolean {
    return this.quality === 'high';
  }

  // P5-02: FX budgets per tier (high == the M14 static defaults). Pools stay
  // sized for the high tier so a mid-fight tier switch never overflows.
  private get dustCap(): number {
    return this.quality === 'high' ? MAX_DUST_PARTICLES : this.quality === 'medium' ? 140 : 80;
  }
  private get afterimageCap(): number {
    return this.quality === 'high' ? MAX_AFTERIMAGES : this.quality === 'medium' ? 8 : 4;
  }
  private get rainStreakCap(): number {
    return this.quality === 'high' ? 75 : this.quality === 'medium' ? 50 : 25;
  }

  // P1-04: camera matrix captured once per frame, reused by the batched
  // item loops below (they run inside the same camera transform).
  private batchBase: DOMMatrix | null = null;

  // Muzzle-flash light blooms (pooled, reused — no allocation in hot paths)
  private muzzleBlooms: MuzzleBloom[] = Array.from({ length: MAX_MUZZLE_BLOOMS }, () => ({
    x: 0,
    y: 0,
    life: 0,
    maxLife: MUZZLE_BLOOM_LIFE,
  }));
  private muzzleBloomCursor = 0;
  // BulletTracer.id is a monotonic counter, so any tracer with an id above
  // this watermark was pushed since the last render and gets a bloom.
  private lastTracerId = -1;

  // AI key-art backdrop cache (lazy-loaded, shared across rooms)
  private backdropImages = new Map<string, HTMLImageElement>();

  /**
   * Returns the cached backdrop image for a room, kicking off an async load
   * on first use. Returns null until the image is fully decoded.
   */
  private getBackdropImage(path: string): HTMLImageElement | null {
    let img = this.backdropImages.get(path);
    if (!img) {
      img = new Image();
      img.src = `${import.meta.env.BASE_URL}${path}`;
      this.backdropImages.set(path, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  public spawnDust(
    x: number,
    y: number,
    vx: number,
    vy: number,
    count: number = 3,
    color: string = 'rgba(180, 190, 210, 0.4)'
  ): void {
    for (let i = 0; i < count; i++) {
      let p: DustParticle;
      if (this.particles.length >= this.dustCap) {
        // Cap behavior unchanged: recycle the oldest live particle first.
        // The shell is reused in place, so no allocation happens either way.
        const oldest = this.particles.shift();
        if (!oldest) continue;
        p = oldest;
      } else {
        p = this.dustPool.acquire();
      }
      p.x = x + (Math.random() * 8 - 4);
      p.y = y + (Math.random() * 4 - 2);
      p.vx = vx + (Math.random() * 40 - 20);
      p.vy = vy - (Math.random() * 30 + 10);
      p.life = 0;
      p.maxLife = 0.3 + Math.random() * 0.25;
      p.size = 2 + Math.random() * 3.5;
      p.color = color;
      this.particles.push(p);
    }
  }

  public updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        this.dustPool.release(p);
      }
    }

    // Afterimage motion-trail decay
    if (this.afterimageCooldown > 0) {
      this.afterimageCooldown -= dt;
    }
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const img = this.afterimages[i];
      img.life -= dt;
      if (img.life <= 0) {
        this.afterimages.splice(i, 1);
        this.afterimagePosePool.release(img.pose);
      }
    }

    // Muzzle-flash bloom decay (pool slots just go dormant)
    for (const bloom of this.muzzleBlooms) {
      if (bloom.life > 0) {
        bloom.life -= dt;
      }
    }
  }

  /**
   * Captures a fading silhouette snapshot of the player's current pose.
   * Called during dodge rolls and heavy attacks for cinematic motion trails.
   */
  public spawnAfterimage(pose: StickFigurePose, facingRight: boolean): void {
    if (this.afterimageCooldown > 0) return;
    this.afterimageCooldown = 0.055;
    if (this.afterimages.length >= this.afterimageCap) {
      const oldest = this.afterimages.shift();
      if (oldest) this.afterimagePosePool.release(oldest.pose);
    }
    // Pooled pose shell + in-place joint copy (was a JSON deep clone)
    const dst = this.afterimagePosePool.acquire();
    copyPoseInto(pose, dst);
    this.afterimages.push({
      pose: dst,
      facingRight,
      life: 0.32,
      maxLife: 0.32,
    });
  }

  public clearAfterimages(): void {
    for (const img of this.afterimages) {
      this.afterimagePosePool.release(img.pose);
    }
    this.afterimages = [];
  }

  /** P6-02: live dust count + cap for the Rig debug stats chip. */
  public fxStats(): { dust: number; dustCap: number } {
    return { dust: this.particles.length, dustCap: this.dustCap };
  }

  /**
   * Pops a short-lived warm light bloom at a gun's muzzle origin.
   * Reuses the fixed 8-slot pool (round-robin overwrite when full),
   * so rapid fire never allocates and never exceeds the cap.
   */
  public spawnMuzzleBloom(x: number, y: number): void {
    let slot = this.muzzleBlooms[this.muzzleBloomCursor];
    for (let i = 0; i < MAX_MUZZLE_BLOOMS; i++) {
      if (this.muzzleBlooms[i].life <= 0) {
        slot = this.muzzleBlooms[i];
        this.muzzleBloomCursor = i;
        break;
      }
    }
    this.muzzleBloomCursor = (this.muzzleBloomCursor + 1) % MAX_MUZZLE_BLOOMS;
    slot.x = x;
    slot.y = y;
    slot.life = MUZZLE_BLOOM_LIFE;
    slot.maxLife = MUZZLE_BLOOM_LIFE;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    camera: Camera,
    player: PlayerController,
    enemies: EnemyController[],
    combatDirector: CombatDirector,
    environmentManager?: EnvironmentManager,
    debugMode: boolean = false
  ): void {
    // P1-02: cached gradients belong to the context they were built from —
    // a fresh canvas (GameCanvas remount) invalidates the whole set.
    if (this.gradCtx !== ctx) {
      this.gradCtx = ctx;
      this.bgGrad = null;
      this.skyGrad = null;
      this.floorGrad = null;
      this.sconceGradL = null;
      this.sconceGradR = null;
      this.doorGrad = null;
      this.beamGrad = null;
      this.healthGlowGrad = null;
      this.weaponGlowGrad = null;
      this.ammoGlowGrad = null;
      this.vignetteGradient = null;
    }

    ctx.clearRect(0, 0, width, height);

    ctx.save();

    // Center of screen transform
    const centerX = width * 0.5;
    const centerY = height * 0.5;

    // Apply Camera Transform (translate, zoom, shake)
    ctx.translate(centerX + camera.shakeOffsetX, centerY + camera.shakeOffsetY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // P1-04: the camera matrix every batched item loop composes from — one
    // DOMMatrix per frame instead of a save/restore pair per item.
    this.batchBase = ctx.getTransform();

    // M14: world-space bounds of what this frame can possibly show. Every
    // sub-render pass below uses them to skip off-screen objects cheaply
    // (padding is generous, so anything culled was never rasterized anyway).
    const zoom = camera.zoom > 0.001 ? camera.zoom : 0.001;
    const halfW = width * 0.5 / zoom + CULL_PADDING;
    const halfH = height * 0.5 / zoom + CULL_PADDING;
    this.viewLeft = camera.x - halfW;
    this.viewRight = camera.x + halfW;
    this.viewTop = camera.y - halfH;
    this.viewBottom = camera.y + halfH;

    // 1. CINEMATIC BACKGROUND (Noir Atmospheric Parallax & Thematic Room Decor)
    this.renderBackground(ctx, camera.x, camera.y, environmentManager);

    // 2. STAGE FLOOR & POLISHED REFLECTION
    this.renderFloor(ctx, camera.x, environmentManager);

    // 2b. BLOOD DECALS ON FLOOR (Godot CPUParticles2D splat decals)
    this.renderBloodDecals(ctx, combatDirector);

    // 3. EXIT DOOR
    if (environmentManager) {
      this.renderExitDoor(ctx, environmentManager);
    }

    // 4. DESTRUCTIBLE FURNITURE & GLASS PARTITIONS
    if (environmentManager) {
      this.renderDestructibles(ctx, environmentManager);
      this.renderGlassShards(ctx, environmentManager);
      this.renderDroppedWeapons(ctx, environmentManager);
      this.renderGoldCoins(ctx, environmentManager);
      this.renderProjectiles(ctx, environmentManager);
      this.renderHealthPacks(ctx, environmentManager);
      this.renderAmmoPacks(ctx, environmentManager);
    }

    // 5. DUST & MOTION PARTICLES
    this.renderParticles(ctx);

    // 6. CHARACTER DROP SHADOWS
    // (pad ≈ body width so an enemy clipped by the screen edge still draws)
    // P1-04: one save for the whole shadow family — each shadow only swaps
    // fillStyle and builds its own ellipse path.
    ctx.save();
    this.renderShadow(ctx, player.physics.position.x, player.physics.position.y);
    for (const enemy of enemies) {
      if (!this.inView(enemy.position.x, enemy.position.y, 96)) continue;
      this.renderShadow(ctx, enemy.position.x, enemy.position.y);
    }
    ctx.restore();

    // 7. ENEMIES (off-screen rigs are skipped entirely — pose work for them
    //    still runs in the sim, but no draw calls are issued)
    for (const enemy of enemies) {
      if (!this.inView(enemy.position.x, enemy.position.y, 96)) continue;
      this.enemyRig.render(ctx, enemy, debugMode);
    }

    // 8. TACTICAL LASER AIM (Twin-Stick & Mobile Aim)
    this.renderAimLaser(ctx, player);

    // 8a. SNIPER CHARGE SIGHTS (telegraphs the block-piercing shot)
    this.renderSniperSights(ctx, enemies, player);

    // 8b. AFTERIMAGE MOTION TRAILS (Dodge / Heavy Attack ghosts)
    this.renderAfterimages(ctx, player);

    // 9. PLAYER STICK FIGURE (With equipped Katana/Knife)
    //    or tumbling ragdoll during the death kill-cam
    if (player.ragdoll && !player.ragdoll.dead) {
      // Same ivory silhouette + dark under-stroke as the live rig (JOB 1),
      // with the warm rim accent so the kill-cam body keeps its glow.
      player.ragdoll.render(ctx, '#f6efdf', '#f6efdf', 'rgba(255, 240, 206, 0.8)');
    } else {
      player.rig.render(
        ctx,
        player.currentPose,
        player.physics.facingRight,
        debugMode,
        player.physics.equippedWeapon
      );
    }

    // 10. COMBAT PARTICLES (Shockwaves, Sparks, Tracers, Casings, Blade Arcs)
    this.renderCombatFX(ctx, combatDirector);

    // 11. DAMAGE NUMBERS & COMBAT POPUPS
    this.renderDamagePopups(ctx, combatDirector);

    ctx.restore();

    // 11. SCREEN VIGNETTE & CINEMATIC BARS
    this.renderVignette(ctx, width, height);

    // 11b. RADIAL SPEED LINES (Heavy impacts & slow-mo)
    this.renderSpeedLines(ctx, width, height, combatDirector);

    // 12. SCREEN-SPACE COMBO & STYLE OVERLAY
    this.renderComboHUD(ctx, width, height, combatDirector);

    // 12b. PHASE 1B 8: style rank meter (left rail — clear of the React HUD
    // strip, the combo chain and the thumb controls)
    this.renderStyleMeter(ctx, height, combatDirector);

    // 13. HIGH TABLE BOSS HEALTH BAR (When Boss is active)
    this.renderBossHUD(ctx, width, height, enemies);

    // 14. ROOM INTRO TITLE BANNER & TRANSITION FADE
    if (environmentManager) {
      this.renderRoomBanner(ctx, width, height, environmentManager);
      this.renderTransitionOverlay(ctx, width, height, environmentManager);
    }
  }

  /**
   * M14 frustum test: true when a world-space point could touch the current
   * frame's view. Bounds already include CULL_PADDING, so callers never need
   * to pad again — anything failing this test is off-canvas by a wide margin.
   */
  private inView(x: number, y: number, pad: number = 0): boolean {
    return (
      x >= this.viewLeft - pad &&
      x <= this.viewRight + pad &&
      y >= this.viewTop - pad &&
      y <= this.viewBottom + pad
    );
  }

  /**
   * P1-04: applies base · translate(x,y) · rotate(rot) · scale(sx,sy) directly.
   * Batched item loops (casings, shards, coins …) used to pay a
   * save/translate/rotate/restore per item; this touches only the matrix, and
   * the caller restores the captured base once after the loop.
   */
  private setItemTransform(
    ctx: CanvasRenderingContext2D,
    base: DOMMatrix,
    x: number,
    y: number,
    rot: number,
    sx: number = 1,
    sy: number = 1
  ): void {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    ctx.setTransform(
      (base.a * cos + base.c * sin) * sx,
      (base.b * cos + base.d * sin) * sx,
      (-base.a * sin + base.c * cos) * sy,
      (-base.b * sin + base.d * cos) * sy,
      base.a * x + base.c * y + base.e,
      base.b * x + base.d * y + base.f
    );
  }

  /** Restores the matrix captured by setItemTransform's caller. */
  private resetItemTransform(ctx: CanvasRenderingContext2D, base: DOMMatrix): void {
    ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
  }

  private renderBackground(
    ctx: CanvasRenderingContext2D,
    camX: number,
    _camY: number,
    env?: EnvironmentManager
  ): void {
    const groundY = 0;
    const accentColor = env ? env.config.accentColor : '#d97706';
    const ambienceColor = env ? env.config.ambienceColor : '#0a0c14';

    // Far background: AI key-art backdrop when the room has one, else noir gradient
    const backdropPath = env?.config.backdropImage;
    const backdropImg = backdropPath ? this.getBackdropImage(backdropPath) : null;
    if (backdropImg) {
      this.renderBackdropImage(ctx, camX, groundY, backdropImg, ambienceColor);
    } else {
      // P1-02: stops depend only on the room's ambience colour
      if (!this.bgGrad || this.bgGradAmbience !== ambienceColor) {
        const grad = ctx.createLinearGradient(0, groundY - 500, 0, groundY);
        grad.addColorStop(0, ambienceColor);
        grad.addColorStop(0.7, '#111422');
        grad.addColorStop(1, '#181b2e');
        this.bgGrad = grad;
        this.bgGradAmbience = ambienceColor;
      }
      ctx.fillStyle = this.bgGrad;
      ctx.fillRect(camX - 1500, groundY - 600, 3000, 600);
    }

    // Parallax pillars / vertical architectural blinds
    ctx.save();
    ctx.fillStyle = '#0f121d';
    const pillarSpacing = 160;
    const parallaxX = camX * 0.3;
    const startPillar = Math.floor((camX - 1000) / pillarSpacing) * pillarSpacing;

    for (let x = startPillar; x < camX + 1000; x += pillarSpacing) {
      const screenX = x - parallaxX;
      ctx.fillRect(screenX, groundY - 450, 48, 450);
      ctx.fillStyle = 'rgba(70, 85, 120, 0.08)';
      ctx.fillRect(screenX, groundY - 450, 3, 450);
      ctx.fillStyle = '#0f121d';
    }

    // Mid-ground wall base trim
    ctx.fillStyle = '#1c2032';
    ctx.fillRect(camX - 1500, groundY - 14, 3000, 14);

    // Atmospheric warm light sconces on wall
    for (let x = startPillar + 80; x < camX + 1000; x += pillarSpacing * 2) {
      const lampX = x - parallaxX;
      const lampGrad = ctx.createRadialGradient(lampX, groundY - 180, 5, lampX, groundY - 180, 140);
      lampGrad.addColorStop(0, `${accentColor}33`);
      lampGrad.addColorStop(0.5, `${accentColor}0a`);
      lampGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = lampGrad;
      ctx.fillRect(lampX - 140, groundY - 320, 280, 280);
    }
    ctx.restore();

    // Rain Streaks (if theme has rain)
    if (env && env.config.hasRain) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      // Draw procedural rain streaks (P5-02: streak budget scales by tier)
      const rainTime = performance.now() * 0.001;
      const rainCap = this.rainStreakCap;
      for (let i = 0; i < rainCap; i++) {
        const rx = ((i * 37 + rainTime * 700) % 1800) - 900;
        const ry = ((i * 53 + rainTime * 950) % 550) - 500;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 8, ry + 18);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Arena Perimeter Pillars (World space at -840 and +840)
    this.renderArenaBoundary(ctx, -840, true, accentColor);
    this.renderArenaBoundary(ctx, 840, false, accentColor);
  }

  /**
   * Draws the room's AI key-art backdrop as a far parallax layer.
   * The image is darkened so stick-figure fighters stay clearly readable.
   */
  private renderBackdropImage(
    ctx: CanvasRenderingContext2D,
    camX: number,
    groundY: number,
    img: HTMLImageElement,
    ambienceColor: string
  ): void {
    const dw = 4800;
    const dh = 620;
    // Parallax factor: backdrop drifts at ~55% of world speed.
    // Rect is oversized so it still covers ultrawide screens at max camera travel.
    const parallax = 0.45;
    const dx = camX * parallax - dw / 2;

    // Sky band above the key art: tall screens (1440p, portrait tablets)
    // see past the top of the 620px band — fill it with the room ambience.
    if (!this.skyGrad || this.skyGradAmbience !== ambienceColor) {
      const skyGrad = ctx.createLinearGradient(0, groundY - 1150, 0, groundY - 600);
      skyGrad.addColorStop(0, ambienceColor);
      skyGrad.addColorStop(1, '#0a0c14');
      this.skyGrad = skyGrad;
      this.skyGradAmbience = ambienceColor;
    }
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(dx, groundY - 1150, dw, 550);

    // Cover-fit the 16:9 key art into the wide backdrop rect
    const scale = Math.max(dw / img.width, dh / img.height);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, groundY - 600, dw, dh);

    // Cinematic darkening for fighter readability
    ctx.fillStyle = 'rgba(4, 6, 11, 0.62)';
    ctx.fillRect(dx, groundY - 600, dw, dh);
  }

  private renderArenaBoundary(
    ctx: CanvasRenderingContext2D,
    x: number,
    isLeft: boolean,
    accentColor: string = '#d97706'
  ): void {
    const groundY = 0;
    ctx.save();

    // Main structural pillar
    ctx.fillStyle = '#0b0d14';
    ctx.fillRect(isLeft ? x - 70 : x, groundY - 450, 70, 450);

    // Accent brass ornamental trim
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(isLeft ? x - 3 : x, groundY - 450, 3, 450);
    ctx.fillStyle = accentColor;
    ctx.fillRect(isLeft ? x - 8 : x + 5, groundY - 220, 3, 20);

    // Sconce light glow (P1-02: fixed coordinates per side, stops per accent)
    const sconceX = isLeft ? x - 6 : x + 6;
    const sconceY = groundY - 210;
    let sconceGrad = isLeft ? this.sconceGradL : this.sconceGradR;
    const sconceAccent = isLeft ? this.sconceAccentL : this.sconceAccentR;
    if (sconceGrad === null || sconceAccent !== accentColor) {
      sconceGrad = ctx.createRadialGradient(sconceX, sconceY, 2, sconceX, sconceY, 90);
      sconceGrad.addColorStop(0, `${accentColor}55`);
      sconceGrad.addColorStop(0.4, `${accentColor}18`);
      sconceGrad.addColorStop(1, 'rgba(0,0,0,0)');
      if (isLeft) {
        this.sconceGradL = sconceGrad;
        this.sconceAccentL = accentColor;
      } else {
        this.sconceGradR = sconceGrad;
        this.sconceAccentR = accentColor;
      }
    }
    ctx.fillStyle = sconceGrad;
    ctx.beginPath();
    ctx.arc(sconceX, sconceY, 90, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private renderFloor(
    ctx: CanvasRenderingContext2D,
    camX: number,
    env?: EnvironmentManager
  ): void {
    const groundY = 0;
    const floorColor = env ? env.config.floorColor : '#151722';
    // P1-02: floor stops change only with the room's floor colour
    if (!this.floorGrad || this.floorGradColor !== floorColor) {
      const floorGrad = ctx.createLinearGradient(0, groundY, 0, groundY + 400);
      floorGrad.addColorStop(0, floorColor);
      floorGrad.addColorStop(0.2, '#0c0d13');
      floorGrad.addColorStop(1, '#050608');
      this.floorGrad = floorGrad;
      this.floorGradColor = floorColor;
    }
    ctx.fillStyle = this.floorGrad;

    // M14: draw only the slice of the floor the camera can see. The canvas is
    // fully redrawn every frame, so clipped-away pixels are identical either way.
    const left = Math.max(camX - 1500, this.viewLeft);
    const right = Math.min(camX + 1500, this.viewRight);
    const bottom = Math.min(groundY + 500, this.viewBottom);
    if (right <= left || bottom <= groundY) return;
    ctx.fillRect(left, groundY, right - left, bottom - groundY);

    ctx.strokeStyle = 'rgba(50, 60, 85, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, groundY);
    ctx.lineTo(right, groundY);
    ctx.stroke();

    const tileSize = 120;
    const startTile = Math.ceil(left / tileSize) * tileSize;
    const tileBottom = Math.min(groundY + 300, bottom);
    for (let x = startTile; x < right; x += tileSize) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x, tileBottom);
      ctx.stroke();
    }
  }

  private renderShadow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const groundDist = Math.max(0, -y);
    const scale = Math.max(0.2, 1 - groundDist / 200);
    const opacity = Math.max(0.08, 0.45 * (1 - groundDist / 180));

    // P1-04: the old save/translate/scale/arc/restore was exactly this
    // axis-aligned ellipse — same pixels, no state flips.
    ctx.beginPath();
    ctx.ellipse(x, 0, 22 * scale, 22 * scale * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
    ctx.fill();
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) return;
    // One save/restore for the whole batch: only globalAlpha and fillStyle
    // change per particle, so per-particle state saves were pure overhead.
    ctx.save();
    for (const p of this.particles) {
      if (!this.inView(p.x, p.y)) continue;
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - p.life * 0.5 / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderCombatFX(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    // Shockwaves — one save/restore for the group (only alpha/style change)
    if (combat.shockwaves.length > 0) {
      ctx.save();
      for (const sw of combat.shockwaves) {
        if (!this.inView(sw.x, sw.y, sw.maxRadius)) continue;
        const alpha = sw.life / sw.maxLife;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = sw.lineWidth * alpha;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Sparks — batched, and off-screen sparks never touch the canvas
    if (combat.sparks.length > 0) {
      ctx.save();
      for (const s of combat.sparks) {
        if (!this.inView(s.x, s.y)) continue;
        const alpha = s.life / s.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Supersonic Bullet Tracers
    if (combat.tracers.length === 0) {
      // Tracers were all cleared (room reset / fade-out) — reset the watermark
      // so the next shot's id is correctly detected as new.
      this.lastTracerId = -1;
    }
    if (combat.tracers.length > 0) ctx.save();
    for (const tr of combat.tracers) {
      if (tr.id > this.lastTracerId) {
        // Newly fired shot: pop a short-lived light bloom at the muzzle origin.
        // Id-based so hit-stop re-renders of the same frozen tracer don't respawn.
        this.spawnMuzzleBloom(tr.x1, tr.y1);
        this.lastTracerId = tr.id;
      }
      if (!this.inView(tr.x1, tr.y1, 64) && !this.inView(tr.x2, tr.y2, 64)) continue;
      const alpha = tr.life / tr.maxLife;
      // Outer amber glow
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = tr.width * 2.5;
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();

      // Sharp white-hot core
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = tr.width;
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();

      // Muzzle flash star at origin
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(tr.x1, tr.y1, 6 * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    if (combat.tracers.length > 0) ctx.restore();

    // Muzzle-flash light blooms (pooled radial glow at shot origins)
    this.renderMuzzleBlooms(ctx);

    // Enemy bullets (crimson bolts) — cross-worker: logic lives in CombatDirector
    this.renderEnemyBullets(ctx, combat.enemyBullets);

    // Spent Brass 9mm Casings (P1-04: matrix-only per item, one save total)
    if (combat.casings.length > 0 && this.batchBase) {
      ctx.save();
      for (const c of combat.casings) {
        if (!this.inView(c.x, c.y)) continue;
        this.setItemTransform(ctx, this.batchBase, c.x, c.y, c.rot);
        // Brass casing body
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-3, -1.2, 6, 2.4);
        // Dark rim
        ctx.fillStyle = '#d97706';
        ctx.fillRect(-3, -1.2, 1.2, 2.4);
      }
      this.resetItemTransform(ctx, this.batchBase);
      ctx.restore();
    }

    // Blade Slash Arc Ribbon Trails (Godot style)
    this.renderBladeArcs(ctx, combat);
  }

  /**
   * Draws pooled muzzle-flash blooms: warm white-gold radial glow,
   * fading over ~0.12s. One batched 'lighter' group per frame (used
   * sparingly for mobile GPU safety) instead of per-bloom state changes.
   */
  private renderMuzzleBlooms(ctx: CanvasRenderingContext2D): void {
    let anyActive = false;
    for (const bloom of this.muzzleBlooms) {
      if (bloom.life > 0) {
        anyActive = true;
        break;
      }
    }
    if (!anyActive) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bloom of this.muzzleBlooms) {
      if (bloom.life <= 0) continue;
      const progress = Math.max(0, bloom.life / bloom.maxLife);
      const radius = 20 + (1 - progress) * 34;
      const grad = ctx.createRadialGradient(bloom.x, bloom.y, 2, bloom.x, bloom.y, radius);
      grad.addColorStop(0, `rgba(255, 252, 235, ${0.9 * progress})`);
      grad.addColorStop(0.35, `rgba(253, 224, 71, ${0.55 * progress})`);
      grad.addColorStop(1, 'rgba(217, 119, 6, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(bloom.x - radius, bloom.y - radius, radius * 2, radius * 2);
    }
    ctx.restore();
  }

  /**
   * Renders enemy bullets as glowing crimson bolts: soft outer glow,
   * velocity-aligned streak, bright core dot. Batched into three draw
   * calls total regardless of bullet count.
   */
  private renderEnemyBullets(ctx: CanvasRenderingContext2D, bullets: EnemyBullet[]): void {
    if (bullets.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';

    // Pass 1: soft outer glow (batched)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.28)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (const b of bullets) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const nx = b.vx / speed;
      const ny = b.vy / speed;
      ctx.moveTo(b.x - nx * 22, b.y - ny * 22);
      ctx.lineTo(b.x + nx * 5, b.y + ny * 5);
    }
    ctx.stroke();

    // Pass 2: crimson streak core (batched)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (const b of bullets) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const nx = b.vx / speed;
      const ny = b.vy / speed;
      ctx.moveTo(b.x - nx * 16, b.y - ny * 16);
      ctx.lineTo(b.x + nx * 5, b.y + ny * 5);
    }
    ctx.stroke();

    // Pass 3: bright white-hot tip dots (batched)
    ctx.fillStyle = '#ffe4e6';
    ctx.beginPath();
    for (const b of bullets) {
      ctx.moveTo(b.x + 3, b.y);
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.restore();
  }

  private renderBloodDecals(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    if (combat.bloodDecals.length === 0) return;
    ctx.save();
    for (const b of combat.bloodDecals) {
      if (!this.inView(b.x, b.y, b.radius)) continue;
      ctx.globalAlpha = b.alpha;
      // Crimson noir blood: dark pooled edge + brighter wet core so drops still
      // read on both dark stages and the bright ivory player.
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      if (b.isStuck) {
        ctx.ellipse(b.x, b.y - 1, b.radius * 1.35, b.radius * 0.55, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.globalAlpha = b.alpha * 0.9;
      ctx.fillStyle = '#c22222';
      ctx.beginPath();
      if (b.isStuck) {
        ctx.ellipse(b.x, b.y - 1, b.radius * 0.7, b.radius * 0.3, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(b.x, b.y, b.radius * 0.55, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  private renderBladeArcs(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    if (combat.bladeArcs.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const arc of combat.bladeArcs) {
      if (!this.inView(arc.x, arc.y, arc.radius + 40)) continue;
      const progress = arc.life / arc.maxLife;
      const alpha = 1 - progress;
      const start = arc.angle - arc.arcLength * 0.5;
      const end = arc.angle + arc.arcLength * 0.5;
      // Wide low-alpha under-stroke as glow (cheaper than shadowBlur on mobile)
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = arc.color;
      ctx.lineWidth = 12 * (1 - progress * 0.5);
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, arc.radius, start, end);
      ctx.stroke();
      // Sharp core stroke
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 4 * (1 - progress * 0.5);
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, arc.radius, start, end);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderAimLaser(ctx: CanvasRenderingContext2D, player: PlayerController): void {
    if (player.physics.aimAngle === null || player.physics.aimAngle === undefined) return;
    const angle = player.physics.aimAngle;
    const originX = player.physics.position.x + (player.physics.facingRight ? 18 : -18);
    const originY = player.physics.position.y - 62;
    const length = 340;
    const targetX = originX + Math.cos(angle) * length;
    const targetY = originY + Math.sin(angle) * length;

    ctx.save();
    // Red tactical laser sight line
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash(DASH_LASER);
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    // Laser dot & target reticle
    ctx.setLineDash([]);
    ctx.fillStyle = '#ef4444';
    // P1-06: GPU blur only on the Cinematic tier (aim laser reticle)
    if (this.glowBlur) {
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    ctx.arc(targetX, targetY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Reticle circle
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(targetX, targetY, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Red charge beam from every SNIPER that is winding up, aimed at the player.
   * The beam tightens and brightens as the 0.8s charge completes.
   */
  private renderSniperSights(
    ctx: CanvasRenderingContext2D,
    enemies: EnemyController[],
    player: PlayerController
  ): void {
    const targetX = player.physics.position.x;
    const targetY = player.physics.position.y - 55;

    for (const enemy of enemies) {
      if (!enemy.sniperCharging || enemy.health <= 0) continue;

      const f = enemy.facingRight ? 1 : -1;
      const originX = enemy.position.x + f * 22;
      const originY = enemy.position.y - 72;
      const charge = Math.min(1, enemy.stateTimer / 0.8);
      const flicker = 0.55 + 0.45 * charge + Math.sin(performance.now() / 45) * 0.08;

      ctx.save();
      ctx.strokeStyle = `rgba(248, 113, 113, ${Math.min(0.95, flicker)})`;
      ctx.lineWidth = 1 + 2 * charge;
      ctx.setLineDash(DASH_SNIPER);
      ctx.lineDashOffset = -performance.now() / 25;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Reticle on the player, closing in as the charge fills
      ctx.strokeStyle = `rgba(248, 113, 113, ${Math.min(1, 0.4 + charge)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(targetX, targetY, 16 - 8 * charge, 0, Math.PI * 2);
      ctx.stroke();

      // Muzzle glow
      ctx.fillStyle = `rgba(254, 240, 138, ${0.3 + 0.7 * charge})`;
      ctx.beginPath();
      ctx.arc(originX, originY, 2 + 4 * charge, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderDamagePopups(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    if (combat.popups.length === 0) return;
    // Batched: only font/fill/stroke/alpha change per popup, one save for all
    ctx.save();
    for (const p of combat.popups) {
      if (!this.inView(p.x, p.y, 180)) continue;
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.font = `bold ${p.size}px monospace`;
      ctx.fillStyle = p.color;
      ctx.textAlign = 'center';
      // Outline for legibility
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  private renderComboHUD(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    combat: CombatDirector
  ): void {
    if (combat.stats.comboCount <= 1 && !combat.stats.finisherArmed) return;

    ctx.save();
    const count = combat.stats.comboCount;
    const rating = combat.stats.styleRating;
    const armed = combat.stats.finisherArmed;
    const multiplier = combat.comboDamageMultiplier();
    const x = width * 0.5;
    // Lower third of the screen: the React HUD owns the top strip, so the
    // in-canvas chain meter sits clear of it (and clear of the thumb controls).
    const y = height - 130;

    ctx.textAlign = 'center';

    // Combo Count (P1-05: label rebuilt only when the count changes)
    if (this.comboLabelCount !== count) {
      this.comboLabel = `${count}x COMBO`;
      this.comboLabelCount = count;
    }
    ctx.font = '900 28px sans-serif';
    ctx.fillStyle = armed ? '#fbbf24' : '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(this.comboLabel, x, y);
    ctx.fillText(this.comboLabel, x, y);

    // Escalating chain damage
    if (this.dmgLabelKey !== multiplier) {
      this.dmgLabel = `DMG x${multiplier.toFixed(2)}`;
      this.dmgLabelKey = multiplier;
    }
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#fda4af';
    ctx.fillText(this.dmgLabel, x, y + 15);

    // Style Tier Badge
    const ratingColor =
      rating === 'BABA YAGA'
        ? '#f59e0b'
        : rating === 'APEX'
        ? '#ec4899'
        : rating === 'RELENTLESS'
        ? '#38bdf8'
        : '#10b981';

    ctx.fillStyle = ratingColor;
    if (this.ratingLabelKey !== rating) {
      this.ratingLabel = `• ${rating} •`;
      this.ratingLabelKey = rating;
    }
    ctx.fillText(this.ratingLabel, x, y + 30);

    // Chain finisher ready pulse
    if (armed) {
      const flash = 0.55 + 0.45 * Math.sin(performance.now() * 0.012);
      ctx.globalAlpha = flash;
      ctx.font = '900 13px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText('FINISHER READY', x, y + 46);
      ctx.fillText('FINISHER READY', x, y + 46);
      ctx.globalAlpha = 1;
    }

    // Combo Timer Decay Bar
    const barWidth = 80;
    const barProgress = Math.max(0, combat.stats.comboTimer / CombatDirector.COMBO_WINDOW);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(x - barWidth / 2, y + 52, barWidth, 3);
    ctx.fillStyle = ratingColor;
    ctx.fillRect(x - barWidth / 2, y + 52, barWidth * barProgress, 3);

    ctx.restore();
  }

  /**
   * PHASE 1B 8 — style meter. The rank letter (D → SS) sits on a fill bar of
   * the points that earned it; the letter punches in on a rank flip and fades
   * back out over ~0.6 s. Hidden entirely while the meter is empty so a quiet
   * fight keeps the screen clean.
   */
  private renderStyleMeter(
    ctx: CanvasRenderingContext2D,
    height: number,
    combat: CombatDirector
  ): void {
    const points = combat.stylePoints;
    const rank = combat.styleRank;
    if (points <= 0 && this.styleRankFlash <= 0) return;

    ctx.save();

    // Rank flip: cache the glyph once, then flash the scale for a beat
    if (this.styleRankKey !== rank) {
      this.styleRankKey = rank;
      this.styleRankLabel = rank;
      this.styleRankFlash = 1;
    } else if (this.styleRankFlash > 0) {
      this.styleRankFlash = Math.max(0, this.styleRankFlash - 0.02);
    }

    const color =
      rank === 'SS' ? '#f472b6'
      : rank === 'S' ? '#fbbf24'
      : rank === 'A' ? '#a78bfa'
      : rank === 'B' ? '#38bdf8'
      : rank === 'C' ? '#10b981'
      : '#94a3b8';

    const x = 30;
    const y = height * 0.5;
    const barW = 96;
    const barH = 6;

    // Meter well + fill (points are already clamped 0–100 by the director)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(x, y + 14, barW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 14, (barW * points) / 100, barH);

    // Rank glyph: flash = 1 → 1.35x scale easing back to 1
    const scale = 1 + this.styleRankFlash * 0.35;
    ctx.translate(x + 20, y - 6);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.font = '900 34px sans-serif';
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(this.styleRankLabel, 0, 0);
    ctx.fillText(this.styleRankLabel, 0, 0);
    ctx.restore();
  }

  private renderAfterimages(ctx: CanvasRenderingContext2D, player: PlayerController): void {
    if (this.afterimages.length === 0) return;
    // One save/restore for the trail: each ghost only tweaks globalAlpha
    ctx.save();
    for (const img of this.afterimages) {
      ctx.globalAlpha = Math.max(0, (img.life / img.maxLife) * 0.38);
      player.rig.render(ctx, img.pose, img.facingRight, false, 'UNARMED', true);
    }
    ctx.restore();
  }

  private renderSpeedLines(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    combat: CombatDirector
  ): void {
    const timerActive = combat.speedLinesTimer > 0;
    const slowMoActive = combat.slowMoFactor < 1;
    if (!timerActive && !slowMoActive) return;

    const intensity = timerActive
      ? Math.min(1, combat.speedLinesTimer / 0.28)
      : 0.45;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const maxR = Math.max(width, height) * 0.5;
    const t = performance.now() * 0.001;

    ctx.save();
    ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + i * 0.7;
      const cycle = (t * 2.2 + i * 0.23) % 1;
      const r1 = maxR * (0.32 + cycle * 0.45);
      const r2 = r1 + 30 + cycle * 70;
      const fade = (1 - cycle) * 0.30 * intensity;
      // P1-05: table lookup instead of building `rgba(...${fade.toFixed(3)})`
      const step = Math.min(300, Math.max(0, Math.round(fade * 1000)));
      ctx.strokeStyle = SPEED_FADE_ALPHA[step];
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
      ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderHealthPacks(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    if (env.healthPacks.length === 0 || !this.batchBase) return;
    const t = performance.now() * 0.001;
    ctx.save();
    for (const pack of env.healthPacks) {
      if (!this.inView(pack.x, pack.y, 48)) continue;
      // Blink during the last 3 seconds before despawn
      if (pack.life > 22 && Math.floor(t * 6) % 2 === 0) continue;
      const bob = Math.sin(t * 3 + pack.id) * 4;
      // P1-04: matrix-only per item; P1-02: glow stops are constant
      this.setItemTransform(ctx, this.batchBase, pack.x, pack.y - 16 + bob, 0);

      if (!this.healthGlowGrad) {
        const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 32);
        glow.addColorStop(0, 'rgba(16, 185, 129, 0.55)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.healthGlowGrad = glow;
      }
      ctx.fillStyle = this.healthGlowGrad;
      ctx.fillRect(-32, -32, 64, 64);

      // Medic kit body
      ctx.fillStyle = '#065f46';
      ctx.fillRect(-13, -10, 26, 20);
      ctx.strokeStyle = '#6ee7b7';
      ctx.lineWidth = 2;
      ctx.strokeRect(-13, -10, 26, 20);

      // White cross emblem
      ctx.fillStyle = '#d1fae5';
      ctx.fillRect(-3, -7, 6, 14);
      ctx.fillRect(-8, -2.5, 16, 5);
    }
    this.resetItemTransform(ctx, this.batchBase);
    ctx.restore();
  }

  /** Phase 1 D5: field ammo pouch (feeds the held firearm's reserve). */
  private renderAmmoPacks(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    if (env.ammoPacks.length === 0 || !this.batchBase) return;
    const t = performance.now() * 0.001;
    ctx.save();
    for (const pack of env.ammoPacks) {
      if (!this.inView(pack.x, pack.y, 48)) continue;
      if (pack.life > 22 && Math.floor(t * 6) % 2 === 0) continue;
      const bob = Math.sin(t * 3.4 + pack.id) * 4;
      this.setItemTransform(ctx, this.batchBase, pack.x, pack.y - 14 + bob, 0);

      if (!this.ammoGlowGrad) {
        const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
        glow.addColorStop(0, 'rgba(125, 211, 252, 0.55)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ammoGlowGrad = glow;
      }
      ctx.fillStyle = this.ammoGlowGrad;
      ctx.fillRect(-30, -30, 60, 60);

      // Pouch body
      ctx.fillStyle = '#0c4a6e';
      ctx.fillRect(-12, -9, 24, 18);
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2;
      ctx.strokeRect(-12, -9, 24, 18);

      // Three visible rounds
      ctx.fillStyle = '#fbbf24';
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(i * 6 - 1.5, -6, 3, 12);
      }
    }
    this.resetItemTransform(ctx, this.batchBase);
    ctx.restore();
  }

  private renderVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    // M14: the gradient is identical every frame — build it once per canvas
    // size instead of re-parsing its colour stops on every single frame.
    // P1-05: size compared as numbers (was a `${w}x${h}` key per frame).
    if (!this.vignetteGradient || this.vignetteW !== width || this.vignetteH !== height) {
      const radius = Math.max(width, height) * 0.75;
      const vignette = ctx.createRadialGradient(
        width * 0.5, height * 0.5, radius * 0.4,
        width * 0.5, height * 0.5, radius
      );
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
      this.vignetteGradient = vignette;
      this.vignetteW = width;
      this.vignetteH = height;
    }

    ctx.fillStyle = this.vignetteGradient;
    ctx.fillRect(0, 0, width, height);
  }

  private renderBossHUD(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    enemies: EnemyController[]
  ): void {
    // P1-05: plain scan instead of `enemies.find` (a closure + scan per frame)
    let boss: EnemyController | null = null;
    for (const e of enemies) {
      if ((e.type === 'BOSS' || e.type === 'MARQUIS') && e.health > 0) {
        boss = e;
        break;
      }
    }
    if (!boss) return;

    ctx.save();
    const centerX = width * 0.5;
    const barWidth = Math.min(440, width * 0.78);
    const barHeight = 10;
    const x = centerX - barWidth / 2;
    const y = 28;

    const isMarquis = boss.type === 'MARQUIS';

    // Header label
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = isMarquis ? '#c084fc' : '#f59e0b';
    // P1-06: drop-shadow blur is Cinematic-tier only
    if (this.glowBlur) {
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
    }
    ctx.fillText(
      isMarquis
        ? `⚜️ HIGH TABLE GRANDMASTER: MARQUIS DE GRAMONT [PHASE ${boss.bossPhase}/3] ⚜️`
        : `⚔️ HIGH TABLE MASTER ENVOY: ZERO [PHASE ${boss.bossPhase}/3] ⚔️`,
      centerX,
      y - 6
    );

    // Frame backdrop
    ctx.fillStyle = 'rgba(10, 12, 18, 0.85)';
    ctx.fillRect(x - 2, y - 2, barWidth + 4, barHeight + 4);

    // Outer border with gold/purple highlight
    ctx.strokeStyle = isMarquis ? '#a855f7' : '#b45309';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 2, y - 2, barWidth + 4, barHeight + 4);

    // Ghost damage bar (trailing gold bar showing chunk of damage)
    const ghostRatio = Math.max(0, boss.ghostHealth / boss.maxHealth);
    ctx.fillStyle = isMarquis ? '#e9d5ff' : '#fbbf24';
    ctx.fillRect(x, y, barWidth * ghostRatio, barHeight);

    // Main health fill (crimson or royal violet)
    const hpRatio = Math.max(0, boss.health / boss.maxHealth);
    ctx.fillStyle = isMarquis
      ? (hpRatio > 0.25 ? '#9333ea' : '#7e22ce')
      : (hpRatio > 0.25 ? '#ef4444' : '#dc2626');
    ctx.fillRect(x, y, barWidth * hpRatio, barHeight);

    // Subtle glass gloss highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(x, y, barWidth * hpRatio, barHeight * 0.45);

    // Phase threshold ticks at 66% / 33% (Phase 1 C6 — the bar reads the
    // three-phase contract at a glance even before a threshold is crossed)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(x + barWidth * 0.66 - 1, y - 2, 2, barHeight + 4);
    ctx.fillRect(x + barWidth * 0.33 - 1, y - 2, 2, barHeight + 4);

    // Stagger / Guard sub-bar
    const stWidth = barWidth;
    const stHeight = 3;
    const stY = y + barHeight + 4;
    ctx.fillStyle = 'rgba(10, 12, 18, 0.8)';
    ctx.fillRect(x - 1, stY - 1, stWidth + 2, stHeight + 2);

    const stRatio = Math.min(1, boss.staggerMeter / boss.maxStagger);
    ctx.fillStyle = boss.isStaggered ? '#fbbf24' : isMarquis ? '#c084fc' : '#38bdf8';
    ctx.fillRect(x, stY, stWidth * stRatio, stHeight);

    // Percentage (P1-05: rebuilt only when the rounded value changes)
    const pct = Math.round(hpRatio * 100);
    if (this.bossPctValue !== pct) {
      this.bossPctLabel = `${pct}%`;
      this.bossPctValue = pct;
    }
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(this.bossPctLabel, centerX, y + barHeight - 1);

    ctx.restore();
  }

  private renderExitDoor(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    const x = env.doorX;
    const y = 0;
    const w = env.doorWidth;
    const h = env.doorHeight;
    const accent = env.config.accentColor;

    // P1-03: the door (frame, spill beam and exit sign) is static per room —
    // skip the whole pass when it is outside the padded view. Pad covers the
    // frame overhang and the open-door light spill (±90 px).
    if (!this.inView(x, y - h * 0.5, Math.max(w, h) * 0.5 + 32)) return;

    ctx.save();

    // Doorway frame
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(x - w / 2 - 6, y - h - 12, w + 12, h + 12);
    ctx.strokeStyle = env.doorOpen ? accent : '#475569';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x - w / 2 - 6, y - h - 12, w + 12, h + 12);

    if (env.doorOpen) {
      // Illuminated doorway interior (P1-02: constant coords, accent stops)
      if (!this.doorGrad || this.doorGradAccent !== accent || this.doorGradH !== h) {
        const doorGrad = ctx.createLinearGradient(0, y - h, 0, y);
        doorGrad.addColorStop(0, `${accent}aa`);
        doorGrad.addColorStop(1, '#000000');
        this.doorGrad = doorGrad;
        this.doorGradAccent = accent;
        this.doorGradH = h;
      }
      ctx.fillStyle = this.doorGrad;
      ctx.fillRect(x - w / 2, y - h, w, h);

      // Light beam spilling out onto floor (P1-02 keyed by position + accent)
      if (
        !this.beamGrad ||
        this.beamGradAccent !== accent ||
        this.beamGradX !== x ||
        this.beamGradH !== h
      ) {
        const beamGrad = ctx.createRadialGradient(x, y, 5, x, y, 140);
        beamGrad.addColorStop(0, `${accent}66`);
        beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
        this.beamGrad = beamGrad;
        this.beamGradAccent = accent;
        this.beamGradX = x;
        this.beamGradH = h;
      }
      ctx.fillStyle = this.beamGrad;
      ctx.fillRect(x - 90, y, 180, 50);

      // Floating particles in doorway
      const time = performance.now() * 0.002;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) {
        const py = y - ((i * 22 + time * 40) % h);
        const px = x + Math.sin(time + i) * (w * 0.3);
        ctx.fillRect(px, py, 2, 2);
      }

      // Exit sign above door
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = accent;
      ctx.fillText('• PROCEED TO NEXT CHAMBER •', x, y - h - 18);
    } else {
      // Secure brushed metal door panels
      ctx.fillStyle = '#1e222d';
      ctx.fillRect(x - w / 2, y - h, w, h);

      // Horizontal security slits
      ctx.fillStyle = '#0f1117';
      for (let i = 1; i <= 4; i++) {
        ctx.fillRect(x - w / 2 + 8, y - h + i * 24, w - 16, 2);
      }

      // Red biometric scanner LED
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(x + w / 2 - 12, y - h * 0.5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private renderDestructibles(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    ctx.save();
    for (const obj of env.destructibles) {
      if (obj.isBroken) continue;
      // P1-03: static furniture — skip anything outside the padded view
      // (pad covers half the larger side + the champagne-bucket overhang)
      if (!this.inView(obj.x, obj.y - obj.height * 0.5, Math.max(obj.width, obj.height) * 0.5 + 32)) continue;

      const left = obj.x - obj.width / 2;
      const top = obj.y - obj.height;

      if (obj.type === 'GLASS_DISPLAY') {
        // High-end Continental Glass Display Case
        // Wooden pedestal base
        ctx.fillStyle = '#1c1917';
        ctx.fillRect(left, obj.y - 14, obj.width, 14);
        ctx.fillStyle = '#d97706';
        ctx.fillRect(left, obj.y - 14, obj.width, 2);

        // Glass encasement
        ctx.fillStyle = 'rgba(186, 230, 253, 0.14)';
        ctx.fillRect(left + 2, top + 10, obj.width - 4, obj.height - 24);

        // Glass frame border
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(left + 2, top + 10, obj.width - 4, obj.height - 24);

        // Specular reflection diagonal streak
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left + 6, top + 16);
        ctx.lineTo(left + obj.width - 12, top + obj.height - 32);
        ctx.stroke();

        // Weapon displayed inside velvet pedestal
        if (obj.droppedWeapon === 'KATANA') {
          // Floating ceremonial Katana
          ctx.strokeStyle = '#f8fafc';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(obj.x - 18, obj.y - 62);
          ctx.lineTo(obj.x + 18, obj.y - 62);
          ctx.stroke();

          // Golden Tsuba
          ctx.fillStyle = '#d97706';
          ctx.fillRect(obj.x - 12, obj.y - 65, 3, 6);
        } else if (obj.droppedWeapon === 'KNIFE') {
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(obj.x - 10, obj.y - 58);
          ctx.lineTo(obj.x + 10, obj.y - 58);
          ctx.stroke();
        }

        // Top brass cap
        ctx.fillStyle = '#292524';
        ctx.fillRect(left, top, obj.width, 10);
        ctx.fillStyle = '#d97706';
        ctx.fillRect(left, top + 8, obj.width, 2);
      } else if (obj.type === 'CHAMPAGNE_TABLE') {
        // Continental lounge table
        ctx.fillStyle = '#171717';
        // Table top
        ctx.fillRect(left, top, obj.width, 8);
        // Table legs
        ctx.fillStyle = '#262626';
        ctx.fillRect(left + 6, top + 8, 4, obj.height - 8);
        ctx.fillRect(left + obj.width - 10, top + 8, 4, obj.height - 8);

        // Champagne bucket and ice
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(obj.x - 7, top - 14, 14, 14);
        ctx.fillStyle = '#10b981'; // Champagne bottle neck
        ctx.fillRect(obj.x - 2, top - 22, 4, 10);
        ctx.fillStyle = '#fbbf24'; // Gold foil
        ctx.fillRect(obj.x - 2, top - 24, 4, 3);
      } else if (obj.type === 'EXPLOSIVE_BARREL') {
        // Volatile fuel drum — hazard stripe + a crack as it takes damage
        const hurt = obj.health / obj.maxHealth;
        ctx.fillStyle = hurt > 0.5 ? '#b91c1c' : '#7f1d1d';
        ctx.fillRect(left, top + 6, obj.width, obj.height - 6);
        ctx.fillStyle = '#450a0a';
        ctx.fillRect(left, top, obj.width, 8);
        ctx.fillRect(left, obj.y - 8, obj.width, 8);
        // Hazard band
        ctx.fillStyle = '#facc15';
        ctx.fillRect(left, obj.y - obj.height * 0.55, obj.width, 7);
        ctx.fillStyle = '#1c1917';
        for (let s = 0; s < obj.width; s += 10) {
          ctx.fillRect(left + s, obj.y - obj.height * 0.55, 5, 7);
        }
        // Pressure valve
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(obj.x - 3, top - 5, 6, 6);
        // Damage cracks
        if (hurt < 0.7) {
          ctx.strokeStyle = '#fef08a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(obj.x - 6, top + 14);
          ctx.lineTo(obj.x + 3, top + 26);
          ctx.lineTo(obj.x - 4, top + 38);
          ctx.stroke();
        }
      } else if (obj.type === 'CRATE') {
        // Ammunition crate — wood planks with a steel band
        ctx.fillStyle = '#78350f';
        ctx.fillRect(left, top, obj.width, obj.height);
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = 2;
        for (let p = 1; p < 3; p++) {
          ctx.beginPath();
          ctx.moveTo(left, top + (obj.height / 3) * p);
          ctx.lineTo(left + obj.width, top + (obj.height / 3) * p);
          ctx.stroke();
        }
        ctx.strokeRect(left, top, obj.width, obj.height);
        ctx.fillStyle = '#3f3f46';
        ctx.fillRect(left, top + obj.height * 0.4, obj.width, 5);
        // Ammo stencil
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(obj.x - 7, top + 8, 14, 4);
        ctx.fillRect(obj.x - 3, top + 4, 6, 12);
      } else if (obj.type === 'GLASS_PANEL') {
        // Breakable window — translucent pane in a thin frame
        ctx.fillStyle = 'rgba(186, 230, 253, 0.12)';
        ctx.fillRect(left, top, obj.width, obj.height);
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, obj.width, obj.height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left + 8, top + 12);
        ctx.lineTo(left + obj.width - 14, top + obj.height - 20);
        ctx.stroke();
        if (obj.health < obj.maxHealth) {
          ctx.beginPath();
          ctx.moveTo(obj.x, top + obj.height * 0.3);
          ctx.lineTo(obj.x - 12, top + obj.height * 0.55);
          ctx.moveTo(obj.x, top + obj.height * 0.3);
          ctx.lineTo(obj.x + 14, top + obj.height * 0.62);
          ctx.stroke();
        }
      } else {
        // Weapon Rack
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(left, top, obj.width, obj.height);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(left, top, obj.width, obj.height);

        // Weapon silhouettes inside rack
        ctx.fillStyle = '#64748b';
        ctx.fillRect(obj.x - 4, top + 15, 8, obj.height - 30);
      }
    }
    ctx.restore();
  }

  private renderGlassShards(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    if (env.glassShards.length === 0 || !this.batchBase) return;
    ctx.save();
    for (const shard of env.glassShards) {
      if (!this.inView(shard.x, shard.y, shard.size)) continue;
      const alpha = 1 - shard.life / shard.maxLife;
      ctx.globalAlpha = alpha;
      this.setItemTransform(ctx, this.batchBase, shard.x, shard.y, shard.rot);

      ctx.fillStyle = shard.color;
      ctx.beginPath();
      ctx.moveTo(-shard.size, -shard.size * 0.6);
      ctx.lineTo(shard.size, 0);
      ctx.lineTo(-shard.size * 0.4, shard.size * 0.8);
      ctx.closePath();
      ctx.fill();

      // Specular rim
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    this.resetItemTransform(ctx, this.batchBase);
    ctx.restore();
  }

  private renderDroppedWeapons(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    if (env.droppedWeapons.length === 0 || !this.batchBase) return;
    ctx.save();
    for (const w of env.droppedWeapons) {
      if (!this.inView(w.x, w.y, 64)) continue;
      this.setItemTransform(ctx, this.batchBase, w.x, w.y, w.rot);

      // Upward golden aura indicator (P1-02: constant local coords + stops)
      if (!this.weaponGlowGrad) {
        const glowGrad = ctx.createRadialGradient(0, -8, 2, 0, -8, 24);
        glowGrad.addColorStop(0, 'rgba(251, 191, 36, 0.45)');
        glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
        this.weaponGlowGrad = glowGrad;
      }
      ctx.fillStyle = this.weaponGlowGrad;
      ctx.fillRect(-24, -32, 48, 48);

      if (w.type === 'KATANA') {
        // Dropped Katana
        ctx.strokeStyle = '#18181b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-18, -4);
        ctx.lineTo(-8, -4);
        ctx.stroke();

        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-8, -8);
        ctx.lineTo(-8, 0);
        ctx.stroke();

        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-7, -4);
        ctx.lineTo(24, -7);
        ctx.stroke();
      } else if (
        w.type === 'PISTOL' ||
        w.type === 'SMG' ||
        w.type === 'SHOTGUN' ||
        w.type === 'RIFLE'
      ) {
        // Phase 1 B6: firearm pickups read as guns, not blades
        const long = w.type === 'RIFLE' || w.type === 'SHOTGUN';
        const barrelLen = w.type === 'RIFLE' ? 34 : w.type === 'SHOTGUN' ? 30 : w.type === 'SMG' ? 22 : 16;
        ctx.fillStyle = '#18181b';
        ctx.fillRect(-12, -11, barrelLen, 7); // slide / barrel
        ctx.fillRect(-8, -5, 9, 11);          // grip
        if (w.type === 'SMG') ctx.fillRect(-3, -4, 8, 4); // box magazine
        if (w.type === 'SHOTGUN') ctx.fillRect(10, -8, 12, 4); // pump
        if (w.type === 'RIFLE') ctx.fillRect(-16, -9, 6, 5);   // stock
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(-12, -11, 5, 2);
        if (long) {
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(4, -13, 10, 2);
        }
      } else {
        // Dropped Knife
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, -3);
        ctx.lineTo(-2, -3);
        ctx.stroke();

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-2, -3);
        ctx.lineTo(12, -3);
        ctx.stroke();
      }
    }
    this.resetItemTransform(ctx, this.batchBase);
    ctx.restore();
  }

  private renderGoldCoins(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    if (env.coins.length === 0 || !this.batchBase) return;
    ctx.save();
    for (const coin of env.coins) {
      if (!this.inView(coin.x, coin.y, 24)) continue;
      // 3D spinning coin animation via cosine scaling (P1-04: matrix only)
      const scaleX = Math.cos(coin.rot);
      this.setItemTransform(ctx, this.batchBase, coin.x, coin.y, 0, scaleX, 1);

      // Gold coin rim
      ctx.fillStyle = '#d97706';
      ctx.beginPath();
      ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
      ctx.fill();

      // Gleaming face
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();

      // Continental lion seal
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-2, -3, 4, 6);
    }
    this.resetItemTransform(ctx, this.batchBase);
    ctx.restore();
  }

  private renderProjectiles(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    if (env.projectiles.length === 0 || !this.batchBase) return;
    ctx.save();
    for (const p of env.projectiles) {
      if (!this.inView(p.x, p.y, 48)) continue;
      this.setItemTransform(ctx, this.batchBase, p.x, p.y, p.rot);

      // Speed streak
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.4)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();

      // Sharp blade
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(12, 0);
      ctx.stroke();
    }
    this.resetItemTransform(ctx, this.batchBase);
    ctx.restore();
  }

  private renderRoomBanner(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    env: EnvironmentManager
  ): void {
    if (env.roomBannerTimer <= 0) return;
    const alpha = Math.min(1, env.roomBannerTimer * 1.5);

    ctx.save();
    ctx.globalAlpha = alpha;
    const centerX = width * 0.5;
    const y = 80;

    ctx.textAlign = 'center';
    ctx.font = '900 20px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(env.config.title, centerX, y);
    ctx.fillText(env.config.title, centerX, y);

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = env.config.accentColor;
    ctx.fillText(`— ${env.config.subtitle} —`, centerX, y + 18);

    ctx.restore();
  }

  private renderTransitionOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    env: EnvironmentManager
  ): void {
    if (env.transitionAlpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = env.transitionAlpha;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

