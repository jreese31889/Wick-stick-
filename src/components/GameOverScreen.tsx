import React from 'react';
import { Skull, Trophy, RotateCcw, Layers, LogOut, Play, Flame, Clock, Crosshair, Zap, Award } from 'lucide-react';
import { formatDuration } from './settings';

export interface RunStats {
  kills: number;
  maxCombo: number;
  timeSec: number;
  score: number;
  wave: number;
  takedowns: number;
  parries: number;
  damage: number;
  coins: number;
  style: string;
}

interface EndScreenProps {
  variant: 'defeat' | 'victory';
  stats: RunStats;
  stageName: string;
  isNewRecord: boolean;
  onRetry: () => void;
  onStages: () => void;
  onMainMenu: () => void;
  /** Victory only: keep going into the endless gauntlet. */
  onContinue?: () => void;
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Skull;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl bg-black/50 border border-white/10 px-2.5 py-2 flex flex-col items-center justify-center gap-0.5 min-h-[64px]">
      <Icon className={`w-3.5 h-3.5 ${accent}`} />
      <div className="text-sm font-black font-mono text-white leading-none">{value}</div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-neutral-500 leading-none">
        {label}
      </div>
    </div>
  );
}

/**
 * Shared run-ending overlay: contract defeat and High Table victory both
 * report the same performance stats (kills, max combo, time) with different
 * follow-up actions.
 */
export const GameOverScreen: React.FC<EndScreenProps> = ({
  variant,
  stats,
  stageName,
  isNewRecord,
  onRetry,
  onStages,
  onMainMenu,
  onContinue,
}) => {
  const victory = variant === 'victory';

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 overflow-y-auto">
      <div
        className={`menu-in w-full max-w-lg rounded-2xl p-4 sm:p-5 flex flex-col gap-4 text-neutral-200 max-h-[92vh] overflow-y-auto ${
          victory
            ? 'bg-[#0d0f15] border border-amber-400/50 shadow-[0_0_70px_rgba(245,188,11,0.3)]'
            : 'bg-[#0d0a0a] border border-red-500/40 shadow-[0_0_60px_rgba(239,68,68,0.25)]'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center gap-3 border-b pb-3 ${
            victory ? 'border-amber-500/25' : 'border-red-500/20'
          }`}
        >
          <div
            className={`p-2.5 rounded-xl border ${
              victory
                ? 'bg-amber-500/15 border-amber-400/40'
                : 'bg-red-950/60 border-red-500/30'
            }`}
          >
            {victory ? (
              <Trophy className="w-6 h-6 text-amber-400" />
            ) : (
              <Skull className="w-6 h-6 text-red-400" />
            )}
          </div>
          <div className="min-w-0">
            <h2
              className={`text-lg sm:text-xl font-black tracking-widest uppercase font-mono leading-tight ${
                victory ? 'text-amber-300' : 'text-red-400'
              }`}
            >
              {victory ? 'High Table Toppled' : 'The High Table Prevails'}
            </h2>
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
              {victory ? 'Contract fulfilled' : 'Contract terminated'} • {stageName} • Wave{' '}
              {stats.wave}
            </span>
          </div>
          {isNewRecord && (
            <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] font-mono font-black uppercase px-2 py-1 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-400/50 animate-pulse">
              <Award className="w-3.5 h-3.5" /> Record
            </span>
          )}
        </div>

        {/* Performance stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile icon={Crosshair} label="Kills" value={String(stats.kills)} accent="text-red-400" />
          <StatTile icon={Flame} label="Max Combo" value={`${stats.maxCombo}x`} accent="text-amber-400" />
          <StatTile icon={Clock} label="Time" value={formatDuration(stats.timeSec)} accent="text-sky-400" />
          <StatTile icon={Trophy} label="Score" value={stats.score.toLocaleString()} accent="text-yellow-400" />
          <StatTile icon={Skull} label="Wave" value={String(stats.wave)} accent="text-neutral-300" />
          <StatTile icon={Zap} label="Takedowns" value={String(stats.takedowns)} accent="text-emerald-400" />
          <StatTile icon={Award} label="Parries" value={String(stats.parries)} accent="text-sky-300" />
          <StatTile icon={Layers} label="Style" value={stats.style} accent="text-rose-400" />
        </div>

        <div className="flex items-center justify-between bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[11px] font-mono">
          <span className="text-neutral-400">DAMAGE DEALT</span>
          <span className="text-white font-bold">{Math.round(stats.damage)}</span>
          <span className="text-neutral-400">GOLD COINS</span>
          <span className="text-yellow-300 font-bold">{stats.coins}</span>
        </div>

        <div className="text-[11px] text-center text-neutral-500 font-mono italic">
          "
          {victory
            ? 'They bowed to no one. Until now.'
            : stats.style === 'BABA YAGA'
            ? 'They called him Baba Yaga.'
            : 'No one escapes the Table forever.'}
          "
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {victory && onContinue ? (
            <button
              onClick={onContinue}
              className="w-full min-h-[50px] py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              Continue — Endless
            </button>
          ) : (
            <button
              onClick={onRetry}
              className={`w-full min-h-[50px] py-3 rounded-xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer ${
                victory
                  ? 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black'
                  : 'bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-black'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              {victory ? 'Replay Stage' : 'Retry Stage'}
            </button>
          )}

          <div
            className={`grid gap-2 ${victory && onContinue ? 'grid-cols-3' : 'grid-cols-2'}`}
          >
            {victory && onContinue && (
              <button
                onClick={onRetry}
                className="min-h-[46px] py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Replay
              </button>
            )}
            <button
              onClick={onStages}
              className="min-h-[46px] py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Layers className="w-4 h-4" />
              Stages
            </button>
            <button
              onClick={onMainMenu}
              className="min-h-[46px] py-2.5 rounded-xl bg-neutral-900 hover:bg-red-950/50 border border-white/15 text-neutral-300 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Main Menu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
