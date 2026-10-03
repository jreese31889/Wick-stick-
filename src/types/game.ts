export interface Vector2 {
  x: number;
  y: number;
}

export type AnimationState = 
  | 'IDLE'
  | 'WALK'
  | 'RUN'
  | 'JUMP_ASCENT'
  | 'FALL'
  | 'LAND'
  | 'SLIDE'
  | 'DODGE_ROLL'
  | 'BLOCK'
  | 'ATTACK_LIGHT_1'
  | 'ATTACK_LIGHT_2'
  | 'ATTACK_LIGHT_3'
  | 'ATTACK_HEAVY'
  | 'ATTACK_KICK'
  | 'ATTACK_SWEEP'
  | 'ATTACK_FLYING_KICK'
  | 'ATTACK_GUN_SHOT'
  | 'ATTACK_SPECIAL'
  | 'ATTACK_SUPER'
  | 'HURT'
  | 'KNOCKBACK';

export interface RigJoint {
  x: number;
  y: number;
}

export interface StickFigurePose {
  head: RigJoint;
  neck: RigJoint;
  torso: RigJoint;
  hips: RigJoint;
  // Left arm
  leftShoulder: RigJoint;
  leftElbow: RigJoint;
  leftHand: RigJoint;
  // Right arm
  rightShoulder: RigJoint;
  rightElbow: RigJoint;
  rightHand: RigJoint;
  // Left leg
  leftHip: RigJoint;
  leftKnee: RigJoint;
  leftFoot: RigJoint;
  // Right leg
  rightHip: RigJoint;
  rightKnee: RigJoint;
  rightFoot: RigJoint;
  // Dynamic cloth/tie nodes
  tieBase: RigJoint;
  tieMid: RigJoint;
  tieTip: RigJoint;
  // Jacket tail nodes for motion
  coatTailLeft: RigJoint;
  coatTailRight: RigJoint;
}

export interface InputState {
  moveX: number; // -1 to 1
  moveY: number; // -1 to 1
  aimX: number;  // -1 to 1 (Right Stick / Touch Aim)
  aimY: number;  // -1 to 1
  aimActive: boolean;
  jump: boolean;
  jumpJustPressed: boolean;
  dodge: boolean;
  dodgeJustPressed: boolean;
  attack: boolean;
  attackJustPressed: boolean;
  heavyAttack: boolean;
  heavyAttackJustPressed: boolean;
  block: boolean;
  grab: boolean;
  grabJustPressed: boolean;
  shoot: boolean;
  shootJustPressed: boolean;
  reload: boolean;
  reloadJustPressed: boolean;
  interact: boolean;
  interactJustPressed: boolean;
  focus: boolean;
  focusJustPressed: boolean;
  /** Combo-meter special / super move (keyboard chord, PUNCH+KICK chord, pad chord) */
  special: boolean;
  specialJustPressed: boolean;
  /** Cycle the owned firearms (keyboard X / pad L3 / touch SWAP). */
  swap: boolean;
  swapJustPressed: boolean;
}

export interface PlayerPhysics {
  position: Vector2;
  velocity: Vector2;
  grounded: boolean;
  facingRight: boolean;
  isSliding: boolean;
  isDodging: boolean;
  isBlocking: boolean;
  isWallSliding?: boolean;
  aimAngle?: number | null;
  state: AnimationState;
  stateTimer: number;
  moveSpeed: number;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  ammo: number;
  maxAmmo: number;
  /** Rounds in reserve for the current firearm (Phase 1 arsenal). */
  reserveAmmo: number;
  isReloading: boolean;
  reloadTimer: number;
  /** Set by EnvironmentManager when a firearm is walked over; consumed by GameLoop. */
  pendingGunPickup?: WeaponType | null;
  /** Set by EnvironmentManager on an ammo-pack pickup; consumed by GameLoop. */
  pendingAmmo?: number;
  equippedWeapon: WeaponType;
  weaponDurability: number;
  coins: number;
  perks: Partial<Record<PerkId, boolean>>;
  focus: number;
  maxFocus: number;
  isFocusActive: boolean;
  focusTimer: number;
}

export interface BloodDecal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  life: number;
  maxLife: number;
  isStuck: boolean;
}

export interface BladeSlashArc {
  id: number;
  x: number;
  y: number;
  angle: number;
  radius: number;
  arcLength: number;
  color: string;
  life: number;
  maxLife: number;
}

export type EnemyType =
  | 'BASIC'
  | 'RUSHER'
  | 'HEAVY'
  | 'DEFENDER'
  | 'ELITE'
  | 'GUNNER'
  | 'BOSS'
  | 'MARQUIS'
  | 'BERSERKER'
  | 'ACROBAT'
  | 'SNIPER';

export type EnemyActionState =
  | 'IDLE'
  | 'APPROACH'
  | 'WINDUP'
  | 'ATTACK'
  | 'RECOVERY'
  | 'BLOCK'
  | 'DODGE'
  | 'COUNTER'
  | 'HURT'
  | 'STAGGER'
  | 'KNOCKBACK'
  | 'DOWNED'
  | 'GETUP'
  | 'GRAPPLED';

export interface Hitbox {
  x: number;
  y: number;
  radius: number;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  hitStopFrames: number;
}

export interface DamagePopup {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  vy: number;
}

export interface ImpactSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  lineWidth: number;
}

export interface BulletTracer {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

export interface CasingParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  life: number;
}

/** Melee + thrown kit plus the Phase 1 firearm roster (see engine/Weapons.ts). */
export type WeaponType = 'UNARMED' | 'KATANA' | 'KNIFE' | 'PISTOL' | 'SMG' | 'SHOTGUN' | 'RIFLE';

export interface DroppedWeapon {
  id: number;
  type: WeaponType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  durability: number;
  grounded: boolean;
}

export interface ThrownProjectile {
  id: number;
  type: 'KNIFE' | 'KATANA';
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  life: number;
  damage: number;
}

export interface GlassShard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vRot: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface DestructibleObject {
  id: number;
  /**
   * GLASS_DISPLAY / CHAMPAGNE_TABLE / WEAPON_RACK ship with the rooms.
   * Phase 1 adds CRATE and EXPLOSIVE_BARREL (solid for enemies, walk-through
   * for the player) and GLASS_PANEL (a breakable, non-solid window).
   */
  type: 'GLASS_DISPLAY' | 'CHAMPAGNE_TABLE' | 'WEAPON_RACK' | 'CRATE' | 'EXPLOSIVE_BARREL' | 'GLASS_PANEL';
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  maxHealth: number;
  isBroken: boolean;
  droppedWeapon?: WeaponType;
  /** Seconds an enemy has been nose-to-prop this frame streak (cover breaking). */
  blockedTimer?: number;
}

export interface GoldCoin {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  life: number;
  value: number;
}

export interface HealthPack {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  life: number;
  healAmount: number;
}

/** Field ammo pouch — refills reserve rounds for the held firearm (Phase 1). */
export interface AmmoPack {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vRot: number;
  life: number;
  amount: number;
}

export interface EnemyBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  damage: number;
  /** Sniper rounds ignore the player's guard — dodge is the only answer */
  pierceBlock?: boolean;
}

export type RoomTheme = 'CONTINENTAL_LOUNGE' | 'NEON_GALLERY' | 'RAINY_ALLEY' | 'PENTHOUSE_SUITE';

export type PerkId =
  | 'KEVLAR_WEAVE'
  | 'ADRENALINE_INFUSION'
  | 'EXTENDED_MAG'
  | 'LETHAL_BLADE'
  | 'VAMPIRIC_TAKEDOWN'
  | 'BULLET_DEFLECT'
  | 'SOVEREIGN_MAGNUM';

export interface PerkDef {
  id: PerkId;
  name: string;
  cost: number;
  description: string;
  icon: string;
}

// ============================================================
// COMBAT DEPTH (workstream 2): player specials, reinforcements, hazards
// ============================================================

/** Combo-meter finishers. Costs are declared on PlayerController. */
export type SpecialMoveId = 'SPIN_SLASH' | 'EXECUTIONER';

