import { SoundFX } from '../engine/SoundFX';

/**
 * Shared menu state: persistent settings (audio / graphics), persistent run
 * progression (stage unlocks, personal bests), and the master SFX volume bus.
 *
 * Everything here is deliberately self-contained so the menu components can
 * read/write it without reaching into engine internals.
 */

export type Quality = 'low' | 'medium' | 'high';

export interface GameSettings {
  /** Master SFX volume, 0-100. 0 silences every effect. */
  sfxVolume: number;
  /** Graphics quality tier driving the CSS effect budget. */
  quality: Quality;
  /** Show the FPS chip in the HUD (visible on xl+ layouts). */
  showFps: boolean;
  /** PHASE 1B E6: gameplay haptics (pad rumble + phone vibration). */
  haptics: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sfxVolume: 100,
  quality: 'high',
  showFps: true,
  haptics: true,
};

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

export function loadSettings(): GameSettings {
  const raw = readJson(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  const quality =
    raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high'
      ? raw.quality
      : DEFAULT_SETTINGS.quality;
  return {
    sfxVolume: clamp(Math.round(num(raw.sfxVolume, DEFAULT_SETTINGS.sfxVolume)), 0, 100),
    quality,
    showFps: typeof raw.showFps === 'boolean' ? raw.showFps : DEFAULT_SETTINGS.showFps,
    haptics: typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULT_SETTINGS.haptics,
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
