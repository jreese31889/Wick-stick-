import React from 'react';
import {
  X,
  Volume2,
  VolumeX,
  Gauge,
  MonitorPlay,
  RotateCcw,
  Vibrate,
  Trash2,
  AlertTriangle,
  Gamepad2,
  Crosshair,
  Smartphone,
  Move,
  Music2,
  Swords,
  Film,
} from 'lucide-react';
import type { GameSettings } from './settings';
import {
  AIM_ASSIST_OPTIONS,
  DEFAULT_SETTINGS,
  DEATH_CAM_DURATIONS,
  DIFFICULTY_OPTIONS,
  QUALITY_OPTIONS,
} from './settings';

interface OptionsModalProps {
  isOpen: boolean;
  settings: GameSettings;
  onChange: (patch: Partial<GameSettings>) => void;
  /** PHASE 2: wipes the progression profile (level, coins, unlocks, medals). */
  onResetProfile: () => void;
  /** PHASE 3 2: opens the full-screen drag-to-place touch layout editor. */
  onEditLayout: () => void;
  /** PHASE 3 1: live gamepad status for the tuning section. */
  padConnected: boolean;
  padName: string;
  onClose: () => void;
}

const ROW = 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-5';
const LABEL = 'font-black uppercase tracking-widest text-xs text-neutral-100 flex items-center gap-2';
const BLURB = 'text-[11px] font-mono text-neutral-400 mt-1 leading-snug max-w-sm';

/** Compact labelled slider used by every numeric PHASE 3 setting. */
const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '%', onChange }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">{label}</span>
      <span className="font-mono font-black text-xs text-amber-300">
        {value}
        {suffix}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      className="menu-range w-full"
      style={{ '--vol': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
    />
  </div>
);

/**
 * DEATH CAM §7 — the four switches beside the master toggle. Each entry owns
 * its own getter/setter so the patch stays a literal and the compiler checks
 * every key against GameSettings.
 */
const DEATH_CAM_TOGGLES: {
  id: string;
  label: string;
  blurb: string;
  get: (s: GameSettings) => boolean;
  set: (v: boolean) => Partial<GameSettings>;
}[] = [
  {
    id: 'cinematic',
    label: 'Cinematic',
    blurb: 'Extra framings + vignette push',
    get: (s) => s.deathCamCinematic,
    set: (v) => ({ deathCamCinematic: v }),
  },
  {
    id: 'slowmo',
    label: 'Slow motion',
    blurb: 'Rate drop + audio on the blow',
    get: (s) => s.deathCamSlowMotion,
    set: (v) => ({ deathCamSlowMotion: v }),
  },
  {
    id: 'shake',
    label: 'Camera shake',
    blurb: 'Trauma on replay impacts',
    get: (s) => s.deathCamShake,
    set: (v) => ({ deathCamShake: v }),
  },
  {
    id: 'autoskip',
    label: 'Auto skip',
    blurb: 'Skip replay after the freeze',
    get: (s) => s.deathCamAutoSkip,
    set: (v) => ({ deathCamAutoSkip: v }),
  },
];

/**
 * Options: master SFX volume, graphics quality tier, the HUD FPS chip and the
 * PHASE 3 input / platform controls (gamepad tuning, aim assist, touch layout).
 * Every control is thumb-sized for landscape phones.
 */
export const OptionsModal: React.FC<OptionsModalProps> = ({
  isOpen,
  settings,
  onChange,
  onResetProfile,
  onEditLayout,
  padConnected,
  padName,
  onClose,
}) => {
  const [armed, setArmed] = React.useState(false);
  if (!isOpen) return null;

  const volume = settings.sfxVolume;
  const music = settings.musicVolume;

  return (
    <div
      className="safe-top safe-bottom safe-left safe-right fixed inset-0 z-[75] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="menu-in w-full max-w-2xl bg-[#0d0f15] border border-amber-500/30 rounded-2xl p-4 sm:p-5 shadow-[0_0_60px_rgba(245,158,11,0.22)] flex flex-col gap-4 text-neutral-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-600/30 border border-amber-400/40 flex items-center justify-center">
              <Gauge className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-widest text-amber-300 uppercase font-mono">
                Options
              </h2>
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Audio, graphics, HUD & controls
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SOUND VOLUME */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-3.5">
          <div className={ROW}>
            <div>
              <div className={LABEL}>
                {volume > 0 ? (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-red-400" />
                )}
                Sound Volume
              </div>
              <div className={BLURB}>
                Master volume for every punch, parry and gunshot. 0 silences the game.
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-64 shrink-0">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={volume}
                aria-label="Sound volume"
                onChange={(e) => onChange({ sfxVolume: Number(e.target.value) })}
                className="menu-range flex-1"
                style={{ '--vol': `${volume}%` } as React.CSSProperties}
              />
              <span className="w-12 text-right font-mono font-black text-sm text-amber-300">
                {volume}%
              </span>
            </div>
          </div>

          {/* PHASE 4 E5 — adaptive score level, beside the master fader */}
          <div className={ROW}>
            <div>
              <div className={LABEL}>
                <Music2 className="w-4 h-4 text-sky-400" />
                Music Volume
              </div>
              <div className={BLURB}>
                Procedural score — menu theme, combat layers and stings. 0 stops the music engine.
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-64 shrink-0">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={music}
                aria-label="Music volume"
                onChange={(e) => onChange({ musicVolume: Number(e.target.value) })}
                className="menu-range flex-1"
                style={{ '--vol': `${music}%` } as React.CSSProperties}
              />
              <span className="w-12 text-right font-mono font-black text-sm text-amber-300">
                {music}%
              </span>
            </div>
          </div>
        </div>

        {/* GRAPHICS QUALITY */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-3">
          <div>
            <div className={LABEL}>
              <MonitorPlay className="w-4 h-4 text-sky-400" />
              Graphics Quality
            </div>
            <div className={BLURB}>
              Trims screen effects (blur, glow shadows, animations) to protect the frame rate.
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {QUALITY_OPTIONS.map((option) => {
              const active = settings.quality === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => onChange({ quality: option.id })}
                  className={`min-h-[52px] rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-gradient-to-r from-amber-500/25 to-yellow-500/15 border-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.3)]'
                      : 'bg-neutral-900 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div
                    className={`text-xs font-black uppercase tracking-widest ${
                      active ? 'text-amber-300' : 'text-neutral-300'
                    }`}
                  >
                    {option.label}
                  </div>
                  <div className="text-[10px] font-mono text-neutral-400 leading-snug mt-0.5">
                    {option.blurb}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* DIFFICULTY TIER — G5 (behaviour only, never HP) */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-3">
          <div>
            <div className={LABEL}>
              <Swords className="w-4 h-4 text-amber-400" />
              Difficulty
            </div>
            <div className={BLURB}>
              Changes how enemies react and decide — never their health or damage. PRO is the
              shipped baseline.
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {DIFFICULTY_OPTIONS.map((option) => {
              const active = settings.difficulty === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => onChange({ difficulty: option.id })}
                  className={`min-h-[52px] rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-gradient-to-r from-amber-500/25 to-yellow-500/15 border-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.3)]'
                      : 'bg-neutral-900 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div
                    className={`text-xs font-black uppercase tracking-widest ${
                      active ? 'text-amber-300' : 'text-neutral-300'
                    }`}
                  >
                    {option.label}
                  </div>
                  <div className="text-[10px] font-mono text-neutral-400 leading-snug mt-0.5">
                    {option.blurb}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* HUD TOGGLE */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5">
          <div className={ROW}>
            <div>
              <div className={LABEL}>
                <Gauge className="w-4 h-4 text-emerald-400" />
                FPS Counter
              </div>
              <div className={BLURB}>Shows the live frame rate chip in the top-right HUD.</div>
            </div>
            <button
              onClick={() => onChange({ showFps: !settings.showFps })}
              className={`min-h-[44px] px-5 rounded-xl border font-black uppercase tracking-widest text-xs transition-all cursor-pointer ${
                settings.showFps
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-neutral-900 border-white/10 text-neutral-400'
              }`}
            >
              {settings.showFps ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        {/* HAPTICS TOGGLE (PHASE 1B E6) */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5">
          <div className={ROW}>
            <div>
              <div className={LABEL}>
                <Vibrate className="w-4 h-4 text-rose-400" />
                Haptic Feedback
              </div>
              <div className={BLURB}>
                Controller rumble on impacts, parries and takedowns — plus phone vibration on mobile.
              </div>
            </div>
            <button
              onClick={() => onChange({ haptics: !settings.haptics })}
              className={`min-h-[44px] px-5 rounded-xl border font-black uppercase tracking-widest text-xs transition-all cursor-pointer ${
                settings.haptics
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-neutral-900 border-white/10 text-neutral-400'
              }`}
            >
              {settings.haptics ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        {/* AIM ASSIST — PHASE 3 4 */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-3">
          <div>
            <div className={LABEL}>
              <Crosshair className="w-4 h-4 text-rose-400" />
              Aim Assist
            </div>
            <div className={BLURB}>
              Head magnetism inside the reticle cone. Low is the shipped default; Off is raw stick.
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {AIM_ASSIST_OPTIONS.map((option) => {
              const active = settings.aimAssist === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => onChange({ aimAssist: option.id })}
                  className={`min-h-[52px] rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-gradient-to-r from-rose-500/25 to-amber-500/15 border-rose-400 shadow-[0_0_16px_rgba(244,63,94,0.3)]'
                      : 'bg-neutral-900 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div
                    className={`text-xs font-black uppercase tracking-widest ${
                      active ? 'text-rose-300' : 'text-neutral-300'
                    }`}
                  >
                    {option.label}
                  </div>
                  <div className="text-[10px] font-mono text-neutral-400 leading-snug mt-0.5">
                    {option.blurb}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* GAMEPAD TUNING — PHASE 3 1 */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={LABEL}>
                <Gamepad2 className="w-4 h-4 text-emerald-400" />
                Gamepad Tuning
              </div>
              <div className={BLURB}>
                Radial deadzones and stick sensitivity for Type-C controllers. 100% = shipped feel.
              </div>
            </div>
            <span
              className={`shrink-0 px-2.5 py-1 rounded-lg border font-mono text-[10px] font-bold ${
                padConnected
                  ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
                  : 'bg-neutral-900 border-white/10 text-neutral-500'
              }`}
            >
              {padConnected ? padName : 'No pad'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Slider
              label="Move deadzone"
              value={settings.padMoveDeadzone}
              min={0}
              max={40}
              onChange={(v) => onChange({ padMoveDeadzone: v })}
            />
            <Slider
              label="Aim deadzone"
              value={settings.padAimDeadzone}
              min={0}
              max={40}
              onChange={(v) => onChange({ padAimDeadzone: v })}
            />
            <Slider
              label="Move sensitivity"
              value={settings.padMoveSensitivity}
              min={50}
              max={200}
              onChange={(v) => onChange({ padMoveSensitivity: v })}
            />
            <Slider
              label="Aim sensitivity"
              value={settings.padAimSensitivity}
              min={50}
              max={200}
              onChange={(v) => onChange({ padAimSensitivity: v })}
            />
          </div>
          <div className="text-[10px] font-mono text-neutral-500 leading-snug border-t border-white/10 pt-2">
            A jump · B dodge · X interact / reload · Y swap · LB/RB combo · L3 block · R3 grab ·
            LT aim · RT fire · Start pause
          </div>
        </div>

        {/* TOUCH CONTROLS — PHASE 3 2 / 3 */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-3">
          <div>
            <div className={LABEL}>
              <Smartphone className="w-4 h-4 text-sky-400" />
              Touch Controls
            </div>
            <div className={BLURB}>
              Button size, HUD fade, look-area swipe gestures and the drag-to-place layout.
            </div>
          </div>
          <div className={ROW}>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Swipe gestures
              </div>
              <div className="text-[10px] font-mono text-neutral-500 mt-0.5 leading-snug">
                Flick right = swap · flick down = reload · two-finger tap = focus.
              </div>
            </div>
            <button
              onClick={() => onChange({ swipeGestures: !settings.swipeGestures })}
              className={`min-h-[44px] px-5 rounded-xl border font-black uppercase tracking-widest text-xs transition-all cursor-pointer ${
                settings.swipeGestures
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-neutral-900 border-white/10 text-neutral-400'
              }`}
            >
              {settings.swipeGestures ? 'On' : 'Off'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <Move className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <Slider
              label="Button size"
              value={settings.touchButtonScale}
              min={70}
              max={140}
              onChange={(v) => onChange({ touchButtonScale: v })}
            />
          </div>
          <Slider
            label="HUD opacity"
            value={settings.hudOpacity}
            min={40}
            max={100}
            onChange={(v) => onChange({ hudOpacity: v })}
          />
          <button
            onClick={onEditLayout}
            className="w-full min-h-[44px] px-4 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-400/40 text-sky-200 font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Move className="w-4 h-4" />
            Edit touch layout
          </button>
        </div>

        {/* DEATH CAM — kill replay (owner spec 2026-10-03) */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-3">
          <div>
            <div className={LABEL}>
              <Film className="w-4 h-4 text-amber-400" />
              Death Cam
            </div>
            <div className={BLURB}>
              On death: a slow-motion freeze, a camera move into the kill, then the run-up rebuilt
              from the last few seconds. Off keeps the shipped death sequence untouched.
            </div>
          </div>
          <div className={ROW}>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Kill replay
              </div>
              <div className="text-[10px] font-mono text-neutral-500 mt-0.5 leading-snug">
                Escape / SKIP exits instantly at any point.
              </div>
            </div>
            <button
              onClick={() => onChange({ deathCam: !settings.deathCam })}
              className={`min-h-[44px] px-5 rounded-xl border font-black uppercase tracking-widest text-xs transition-all cursor-pointer ${
                settings.deathCam
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-neutral-900 border-white/10 text-neutral-400'
              }`}
            >
              {settings.deathCam ? 'On' : 'Off'}
            </button>
          </div>

          <div
            className={
              settings.deathCam ? 'space-y-3' : 'space-y-3 opacity-40 pointer-events-none'
            }
          >
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mb-1.5">
                Replay length
              </div>
              <div className="grid grid-cols-4 gap-2">
                {DEATH_CAM_DURATIONS.map((seconds) => {
                  const active = settings.deathCamDuration === seconds;
                  return (
                    <button
                      key={seconds}
                      onClick={() => onChange({ deathCamDuration: seconds })}
                      className={`min-h-[44px] rounded-xl border font-black uppercase tracking-widest text-xs transition-all cursor-pointer ${
                        active
                          ? 'bg-gradient-to-r from-amber-500/30 to-yellow-500/15 border-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.3)] text-amber-300'
                          : 'bg-neutral-900 border-white/10 text-neutral-300 hover:border-white/25'
                      }`}
                    >
                      {seconds}s
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {DEATH_CAM_TOGGLES.map((toggle) => {
                const value = toggle.get(settings);
                return (
                  <div key={toggle.id} className={ROW}>
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                        {toggle.label}
                      </div>
                      <div className="text-[10px] font-mono text-neutral-500 mt-0.5 leading-snug">
                        {toggle.blurb}
                      </div>
                    </div>
                    <button
                      onClick={() => onChange(toggle.set(!value))}
                      className={`min-h-[44px] px-5 rounded-xl border font-black uppercase tracking-widest text-xs transition-all cursor-pointer ${
                        value
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                          : 'bg-neutral-900 border-white/10 text-neutral-400'
                      }`}
                    >
                      {value ? 'On' : 'Off'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* DANGER ZONE — PHASE 2 profile wipe (two-step confirm) */}
        <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-3.5">
          <div className={ROW}>
            <div>
              <div className={LABEL}>
                <Trash2 className="w-4 h-4 text-red-400" />
                Reset Profile
              </div>
              <div className={BLURB}>
                Wipes level, XP, banked coins, upgrades, loadouts and medals. Audio and graphics
                settings are kept. This cannot be undone.
              </div>
            </div>
            <button
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  window.setTimeout(() => setArmed(false), 4000);
                  return;
                }
                setArmed(false);
                onResetProfile();
              }}
              className={`min-h-[44px] px-5 rounded-xl border font-black uppercase tracking-widest text-xs transition-all cursor-pointer flex items-center justify-center gap-2 ${
                armed
                  ? 'bg-red-600 border-red-400 text-white animate-pulse'
                  : 'bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20'
              }`}
            >
              {armed ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  Tap again to wipe
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Reset
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1 border-t border-white/10">
          <button
            onClick={() => onChange({ ...DEFAULT_SETTINGS, touchLayout: settings.touchLayout })}
            className="min-h-[44px] px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 font-bold uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restore Defaults
          </button>
          <button
            onClick={onClose}
            className="min-h-[44px] px-8 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black uppercase tracking-widest text-xs transition-transform active:scale-95 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
