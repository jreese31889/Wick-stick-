import React from 'react';
import type { GameLoop } from '../engine/GameLoop';
import {
  X,
  Play,
  RotateCcw,
  Settings,
  LogOut,
  Award,
  Target,
  Bot,
  HelpCircle,
  Gamepad2,
  Volume2,
  VolumeX,
  Eye,
  Coins,
  Zap,
  Clock,
} from 'lucide-react';
import { formatDuration } from './settings';

interface PauseMenuProps {
  gameLoop: GameLoop;
  runTimeSec: number;
  /** PHASE 2: wallet shown to the player — banked coins + field purse. */
  coins: number;
  isMuted: boolean;
  showDebug: boolean;
  onResume: () => void;
  onRestart: () => void;
  onOptions: () => void;
  onMainMenu: () => void;
  onHelp: () => void;
  onHowToPlay: () => void;
  onPerks: () => void;
  onMilestones: () => void;
  onAIStudio: () => void;
  onToggleSound: () => void;
  onToggleDebug: () => void;
}

const ACTION =
  'w-full min-h-[46px] py-2.5 rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.97] cursor-pointer';
const SECONDARY = `${ACTION} bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300`;

/**
 * Tactical pause overlay: Resume / Restart / Options / Main Menu up front,
 * with the armory, contracts and encounter spawners kept below.
 */
export const PauseMenu: React.FC<PauseMenuProps> = ({
  gameLoop,
  runTimeSec,
  coins,
  isMuted,
  showDebug,
  onResume,
  onRestart,
  onOptions,
  onMainMenu,
  onHelp,
  onHowToPlay,
  onPerks,
  onMilestones,
  onAIStudio,
  onToggleSound,
  onToggleDebug,
}) => {
  const combat = gameLoop.combatDirector;
  const enemies = gameLoop.enemies;
  const roomConfig = gameLoop.environmentManager.config;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onResume();
      }}
    >
      <div className="menu-in w-full max-w-md bg-[#0d0f15] border border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-[0_0_60px_rgba(245,158,11,0.25)] flex flex-col gap-4 text-neutral-200 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-widest text-amber-300 uppercase font-mono">
                Mission Suspended
              </h2>
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                Tactical Combat Pause
              </span>
            </div>
          </div>
          <button
            onClick={onResume}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Resume"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chamber status */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3 space-y-2 text-[11px] font-mono">
          <div className="flex items-center justify-between text-neutral-400">
            <span>CHAMBER:</span>
            <span className="text-white font-bold text-right">
              {roomConfig.title} (WAVE {gameLoop.waveNumber})
            </span>
          </div>
          <div className="flex items-center justify-between text-neutral-400">
            <span>RUN TIME:</span>
            <span className="text-sky-300 font-bold flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatDuration(runTimeSec)}
            </span>
          </div>
          <div className="flex items-center justify-between text-neutral-400">
            <span>STYLE / COMBO:</span>
            <span className="text-amber-400 font-bold">
              {combat.stats.styleRating} • {combat.stats.comboCount}x (Max {combat.stats.maxCombo}x)
            </span>
          </div>
          <div className="flex items-center justify-between text-neutral-400">
            <span>SPECIE WALLET:</span>
            <span className="text-yellow-400 font-bold flex items-center gap-1">
              <Coins className="w-3.5 h-3.5" />
              {coins}
            </span>
          </div>
          <div className="flex items-center justify-between text-neutral-400">
            <span>TAKEDOWNS / PARRIES:</span>
            <span className="text-emerald-300 font-bold">
              {combat.stats.takedownCount} / {combat.stats.parryCount}
            </span>
          </div>
        </div>

        {/* Required core actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onResume}
            className={`${ACTION} bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black shadow-lg`}
          >
            <Play className="w-4 h-4 fill-current" />
            Resume
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onRestart} className={`${SECONDARY} text-red-300 border-red-500/30`}>
              <RotateCcw className="w-4 h-4 text-red-400" />
              Restart
            </button>
            <button onClick={onOptions} className={SECONDARY}>
              <Settings className="w-4 h-4 text-amber-400" />
              Options
            </button>
          </div>
          <button
            onClick={onMainMenu}
            className={`${ACTION} bg-neutral-900 hover:bg-red-950/50 border border-white/15 text-neutral-300 hover:text-red-200`}
          >
            <LogOut className="w-4 h-4" />
            Main Menu
          </button>
        </div>

        {/* Operations */}
        <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 border-t border-white/10 pt-2">
          Operations
        </div>
        <div className="grid grid-cols-2 gap-2 -mt-2">
          <button
            onClick={onPerks}
            className={`${SECONDARY} !text-amber-300 border-amber-500/30`}
          >
            <Award className="w-4 h-4 text-amber-400" />
            Armory
          </button>
          <button onClick={onMilestones} className={`${SECONDARY} !text-sky-300 border-sky-500/30`}>
            <Target className="w-4 h-4 text-sky-400" />
            Contracts
          </button>
          <button onClick={onHelp} className={SECONDARY}>
            <HelpCircle className="w-4 h-4 text-neutral-400" />
            Combat Manual
          </button>
          <button onClick={onHowToPlay} className={SECONDARY}>
            <Gamepad2 className="w-4 h-4 text-emerald-400" />
            How to Play
          </button>
          <button onClick={onAIStudio} className={`${SECONDARY} col-span-2`}>
            <Bot className="w-4 h-4 text-amber-400" />
            AI Syndicate Bureau
          </button>
        </div>

        {/* Encounter spawners — touch stand-ins for the desktop-only header toggles */}
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3].map((count) => (
            <button
              key={count}
              onClick={() => gameLoop.spawnSquad(count)}
              className={`min-h-[44px] rounded-lg font-mono text-[11px] font-bold transition-colors cursor-pointer ${
                gameLoop.squadSize === count && !enemies.some((e) => e.type === 'BOSS')
                  ? 'bg-amber-500 text-black'
                  : 'bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300'
              }`}
              title={`Spawn ${count} enemies`}
            >
              {count === 1 ? '1v1' : count === 2 ? '1v2' : '1v3'}
            </button>
          ))}
          <button
            onClick={() => gameLoop.spawnBossDuel()}
            className={`min-h-[44px] rounded-lg font-mono text-[11px] font-bold transition-colors cursor-pointer ${
              enemies.some((e) => e.type === 'BOSS')
                ? 'bg-gradient-to-r from-red-600 to-amber-500 text-white'
                : 'bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400'
            }`}
            title="Spawn High Table Master Boss"
          >
            👑 BOSS
          </button>
          <button
            onClick={() => gameLoop.spawnEliteDuo()}
            className={`min-h-[44px] rounded-lg font-mono text-[11px] font-bold transition-colors cursor-pointer ${
              gameLoop.squadSize === 5 && !enemies.some((e) => e.type === 'BOSS')
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white'
                : 'bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300'
            }`}
            title="Spawn Elite Vanguard & Shinobi Duo"
          >
            ⚡ ELITE
          </button>
        </div>

        {/* Utility toggles */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onToggleSound} className={SECONDARY}>
            {isMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-red-400" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            {isMuted ? 'Muted' : 'Sound'}
          </button>
          <button
            onClick={onToggleDebug}
            className={`${SECONDARY} ${
              showDebug ? '!bg-emerald-500/15 !border-emerald-400 !text-emerald-300' : ''
            }`}
            title="Toggle Skeletal Rig Overlay"
          >
            <Eye className="w-3.5 h-3.5" />
            Rig
          </button>
        </div>

        <div className="text-[10px] text-center text-neutral-400 font-mono">
          <Zap className="w-3 h-3 inline text-amber-400" /> Tap Resume or press Start on your Type-C
          gamepad to continue combat.
        </div>
      </div>
    </div>
  );
};
