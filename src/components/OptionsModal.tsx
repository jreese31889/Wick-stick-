import React from 'react';
import { X, Volume2, VolumeX, Gauge, MonitorPlay, RotateCcw, Vibrate, Trash2, AlertTriangle } from 'lucide-react';
import type { GameSettings } from './settings';
import { DEFAULT_SETTINGS, QUALITY_OPTIONS } from './settings';

interface OptionsModalProps {
  isOpen: boolean;
  settings: GameSettings;
  onChange: (patch: Partial<GameSettings>) => void;
  /** PHASE 2: wipes the progression profile (level, coins, unlocks, medals). */
  onResetProfile: () => void;
  onClose: () => void;
}

const ROW = 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-5';
const LABEL = 'font-black uppercase tracking-widest text-xs text-neutral-100 flex items-center gap-2';
const BLURB = 'text-[11px] font-mono text-neutral-400 mt-1 leading-snug max-w-sm';

/**
 * Options: master SFX volume, graphics quality tier and the HUD FPS chip.
 * Every control is thumb-sized for landscape phones.
 */
export const OptionsModal: React.FC<OptionsModalProps> = ({
  isOpen,
  settings,
  onChange,
  onResetProfile,
  onClose,
}) => {
  const [armed, setArmed] = React.useState(false);
  if (!isOpen) return null;

  const volume = settings.sfxVolume;

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5"
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
                Audio, graphics & HUD
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
        <div className="bg-black/50 border border-white/10 rounded-xl p-3.5">
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
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
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
