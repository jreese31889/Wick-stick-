import React from 'react';
import { X, Award, Check, Lock, Coins, Star } from 'lucide-react';
import { ACHIEVEMENTS, type AchievementDef } from '../profile/Catalogs';
import type { GameProfile } from '../profile/ProfileStore';
import { achievementProgress } from '../profile/Progression';

interface AchievementsModalProps {
  isOpen: boolean;
  profile: GameProfile;
  onClose: () => void;
}

function goalLabel(def: AchievementDef): string {
  switch (def.source) {
    case 'styleRank':
      return 'S RANK';
    case 'maxedUpgrades':
      return 'ANY STAT MAXED';
    case 'bestWave':
      return `WAVE ${def.goal}`;
    case 'bestCombo':
      return `${def.goal}x COMBO`;
    case 'coinsEarned':
      return `${def.goal} COINS EARNED`;
    case 'level':
      return `LEVEL ${def.goal}`;
    case 'envKills':
      return `${def.goal} BARREL KILLS`;
    case 'bossKills':
      return `${def.goal} BOSS`;
    case 'disarms':
      return `${def.goal} DISARMS`;
    case 'ricochetKills':
      return `${def.goal} RICOCHET`;
    case 'noDamageWaves':
      return `${def.goal} CLEAN WAVE`;
    case 'victories':
      return `${def.goal} VICTORY`;
    case 'executions':
      return `${def.goal} EXECUTIONS`;
    default:
      return `${def.goal} ${def.source.toUpperCase()}`;
  }
}

/** PHASE 2: career achievements — progress is read live off the profile. */
export const AchievementsModal: React.FC<AchievementsModalProps> = ({ isOpen, profile, onClose }) => {
  if (!isOpen) return null;

  const unlockedCount = ACHIEVEMENTS.filter((d) => profile.achievements[d.id]?.unlocked).length;
  const percent = Math.round((unlockedCount / ACHIEVEMENTS.length) * 100);

  return (
    <div
      className="safe-top safe-bottom safe-left safe-right fixed inset-0 z-[75] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-2xl w-full bg-[#0d0f15] border border-purple-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(168,85,247,0.18)] flex flex-col gap-4 text-neutral-200 relative animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-fuchsia-600/30 border border-purple-400/40 flex items-center justify-center shadow-lg">
              <Award className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wider text-purple-200 uppercase font-mono">
                Commendations
              </h2>
              <p className="text-xs text-neutral-400">
                {unlockedCount} of {ACHIEVEMENTS.length} earned • pays coins + XP
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress banner */}
        <div className="bg-black/50 border border-purple-500/20 rounded-xl p-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-neutral-400 uppercase tracking-wider">Career Commendations</span>
            <span className="text-purple-300 font-bold">{percent}%</span>
          </div>
          <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-400 transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[56vh] overflow-y-auto pr-1">
          {ACHIEVEMENTS.map((def) => {
            const state = profile.achievements[def.id];
            const unlocked = state?.unlocked ?? false;
            const progress = unlocked ? def.goal : achievementProgress(profile, def);
            const pct = Math.min(100, Math.round((progress / def.goal) * 100));

            return (
              <div
                key={def.id}
                className={`p-3 rounded-xl border transition-all ${
                  unlocked
                    ? 'bg-purple-950/20 border-purple-500/40 shadow-[0_0_14px_rgba(168,85,247,0.12)]'
                    : 'bg-neutral-900/60 border-white/5'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                      unlocked
                        ? 'bg-purple-500/20 text-purple-200 border border-purple-400/40'
                        : 'bg-white/5 text-neutral-500 border border-white/10'
                    }`}
                  >
                    {unlocked ? <Check className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-bold text-sm ${unlocked ? 'text-white' : 'text-neutral-300'}`}
                      >
                        {def.title}
                      </span>
                      <span className="text-[10px] font-mono text-amber-300/90 shrink-0 flex items-center gap-1">
                        <Coins className="w-3 h-3 text-yellow-400" />
                        {def.rewardCoins}
                        <Star className="w-3 h-3 text-sky-400 ml-1" />
                        {def.rewardXp} XP
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">{def.description}</p>
                    {!unlocked && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 mb-1">
                          <span>{goalLabel(def)}</span>
                          <span>
                            {progress} / {def.goal}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-400 transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono text-neutral-400">
          <span className="text-[11px]">Unlocks pay out immediately — watch for the toast.</span>
          <button
            onClick={onClose}
            className="px-6 py-1.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
