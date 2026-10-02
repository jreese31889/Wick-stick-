import {
  DestructibleObject,
  DroppedWeapon,
  GlassShard,
  GoldCoin,
  Hitbox,
  RoomTheme,
  ThrownProjectile,
  Vector2,
  WeaponType
} from '../types/game';
import { SoundFX } from './SoundFX';
import { EnemyController } from './EnemyController';

export interface RoomConfig {
  theme: RoomTheme;
  title: string;
  subtitle: string;
  ambienceColor: string;
  floorColor: string;
  accentColor: string;
  hasRain: boolean;
}

export const ROOM_CONFIGS: Record<RoomTheme, RoomConfig> = {
  CONTINENTAL_LOUNGE: {
    theme: 'CONTINENTAL_LOUNGE',
    title: 'THE CONTINENTAL',
    subtitle: 'Grand Lounge & Vault',
    ambienceColor: '#0c0a09',
    floorColor: '#1c1917',
    accentColor: '#d97706',
    hasRain: false,
  },
  NEON_GALLERY: {
    theme: 'NEON_GALLERY',
    title: 'GLASS PAVILION',
    subtitle: 'Exhibition of Shadows',
    ambienceColor: '#050a14',
    floorColor: '#0a1124',
    accentColor: '#06b6d4',
    hasRain: false,
  },
  RAINY_ALLEY: {
    theme: 'RAINY_ALLEY',
    title: 'RAINIER ALLEYWAY',
    subtitle: 'Midnight Industrial Corridor',
    ambienceColor: '#05070a',
    floorColor: '#0f172a',
    accentColor: '#38bdf8',
    hasRain: true,
  },
  PENTHOUSE_SUITE: {
    theme: 'PENTHOUSE_SUITE',
    title: 'HIGH TABLE PENTHOUSE',
    subtitle: 'Apex Observatory',
    ambienceColor: '#09050d',
    floorColor: '#1a0d24',
    accentColor: '#f43f5e',
    hasRain: false,
  },
};

export class EnvironmentManager {
  public currentRoomIndex: number = 0;
  public currentTheme: RoomTheme = 'CONTINENTAL_LOUNGE';
  public destructibles: DestructibleObject[] = [];
  public glassShards: GlassShard[] = [];
  public droppedWeapons: DroppedWeapon[] = [];
  public coins: GoldCoin[] = [];
  public projectiles: ThrownProjectile[] = [];
  public doorOpen: boolean = false;
  public doorX: number = 740;
  public doorWidth: number = 70;
  public doorHeight: number = 130;
  public roomBannerTimer: number = 0;
  public transitionAlpha: number = 0;

  // Rain particles for Rainy Alley theme
  private rainDrops: { x: number; y: number; speed: number; len: number }[] = [];

  constructor() {
    this.initRain();
    this.initRoom(0);
  }

  private initRain() {
    this.rainDrops = [];
    for (let i = 0; i < 90; i++) {
      this.rainDrops.push({
        x: (Math.random() - 0.5) * 1600,
        y: -400 + Math.random() * 500,
        speed: 650 + Math.random() * 400,
        len: 12 + Math.random() * 16,
      });
    }
  }

  public get config(): RoomConfig {
    return ROOM_CONFIGS[this.currentTheme] || ROOM_CONFIGS.CONTINENTAL_LOUNGE;
  }

  public initRoom(roomIndex: number) {
    this.currentRoomIndex = roomIndex;
    const themes: RoomTheme[] = ['CONTINENTAL_LOUNGE', 'NEON_GALLERY', 'RAINY_ALLEY', 'PENTHOUSE_SUITE'];
    this.currentTheme = themes[roomIndex % themes.length];
    this.doorOpen = false;
    this.roomBannerTimer = 3.5;
    this.transitionAlpha = 1.0;

    // Clear transient projectiles and shards
    this.projectiles = [];
    this.glassShards = [];

    // Setup Room Destructibles and tactical weapon caches
    this.destructibles = [];
    if (this.currentTheme === 'CONTINENTAL_LOUNGE') {
      this.destructibles.push(
        {
          id: 1,
          type: 'GLASS_DISPLAY',
          x: -360,
          y: 0,
          width: 55,
          height: 110,
          health: 40,
          maxHealth: 40,
          isBroken: false,
          droppedWeapon: 'KATANA',
        },
        {
          id: 2,
          type: 'CHAMPAGNE_TABLE',
          x: 280,
          y: 0,
          width: 80,
          height: 50,
          health: 30,
          maxHealth: 30,
          isBroken: false,
        },
        {
          id: 3,
          type: 'WEAPON_RACK',
          x: -600,
          y: 0,
          width: 45,
          height: 90,
          health: 35,
          maxHealth: 35,
          isBroken: false,
          droppedWeapon: 'KNIFE',
        }
      );
    } else if (this.currentTheme === 'NEON_GALLERY') {
      this.destructibles.push(
        {
          id: 1,
          type: 'GLASS_DISPLAY',
          x: -280,
          y: 0,
          width: 60,
          height: 120,
          health: 40,
          maxHealth: 40,
          isBroken: false,
          droppedWeapon: 'KATANA',
        },
        {
          id: 2,
          type: 'GLASS_DISPLAY',
          x: 340,
          y: 0,
          width: 60,
          height: 120,
          health: 40,
          maxHealth: 40,
          isBroken: false,
          droppedWeapon: 'KNIFE',
        }
      );
    } else if (this.currentTheme === 'RAINY_ALLEY') {
      this.destructibles.push(
        {
          id: 1,
          type: 'WEAPON_RACK',
          x: -380,
          y: 0,
          width: 50,
          height: 85,
          health: 30,
          maxHealth: 30,
          isBroken: false,
          droppedWeapon: 'KNIFE',
        },
        {
          id: 2,
          type: 'CHAMPAGNE_TABLE',
          x: 320,
          y: 0,
          width: 70,
          height: 45,
          health: 25,
          maxHealth: 25,
          isBroken: false,
          droppedWeapon: 'KATANA',
        }
      );
    } else {
      // PENTHOUSE_SUITE
      this.destructibles.push(
        {
          id: 1,
          type: 'GLASS_DISPLAY',
          x: -300,
          y: 0,
          width: 65,
          height: 130,
          health: 50,
          maxHealth: 50,
          isBroken: false,
          droppedWeapon: 'KATANA',
        },
        {
          id: 2,
          type: 'CHAMPAGNE_TABLE',
          x: 380,
          y: 0,
          width: 85,
          height: 55,
          health: 40,
          maxHealth: 40,
          isBroken: false,
        }
      );
    }
  }

  public openExitDoor() {
    if (!this.doorOpen) {
      this.doorOpen = true;
      SoundFX.playDoorOpen();
    }
  }

  public setDoorOpen(isOpen: boolean) {
    if (isOpen) {
      this.openExitDoor();
    } else {
      this.doorOpen = false;
    }
  }

  public checkDoorInteraction(playerX: number, interactPressed: boolean): boolean {
    if (!this.doorOpen) return false;
    const dist = Math.abs(playerX - this.doorX);
    if (dist < 80 && interactPressed) {
      return true;
    }
    return false;
  }

  public setupRoomForWave(wave: number) {
    this.initRoom(wave - 1);
  }

  public reset() {
    this.initRoom(0);
    this.coins = [];
    this.droppedWeapons = [];
    this.projectiles = [];
    this.glassShards = [];
  }

  public shatterObject(obj: DestructibleObject, impactForceX: number = 0, impactForceY: number = -120) {
    if (obj.isBroken) return;
    obj.isBroken = true;
    SoundFX.playGlassShatter();

    // Spawn 28+ physics-simulated glass shards
    const colors =
      this.currentTheme === 'NEON_GALLERY'
        ? ['#a5f3fc', '#38bdf8', '#c084fc', '#ffffff']
        : ['#fef08a', '#fde047', '#ffffff', '#e2e8f0'];

    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 320;
      this.glassShards.push({
        x: obj.x + (Math.random() - 0.5) * obj.width,
        y: obj.y - Math.random() * obj.height,
        vx: Math.cos(angle) * speed + impactForceX * 0.4,
        vy: Math.sin(angle) * speed + impactForceY * 0.6,
        size: 3 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 14,
        life: 0,
        maxLife: 2.2 + Math.random() * 1.5,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    // Drop contained weapon if present
    if (obj.droppedWeapon) {
      this.dropWeapon(obj.droppedWeapon, obj.x, obj.y - 30, (Math.random() - 0.5) * 80, -180);
    }

    // Drop 1-2 Continental Gold Coins
    this.dropCoin(obj.x, obj.y - 40, 1);
    if (Math.random() > 0.4) {
      this.dropCoin(obj.x + (Math.random() - 0.5) * 30, obj.y - 50, 1);
    }
  }

  public dropWeapon(type: WeaponType, x: number, y: number, vx: number = 0, vy: number = -160) {
    this.droppedWeapons.push({
      id: Date.now() + Math.random(),
      type,
      x,
      y,
      vx,
      vy,
      rot: Math.random() * Math.PI,
      vRot: (Math.random() - 0.5) * 10,
      durability: type === 'KATANA' ? 14 : 5,
      grounded: false,
    });
  }

  public dropCoin(x: number, y: number, value: number = 1) {
    this.coins.push({
      id: Date.now() + Math.random(),
      x,
      y,
      vx: (Math.random() - 0.5) * 160,
      vy: -220 - Math.random() * 120,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 12,
      life: 0,
      value,
    });
  }

  public throwKnife(x: number, y: number, dir: number) {
    SoundFX.playKnifeThrow();
    this.projectiles.push({
      id: Date.now() + Math.random(),
      type: 'KNIFE',
      x,
      y: y - 55,
      vx: dir * 980,
      vy: -25,
      rot: dir > 0 ? 0 : Math.PI,
      life: 0,
      damage: 48,
    });
  }

  public update(
    dt: number,
    player: { position: Vector2; coins?: number; equippedWeapon?: WeaponType; weaponDurability?: number; perks?: Record<string, boolean> },
    onPickupCoin?: (val: number) => void,
    onPickupWeapon?: (weapon: WeaponType) => void
  ) {
    const playerPos = player.position;

    // Banner timer
    if (this.roomBannerTimer > 0) {
      this.roomBannerTimer -= dt;
    }
    if (this.transitionAlpha > 0) {
      this.transitionAlpha = Math.max(0, this.transitionAlpha - dt * 2.0);
    }

    // 1. Rain simulation
    if (this.config.hasRain) {
      for (const drop of this.rainDrops) {
        drop.y += drop.speed * dt;
        drop.x -= 80 * dt; // Wind slant
        if (drop.y > 50) {
          drop.y = -350 - Math.random() * 100;
          drop.x = (Math.random() - 0.5) * 1600;
        }
      }
    }

    // 2. Glass Shards physics
    const GRAVITY = 1100;
    for (let i = this.glassShards.length - 1; i >= 0; i--) {
      const shard = this.glassShards[i];
      shard.life += dt;
      shard.vy += GRAVITY * dt;
      shard.x += shard.vx * dt;
      shard.y += shard.vy * dt;
      shard.rot += shard.vRot * dt;

      // Floor bounce (GROUND_Y = 0)
      if (shard.y >= 0) {
        shard.y = 0;
        shard.vy = -shard.vy * 0.35; // Dampened bounce
        shard.vx *= 0.65;
        shard.vRot *= 0.5;
      }

      if (shard.life >= shard.maxLife) {
        this.glassShards.splice(i, 1);
      }
    }

    // 3. Dropped Weapons physics & pickup
    for (let i = this.droppedWeapons.length - 1; i >= 0; i--) {
      const w = this.droppedWeapons[i];
      if (!w.grounded) {
        w.vy += GRAVITY * dt;
        w.x += w.vx * dt;
        w.y += w.vy * dt;
        w.rot += w.vRot * dt;

        if (w.y >= 0) {
          w.y = 0;
          w.vy = 0;
          w.vx = 0;
          w.vRot = 0;
          w.grounded = true;
          w.rot = 0;
        }
      }

      // Player proximity pickup
      const dx = playerPos.x - w.x;
      const dy = playerPos.y - w.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 55) {
        if (player.equippedWeapon !== undefined) {
          player.equippedWeapon = w.type;
          const bonusDurability = player.perks?.['LETHAL_BLADE'] ? 6 : 0;
          player.weaponDurability = w.type === 'KATANA' ? 14 + bonusDurability : 4;
        }
        if (onPickupWeapon) onPickupWeapon(w.type);
        SoundFX.playBladeSlash();
        this.droppedWeapons.splice(i, 1);
      }
    }

    // 4. Gold Coins physics & magnetic collection
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.life += dt;

      // Magnetic pull toward player if within 180px
      const dx = playerPos.x - coin.x;
      const dy = (playerPos.y - 45) - coin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 190) {
        const pullSpeed = 460;
        coin.vx += (dx / dist) * pullSpeed * dt * 4;
        coin.vy += (dy / dist) * pullSpeed * dt * 4;
      } else {
        coin.vy += GRAVITY * dt;
      }

      coin.x += coin.vx * dt;
      coin.y += coin.vy * dt;
      coin.rot += coin.vRot * dt;

      if (coin.y >= 0) {
        coin.y = 0;
        coin.vy = -coin.vy * 0.4;
        coin.vx *= 0.75;
      }

      // Pickup radius
      if (dist < 42) {
        SoundFX.playCoinPickup();
        if (player.coins !== undefined) {
          player.coins += coin.value;
        }
        if (onPickupCoin) onPickupCoin(coin.value);
        this.coins.splice(i, 1);
      }
    }

    // 5. Thrown Projectiles update
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Screen boundary check
      if (p.life > 1.4 || Math.abs(p.x) > 850) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  public checkHitboxAgainstDestructibles(hitbox: Hitbox): boolean {
    let hitAny = false;
    for (const obj of this.destructibles) {
      if (obj.isBroken) continue;
      // Object bounding box: [x - width/2, x + width/2] and [y - height, y]
      const minX = obj.x - obj.width / 2;
      const maxX = obj.x + obj.width / 2;
      const minY = obj.y - obj.height;
      const maxY = obj.y;

      const closestX = Math.max(minX, Math.min(hitbox.x, maxX));
      const closestY = Math.max(minY, Math.min(hitbox.y, maxY));
      const distSq = (hitbox.x - closestX) ** 2 + (hitbox.y - closestY) ** 2;

      if (distSq <= hitbox.radius ** 2) {
        hitAny = true;
        obj.health -= hitbox.damage;
        if (obj.health <= 0) {
          this.shatterObject(obj, hitbox.knockbackX, hitbox.knockbackY);
        }
      }
    }
    return hitAny;
  }

  public checkProjectilesAgainstEnemies(
    enemies: EnemyController[],
    onHit: (enemy: EnemyController, damage: number, px: number, py: number) => void
  ) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      for (const enemy of enemies) {
        if (enemy.health <= 0) continue;
        const ex = enemy.position.x;
        const ey = enemy.position.y - 50; // Torso
        const dist = Math.hypot(p.x - ex, p.y - ey);
        if (dist < 40) {
          onHit(enemy, p.damage, p.x, p.y);
          this.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }
}
