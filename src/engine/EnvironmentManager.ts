import {
  AmmoPack,
  DestructibleObject,
  DroppedWeapon,
  GlassShard,
  GoldCoin,
  HealthPack,
  Hitbox,
  RoomTheme,
  ThrownProjectile,
  Vector2,
  WeaponType
} from '../types/game';
import { SoundFX } from './SoundFX';
import { EnemyController } from './EnemyController';
import { ObjectPool } from './ObjectPool';

export interface RoomConfig {
  theme: RoomTheme;
  title: string;
  subtitle: string;
  ambienceColor: string;
  floorColor: string;
  accentColor: string;
  hasRain: boolean;
  /** Optional AI key-art backdrop (path relative to Vite base), drawn with parallax behind the procedural set */
  backdropImage?: string;
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
    backdropImage: 'assets/ai/level-dojo.jpg',
  },
  NEON_GALLERY: {
    theme: 'NEON_GALLERY',
    title: 'GLASS PAVILION',
    subtitle: 'Exhibition of Shadows',
    ambienceColor: '#050a14',
    floorColor: '#0a1124',
    accentColor: '#06b6d4',
    hasRain: false,
    backdropImage: 'assets/ai/level-nightclub.jpg',
  },
  RAINY_ALLEY: {
    theme: 'RAINY_ALLEY',
    title: 'RAINIER ALLEYWAY',
    subtitle: 'Midnight Industrial Corridor',
    ambienceColor: '#05070a',
    floorColor: '#0f172a',
    accentColor: '#38bdf8',
    hasRain: true,
    backdropImage: 'assets/ai/level-rooftop.jpg',
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
  public healthPacks: HealthPack[] = [];
  /** Field ammo pouches feeding the Phase-1 reserve (D5). */
  public ammoPacks: AmmoPack[] = [];
  /**
   * Explosive-barrel detonations waiting to be resolved (D3). The environment
   * only owns props; CombatDirector drains this queue each frame because it
   * is the one system holding the player, the squad and the camera.
   */
  public pendingExplosions: { x: number; y: number }[] = [];
  public doorOpen: boolean = false;
  public doorX: number = 740;
  public doorWidth: number = 70;
  public doorHeight: number = 130;
  public roomBannerTimer: number = 0;
  public transitionAlpha: number = 0;

  /**
   * M14 hard caps for the high-churn props. All sit far above what a real
   * fight produces, so normal play never notices them; they only stop a
   * pathological burst from growing the arrays without bound.
   */
  public static readonly MAX_GLASS_SHARDS = 160;
  public static readonly MAX_COINS = 192;
  public static readonly MAX_KNIVES = 32;
  /** P3-03: loot caps — bounded worst case in loot-heavy runs. */
  public static readonly MAX_HEALTH_PACKS = 8;
  public static readonly MAX_DROPPED_WEAPONS = 12;
  public static readonly MAX_AMMO_PACKS = 8;
  /** Queued barrel detonations (rare — a room holds 1-3 barrels). */
  public static readonly MAX_PENDING_EXPLOSIONS = 8;

  // M14: free lists so shattered glass, coins and thrown knives are recycled
  // instead of allocated fresh on every spawn (GC churn on mid-range Android).
  private shardPool = new ObjectPool<GlassShard>(
    () => ({
      x: 0, y: 0, vx: 0, vy: 0, size: 1, rot: 0, vRot: 0,
      life: 0, maxLife: 1, color: '#ffffff',
    }),
    EnvironmentManager.MAX_GLASS_SHARDS + 64
  );
  private coinPool = new ObjectPool<GoldCoin>(
    () => ({ id: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0, life: 0, value: 1 }),
    EnvironmentManager.MAX_COINS + 32
  );
  private knifePool = new ObjectPool<ThrownProjectile>(
    () => ({ id: 0, type: 'KNIFE', x: 0, y: 0, vx: 0, vy: 0, rot: 0, life: 0, damage: 0 }),
    EnvironmentManager.MAX_KNIVES + 8
  );
  // P3-03: loot pools — med kits and dropped blades recycle like the rest
  private healthPackPool = new ObjectPool<HealthPack>(
    () => ({ id: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0, life: 0, healAmount: 35 }),
    EnvironmentManager.MAX_HEALTH_PACKS + 8
  );
  private weaponPool = new ObjectPool<DroppedWeapon>(
    () => ({
      id: 0, type: 'KNIFE', x: 0, y: 0, vx: 0, vy: 0,
      rot: 0, vRot: 0, durability: 0, grounded: false,
    }),
    EnvironmentManager.MAX_DROPPED_WEAPONS + 8
  );
  private ammoPackPool = new ObjectPool<AmmoPack>(
    () => ({ id: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0, life: 0, amount: 12 }),
    EnvironmentManager.MAX_AMMO_PACKS + 8
  );
  private explosionPool = new ObjectPool<{ x: number; y: number }>(
    () => ({ x: 0, y: 0 }),
    EnvironmentManager.MAX_PENDING_EXPLOSIONS + 4
  );

  constructor() {
    this.initRoom(0);
  }

  public get config(): RoomConfig {
    return ROOM_CONFIGS[this.currentTheme] || ROOM_CONFIGS.CONTINENTAL_LOUNGE;
  }

  /** Recycles the oldest `count` entries of a capped array back to its pool. */
  private trimOldest<T>(arr: T[], count: number, pool: ObjectPool<T>): void {
    const n = Math.max(0, Math.min(count, arr.length));
    for (let i = 0; i < n; i++) {
      const old = arr.shift();
      if (old === undefined) break;
      pool.release(old);
    }
  }

  public initRoom(roomIndex: number) {
    this.currentRoomIndex = roomIndex;
    const themes: RoomTheme[] = ['CONTINENTAL_LOUNGE', 'NEON_GALLERY', 'RAINY_ALLEY', 'PENTHOUSE_SUITE'];
    this.currentTheme = themes[roomIndex % themes.length];
    this.doorOpen = false;
    this.roomBannerTimer = 3.5;
    this.transitionAlpha = 1.0;

    // Clear transient projectiles and shards (shells go back to their pools)
    this.knifePool.releaseAll(this.projectiles);
    this.projectiles = [];
    this.shardPool.releaseAll(this.glassShards);
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
        },
        // Phase 1: breakable crate cache + a barrel that chains explosions
        {
          id: 4,
          type: 'CRATE',
          x: 140,
          y: 0,
          width: 48,
          height: 48,
          health: 26,
          maxHealth: 26,
          isBroken: false,
          droppedWeapon: 'SMG',
        },
        {
          id: 5,
          type: 'EXPLOSIVE_BARREL',
          x: -140,
          y: 0,
          width: 34,
          height: 58,
          health: 20,
          maxHealth: 20,
          isBroken: false,
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
        },
        {
          id: 3,
          type: 'WEAPON_RACK',
          x: -60,
          y: 0,
          width: 46,
          height: 88,
          health: 32,
          maxHealth: 32,
          isBroken: false,
          droppedWeapon: 'SHOTGUN',
        },
        {
          id: 4,
          type: 'EXPLOSIVE_BARREL',
          x: 200,
          y: 0,
          width: 34,
          height: 58,
          health: 20,
          maxHealth: 20,
          isBroken: false,
        },
        {
          id: 5,
          type: 'GLASS_PANEL',
          x: -460,
          y: 0,
          width: 70,
          height: 150,
          health: 16,
          maxHealth: 16,
          isBroken: false,
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
        },
        {
          id: 3,
          type: 'CRATE',
          x: 60,
          y: 0,
          width: 48,
          height: 48,
          health: 26,
          maxHealth: 26,
          isBroken: false,
          droppedWeapon: 'RIFLE',
        },
        {
          id: 4,
          type: 'EXPLOSIVE_BARREL',
          x: -180,
          y: 0,
          width: 34,
          height: 58,
          health: 20,
          maxHealth: 20,
          isBroken: false,
        },
        {
          id: 5,
          type: 'EXPLOSIVE_BARREL',
          x: 470,
          y: 0,
          width: 34,
          height: 58,
          health: 20,
          maxHealth: 20,
          isBroken: false,
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
        },
        {
          id: 3,
          type: 'EXPLOSIVE_BARREL',
          x: -480,
          y: 0,
          width: 34,
          height: 58,
          health: 20,
          maxHealth: 20,
          isBroken: false,
        },
        {
          id: 4,
          type: 'EXPLOSIVE_BARREL',
          x: 160,
          y: 0,
          width: 34,
          height: 58,
          health: 20,
          maxHealth: 20,
          isBroken: false,
        },
        {
          id: 5,
          type: 'CRATE',
          x: 620,
          y: 0,
          width: 48,
          height: 48,
          health: 26,
          maxHealth: 26,
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
    this.coinPool.releaseAll(this.coins);
    this.coins = [];
    this.weaponPool.releaseAll(this.droppedWeapons);
    this.droppedWeapons = [];
    this.knifePool.releaseAll(this.projectiles);
    this.projectiles = [];
    this.shardPool.releaseAll(this.glassShards);
    this.glassShards = [];
    this.healthPackPool.releaseAll(this.healthPacks);
    this.healthPacks = [];
    this.ammoPackPool.releaseAll(this.ammoPacks);
    this.ammoPacks = [];
    this.explosionPool.releaseAll(this.pendingExplosions);
    this.pendingExplosions = [];
  }

  public shatterObject(obj: DestructibleObject, impactForceX: number = 0, impactForceY: number = -120) {
    if (obj.isBroken) return;
    obj.isBroken = true;

    // Explosive barrel: the blast is resolved by CombatDirector (only that
    // system holds the player, the squad and the camera).
    if (obj.type === 'EXPLOSIVE_BARREL') {
      this.queueExplosion(obj.x, obj.y - obj.height * 0.5);
      this.dropCoin(obj.x, obj.y - 26, 1);
      return;
    }

    const isCrate = obj.type === 'CRATE';
    if (isCrate) SoundFX.playPunch('slam');
    else SoundFX.playGlassShatter();

    // Shard palette by surface (wood splinters for crates, glass otherwise)
    const colors = isCrate
      ? ['#a16207', '#78350f', '#d97706', '#e7d7b0']
      : this.currentTheme === 'NEON_GALLERY'
        ? ['#a5f3fc', '#38bdf8', '#c084fc', '#ffffff']
        : ['#fef08a', '#fde047', '#ffffff', '#e2e8f0'];

    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 320;
      this.trimOldest(
        this.glassShards,
        this.glassShards.length + 1 - EnvironmentManager.MAX_GLASS_SHARDS,
        this.shardPool
      );
      const shard = this.shardPool.acquire();
      shard.x = obj.x + (Math.random() - 0.5) * obj.width;
      shard.y = obj.y - Math.random() * obj.height;
      shard.vx = Math.cos(angle) * speed + impactForceX * 0.4;
      shard.vy = Math.sin(angle) * speed + impactForceY * 0.6;
      shard.size = 3 + Math.random() * 7;
      shard.rot = Math.random() * Math.PI * 2;
      shard.vRot = (Math.random() - 0.5) * 14;
      shard.life = 0;
      shard.maxLife = 2.2 + Math.random() * 1.5;
      shard.color = colors[Math.floor(Math.random() * colors.length)];
      this.glassShards.push(shard);
    }

    // Drop contained weapon if present
    if (obj.droppedWeapon) {
      this.dropWeapon(obj.droppedWeapon, obj.x, obj.y - 30, (Math.random() - 0.5) * 80, -180);
    }

    // Caches pay out in field ammo; every prop still scatters Continental gold
    if (isCrate) {
      this.dropAmmoPack(obj.x, obj.y - 46, 18);
    }
    this.dropCoin(obj.x, obj.y - 40, 1);
    if (Math.random() > 0.4) {
      this.dropCoin(obj.x + (Math.random() - 0.5) * 30, obj.y - 50, 1);
    }
  }

  /** Queues a barrel detonation for CombatDirector to resolve. */
  public queueExplosion(x: number, y: number): void {
    this.trimOldest(
      this.pendingExplosions,
      this.pendingExplosions.length + 1 - EnvironmentManager.MAX_PENDING_EXPLOSIONS,
      this.explosionPool
    );
    const e = this.explosionPool.acquire();
    e.x = x;
    e.y = y;
    this.pendingExplosions.push(e);
  }

  /** Pops the oldest queued detonation back into its pool (CombatDirector). */
  public releaseExplosion(): void {
    const e = this.pendingExplosions.pop();
    if (e) this.explosionPool.release(e);
  }

  /**
   * Bullet / blast damage against a live prop (Phase 1 D2/D3).
   * Returns true when the round actually connected with something.
   */
  public damageObject(obj: DestructibleObject, damage: number, forceX: number = 0, forceY: number = -80): boolean {
    if (obj.isBroken || damage <= 0) return false;
    obj.health -= damage;
    if (obj.health <= 0) {
      this.shatterObject(obj, forceX, forceY);
    }
    return true;
  }

  public dropWeapon(type: WeaponType, x: number, y: number, vx: number = 0, vy: number = -160) {
    // P3-03: capped + recycled instead of an unbounded literal push
    this.trimOldest(
      this.droppedWeapons,
      this.droppedWeapons.length + 1 - EnvironmentManager.MAX_DROPPED_WEAPONS,
      this.weaponPool
    );
    const w = this.weaponPool.acquire();
    w.id = Date.now() + Math.random();
    w.type = type;
    w.x = x;
    w.y = y;
    w.vx = vx;
    w.vy = vy;
    w.rot = Math.random() * Math.PI;
    w.vRot = (Math.random() - 0.5) * 10;
    w.durability = type === 'KATANA' ? 14 : 5;
    w.grounded = false;
    this.droppedWeapons.push(w);
  }

  public dropCoin(x: number, y: number, value: number = 1) {
    this.trimOldest(this.coins, this.coins.length + 1 - EnvironmentManager.MAX_COINS, this.coinPool);
    const coin = this.coinPool.acquire();
    coin.id = Date.now() + Math.random();
    coin.x = x;
    coin.y = y;
    coin.vx = (Math.random() - 0.5) * 160;
    coin.vy = -220 - Math.random() * 120;
    coin.rot = Math.random() * Math.PI * 2;
    coin.vRot = (Math.random() - 0.5) * 12;
    coin.life = 0;
    coin.value = value;
    this.coins.push(coin);
  }

  public dropHealthPack(x: number, y: number, healAmount: number = 35) {
    // P3-03: capped + recycled instead of an unbounded literal push
    this.trimOldest(
      this.healthPacks,
      this.healthPacks.length + 1 - EnvironmentManager.MAX_HEALTH_PACKS,
      this.healthPackPool
    );
    const pack = this.healthPackPool.acquire();
    pack.id = Date.now() + Math.random();
    pack.x = x;
    pack.y = y - 30;
    pack.vx = (Math.random() - 0.5) * 140;
    pack.vy = -200 - Math.random() * 100;
    pack.rot = 0;
    pack.vRot = (Math.random() - 0.5) * 6;
    pack.life = 0;
    pack.healAmount = healAmount;
    this.healthPacks.push(pack);
  }

  /** Field ammo pouch — feeds the held firearm's reserve (Phase 1 D5). */
  public dropAmmoPack(x: number, y: number, amount: number = 14) {
    this.trimOldest(
      this.ammoPacks,
      this.ammoPacks.length + 1 - EnvironmentManager.MAX_AMMO_PACKS,
      this.ammoPackPool
    );
    const pack = this.ammoPackPool.acquire();
    pack.id = Date.now() + Math.random();
    pack.x = x;
    pack.y = y - 24;
    pack.vx = (Math.random() - 0.5) * 130;
    pack.vy = -190 - Math.random() * 90;
    pack.rot = 0;
    pack.vRot = (Math.random() - 0.5) * 6;
    pack.life = 0;
    pack.amount = amount;
    this.ammoPacks.push(pack);
  }

  public throwKnife(x: number, y: number, dir: number) {
    SoundFX.playKnifeThrow();
    this.trimOldest(
      this.projectiles,
      this.projectiles.length + 1 - EnvironmentManager.MAX_KNIVES,
      this.knifePool
    );
    const knife = this.knifePool.acquire();
    knife.id = Date.now() + Math.random();
    knife.type = 'KNIFE';
    knife.x = x;
    knife.y = y - 55;
    knife.vx = dir * 980;
    knife.vy = -25;
    knife.rot = dir > 0 ? 0 : Math.PI;
    knife.life = 0;
    knife.damage = 48;
    this.projectiles.push(knife);
  }

  public update(
    dt: number,
    player: {
      position: Vector2;
      coins?: number;
      equippedWeapon?: WeaponType;
      weaponDurability?: number;
      perks?: Record<string, boolean>;
      health?: number;
      maxHealth?: number;
      pendingGunPickup?: WeaponType | null;
      pendingAmmo?: number;
    },
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

    // 1. Glass Shards physics
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
        this.shardPool.release(shard);
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
        const isFirearm =
          w.type === 'PISTOL' || w.type === 'SMG' || w.type === 'SHOTGUN' || w.type === 'RIFLE';
        if (isFirearm) {
          // Phase 1 arsenal: hand the gun to GameLoop, which loads the inventory
          if (player.pendingGunPickup !== undefined) player.pendingGunPickup = w.type;
          SoundFX.playGunCock();
        } else {
          if (player.equippedWeapon !== undefined) {
            player.equippedWeapon = w.type;
            const bonusDurability = player.perks?.['LETHAL_BLADE'] ? 6 : 0;
            player.weaponDurability = w.type === 'KATANA' ? 14 + bonusDurability : 4;
          }
          SoundFX.playBladeSlash();
        }
        if (onPickupWeapon) onPickupWeapon(w.type);
        this.droppedWeapons.splice(i, 1);
        this.weaponPool.release(w);
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
        this.coinPool.release(coin);
      }
    }

    // 5. Health Packs physics & pickup (Continental field medic kits)
    for (let i = this.healthPacks.length - 1; i >= 0; i--) {
      const pack = this.healthPacks[i];
      pack.life += dt;
      pack.vy += GRAVITY * dt;
      pack.x += pack.vx * dt;
      pack.y += pack.vy * dt;
      pack.rot += pack.vRot * dt;

      if (pack.y >= 0) {
        pack.y = 0;
        pack.vy = -pack.vy * 0.4;
        pack.vx *= 0.75;
        pack.vRot *= 0.6;
      }

      // Despawn after 25s so the arena doesn't fill up
      if (pack.life > 25) {
        this.healthPacks.splice(i, 1);
        this.healthPackPool.release(pack);
        continue;
      }

      // Pickup radius — only consumed when the player is actually hurt
      const pdx = playerPos.x - pack.x;
      const pdy = (playerPos.y - 45) - pack.y;
      const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (
        pdist < 48 &&
        player.health !== undefined &&
        player.maxHealth !== undefined &&
        player.health < player.maxHealth
      ) {
        player.health = Math.min(player.maxHealth, player.health + pack.healAmount);
        SoundFX.playHeal();
        this.healthPacks.splice(i, 1);
        this.healthPackPool.release(pack);
      }
    }

    // 5b. Ammo pouches (Phase 1 D5) — physics + always-on pickup
    for (let i = this.ammoPacks.length - 1; i >= 0; i--) {
      const pack = this.ammoPacks[i];
      pack.life += dt;
      pack.vy += GRAVITY * dt;
      pack.x += pack.vx * dt;
      pack.y += pack.vy * dt;
      pack.rot += pack.vRot * dt;

      if (pack.y >= 0) {
        pack.y = 0;
        pack.vy = -pack.vy * 0.4;
        pack.vx *= 0.75;
        pack.vRot *= 0.6;
      }

      // Despawn after 25s so the arena doesn't fill up
      if (pack.life > 25) {
        this.ammoPacks.splice(i, 1);
        this.ammoPackPool.release(pack);
        continue;
      }

      const pdx = playerPos.x - pack.x;
      const pdy = (playerPos.y - 45) - pack.y;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < 46) {
        if (player.pendingAmmo !== undefined) player.pendingAmmo = pack.amount;
        SoundFX.playGunCock();
        this.ammoPacks.splice(i, 1);
        this.ammoPackPool.release(pack);
      }
    }

    // 6. Thrown Projectiles update
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Screen boundary check
      if (p.life > 1.4 || Math.abs(p.x) > 850) {
        this.projectiles.splice(i, 1);
        this.knifePool.release(p);
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
          this.knifePool.release(p);
          break;
        }
      }
    }
  }
}
