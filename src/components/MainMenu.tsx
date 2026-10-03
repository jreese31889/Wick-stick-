import React from 'react';
import {
  Play,
  Layers,
  Settings,
  Gamepad2,
  Trophy,
  Target,
  Flame,
  Clock,
  Coins,
  Swords,
  Shirt,
  Award,
  User,
} from 'lucide-react';
import type { GameProgress } from './settings';
import { formatDuration } from './settings';
import type { StageDef } from './StageSelectModal';
import type { GameProfile } from '../profile/ProfileStore';
import { xpToNext, STYLE_RANKS } from '../profile/Progression';
import { ACHIEVEMENTS } from '../profile/Catalogs';

interface MainMenuProps {
  progress: GameProgress;
  /** PHASE 2: persistent profile (level / coins / commendations). */
  profile: GameProfile;
  /** Stage the Play button launches (first uncleared stage). */
  nextStage: StageDef;
  onPlay: () => void;
  onStageSelect: () => void;
  onUpgrades: () => void;
  onAppearance: () => void;
  onAchievements: () => void;
  onProfile: () => void;
  onOptions: () => void;
  onHowToPlay: () => void;
}

const MENU_BUTTON =
  'menu-btn group flex items-center justify-center gap-2.5 min-h-[52px] px-4 rounded-xl font-black uppercase tracking-[0.18em] text-xs sm:text-sm transition-all active:scale-[0.97] cursor-pointer border';

/**
 * Landscape-first title screen: art + logo on the left, thumb-sized action
 * column and career stats on the right.
 */
export const MainMenu: React.FC<MainMenuProps> = ({
  progress,
  profile,
  nextStage,
  onPlay,
  onStageSelect,
  onUpgrades,
  onAppearance,
  onAchievements,
  onProfile,
  onOptions,
  onHowToPlay,
}) => {
  const stagesCleared = progress.clearedStages.filter((id) => id <= 5).length;
  const xpNeed = xpToNext(profile.level);
  const xpPct = Math.min(100, Math.round((profile.xp / Math.max(1, xpNeed)) * 100));
  const unlockedCount = ACHIEVEMENTS.filter((d) => profile.achievements[d.id]?.unlocked).length;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}assets/ai/title-bg.jpg)` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/25" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.6)_100%)]" />

      <div className="safe-top safe-bottom relative z-10 min-h-full w-full max-w-6xl mx-auto px-5 py-6 sm:px-8 grid gap-6 lg:gap-10 lg:grid-cols-[1.05fr_0.95fr] items-center">
        {/* LEFT — branding */}
        <div className="text-center lg:text-left">
          <div className="text-[10px] font-mono tracking-[0.5em] text-amber-400/90 uppercase mb-3">
            The High Table presents
          </div>
          <h1 className="text-5xl sm:text-6xl xl:text-7xl font-black tracking-tight text-white uppercase leading-none drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
            John <span className="text-amber-400">Stick</span>
          </h1>
          <p className="mt-3 text-xs sm:text-sm font-mono text-neutral-300 tracking-widest uppercase">
            Baba Yaga • Stick-Figure Gun-Fu
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center lg:justify-start gap-x-3 gap-y-1 text-[10px] font-mono text-neutral-400 uppercase tracking-wider">
            <span>Endless chambers</span>
            <span className="text-amber-500">•</span>
            <span>Gun-fu takedowns</span>
            <span className="text-amber-500">•</span>
            <span>Boss duels</span>
          </div>

          {/* PHASE 2 — level, bank and commendations at a glance */}
          <div className="mt-5 max-w-xl mx-auto lg:mx-0 rounded-xl bg-black/60 border border-amber-500/25 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/25 to-teal-600/40 border border-emerald-400/40 flex items-center justify-center">
                  <Swords className="w-4.5 h-4.5 text-emerald-300" />
                </div>
                <div>
                  <div className="text-lg font-black font-mono text-emerald-300 leading-none">
                    LV {profile.level}
                  </div>
                  <div className="text-micro font-mono uppercase text-neutral-500">
                    Rank:{' '}
                    {STYLE_RANKS[Math.min(5, profile.stats.bestStyleRank)]} style •{' '}
                    {unlockedCount}/{ACHIEVEMENTS.length} medals
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-amber-300 font-mono text-base font-black">
                <Coins className="w-4 h-4 text-yellow-400" />
                {profile.coins}
              </div>
            </div>
            <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10 mt-2.5">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-300 transition-all duration-300"
                style={{ width: `${xpPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[9px] font-mono text-neutral-500 mt-1">
              <span>
                {profile.xp} / {xpNeed} XP
              </span>
              <span>next: LV {profile.level + 1}</span>
            </div>
          </div>

          {/* Career stats — progression at a glance */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-xl mx-auto lg:mx-0">
            <div className="rounded-xl bg-black/60 border border-white/10 px-3 py-2 text-center">
              <Trophy className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
              <div className="text-sm font-black font-mono text-amber-300">{progress.victories}</div>
              <div className="text-micro font-mono uppercase text-neutral-500">Victories</div>
            </div>
            <div className="rounded-xl bg-black/60 border border-white/10 px-3 py-2 text-center">
              <Target className="w-3.5 h-3.5 text-sky-400 mx-auto mb-1" />
              <div className="text-sm font-black font-mono text-sky-300">
                {progress.bestScore.toLocaleString()}
              </div>
              <div className="text-micro font-mono uppercase text-neutral-500">Best Score</div>
            </div>
            <div className="rounded-xl bg-black/60 border border-white/10 px-3 py-2 text-center">
              <Flame className="w-3.5 h-3.5 text-orange-400 mx-auto mb-1" />
              <div className="text-sm font-black font-mono text-orange-300">{progress.bestMaxCombo}x</div>
              <div className="text-micro font-mono uppercase text-neutral-500">Max Combo</div>
            </div>
            <div className="rounded-xl bg-black/60 border border-white/10 px-3 py-2 text-center">
              <Clock className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
              <div className="text-sm font-black font-mono text-emerald-300">
                {progress.bestTimeSec > 0 ? formatDuration(progress.bestTimeSec) : '—'}
              </div>
              <div className="text-micro font-mono uppercase text-neutral-500">Best Run</div>
            </div>
          </div>
        </div>

        {/* RIGHT — thumb-sized action column */}
        <div className="flex flex-col gap-3 w-full max-w-md mx-auto">
          <button onClick={onPlay} className={`${MENU_BUTTON} menu-btn-primary shadow-[0_0_40px_rgba(245,158,11,0.4)]`}>
            <Play className="w-5 h-5 fill-current" />
            Play
          </button>
          <div className="text-center text-eyebrow font-mono uppercase text-amber-300/90 -mt-1">
            Next: Stage {nextStage.id} — {nextStage.name}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-1">
            <button onClick={onStageSelect} className={`${MENU_BUTTON} menu-btn-ghost`}>
              <Layers className="w-4 h-4 text-sky-400" />
              Stages
            </button>
            <button onClick={onOptions} className={`${MENU_BUTTON} menu-btn-ghost`}>
              <Settings className="w-4 h-4 text-amber-400" />
              Options
            </button>
            <button onClick={onHowToPlay} className={`${MENU_BUTTON} menu-btn-ghost`}>
              <Gamepad2 className="w-4 h-4 text-emerald-400" />
              How to Play
            </button>
          </div>

          {/* PHASE 2 — progression screens */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button onClick={onUpgrades} className={`${MENU_BUTTON} menu-btn-ghost`}>
              <Swords className="w-4 h-4 text-amber-400" />
              Safehouse
            </button>
            <button onClick={onAppearance} className={`${MENU_BUTTON} menu-btn-ghost`}>
              <Shirt className="w-4 h-4 text-sky-400" />
              Wardrobe
            </button>
            <button onClick={onAchievements} className={`${MENU_BUTTON} menu-btn-ghost`}>
              <Award className="w-4 h-4 text-purple-400" />
              Medals
            </button>
            <button onClick={onProfile} className={`${MENU_BUTTON} menu-btn-ghost`}>
              <User className="w-4 h-4 text-emerald-400" />
              Dossier
            </button>
          </div>

          <div className="mt-1 rounded-xl bg-black/55 border border-white/10 px-3.5 py-2.5 flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
              Stages cleared
            </span>
            <span className="text-[11px] font-mono font-bold text-amber-300">{stagesCleared} / 5</span>
          </div>

          <p className="text-[10px] text-center font-mono text-neutral-500 uppercase tracking-widest">
            Touch controls or gamepad — headphones recommended
          </p>
        </div>
      </div>
    </div>
  );
};
