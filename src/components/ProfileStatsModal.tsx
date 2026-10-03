import React from 'react';
import { X, Coins, Star, Trophy, Crosshair, Swords, Waves, Flame, Target } from 'lucide-react';
import type { GameProfile } from '../profile/ProfileStore';
import { xpToNext, STYLE_RANKS } from '../profile/Progression';
import { UNLOCKS, ACHIEVEMENTS } from '../profile/Catalogs';

interface ProfileStatsModalProps {
  isOpen: boolean;
  profile: GameProfile;
  onClose: () => void;
}

/** PHASE 2: lifetime dossier — level, bank and every tracked career stat. */
export const ProfileStatsModal: React.FC<ProfileStatsModalProps> = ({ isOpen, profile, onClose }) => {
  if (!isOpen) return null;

  const stats = profile.stats;
  const need = xpToNext(profile.level);
  const pct = Math.min(100, Math.round((profile.xp / Math.max(1, need)) * 100));
  const unlockedAchievements = ACHIEVEMENTS.filter((d) => profile.achievements[d.id]?.unlocked).length;

  const countKind = (kind: string) =>
    UNLOCKS.filter((u) => u.kind === kind && profile.unlocks.includes(u.id)).length;
  const totalKind = (kind: string) => UNLOCKS.filter((u) => u.kind === kind).length;

  const tiles: { label: string; value: string | number; icon: typeof Trophy; tone: string }[] = [
    { label: 'Kills', value: stats.kills, icon: Crosshair, tone: 'text-rose-300' },
    { label: 'Executions', value: stats.executions, icon: Swords, tone: 'text-amber-300' },
    { label: 'Barrel Kills', value: stats.envKills, icon: Flame, tone: 'text-orange-300' },
    { label: 'Bosses Slain', value: stats.bossKills, icon: Trophy, tone: 'text-purple-300' },
    { label: 'Waves Cleared', value: stats.wavesCleared, icon: Waves, tone: 'text-sky-300' },
    { label: 'Best Wave', value: stats.bestWave, icon: Target, tone: 'text-emerald-300' },
    { label: 'Best Combo', value: `${stats.bestCombo}x`, icon: Flame, tone: 'text-amber-300' },
    { label: 'Disarms', value: stats.disarms, icon: Crosshair, tone: 'text-sky-300' },
    { label: 'Clean Waves', value: stats.noDamageWaves, icon: Star, tone: 'text-teal-300' },
    { label: 'Victories', value: stats.victories, icon: Trophy, tone: 'text-yellow-300' },
    { label: 'Coins Earned', value: stats.coinsEarned, icon: Coins, tone: 'text-yellow-300' },
    { label: 'Best Style', value: STYLE_RANKS[Math.min(5, stats.bestStyleRank)], icon: Star, tone: 'text-rose-300' },
  ];

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-2xl w-full bg-[#0d0f15] border border-emerald-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(16,185,129,0.18)] flex flex-col gap-4 text-neutral-200 relative animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/30 border border-emerald-400/40 flex items-center justify-center shadow-lg">
              <Trophy className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wider text-emerald-300 uppercase font-mono">
                The Dossier
              </h2>
              <p className="text-xs text-neutral-400">Lifetime record of John's contracts</p>
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

        {/* Level + bank */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-black/50 border border-emerald-500/20 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-mono tracking-wider text-neutral-400">
                  Level
                </div>
                <div className="text-3xl font-black font-mono text-emerald-300 leading-none mt-1">
                  {profile.level}
                </div>
              </div>
              <div className="text-right font-mono text-xs text-neutral-400">
                <div>
                  <span className="text-emerald-300 font-bold">{profile.xp}</span> / {need} XP
                </div>
                <div className="text-[10px]">to level {profile.level + 1}</div>
              </div>
            </div>
            <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden border border-white/10 mt-3">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-300 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl bg-black/50 border border-amber-500/20 p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-neutral-400">
                Banked Specie
              </div>
              <div className="text-3xl font-black font-mono text-amber-300 leading-none mt-1 flex items-center gap-2">
                <Coins className="w-6 h-6 text-yellow-400" />
                {profile.coins}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase font-mono tracking-wider text-neutral-400">
                Commendations
              </div>
              <div className="text-lg font-black font-mono text-purple-300 mt-1">
                {unlockedAchievements} / {ACHIEVEMENTS.length}
              </div>
            </div>
          </div>
        </div>

        {/* Lifetime grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-xl bg-black/45 border border-white/5 px-2.5 py-2.5 text-center"
            >
              <tile.icon className={`w-3.5 h-3.5 mx-auto mb-1 ${tile.tone}`} />
              <div className="text-sm font-black font-mono text-neutral-100">{tile.value}</div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
                {tile.label}
              </div>
            </div>
          ))}
        </div>

        {/* Unlocks */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
          {(
            [
              ['loadout', 'Loadouts'],
              ['move', 'Moves'],
              ['skin', 'Suits'],
              ['tint', 'Tints'],
            ] as const
          ).map(([kind, label]) => (
            <div key={kind} className="rounded-xl bg-black/45 border border-white/5 px-2 py-2">
              <div className="text-sm font-bold text-amber-300">
                {countKind(kind)} / {totalKind(kind)}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-neutral-500">{label}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono text-neutral-400">
          <span className="text-[11px]">Wipe this record in Options → Reset Profile.</span>
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
