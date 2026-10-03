import React from 'react';
import { X, Lock, Check, Play, Swords, Users, Crown, Zap } from 'lucide-react';
import type { GameProgress } from './settings';

export interface StageDef {
  id: number;
  name: string;
  /** In-game venue (matches the chamber the wave boots into). */
  venue: string;
  subtitle: string;
  wave: number;
  /** Human-readable encounter preview for the stage card. */
  encounter: string;
  spawn: 'squad' | 'boss' | 'elite' | 'marquis';
  squad: number;
  endless?: boolean;
}

/**
 * Authored stage ladder. Waves map onto the engine's authored encounters:
 * wave 4 = High Table boss, wave 5 = elite duo, wave 6 = Marquis duel,
 * wave 7+ = endless gauntlet.
 */
export const STAGES: StageDef[] = [
  {
    id: 1,
    name: 'The Continental',
    venue: 'Grand Lounge & Vault',
    subtitle: 'Initiation',
    wave: 1,
    encounter: '1v1 Enforcer duel',
    spawn: 'squad',
    squad: 1,
  },
  {
    id: 2,
    name: 'Rainier Alleyway',
    venue: 'Midnight Industrial Corridor',
    subtitle: 'Ambush',
    wave: 3,
    encounter: '1v3 ambush + gunner',
    spawn: 'squad',
    squad: 3,
  },
  {
    id: 3,
    name: 'High Table Penthouse',
    venue: 'Apex Observatory',
    subtitle: 'Boss Duel',
    wave: 4,
    encounter: 'High Table Master boss',
    spawn: 'boss',
    squad: 4,
  },
  {
    id: 4,
    name: 'Vault Reprisal',
    venue: 'Grand Lounge & Vault',
    subtitle: 'Elite Infiltration',
    wave: 5,
    encounter: 'Defender + Shadow Elite',
    spawn: 'elite',
    squad: 5,
  },
  {
    id: 5,
    name: 'The Marquis Summit',
    venue: 'Exhibition of Shadows',
    subtitle: 'Sovereign Duel',
    wave: 6,
    encounter: 'Marquis de Gramont',
    spawn: 'marquis',
    squad: 7,
  },
  {
    id: 6,
    name: 'Endless Covenant',
    venue: 'Rainier Alleyway',
    subtitle: 'Wave 7+',
    wave: 7,
    encounter: 'Endless gauntlet',
    spawn: 'squad',
    squad: 3,
    endless: true,
  },
];

/** A stage unlocks once the stage before it has been cleared. */
export function isStageUnlocked(stage: StageDef, progress: GameProgress): boolean {
  if (stage.id === 1) return true;
  return progress.clearedStages.includes(stage.id - 1);
}

/** First stage the player has not cleared yet — what the Play button launches. */
export function getNextStage(progress: GameProgress): StageDef {
  return STAGES.find((s) => isStageUnlocked(s, progress) && !progress.clearedStages.includes(s.id)) ??
    STAGES[0];
}

function encounterIcon(stage: StageDef) {
  if (stage.spawn === 'boss' || stage.spawn === 'marquis') return Crown;
  if (stage.spawn === 'elite') return Swords;
  if (stage.squad > 1) return Users;
  return Zap;
}

interface StageSelectModalProps {
  isOpen: boolean;
  progress: GameProgress;
  onSelect: (stage: StageDef) => void;
  onClose: () => void;
}

/**
 * Horizontal, swipeable stage carousel — sized for landscape phones with
 * thumb-sized cards and clear locked / cleared / current states.
 */
export const StageSelectModal: React.FC<StageSelectModalProps> = ({
  isOpen,
  progress,
  onSelect,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="safe-top safe-bottom safe-left safe-right fixed inset-0 z-[75] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="menu-in w-full max-w-4xl bg-[#0d0f15] border border-amber-500/30 rounded-2xl p-4 sm:p-5 shadow-[0_0_60px_rgba(245,158,11,0.22)] flex flex-col gap-4 text-neutral-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-600/30 border border-sky-400/40 flex items-center justify-center">
              <Swords className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-widest text-amber-300 uppercase font-mono">
                Contract Board
              </h2>
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Select a stage — clear a stage to unlock the next
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

        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory -mx-1 px-1">
          {STAGES.map((stage) => {
            const unlocked = isStageUnlocked(stage, progress);
            const cleared = progress.clearedStages.includes(stage.id);
            const Icon = encounterIcon(stage);
            return (
              <button
                key={stage.id}
                disabled={!unlocked}
                onClick={() => onSelect(stage)}
                className={`snap-start shrink-0 w-[210px] sm:w-[230px] min-h-[190px] rounded-xl border p-3.5 text-left flex flex-col gap-2 transition-all cursor-pointer ${
                  unlocked
                    ? 'bg-neutral-900/90 border-amber-500/35 hover:border-amber-300 hover:bg-neutral-900 active:scale-[0.98]'
                    : 'bg-neutral-950/70 border-white/10 opacity-70 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-eyebrow font-mono uppercase text-neutral-500">
                    Stage {String(stage.id).padStart(2, '0')}
                  </span>
                  {cleared ? (
                    <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      <Check className="w-3 h-3" /> Cleared
                    </span>
                  ) : unlocked ? (
                    <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      Open
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 border border-white/10">
                      <Lock className="w-3 h-3" /> Locked
                    </span>
                  )}
                </div>

                <div className="font-black uppercase tracking-wide text-sm text-neutral-100 leading-tight">
                  {stage.name}
                </div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                  {stage.venue} • {stage.subtitle}
                </div>

                <div className="mt-auto flex items-center gap-2 rounded-lg bg-black/50 border border-white/10 px-2.5 py-2">
                  <Icon className={`w-4 h-4 shrink-0 ${cleared ? 'text-emerald-400' : 'text-amber-400'}`} />
                  <span className="text-[10px] font-mono text-neutral-300 leading-snug">{stage.encounter}</span>
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-neutral-500">WAVE</span>
                  <span className="text-amber-300 font-bold">{stage.endless ? '7+' : stage.wave}</span>
                </div>

                {unlocked && (
                  <span className="flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 text-black text-[11px] font-black uppercase tracking-widest">
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Deploy
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/10 text-[10px] font-mono text-neutral-400">
          <span>Swipe the board or tap a card. Cleared stages keep your best score on record.</span>
          <button
            onClick={onClose}
            className="min-h-[44px] px-6 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold transition-colors cursor-pointer shrink-0"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
