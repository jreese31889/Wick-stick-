/**
 * PHASE 2 — progression rules.
 *
 * Pure functions over the persisted profile: XP / level maths, unlock
 * granting, achievement evaluation and the run-time stat block the engine
 * consumes. No DOM, no React, no persistence — ProfileStore owns storage,
 * App.tsx owns orchestration.
 */
import {
  ACHIEVEMENTS,
  UPGRADES,
  UNLOCKS,
  type AchievementDef,
  type UpgradeId,
} from './Catalogs';
import { PROFILE_VERSION, defaultProfile, type GameProfile } from './ProfileStore';

/* ------------------------------------------------------------------ */
/* XP / levels                                                         */
/* ------------------------------------------------------------------ */

/** XP needed to advance from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(100 * Math.pow(Math.max(1, level), 1.5));
}

/** XP payout table — applied by the events that trigger them. */
export const XP_VALUES = {
  KILL: 15,
  HEAVY_KILL: 30,
  BOSS_KILL: 200,
  EXECUTION: 40,
  WAVE_CLEAR: 100,
  STYLE_BONUS: { D: 0, C: 10, B: 20, A: 40, S: 70, SS: 100 } as Record<string, number>,
} as const;

/**
 * Adds `amount` XP to the profile and rolls over any level ups.
 * Returns how many levels were gained (0 = none).
 */
export function grantXp(profile: GameProfile, amount: number): number {
  const gain = Math.max(0, Math.round(amount));
  if (gain <= 0) return 0;
  profile.xp += gain;
  let levels = 0;
  // Hard cap keeps a pathological blob from looping forever.
  while (profile.xp >= xpToNext(profile.level) && profile.level < 999) {
    profile.xp -= xpToNext(profile.level);
    profile.level += 1;
    levels += 1;
  }
  return levels;
}

/* ------------------------------------------------------------------ */
/* Style ranks                                                         */
/* ------------------------------------------------------------------ */

export const STYLE_RANKS = ['D', 'C', 'B', 'A', 'S', 'SS'] as const;
export type StyleRankId = (typeof STYLE_RANKS)[number];

/** 0 = D … 5 = SS. Unknown ranks map to 0. */
export function styleRankIndex(rank: string): number {
  const idx = STYLE_RANKS.indexOf(rank as StyleRankId);
  return idx < 0 ? 0 : idx;
}

/* ------------------------------------------------------------------ */
/* Run stat block                                                      */
/* ------------------------------------------------------------------ */

export interface RunProfile {
  /** Global outgoing-damage multiplier (upgrade damage tiers). */
  damageMult: number;
  /** Added to the player's max health (upgrade health tiers). */
  healthBonus: number;
  /** Movement-speed multiplier (upgrade speed tiers). */
  speedMult: number;
  /** Reload duration multiplier (< 1 = faster; SWIFT_RELOAD). */
  reloadMult: number;
  /** Fraction of max Focus granted on wave clear / execution (0 at tier 0). */
  focusGainRatio: number;
  /** Bonus to max Focus (FOCUS_PIP). */
  focusMaxBonus: number;
  /** Bonus to starting Focus (FOCUS_PIP). */
  focusStartBonus: number;
  /** Start the run with a full reserve (FIELD_STOCK). */
  startFullReserve: boolean;
  /** Starting weapon/loadout id. */
  loadout: string;
}


/** Builds the stat block applied to the engine at run start. */
export function computeRunProfile(profile: GameProfile): RunProfile {
  const damageTier = profile.upgrades.damage ?? 0;
  const healthTier = profile.upgrades.health ?? 0;
  const speedTier = profile.upgrades.speed ?? 0;
  const focusTier = profile.upgrades.focus ?? 0;
  return {
    damageMult: 1 + 0.04 * damageTier,
    healthBonus: 10 * healthTier,
    speedMult: 1 + 0.03 * speedTier,
    reloadMult: profile.unlocks.includes('SWIFT_RELOAD') ? 0.85 : 1,
    // Tier 0 = shipped baseline (no passive refill); each tier grants
    // +15% of max Focus on wave clear / execution.
    focusGainRatio: 0.15 * focusTier,
    focusMaxBonus: profile.unlocks.includes('FOCUS_PIP') ? 35 : 0,
    focusStartBonus: profile.unlocks.includes('FOCUS_PIP') ? 35 : 0,
    startFullReserve: profile.unlocks.includes('FIELD_STOCK'),
    loadout: profile.selectedLoadout,
  };
}

/* ------------------------------------------------------------------ */
/* Unlocks                                                             */
/* ------------------------------------------------------------------ */

function unlockGranted(profile: GameProfile, unlockId: string): boolean {
  const def = UNLOCKS.find((u) => u.id === unlockId);
  if (!def) return false;
  if (def.level !== undefined && profile.level < def.level) return false;
  if (def.achievement !== undefined) {
    const state = profile.achievements[def.achievement];
    if (!state || !state.unlocked) return false;
  }
  return true;
}

/**
 * Grants every unlock the profile now qualifies for.
 * Returns the ids that were newly added (empty when nothing changed).
 */
export function refreshUnlocks(profile: GameProfile): string[] {
  const added: string[] = [];
  for (const def of UNLOCKS) {
    if (profile.unlocks.includes(def.id)) continue;
    if (!unlockGranted(profile, def.id)) continue;
    profile.unlocks.push(def.id);
    added.push(def.id);
  }
  return added;
}

export function isUnlocked(profile: GameProfile, unlockId: string): boolean {
  return profile.unlocks.includes(unlockId);
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

/** Reads the profile-wide counter an achievement is measured against. */
export function achievementProgress(profile: GameProfile, def: AchievementDef): number {
  switch (def.source) {
    case 'level':
      return profile.level;
    case 'styleRank':
      return profile.stats.bestStyleRank;
    case 'maxedUpgrades':
      return UPGRADES.some((u) => (profile.upgrades[u.id] ?? 0) >= u.maxTiers) ? 1 : 0;
    default:
      return profile.stats[def.source] ?? 0;
  }
}

/**
 * Evaluates every achievement against the profile.
 * Mutates `unlocked` / `progress` fields; returns the ids that just
 * flipped to unlocked (caller adds the rewards + toasts).
 */
export function evaluateAchievements(profile: GameProfile): string[] {
  const justUnlocked: string[] = [];
  for (const def of ACHIEVEMENTS) {
    const state = profile.achievements[def.id];
    if (!state) {
      profile.achievements[def.id] = { unlocked: false, progress: 0 };
      continue;
    }
    const progress = Math.min(def.goal, achievementProgress(profile, def));
    state.progress = Math.max(state.progress, progress);
    if (!state.unlocked && progress >= def.goal) {
      state.unlocked = true;
      state.progress = def.goal;
      justUnlocked.push(def.id);
    }
  }
  return justUnlocked;
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

/** Fills any missing fields on a loaded profile (forward-compat safety). */
export function ensureProfile(profile: GameProfile): GameProfile {
  if (profile.version === PROFILE_VERSION) return profile;
  const merged = { ...defaultProfile(), ...profile, version: PROFILE_VERSION };
  merged.upgrades = { ...defaultProfile().upgrades, ...profile.upgrades };
  merged.stats = { ...defaultProfile().stats, ...profile.stats };
  merged.achievements = { ...defaultProfile().achievements, ...profile.achievements };
  return merged;
}
