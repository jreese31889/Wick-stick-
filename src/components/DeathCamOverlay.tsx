import React, { useEffect, useRef } from 'react';
import { Skull, Video, ChevronsRight, X } from 'lucide-react';
import type { DeathCam } from '../engine/DeathCam';
import { REPLAY_CAMERA_LABELS, REPLAY_CAMERA_MODES, type ReplayCameraMode } from '../engine/DeathCam';

interface DeathCamOverlayProps {
  /** Mount only while the reconstruction owns the screen. */
  visible: boolean;
  deathCam: DeathCam;
  /** SKIP — drops straight into the existing game-over flow (spec §5). */
  onSkip: () => void;
  /** Manual camera switch (spec §4). Ignored when the choice is gated off. */
  onMode: (mode: ReplayCameraMode) => void;
}

const TYPE_LABELS: Record<string, string> = {
  SHOT: 'GUNFIGHT',
  MELEE: 'MELEE',
  TAKEDOWN: 'TAKEDOWN',
  EXECUTION: 'EXECUTION',
  ENVIRONMENT: 'ENVIRONMENT',
  EXPLOSION: 'EXPLOSION',
  FALL: 'FALL',
};

const formatTime = (seconds: number): string => `${Math.max(0, seconds).toFixed(1)}s`;

/**
 * DEATH CAM HUD (owner spec §5).
 *
 * Deliberately minimal — identity of the killer, what they used, how far away
 * they were, the four framings, and a way out. The progress bar and clock are
 * written straight to the DOM from a rAF loop rather than through state: a 60
 * Hz re-render of the whole app just to move a bar would defeat the point of
 * holding the simulation during the replay.
 */
export const DeathCamOverlay: React.FC<DeathCamOverlayProps> = ({
  visible,
  deathCam,
  onSkip,
  onMode,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const paint = () => {
      const progress = deathCam.progress;
      const bar = barRef.current;
      if (bar) bar.style.width = `${(progress * 100).toFixed(2)}%`;
      const time = timeRef.current;
      if (time) time.textContent = formatTime(progress * deathCam.windowSeconds);
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [visible, deathCam]);

  if (!visible) return null;

  const cinematicAllowed = deathCam.settings.cinematic;
  const total = deathCam.windowSeconds;

  return (
    <div className="safe-top safe-bottom safe-left safe-right pointer-events-none fixed inset-0 z-[62]">
      {/* Top strip — who ended the run */}
      <div className="absolute top-0 left-0 right-0 p-4 sm:p-6 flex items-start justify-between gap-4">
        <div className="pointer-events-auto max-w-[60%]">
          <div className="flex items-center gap-2 text-red-400/90">
            <Skull className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-mono text-[10px] sm:text-xs font-black uppercase tracking-[0.3em]">
              Eliminated by
            </span>
          </div>
          <div className="mt-1.5 font-mono text-lg sm:text-3xl font-black uppercase tracking-wider text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
            {deathCam.killerName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] sm:text-xs uppercase tracking-widest text-amber-300/90">
            <span className="px-1.5 py-0.5 rounded border border-amber-400/40 bg-amber-500/10">
              {deathCam.killerWeapon}
            </span>
            <span className="text-neutral-400">{deathCam.killerDistanceM.toFixed(1)} m</span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-400">{TYPE_LABELS[deathCam.eliminationType] ?? deathCam.eliminationType}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <Video className="w-4 h-4 text-amber-400/80" />
          <span className="font-mono text-[10px] sm:text-xs font-black uppercase tracking-[0.25em] text-amber-300">
            Replay
          </span>
        </div>
      </div>

      {/* Bottom bar — framings, progress, escape */}
      <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          {REPLAY_CAMERA_MODES.map((mode) => {
            const active = deathCam.mode === mode;
            const gated = mode === 'CINEMATIC' && !cinematicAllowed;
            return (
              <button
                key={mode}
                onClick={() => onMode(mode)}
                disabled={gated}
                className={`min-h-[44px] px-3 sm:px-4 rounded-xl border font-mono text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                  active
                    ? 'bg-amber-500/25 border-amber-400 text-amber-200 shadow-[0_0_18px_rgba(245,158,11,0.35)]'
                    : gated
                      ? 'bg-neutral-950/70 border-white/5 text-neutral-600 cursor-not-allowed'
                      : 'bg-black/55 border-white/15 text-neutral-300 hover:border-white/35'
                }`}
              >
                {REPLAY_CAMERA_LABELS[mode]}
              </button>
            );
          })}

          <div className="ml-auto" />

          <button
            onClick={onSkip}
            className="pointer-events-auto min-h-[44px] px-4 sm:px-5 rounded-xl border border-white/25 bg-black/60 hover:bg-white/10 text-white font-mono text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Skip replay"
          >
            <X className="w-3.5 h-3.5" />
            Skip
            <ChevronsRight className="w-3.5 h-3.5 opacity-70" />
          </button>
        </div>

        {/* Progress — width written by rAF, not by React */}
        <div className="flex items-center gap-3">
          <div className="relative h-1.5 flex-1 rounded-full bg-white/12 overflow-hidden">
            <div
              ref={barRef}
              className="absolute inset-y-0 left-0 w-0 rounded-full bg-gradient-to-r from-amber-500 to-yellow-300 shadow-[0_0_12px_rgba(245,158,11,0.8)]"
            />
          </div>
          <span className="font-mono text-[10px] font-black tabular-nums text-amber-300/90 w-[74px] text-right">
            <span ref={timeRef}>{formatTime(0)}</span>
            <span className="text-neutral-500"> / {formatTime(total)}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
