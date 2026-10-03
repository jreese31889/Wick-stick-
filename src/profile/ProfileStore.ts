/**
 * PHASE 2 — versioned profile persistence.
 *
 * The profile is the single source of truth for everything that survives a
 * reload: coins, XP/level, upgrade tiers, unlocks, equipped cosmetics,
 * achievements and lifetime stats. It lives under its own key
 * (`johnstick-profile-v1`) so the Phase 1 progress/settings keys keep
 * working untouched, and every load is sanitized field-by-field — a corrupt
 * or hand-edited blob can never crash the menu or inflate a stat.
 *
 * NOTE: saves are event-driven only (wave end, purchase, achievement,
 * level-up, run end, settings change, reset). Never call saveProfile from a
 * per-frame path.
 */
import {
  ACHIEVEMENTS,
  KNOWN_UNLOCKS,
  UNLOCK_MAP,
  UPGRADES,
  type UpgradeId,
} from './Catalogs';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  sanitizeTouchLayout,
  sanitizeDeathCamDuration,
  type GameSettings,
} from '../components/settings';


export const PROFILE_KEY = 'johnstick-profile-v1';
export const PROFILE_VERSION = 1;

export type StyleRank = 'D' | 'C' | 'B' | 'A' | 'S' | 'SS';

export interface LifetimeStats {
  kills: number;
  executions: number;
  envKills: number;
  bossKills: number;
  disarms: number;
  ricochetKills: number;
  wavesCleared: number;
  noDamageWaves: number;
  victories: number;
  bestWave: number;
  bestCombo: number;
  coinsEarned: number;
  /** Best style rank index reached (0 = D … 5 = SS). */
  bestStyleRank: number;
}

export interface AchievementState {
  unlocked: boolean;
  /** Progress counter mirrored for UI (0..goal). */
  progress: number;
}

export interface GameProfile {
  version: number;
  /** Banked coins (spent in the shop). Run purse lives in engine physics. */
  coins: number;
  xp: number;
  level: number;
  /** Current tier per upgrade id. */
  upgrades: Record<UpgradeId, number>;
  /** Granted unlock ids (loadouts, moves, skins, tints). */
  unlocks: string[];
  selectedLoadout: string;
  selectedSkin: string;
  selectedTint: string;
  achievements: Record<string, AchievementState>;
  stats: LifetimeStats;
  /** Passthrough of the shared audio/graphics settings. */
  settings: GameSettings;
}

export const DEFAULT_STATS: LifetimeStats = {
  kills: 0,
  executions: 0,
  envKills: 0,
  bossKills: 0,
  disarms: 0,
  ricochetKills: 0,
  wavesCleared: 0,
  noDamageWaves: 0,
  victories: 0,
  bestWave: 0,
  bestCombo: 0,
  coinsEarned: 0,
  bestStyleRank: 0,
};

function defaultUpgrades(): Record<UpgradeId, number> {
  const out = {} as Record<UpgradeId, number>;
  for (const def of UPGRADES) out[def.id] = 0;
  return out;
}

function defaultAchievements(): Record<string, AchievementState> {
  const out: Record<string, AchievementState> = {};
  for (const def of ACHIEVEMENTS) out[def.id] = { unlocked: false, progress: 0 };
  return out;
}

export function defaultProfile(): GameProfile {
  return {
    version: PROFILE_VERSION,
    coins: 0,
    xp: 0,
    level: 1,
    upgrades: defaultUpgrades(),
    unlocks: ['FISTS', 'skin_classic', 'tint_steel'],
    selectedLoadout: 'FISTS',
    selectedSkin: 'skin_classic',
    selectedTint: 'tint_steel',
    achievements: defaultAchievements(),
    stats: { ...DEFAULT_STATS },
    settings: { ...DEFAULT_SETTINGS },
  };
}

/* ------------------------------------------------------------------ */
/* Sanitize                                                            */
/* ------------------------------------------------------------------ */

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  return Math.max(0, Math.round(num(value, fallback)));
}

/** Rounded + bounded int (PHASE 3: deadzones, sensitivities, sliders). */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(num(value, fallback))));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function sanitizeSettings(raw: unknown): GameSettings {
  const fallback = loadSettings();
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const obj = raw as Partial<GameSettings>;
  const quality =
    obj.quality === 'low' || obj.quality === 'medium' || obj.quality === 'high'
      ? obj.quality
      : fallback.quality;
  return {
    sfxVolume: Math.min(100, Math.max(0, Math.round(num(obj.sfxVolume, fallback.sfxVolume)))),
    // PHASE 4 E5: score level rides along with the rest of the audio profile.
    musicVolume: clampInt(obj.musicVolume, fallback.musicVolume, 0, 100),
    quality,
    // G5 — the behaviour tier rides along in the profile so it survives a
    // reload exactly like the rest of the menu settings.
    difficulty:
      obj.difficulty === 'rookie' || obj.difficulty === 'pro' || obj.difficulty === 'continental'
        ? obj.difficulty
        : fallback.difficulty,
    showFps: bool(obj.showFps, fallback.showFps),
    haptics: bool(obj.haptics, fallback.haptics),
    // PHASE 3 — input & platform polish rides along in the profile so the
    // touch layout / pad tuning survives a reload the same way XP does.
    padMoveDeadzone: clampInt(obj.padMoveDeadzone, fallback.padMoveDeadzone, 0, 40),
    padAimDeadzone: clampInt(obj.padAimDeadzone, fallback.padAimDeadzone, 0, 40),
    padMoveSensitivity: clampInt(obj.padMoveSensitivity, fallback.padMoveSensitivity, 50, 200),
    padAimSensitivity: clampInt(obj.padAimSensitivity, fallback.padAimSensitivity, 50, 200),
    aimAssist:
      obj.aimAssist === 'off' || obj.aimAssist === 'low' || obj.aimAssist === 'high'
        ? obj.aimAssist
        : fallback.aimAssist,
    swipeGestures: bool(obj.swipeGestures, fallback.swipeGestures),
    touchButtonScale: clampInt(obj.touchButtonScale, fallback.touchButtonScale, 70, 140),
    hudOpacity: clampInt(obj.hudOpacity, fallback.hudOpacity, 40, 100),
    touchLayout:
      obj.touchLayout !== undefined ? sanitizeTouchLayout(obj.touchLayout) : fallback.touchLayout,
    // DEATH CAM §7 — rides along in the profile exactly like the audio/menu
    // settings, so a wipe never silently changes how the player dies.
    deathCam: bool(obj.deathCam, fallback.deathCam),
    deathCamDuration: sanitizeDeathCamDuration(obj.deathCamDuration, fallback.deathCamDuration),
    deathCamCinematic: bool(obj.deathCamCinematic, fallback.deathCamCinematic),
    deathCamSlowMotion: bool(obj.deathCamSlowMotion, fallback.deathCamSlowMotion),
    deathCamShake: bool(obj.deathCamShake, fallback.deathCamShake),
    deathCamAutoSkip: bool(obj.deathCamAutoSkip, fallback.deathCamAutoSkip),
  };
}

function sanitizeUpgrades(raw: unknown): Record<UpgradeId, number> {
  const out = defaultUpgrades();
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const def of UPGRADES) {
    const value = int(obj[def.id], 0);
    out[def.id] = Math.min(value, def.maxTiers);
  }
  return out;
}

function sanitizeAchievements(raw: unknown): Record<string, AchievementState> {
  const out = defaultAchievements();
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const def of ACHIEVEMENTS) {
    const entry = obj[def.id];
    if (!entry || typeof entry !== 'object') continue;
    const state = entry as Partial<AchievementState>;
    out[def.id] = {
      unlocked: bool(state.unlocked, false),
      progress: Math.min(def.goal, int(state.progress, 0)),
    };
  }
  return out;
}

function sanitizeStats(raw: unknown): LifetimeStats {
  const out = { ...DEFAULT_STATS };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_STATS) as (keyof LifetimeStats)[]) {
    out[key] = int(obj[key], 0);
  }
  out.bestStyleRank = Math.min(5, out.bestStyleRank);
  return out;
}

function sanitizeUnlocks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['FISTS', 'skin_classic', 'tint_steel'];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    if (!KNOWN_UNLOCKS.has(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  if (!seen.has('FISTS')) out.unshift('FISTS');
  if (!seen.has('skin_classic')) out.push('skin_classic');
  if (!seen.has('tint_steel')) out.push('tint_steel');
  return out;
}

function sanitizeSelection(value: unknown, unlocks: string[], fallback: string): string {
  const candidate = str(value, fallback);
  if (unlocks.includes(candidate)) return candidate;
  // Fall back to any unlocked item of the same kind (loadout / skin / tint).
  const kind = UNLOCK_MAP[fallback]?.kind;
  const sameKind = unlocks.find((id) => UNLOCK_MAP[id]?.kind === kind);
  return sameKind ?? fallback;
}

/** Coerces an arbitrary parsed object into a safe, complete profile. */
export function sanitizeProfile(raw: unknown): GameProfile {
  const base = defaultProfile();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const unlocks = sanitizeUnlocks(obj.unlocks);
  return {
    version: PROFILE_VERSION,
    coins: int(obj.coins, 0),
    xp: int(obj.xp, 0),
    level: Math.max(1, int(obj.level, 1)),
    upgrades: sanitizeUpgrades(obj.upgrades),
    unlocks,
    selectedLoadout: sanitizeSelection(obj.selectedLoadout, unlocks, 'FISTS'),
    selectedSkin: sanitizeSelection(obj.selectedSkin, unlocks, 'skin_classic'),
    selectedTint: sanitizeSelection(obj.selectedTint, unlocks, 'tint_steel'),
    achievements: sanitizeAchievements(obj.achievements),
    stats: sanitizeStats(obj.stats),
    settings: sanitizeSettings(obj.settings),
  };
}

/* ------------------------------------------------------------------ */
/* Load / save / reset                                                 */
/* ------------------------------------------------------------------ */

function readJson(): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function writeJson(value: unknown): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(value));
  } catch {
    // Storage disabled — progression just won't persist this session.
  }
}

/** Loads the profile (defaults when missing/corrupt). Safe to call at boot. */
export function loadProfile(): GameProfile {
  const raw = readJson();
  if (!raw) return defaultProfile();
  return sanitizeProfile(raw);
}

/** Persists the profile. Cheap enough for event-driven calls only. */
export function saveProfile(profile: GameProfile): void {
  writeJson({ ...profile, version: PROFILE_VERSION });
}

/** Wipes the profile key and returns a fresh default. */
export function resetProfile(): GameProfile {
  try {
    window.localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Ignore — default is returned either way.
  }
  return defaultProfile();
}
