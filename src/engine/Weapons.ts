import { WeaponType } from '../types/game';

/**
 * Phase 1 firearm roster — the single place gun tuning lives.
 *
 * The PISTOL row is the shipped baseline (7-round mag, 28 dmg, whip/crit in
 * CombatDirector) and must not drift: the other three are tuned *around* it.
 * Nothing outside this table hard-codes a magazine size, damage number or
 * reload duration.
 */
export type GunId = 'PISTOL' | 'SMG' | 'SHOTGUN' | 'RIFLE';

export interface GunStats {
  id: GunId;
  /** HUD label. */
  name: string;
  /** Rounds per magazine (EXTENDED_MAG raises the pistol's copy in PlayerController). */
  magSize: number;
  /** Reserve cap carried for this gun. */
  reserveMax: number;
  /** Per-pellet damage before the combo multiplier. */
  damage: number;
  /** Pellets per trigger pull (shotgun fires a spread, everything else one round). */
  pellets: number;
  /** Seconds between shots — 0 keeps the shipped pistol's instant semi behaviour. */
  fireInterval: number;
  /** Half-angle of the pellet cone, radians. 0 = laser-straight. */
  spread: number;
  /** Distance where damage falloff begins. */
  falloffStart: number;
  /** Reload seconds with an empty magazine (auto-reload on empty). */
  reloadEmpty: number;
  /** Reload seconds when rounds remain (tactical — the chambered round is kept). */
  reloadTactical: number;
  /** Kick applied along −facing when the shot commits. */
  recoil: number;
  /** Hit-stop frames on a landed hit. */
  hitStop: number;
  /** Camera trauma on a landed hit. */
  trauma: number;
  /** True = holding SHOOT keeps firing (SMG). */
  auto: boolean;
  tracerLife: number;
  tracerWidth: number;
}

export const GUNS: Record<GunId, GunStats> = {
  PISTOL: {
    id: 'PISTOL',
    name: 'PISTOL',
    magSize: 7,
    reserveMax: 42,
    damage: 28,
    pellets: 1,
    fireInterval: 0,
    spread: 0,
    falloffStart: 9999,
    reloadEmpty: 0.95, // shipped timer — do not regress
    reloadTactical: 0.7,
    recoil: 110, // shipped knockback
    hitStop: 6,
    trauma: 0.28,
    auto: false,
    tracerLife: 0.12,
    tracerWidth: 3.5,
  },
  SMG: {
    id: 'SMG',
    name: 'SMG',
    magSize: 30,
    reserveMax: 150,
    damage: 11,
    pellets: 1,
    fireInterval: 0.09,
    spread: 0.05,
    falloffStart: 620,
    reloadEmpty: 1.35,
    reloadTactical: 1.05,
    recoil: 70,
    hitStop: 3,
    trauma: 0.1,
    auto: true,
    tracerLife: 0.09,
    tracerWidth: 2.5,
  },
  SHOTGUN: {
    id: 'SHOTGUN',
    name: 'SHOTGUN',
    magSize: 6,
    reserveMax: 30,
    damage: 11,
    pellets: 8,
    fireInterval: 0.75,
    spread: 0.16,
    falloffStart: 340,
    reloadEmpty: 2.0,
    reloadTactical: 1.5,
    recoil: 320,
    hitStop: 11,
    trauma: 0.45,
    auto: false,
    tracerLife: 0.1,
    tracerWidth: 3,
  },
  RIFLE: {
    id: 'RIFLE',
    name: 'RIFLE',
    magSize: 24,
    reserveMax: 120,
    damage: 34,
    pellets: 1,
    fireInterval: 0.28,
    spread: 0.02,
    falloffStart: 1100,
    reloadEmpty: 1.6,
    reloadTactical: 1.2,
    recoil: 180,
    hitStop: 9,
    trauma: 0.34,
    auto: false,
    tracerLife: 0.14,
    tracerWidth: 4,
  },
};

/** Cycle order for the SWAP control (owned guns only are visited). */
export const GUN_ORDER: GunId[] = ['PISTOL', 'SMG', 'SHOTGUN', 'RIFLE'];

/** True for anything the arsenal module owns (excludes melee/throwables). */
export function isGun(weapon: WeaponType): weapon is GunId {
  return weapon === 'PISTOL' || weapon === 'SMG' || weapon === 'SHOTGUN' || weapon === 'RIFLE';
}

/**
 * Distance falloff: full damage to `falloffStart`, decaying to 60 % at
 * 1.8× that range. Guns with no falloff (pistol) pass an effectively
 * infinite start and never take the branch.
 */
export function falloffMultiplier(stats: GunStats, distance: number): number {
  if (distance <= stats.falloffStart) return 1;
  const span = stats.falloffStart * 0.8;
  const t = Math.min(1, (distance - stats.falloffStart) / span);
  return 1 - t * 0.4;
}
