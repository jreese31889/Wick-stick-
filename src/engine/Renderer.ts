import { Camera } from './Camera';
import { PlayerController } from './PlayerController';
import { EnemyController } from './EnemyController';
import { EnemyRig } from './EnemyRig';
import { CombatDirector } from './CombatDirector';
import { EnvironmentManager } from './EnvironmentManager';

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

export class Renderer {
  private particles: DustParticle[] = [];
  private enemyRig: EnemyRig = new EnemyRig();

  public spawnDust(
    x: number,
    y: number,
    vx: number,
    vy: number,
    count: number = 3,
    color: string = 'rgba(180, 190, 210, 0.4)'
  ): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() * 8 - 4),
        y: y + (Math.random() * 4 - 2),
        vx: vx + (Math.random() * 40 - 20),
        vy: vy - (Math.random() * 30 + 10),
        life: 0,
        maxLife: 0.3 + Math.random() * 0.25,
        size: 2 + Math.random() * 3.5,
        color
      });
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
      }
    }
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
    ctx.clearRect(0, 0, width, height);

    ctx.save();

    // Center of screen transform
    const centerX = width * 0.5;
    const centerY = height * 0.5;

    // Apply Camera Transform (translate, zoom, shake)
    ctx.translate(centerX + camera.shakeOffsetX, centerY + camera.shakeOffsetY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

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
    }

    // 5. DUST & MOTION PARTICLES
    this.renderParticles(ctx);

    // 6. CHARACTER DROP SHADOWS
    this.renderShadow(ctx, player.physics.position.x, player.physics.position.y);
    for (const enemy of enemies) {
      this.renderShadow(ctx, enemy.position.x, enemy.position.y);
    }

    // 7. ENEMIES
    for (const enemy of enemies) {
      this.enemyRig.render(ctx, enemy, debugMode);
    }

    // 8. TACTICAL LASER AIM (Twin-Stick & Mobile Aim)
    this.renderAimLaser(ctx, player);

    // 9. PLAYER STICK FIGURE (With equipped Katana/Knife)
    player.rig.render(
      ctx,
      player.currentPose,
      player.physics.facingRight,
      debugMode,
      player.physics.equippedWeapon
    );

    // 10. COMBAT PARTICLES (Shockwaves, Sparks, Tracers, Casings, Blade Arcs)
    this.renderCombatFX(ctx, combatDirector);

    // 11. DAMAGE NUMBERS & COMBAT POPUPS
    this.renderDamagePopups(ctx, combatDirector);

    ctx.restore();

    // 11. SCREEN VIGNETTE & CINEMATIC BARS
    this.renderVignette(ctx, width, height);

    // 12. SCREEN-SPACE COMBO & STYLE OVERLAY
    this.renderComboHUD(ctx, width, height, combatDirector);

    // 13. HIGH TABLE BOSS HEALTH BAR (When Boss is active)
    this.renderBossHUD(ctx, width, height, enemies);

    // 14. ROOM INTRO TITLE BANNER & TRANSITION FADE
    if (environmentManager) {
      this.renderRoomBanner(ctx, width, height, environmentManager);
      this.renderTransitionOverlay(ctx, width, height, environmentManager);
    }
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

    // Far background gradient
    const grad = ctx.createLinearGradient(0, groundY - 500, 0, groundY);
    grad.addColorStop(0, ambienceColor);
    grad.addColorStop(0.7, '#111422');
    grad.addColorStop(1, '#181b2e');
    ctx.fillStyle = grad;
    ctx.fillRect(camX - 1500, groundY - 600, 3000, 600);

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
      // Draw procedural rain streaks
      const rainTime = performance.now() * 0.001;
      for (let i = 0; i < 75; i++) {
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

    // Sconce light glow
    const sconceX = isLeft ? x - 6 : x + 6;
    const sconceY = groundY - 210;
    const sconceGrad = ctx.createRadialGradient(sconceX, sconceY, 2, sconceX, sconceY, 90);
    sconceGrad.addColorStop(0, `${accentColor}55`);
    sconceGrad.addColorStop(0.4, `${accentColor}18`);
    sconceGrad.addColorStop(1, 'rgba(0,0,0,0)');
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
    const floorGrad = ctx.createLinearGradient(0, groundY, 0, groundY + 400);
    floorGrad.addColorStop(0, floorColor);
    floorGrad.addColorStop(0.2, '#0c0d13');
    floorGrad.addColorStop(1, '#050608');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(camX - 1500, groundY, 3000, 500);

    ctx.strokeStyle = 'rgba(50, 60, 85, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(camX - 1500, groundY);
    ctx.lineTo(camX + 1500, groundY);
    ctx.stroke();

    const tileSize = 120;
    const startTile = Math.floor((camX - 1500) / tileSize) * tileSize;
    for (let x = startTile; x < camX + 1500; x += tileSize) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x, groundY + 300);
      ctx.stroke();
    }
  }

  private renderShadow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const groundDist = Math.max(0, -y);
    const scale = Math.max(0.2, 1 - groundDist / 200);
    const opacity = Math.max(0.08, 0.45 * (1 - groundDist / 180));

    ctx.save();
    ctx.translate(x, 0);
    ctx.scale(scale, scale * 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
    ctx.fill();
    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - p.life * 0.5 / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderCombatFX(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    // Shockwaves
    for (const sw of combat.shockwaves) {
      const alpha = sw.life / sw.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = sw.lineWidth * alpha;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Sparks
    for (const s of combat.sparks) {
      const alpha = s.life / s.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Supersonic Bullet Tracers
    for (const tr of combat.tracers) {
      const alpha = tr.life / tr.maxLife;
      ctx.save();
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
      ctx.restore();
    }

    // Spent Brass 9mm Casings
    for (const c of combat.casings) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      // Brass casing body
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-3, -1.2, 6, 2.4);
      // Dark rim
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-3, -1.2, 1.2, 2.4);
      ctx.restore();
    }

    // Blade Slash Arc Ribbon Trails (Godot style)
    this.renderBladeArcs(ctx, combat);
  }

  private renderBloodDecals(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    if (combat.bloodDecals.length === 0) return;
    ctx.save();
    for (const b of combat.bloodDecals) {
      ctx.globalAlpha = b.alpha;
      ctx.fillStyle = '#7f1d1d'; // Crimson noir blood
      ctx.beginPath();
      if (b.isStuck) {
        ctx.ellipse(b.x, b.y - 1, b.radius * 1.35, b.radius * 0.55, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  private renderBladeArcs(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    if (combat.bladeArcs.length === 0) return;
    ctx.save();
    for (const arc of combat.bladeArcs) {
      const progress = arc.life / arc.maxLife;
      const alpha = 1 - progress;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = arc.color;
      ctx.lineWidth = 4 * (1 - progress * 0.5);
      ctx.shadowColor = arc.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, arc.radius, arc.angle - arc.arcLength * 0.5, arc.angle + arc.arcLength * 0.5);
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
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    // Laser dot & target reticle
    ctx.setLineDash([]);
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 8;
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

  private renderDamagePopups(ctx: CanvasRenderingContext2D, combat: CombatDirector): void {
    for (const p of combat.popups) {
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${p.size}px monospace`;
      ctx.fillStyle = p.color;
      ctx.textAlign = 'center';
      // Outline for legibility
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  private renderComboHUD(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    combat: CombatDirector
  ): void {
    if (combat.stats.comboCount <= 1) return;

    ctx.save();
    const count = combat.stats.comboCount;
    const rating = combat.stats.styleRating;
    const x = width * 0.5;
    const y = 85;

    ctx.textAlign = 'center';

    // Combo Count
    ctx.font = '900 28px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(`${count}x COMBO`, x, y);
    ctx.fillText(`${count}x COMBO`, x, y);

    // Style Tier Badge
    ctx.font = 'bold 12px monospace';
    const ratingColor =
      rating === 'BABA YAGA'
        ? '#f59e0b'
        : rating === 'APEX'
        ? '#ec4899'
        : rating === 'RELENTLESS'
        ? '#38bdf8'
        : '#10b981';

    ctx.fillStyle = ratingColor;
    ctx.fillText(`• ${rating} •`, x, y + 16);

    // Combo Timer Decay Bar
    const barWidth = 80;
    const barProgress = Math.max(0, combat.stats.comboTimer / 2.8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(x - barWidth / 2, y + 22, barWidth, 3);
    ctx.fillStyle = ratingColor;
    ctx.fillRect(x - barWidth / 2, y + 22, barWidth * barProgress, 3);

    ctx.restore();
  }

  private renderVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const radius = Math.max(width, height) * 0.75;
    const vignette = ctx.createRadialGradient(
      width * 0.5, height * 0.5, radius * 0.4,
      width * 0.5, height * 0.5, radius
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.65)');

    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  private renderBossHUD(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    enemies: EnemyController[]
  ): void {
    const boss = enemies.find((e) => (e.type === 'BOSS' || e.type === 'MARQUIS') && e.health > 0);
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
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(
      isMarquis
        ? '⚜️ HIGH TABLE GRANDMASTER: MARQUIS DE GRAMONT [SOVEREIGN] ⚜️'
        : '⚔️ HIGH TABLE MASTER ENVOY: ZERO [BOSS] ⚔️',
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

    // Stagger / Guard sub-bar
    const stWidth = barWidth;
    const stHeight = 3;
    const stY = y + barHeight + 4;
    ctx.fillStyle = 'rgba(10, 12, 18, 0.8)';
    ctx.fillRect(x - 1, stY - 1, stWidth + 2, stHeight + 2);

    const stRatio = Math.min(1, boss.staggerMeter / boss.maxStagger);
    ctx.fillStyle = boss.isStaggered ? '#fbbf24' : isMarquis ? '#c084fc' : '#38bdf8';
    ctx.fillRect(x, stY, stWidth * stRatio, stHeight);

    // Percentage
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`${Math.round(hpRatio * 100)}%`, centerX, y + barHeight - 1);

    ctx.restore();
  }

  private renderExitDoor(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    const x = env.doorX;
    const y = 0;
    const w = env.doorWidth;
    const h = env.doorHeight;
    const accent = env.config.accentColor;

    ctx.save();

    // Doorway frame
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(x - w / 2 - 6, y - h - 12, w + 12, h + 12);
    ctx.strokeStyle = env.doorOpen ? accent : '#475569';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x - w / 2 - 6, y - h - 12, w + 12, h + 12);

    if (env.doorOpen) {
      // Illuminated doorway interior
      const doorGrad = ctx.createLinearGradient(0, y - h, 0, y);
      doorGrad.addColorStop(0, `${accent}aa`);
      doorGrad.addColorStop(1, '#000000');
      ctx.fillStyle = doorGrad;
      ctx.fillRect(x - w / 2, y - h, w, h);

      // Light beam spilling out onto floor
      const beamGrad = ctx.createRadialGradient(x, y, 5, x, y, 140);
      beamGrad.addColorStop(0, `${accent}66`);
      beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = beamGrad;
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
    ctx.save();
    for (const shard of env.glassShards) {
      const alpha = 1 - shard.life / shard.maxLife;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(shard.x, shard.y);
      ctx.rotate(shard.rot);

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

      ctx.restore();
    }
    ctx.restore();
  }

  private renderDroppedWeapons(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    ctx.save();
    for (const w of env.droppedWeapons) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.rot);

      // Upward golden aura indicator
      const glowGrad = ctx.createRadialGradient(0, -8, 2, 0, -8, 24);
      glowGrad.addColorStop(0, 'rgba(251, 191, 36, 0.45)');
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
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

      ctx.restore();
    }
    ctx.restore();
  }

  private renderGoldCoins(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    ctx.save();
    for (const coin of env.coins) {
      ctx.save();
      ctx.translate(coin.x, coin.y);

      // 3D spinning coin animation via cosine scaling
      const scaleX = Math.cos(coin.rot);
      ctx.scale(scaleX, 1);

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

      ctx.restore();
    }
    ctx.restore();
  }

  private renderProjectiles(ctx: CanvasRenderingContext2D, env: EnvironmentManager): void {
    ctx.save();
    for (const p of env.projectiles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

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

      ctx.restore();
    }
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

