import React from 'react';
import { Award, Sparkles, TrendingUp, Coins, Star } from 'lucide-react';

export interface ProgressToast {
  id: number;
  kind: 'level' | 'achievement' | 'unlock' | 'coins' | 'info';
  title: string;
  body?: string;
}

const STYLES: Record<
  ProgressToast['kind'],
  { icon: typeof Award; frame: string; iconClass: string; bar: string }
> = {
  level: {
    icon: TrendingUp,
    frame: 'border-emerald-400/60 shadow-[0_0_28px_rgba(16,185,129,0.35)]',
    iconClass: 'text-emerald-300',
    bar: 'from-emerald-500 to-teal-300',
  },
  achievement: {
    icon: Award,
    frame: 'border-amber-400/60 shadow-[0_0_28px_rgba(245,158,11,0.4)]',
    iconClass: 'text-amber-300',
    bar: 'from-amber-500 to-yellow-300',
  },
  unlock: {
    icon: Sparkles,
    frame: 'border-sky-400/60 shadow-[0_0_28px_rgba(56,189,248,0.35)]',
    iconClass: 'text-sky-300',
    bar: 'from-sky-500 to-cyan-300',
  },
  coins: {
    icon: Coins,
    frame: 'border-yellow-400/60 shadow-[0_0_24px_rgba(250,204,21,0.35)]',
    iconClass: 'text-yellow-300',
    bar: 'from-yellow-500 to-amber-300',
  },
  info: {
    icon: Star,
    frame: 'border-white/30 shadow-[0_0_20px_rgba(255,255,255,0.15)]',
    iconClass: 'text-neutral-200',
    bar: 'from-neutral-400 to-neutral-200',
  },
};

/** Stacked, auto-expiring progression notifications (level / unlock / achievement). */
export const ProgressionToasts: React.FC<{ toasts: ProgressToast[] }> = ({ toasts }) => {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const style = STYLES[toast.kind];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={`min-w-[240px] max-w-[92vw] rounded-xl bg-[#0d0f15]/95 backdrop-blur-md border px-4 py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-200 ${style.frame}`}
          >
            <div className={`p-2 rounded-lg bg-white/5 shrink-0 ${style.iconClass}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black tracking-wider text-white uppercase font-mono truncate">
                {toast.title}
              </div>
              {toast.body && (
                <div className="text-[11px] text-neutral-400 font-mono truncate">{toast.body}</div>
              )}
            </div>
            <div className={`self-stretch w-1 rounded-full bg-gradient-to-b ${style.bar}`} />
          </div>
        );
      })}
    </div>
  );
};
