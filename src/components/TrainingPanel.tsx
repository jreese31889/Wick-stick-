import React from 'react';
import { Check, RotateCcw, LogOut, Target } from 'lucide-react';
import {
  TRAINING_CHECKS,
  trainingDone,
  trainingProgress,
} from '../engine/TrainingRoom';
import { getDifficulty } from '../engine/Difficulty';

interface TrainingPanelProps {
  /** Instant drill reset — respawns the dummies and clears the board. */
  onReset: () => void;
  /** Leaves the arena and returns to the contract board. */
  onExit: () => void;
}

/**
 * G7 — the Training Arena's mechanic checklist. It reads the tracker module
 * directly on every render, so it lights up the moment CombatDirector marks a
 * move: a ticked row is a mechanic that actually ran through the live combat
 * path, not a UI promise. App re-renders it on the 4 Hz tracker cadence while
 * a drill is on.
 */
export const TrainingPanel: React.FC<TrainingPanelProps> = ({ onReset, onExit }) => {
  const done = trainingDone();
  const { done: doneCount, total } = trainingProgress();
  const complete = doneCount === total;

  return (
    <div className="safe-left fixed left-3 top-1/2 -translate-y-1/2 z-[60] w-[176px] pointer-events-auto select-none">
      <div className="bg-black/75 backdrop-blur-md border border-sky-500/40 rounded-xl p-2.5 shadow-[0_0_24px_rgba(14,165,233,0.25)] flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-sky-300">
            <Target className="w-3.5 h-3.5" />
            Training
          </span>
          <span
            className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
              complete
                ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                : 'bg-neutral-900 border-white/15 text-neutral-300'
            }`}
          >
            {doneCount}/{total}
          </span>
        </div>

        <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-neutral-500 border-t border-white/10 pt-1.5">
          <span>Tier</span>
          <span className="text-amber-300 font-bold">{getDifficulty().label}</span>
        </div>

        <ul className="flex flex-col gap-1">
          {TRAINING_CHECKS.map((check) => {
            const hit = done.includes(check.id);
            return (
              <li key={check.id} className="flex items-start gap-1.5">
                <span
                  className={`mt-[1px] shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${
                    hit
                      ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
                      : 'bg-neutral-900 border-white/20 text-transparent'
                  }`}
                >
                  <Check className="w-2.5 h-2.5" />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-[10px] font-bold leading-tight ${
                      hit ? 'text-emerald-200' : 'text-neutral-200'
                    }`}
                  >
                    {check.label}
                  </span>
                  <span className="block text-[8px] font-mono text-neutral-500 leading-tight">
                    {check.hint}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex gap-1.5 border-t border-white/10 pt-1.5">
          <button
            onClick={onReset}
            className="flex-1 min-h-[34px] rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-white/15 text-neutral-200 text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
          <button
            onClick={onExit}
            className="flex-1 min-h-[34px] rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/50 text-sky-200 text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
            Exit
          </button>
        </div>
      </div>
    </div>
  );
};
