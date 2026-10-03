import { SoundFX } from '../engine/SoundFX';
import { Music } from '../engine/Music';

/**
 * Shared menu state: persistent settings (audio / graphics), persistent run
 * progression (stage unlocks, personal bests), and the master SFX volume bus.
 *
 * Everything here is deliberately self-contained so the menu components can
 * read/write it without reaching into engine internals.
 */

export type Quality = 'low' | 'medium' | 'high';

/** PHASE 3 4 — aim magnetism strength (Low is the shipped PHASE 1B cone). */
export type AimAssistLevel = 'off' | 'low' | 'high';

/** PHASE 3 2 — the touch controls a custom layout may reposition. */
export type TouchControlId =
  | 'joystick'
  | 'aimpad'
  | 'punch'
  | 'kick'
  | 'shoot'
  | 'grab'
  | 'dodge'
  | 'block'
  | 'jump'
  | 'focus'
  | 'interact'
  | 'swap'
  | 'reload';

/** Normalised (fraction of screen) offset from a control's default spot. */
export interface TouchOffset {
  x: number;
  y: number;
}

export interface TouchLayout {
  /** Named preset in force, or 'custom' once a drag no longer matches one. */
  preset: 'default' | 'southpaw' | 'custom';
  /** Per-control offsets; a missing id means "default position". */
  offsets: Partial<Record<TouchControlId, TouchOffset>>;
}

export interface GameSettings {
  /** Master SFX volume, 0-100. 0 silences every effect. */
  sfxVolume: number;
  /**
   * PHASE 4 E5: adaptive score volume, 0-100. Rides on the same master bus
   * as the SFX fader, so the HUD mute (sfxVolume 0) silences music too.
   */
  musicVolume: number;
  /** Graphics quality tier driving the CSS effect budget. */
  quality: Quality;
  /** Show the FPS chip in the HUD (visible on xl+ layouts). */
  showFps: boolean;
  /** PHASE 1B E6: gameplay haptics (pad rumble + phone vibration). */
  haptics: boolean;
  /* -------------------------------------------------------------- */
  /* PHASE 3 — input & platform polish                               */
  /* -------------------------------------------------------------- */
  /** PHASE 3 1: gamepad left-stick radial deadzone, 5-40 (%). */
  padMoveDeadzone: number;
  /** PHASE 3 1: gamepad right-stick (aim) radial deadzone, 5-40 (%). */
  padAimDeadzone: number;
  /** PHASE 3 1: left-stick sensitivity, 50-200 (%). 100 = shipped feel. */
  padMoveSensitivity: number;
  /** PHASE 3 1: right-stick (aim) sensitivity, 50-200 (%). 100 = shipped feel. */
  padAimSensitivity: number;
  /** PHASE 3 4: aim magnetism — Off / Low (shipped 12°) / High (20°). */
  aimAssist: AimAssistLevel;
  /** PHASE 3 3: swipe gestures on the look area (swap / reload / focus). */
  swipeGestures: boolean;
  /** PHASE 3 2: on-screen button scale, 70-140 (%). 100 = shipped size. */
  touchButtonScale: number;
  /** PHASE 3 2: HUD + touch-control opacity, 40-100 (%). */
  hudOpacity: number;
  /** PHASE 3 2: custom touch layout (null = default positions). */
  touchLayout: TouchLayout | null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sfxVolume: 100,
  musicVolume: 70,
  quality: 'high',
  showFps: true,
  haptics: true,
  padMoveDeadzone: 15,
  padAimDeadzone: 22,
  padMoveSensitivity: 100,
  padAimSensitivity: 100,
  aimAssist: 'low',
  swipeGestures: true,
  touchButtonScale: 100,
  hudOpacity: 100,
  touchLayout: null,
};

export const AIM_ASSIST_OPTIONS: { id: AimAssistLevel; label: string; blurb: string }[] = [
  { id: 'off', label: 'Off', blurb: 'Raw stick — no magnetism, every shot flies exactly where you point.' },
  { id: 'low', label: 'Low', blurb: 'Shipped default: 12° head-magnetism inside the reticle cone.' },
  { id: 'high', label: 'High', blurb: 'Wider 20° cone and longer reach — friendlier on a small screen.' },
];

export const QUALITY_OPTIONS: { id: Quality; label: string; blurb: string }[] = [
  {
    id: 'low',
    label: 'Performance',
    blurb: 'Drops HUD blur, glow shadows and looping animations — fastest on low-end phones.',
  },
  {
    id: 'medium',
    label: 'Balanced',
    blurb: 'Keeps the readable frosted HUD, trims heavy glow shadows.',
  },
  {
    id: 'high',
    label: 'Cinematic',
    blurb: 'Full effects: frosted blur, glow shadows, animated HUD and vignette.',
  },
];

export interface GameProgress {
  /** Stage ids the player has beaten (unlocks the next stage). */
  clearedStages: number[];
  /** Furthest wave ever cleared. */
  highestWaveCleared: number;
  /** Times the High Table was toppled (wave 6 cleared). */
  victories: number;
  bestScore: number;
  bestMaxCombo: number;
  bestKills: number;
  /** Fastest victorious run in seconds (0 = none yet). */
  bestTimeSec: number;
}

export const DEFAULT_PROGRESS: GameProgress = {
  clearedStages: [],
  highestWaveCleared: 0,
  victories: 0,
  bestScore: 0,
  bestMaxCombo: 0,
  bestKills: 0,
  bestTimeSec: 0,
};

const SETTINGS_KEY = 'john-stick.settings.v1';
const PROGRESS_KEY = 'john-stick.progress.v1';

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled (private mode) — settings just won't persist.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const TOUCH_CONTROL_IDS: TouchControlId[] = [
  'joystick', 'aimpad', 'punch', 'kick', 'shoot', 'grab', 'dodge',
  'block', 'jump', 'focus', 'interact', 'swap', 'reload',
];

/** Largest |offset| a control may be dragged from its default spot (35 % of screen). */
export const LAYOUT_LIMIT = 0.35;

/** Field-by-field guard for a stored touch layout (corrupt blobs can't crash). */
export function sanitizeTouchLayout(raw: unknown): TouchLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<TouchLayout>;
  const preset = obj.preset === 'southpaw' ? 'southpaw' : obj.preset === 'default' ? 'default' : 'custom';
  const offsets: Partial<Record<TouchControlId, TouchOffset>> = {};
  const rawOffsets = obj.offsets && typeof obj.offsets === 'object'
    ? (obj.offsets as Record<string, unknown>)
    : {};
  let count = 0;
  for (const id of TOUCH_CONTROL_IDS) {
    const entry = rawOffsets[id];
    if (!entry || typeof entry !== 'object') continue;
    const point = entry as Partial<TouchOffset>;
    const x = clamp(num(point.x, 0), -LAYOUT_LIMIT, LAYOUT_LIMIT);
    const y = clamp(num(point.y, 0), -LAYOUT_LIMIT, LAYOUT_LIMIT);
    if (x === 0 && y === 0) continue;
    offsets[id] = { x, y };
    count++;
  }
  if (count === 0) return null;
  return { preset, offsets };
}

function sanitizeAimAssist(value: unknown, fallback: AimAssistLevel): AimAssistLevel {
  return value === 'off' || value === 'low' || value === 'high' ? value : fallback;
}

export function loadSettings(): GameSettings {
  const raw = readJson(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  const quality =
    raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high'
      ? raw.quality
      : DEFAULT_SETTINGS.quality;
  return {
    sfxVolume: clamp(Math.round(num(raw.sfxVolume, DEFAULT_SETTINGS.sfxVolume)), 0, 100),
    musicVolume: clamp(Math.round(num(raw.musicVolume, DEFAULT_SETTINGS.musicVolume)), 0, 100),
    quality,
    showFps: typeof raw.showFps === 'boolean' ? raw.showFps : DEFAULT_SETTINGS.showFps,
    haptics: typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULT_SETTINGS.haptics,
    // PHASE 3 — input polish
    padMoveDeadzone: clamp(Math.round(num(raw.padMoveDeadzone, DEFAULT_SETTINGS.padMoveDeadzone)), 0, 40),
    padAimDeadzone: clamp(Math.round(num(raw.padAimDeadzone, DEFAULT_SETTINGS.padAimDeadzone)), 0, 40),
    padMoveSensitivity: clamp(Math.round(num(raw.padMoveSensitivity, DEFAULT_SETTINGS.padMoveSensitivity)), 50, 200),
    padAimSensitivity: clamp(Math.round(num(raw.padAimSensitivity, DEFAULT_SETTINGS.padAimSensitivity)), 50, 200),
    aimAssist: sanitizeAimAssist(raw.aimAssist, DEFAULT_SETTINGS.aimAssist),
    swipeGestures: typeof raw.swipeGestures === 'boolean' ? raw.swipeGestures : DEFAULT_SETTINGS.swipeGestures,
    touchButtonScale: clamp(Math.round(num(raw.touchButtonScale, DEFAULT_SETTINGS.touchButtonScale)), 70, 140),
    hudOpacity: clamp(Math.round(num(raw.hudOpacity, DEFAULT_SETTINGS.hudOpacity)), 40, 100),
    touchLayout: sanitizeTouchLayout(raw.touchLayout),
  };
}

export function saveSettings(settings: GameSettings): void {
  writeJson(SETTINGS_KEY, settings);
}

export function loadProgress(): GameProgress {
  const raw = readJson(PROGRESS_KEY);
  if (!raw) return { ...DEFAULT_PROGRESS };
  const cleared = Array.isArray(raw.clearedStages)
    ? (raw.clearedStages as unknown[]).filter((v): v is number => typeof v === 'number')
    : [];
  return {
    clearedStages: [...new Set(cleared)],
    highestWaveCleared: Math.max(0, Math.round(num(raw.highestWaveCleared, 0))),
    victories: Math.max(0, Math.round(num(raw.victories, 0))),
    bestScore: Math.max(0, Math.round(num(raw.bestScore, 0))),
    bestMaxCombo: Math.max(0, Math.round(num(raw.bestMaxCombo, 0))),
    bestKills: Math.max(0, Math.round(num(raw.bestKills, 0))),
    bestTimeSec: Math.max(0, Math.round(num(raw.bestTimeSec, 0))),
  };
}

export function saveProgress(progress: GameProgress): void {
  writeJson(PROGRESS_KEY, progress);
}

/** Applies the graphics tier to the document so index.css can trim the effect budget. */
export function applyQuality(quality: Quality): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.quality = quality;
  }
}

/** "12:34" / "1:02:03" — compact run timer for pause + end screens. */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

// ============================================================
// MASTER SFX VOLUME BUS
//
// SoundFX synthesises straight into its AudioContext destination with
// per-effect gains, so a master fader is installed by re-routing every
// context's `destination` through one GainNode. The patch runs before the
// first AudioContext is constructed (see main.tsx) and degrades gracefully
// to a plain mute (SoundFX.enabled) if anything about it fails.
// ============================================================

let masterVolume = 1;
const busGains = new Set<GainNode>();
let busInstalled = false;

export function installAudioBus(): void {
  if (busInstalled || typeof window === 'undefined') return;

  const AudioCtx: typeof AudioContext | undefined =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const descriptor =
    Object.getOwnPropertyDescriptor(AudioContext.prototype, 'destination') ??
    Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination');
  const realGetter = descriptor?.get;
  if (!realGetter) return;

  try {
    class RoutedAudioContext extends AudioCtx {
      get destination(): AudioDestinationNode {
        const self = this as unknown as { __masterGain?: GainNode };
        try {
          if (!self.__masterGain) {
            const real = realGetter.call(this) as AudioDestinationNode;
            const gain = this.createGain();
            gain.gain.value = masterVolume;
            gain.connect(real);
            busGains.add(gain);
            self.__masterGain = gain;
          }
          return self.__masterGain as unknown as AudioDestinationNode;
        } catch {
          // Never let the routing break audio — fall back to the raw output.
          return realGetter.call(this) as AudioDestinationNode;
        }
      }
    }

    window.AudioContext = RoutedAudioContext;
    const legacy = window as unknown as { webkitAudioContext?: typeof AudioContext };
    if (legacy.webkitAudioContext) legacy.webkitAudioContext = RoutedAudioContext;
    busInstalled = true;
  } catch {
    busInstalled = false;
  }
}

function setMasterVolume(volume: number): void {
  masterVolume = volume;
  for (const gain of busGains) {
    try {
      gain.gain.value = volume;
    } catch {
      // Stale node — ignore.
    }
  }
}

/** 0-100 master SFX volume: 0 mutes outright, otherwise scales every effect. */
export function applySfxVolume(volume: number): void {
  const clamped = clamp(Math.round(volume), 0, 100);
  SoundFX.enabled = clamped > 0;
  setMasterVolume(clamped / 100);
}

/**
 * PHASE 4 E5 — 0-100 music volume on the score's own bus.
 *
 * The music bus hangs off the same patched master fader the SFX use, so this
 * slider only sets the *relative* score level: pulling the master (HUD mute /
 * Sound Volume slider) still takes the music down with it.
 */
export function applyMusicVolume(volume: number): void {
  Music.setVolume(clamp(Math.round(volume), 0, 100));
}
