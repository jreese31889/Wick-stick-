/**
 * PHASE 2 — progression catalogs.
 *
 * Pure data: upgrades, unlockable loadouts / moves, cosmetics and
 * achievements. No React, no side effects, no engine imports — ProfileStore
 * owns persistence, Progression owns the rules that read these tables.
 * Cosmetics carry their colour payload as a Partial<...Palette> so
 * App.tsx can apply it straight into the live engine palettes.
 */
import type { PlayerPalette, WeaponTintPalette } from '../engine/Palettes';

/* ------------------------------------------------------------------ */
/* Upgrades                                                            */
/* ------------------------------------------------------------------ */

export type UpgradeId = 'damage' | 'health' | 'speed' | 'focus';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  blurb: string;
  /** Stat points granted per tier (shown to the player). */
  perTier: number;
  /** Human-readable stat name, e.g. 'DMG' / 'HP' */
  statLabel: string;
  maxTiers: number;
  /** Cost of tier 1; each next tier costs baseCost * growth^(tier). */
  baseCost: number;
  growth: number;
  /** Short per-tier effect summary for the card. */
  effectText: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'damage',
    name: 'HITMAN',
    blurb: 'Every shot and swing lands harder.',
    perTier: 4,
    statLabel: 'DMG',
    maxTiers: 5,
    baseCost: 40,
    growth: 1.6,
    effectText: '+4% damage per tier',
  },
  {
    id: 'health',
    name: 'ENDURANCE',
    blurb: 'Take an extra hit before going down.',
    perTier: 10,
    statLabel: 'HP',
    maxTiers: 5,
    baseCost: 40,
    growth: 1.6,
    effectText: '+10 max health per tier',
  },
  {
    id: 'speed',
    name: 'FOOTWORK',
    blurb: 'Close the gap, slip the shots.',
    perTier: 3,
    statLabel: 'SPD',
    maxTiers: 3,
    baseCost: 45,
    growth: 1.7,
    effectText: '+3% move speed per tier',
  },
  {
    id: 'focus',
    name: 'CONTINENTAL TRAINING',
    blurb: 'Rebuild Focus from takedowns and wave clears.',
    perTier: 15,
    statLabel: 'FOC',
    maxTiers: 3,
    baseCost: 50,
    growth: 1.7,
    effectText: '+15% max Focus per grant',
  },
];

export const UPGRADE_MAP: Record<UpgradeId, UpgradeDef> = UPGRADES.reduce(
  (acc, def) => {
    acc[def.id] = def;
    return acc;
  },
  {} as Record<UpgradeId, UpgradeDef>
);

/** Cost of upgrading `id` from `currentTier` to `currentTier + 1` (0 if maxed). */
export function upgradeCost(id: UpgradeId, currentTier: number): number {
  const def = UPGRADE_MAP[id];
  if (!def || currentTier >= def.maxTiers) return 0;
  return Math.round(def.baseCost * Math.pow(def.growth, currentTier));
}

/* ------------------------------------------------------------------ */
/* Unlocks: loadouts, moves, cosmetics                                 */
/* ------------------------------------------------------------------ */

export type UnlockKind = 'loadout' | 'move' | 'skin' | 'tint';

export interface UnlockDef {
  id: string;
  kind: UnlockKind;
  name: string;
  description: string;
  /** Level required (absent = never level-gated). */
  level?: number;
  /** Achievement id that must be unlocked first. */
  achievement?: string;
}

export const UNLOCKS: UnlockDef[] = [
  /* -- weapon loadouts -- */
  { id: 'FISTS', kind: 'loadout', name: 'FISTS', description: 'Brass knuckles. Always ready.' },
  { id: 'SMG', kind: 'loadout', name: 'SMG', description: 'Built-in submachine gun from level 2.', level: 2 },
  { id: 'KATANA', kind: 'loadout', name: 'KATANA', description: 'Razor edge from level 3.', level: 3 },
  { id: 'SHOTGUN', kind: 'loadout', name: 'SHOTGUN', description: 'Room clearer from level 4.', level: 4 },
  { id: 'RIFLE', kind: 'loadout', name: 'RIFLE', description: 'Iron sight work from level 6.', level: 6 },
  /* -- passive moves -- */
  {
    id: 'SWIFT_RELOAD',
    kind: 'move',
    name: 'SWIFT RELOAD',
    description: 'Reloading is 15% faster.',
    level: 3,
  },
  {
    id: 'FIELD_STOCK',
    kind: 'move',
    name: 'FIELD STOCK',
    description: 'Start each run with a full reserve.',
    level: 4,
  },
  {
    id: 'FOCUS_PIP',
    kind: 'move',
    name: 'FOCUS PIP',
    description: '+35 max Focus, +35 starting Focus.',
    level: 5,
  },
  /* -- skins (figure colourway — tie stays signature red) -- */
  {
    id: 'skin_classic',
    kind: 'skin',
    name: 'CLASSIC',
    description: 'The original ivory figure.',
  },
  {
    id: 'skin_noir',
    kind: 'skin',
    name: 'NOIR',
    description: 'Ash grey figure, cold rim light.',
    level: 2,
  },
  {
    id: 'skin_golden',
    kind: 'skin',
    name: 'GOLDEN TICKET',
    description: 'Brass figure, warm rim light.',
    level: 3,
  },
  {
    id: 'skin_arctic',
    kind: 'skin',
    name: 'ARCTIC',
    description: 'Ice blue figure.',
    level: 5,
  },
  {
    id: 'skin_violet',
    kind: 'skin',
    name: 'VIOLET',
    description: 'Amethyst figure.',
    level: 8,
  },
  {
    id: 'skin_crimson',
    kind: 'skin',
    name: 'CRIMSON',
    description: 'Earned by killing 250 enemies.',
    achievement: 'reaper',
  },
  {
    id: 'skin_phantom',
    kind: 'skin',
    name: 'PHANTOM',
    description: 'Earned by a run with S style.',
    achievement: 'style_icon',
  },
  /* -- weapon tints -- */
  {
    id: 'tint_steel',
    kind: 'tint',
    name: 'STEEL',
    description: 'Factory edge. Classic grip.',
  },
  {
    id: 'tint_gold',
    kind: 'tint',
    name: 'GOLD',
    description: 'Gilded furniture from level 4.',
    level: 4,
  },
  {
    id: 'tint_chrome',
    kind: 'tint',
    name: 'CHROME',
    description: 'Mirror polish from level 6.',
    level: 6,
  },
  {
    id: 'tint_crimson',
    kind: 'tint',
    name: 'CRIMSON',
    description: 'Earned by disarming 5 guns.',
    achievement: 'disarmament',
  },
];

export const UNLOCK_MAP: Record<string, UnlockDef> = UNLOCKS.reduce(
  (acc, def) => {
    acc[def.id] = def;
    return acc;
  },
  {} as Record<string, UnlockDef>
);

export const LOADOUT_IDS = ['FISTS', 'SMG', 'KATANA', 'SHOTGUN', 'RIFLE'];
export const MOVE_IDS = ['SWIFT_RELOAD', 'FIELD_STOCK', 'FOCUS_PIP'];

/** Skin colour payloads — Partial so defaults always fill in. */
export const SKIN_PALETTES: Record<string, Partial<PlayerPalette>> = {
  skin_classic: {},
  skin_noir: {
    ivory: '#cfd4dc',
    ivoryBack: '#aab1bc',
    shoe: '#8d95a2',
    shirt: '#f2f4f8',
    shirtEdge: '#0b0d12',
    cuff: '#f2f4f8',
    glow: '207, 212, 220',
    detail: '#15181f',
  },
  skin_golden: {
    ivory: '#f6e3b0',
    ivoryBack: '#e0c98a',
    shoe: '#b8963f',
    shirt: '#fff8e6',
    shirtEdge: '#2a1f08',
    cuff: '#fff8e6',
    glow: '246, 227, 176',
    detail: '#2b2209',
  },
  skin_arctic: {
    ivory: '#e8f4ff',
    ivoryBack: '#c8ddf0',
    shoe: '#9db6cc',
    shirt: '#ffffff',
    shirtEdge: '#0a1826',
    cuff: '#ffffff',
    glow: '210, 235, 255',
    detail: '#122334',
  },
  skin_violet: {
    ivory: '#ece4ff',
    ivoryBack: '#cec0ee',
    shoe: '#9a86c8',
    shirt: '#fbf8ff',
    shirtEdge: '#170b2e',
    cuff: '#fbf8ff',
    glow: '232, 220, 255',
    detail: '#1e1233',
  },
  skin_crimson: {
    ivory: '#ffe4e4',
    ivoryBack: '#efc2c2',
    shoe: '#b06565',
    shirt: '#ffffff',
    shirtEdge: '#260808',
    cuff: '#ffffff',
    glow: '255, 210, 210',
    detail: '#2c0d0d',
  },
  skin_phantom: {
    ivory: '#dfe8ea',
    ivoryBack: '#b7c6ca',
    shoe: '#7f9499',
    shirt: '#eef6f7',
    shirtEdge: '#06161c',
    cuff: '#eef6f7',
    glow: '190, 225, 230',
    detail: '#0b1e24',
  },
};

/** Weapon tint payloads — Partial so defaults always fill in. */
export const TINT_PALETTES: Record<string, Partial<WeaponTintPalette>> = {
  tint_steel: {},
  tint_gold: {
    grip: '#3a2a06',
    guard: '#f0c14b',
    blade: '#ffe9a8',
    slide: '#3a2a06',
    accent: '#f0c14b',
    sight: '#ffe9a8',
    glow: 'rgba(255, 224, 138, 0.45)',
  },
  tint_chrome: {
    grip: '#0f172a',
    guard: '#94a3b8',
    blade: '#f8fafc',
    slide: '#0f172a',
    accent: '#e2e8f0',
    sight: '#f1f5f9',
    glow: 'rgba(226, 232, 240, 0.45)',
  },
  tint_crimson: {
    grip: '#1c0507',
    guard: '#ef4444',
    blade: '#ffe4e6',
    slide: '#1c0507',
    accent: '#f87171',
    sight: '#fecaca',
    glow: 'rgba(255, 140, 140, 0.45)',
  },
};

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

/** Lifetime counters (profile.stats) + special progress sources. */
export type AchievementSource =
  | 'kills'
  | 'executions'
  | 'envKills'
  | 'bossKills'
  | 'disarms'
  | 'ricochetKills'
  | 'noDamageWaves'
  | 'bestWave'
  | 'bestCombo'
  | 'victories'
  | 'coinsEarned'
  | 'wavesCleared'
  | 'level'
  | 'styleRank'
  | 'maxedUpgrades';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  goal: number;
  rewardCoins: number;
  rewardXp: number;
  source: AchievementSource;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', title: 'FIRST BLOOD', description: 'Take your first life.', goal: 1, rewardCoins: 25, rewardXp: 25, source: 'kills' },
  { id: 'hit_list', title: 'HIT LIST', description: 'Eliminate 50 enemies.', goal: 50, rewardCoins: 40, rewardXp: 50, source: 'kills' },
  { id: 'centurion', title: 'CENTURION', description: 'Eliminate 100 enemies.', goal: 100, rewardCoins: 50, rewardXp: 75, source: 'kills' },
  { id: 'reaper', title: 'REAPER', description: 'Eliminate 250 enemies.', goal: 250, rewardCoins: 100, rewardXp: 150, source: 'kills' },
  { id: 'clean_work', title: 'CLEAN WORK', description: 'Perform 10 executions.', goal: 10, rewardCoins: 40, rewardXp: 60, source: 'executions' },
  { id: 'executioner', title: 'EXECUTIONER', description: 'Perform 25 executions.', goal: 25, rewardCoins: 75, rewardXp: 100, source: 'executions' },
  { id: 'collateral', title: 'COLLATERAL DAMAGE', description: 'Kill 5 enemies with barrels.', goal: 5, rewardCoins: 40, rewardXp: 60, source: 'envKills' },
  { id: 'high_table', title: 'HIGH TABLE SLAYER', description: 'Kill a boss.', goal: 1, rewardCoins: 75, rewardXp: 100, source: 'bossKills' },
  { id: 'style_icon', title: 'STYLE ICON', description: 'Earn an S rank in combat.', goal: 4, rewardCoins: 60, rewardXp: 80, source: 'styleRank' },
  { id: 'deep_water', title: 'DEEP WATER', description: 'Reach wave 10.', goal: 10, rewardCoins: 60, rewardXp: 80, source: 'bestWave' },
  { id: 'untouchable', title: 'UNTOUCHABLE', description: 'Clear a wave without taking damage.', goal: 1, rewardCoins: 50, rewardXp: 75, source: 'noDamageWaves' },
  { id: 'disarmament', title: 'DISARMAMENT', description: 'Disarm 5 guns.', goal: 5, rewardCoins: 40, rewardXp: 50, source: 'disarms' },
  { id: 'bank_shot', title: 'BANK SHOT', description: 'Kill an enemy with a ricochet.', goal: 1, rewardCoins: 30, rewardXp: 40, source: 'ricochetKills' },
  { id: 'maxed_out', title: 'MAXED OUT', description: 'Max out any upgrade.', goal: 1, rewardCoins: 50, rewardXp: 60, source: 'maxedUpgrades' },
  { id: 'veteran', title: 'VETERAN', description: 'Reach level 10.', goal: 10, rewardCoins: 100, rewardXp: 150, source: 'level' },
  { id: 'combo_king', title: 'COMBO KING', description: 'Reach a 15x combo.', goal: 15, rewardCoins: 50, rewardXp: 60, source: 'bestCombo' },
  { id: 'victor', title: 'CONTINENTAL VICTOR', description: 'Clear the final wave.', goal: 1, rewardCoins: 75, rewardXp: 100, source: 'victories' },
  { id: 'gold_hoarder', title: 'GOLD HOARDER', description: 'Earn 500 coins in total.', goal: 500, rewardCoins: 50, rewardXp: 50, source: 'coinsEarned' },
];

export const ACHIEVEMENT_MAP: Record<string, AchievementDef> = ACHIEVEMENTS.reduce(
  (acc, def) => {
    acc[def.id] = def;
    return acc;
  },
  {} as Record<string, AchievementDef>
);

/** Every known unlock id — used to sanitize persisted profiles. */
export const KNOWN_UNLOCKS: Set<string> = new Set(UNLOCKS.map((u) => u.id));
