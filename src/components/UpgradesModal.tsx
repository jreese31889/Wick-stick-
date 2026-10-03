import React from 'react';
import { X, Coins, Check, Lock, Sword, Heart, Footprints, Eye } from 'lucide-react';
import { UPGRADES, upgradeCost, type UpgradeId } from '../profile/Catalogs';
import type { GameProfile } from '../profile/ProfileStore';

interface UpgradesModalProps {
  isOpen: boolean;
  profile: GameProfile;
  /** Total spendable: banked profile coins + un-swept run purse. */
  spendable: number;
  onBuy: (id: UpgradeId) => void;
  onClose: () => void;
}

const ICONS: Record<UpgradeId, typeof Sword> = {
  damage: Sword,
  health: Heart,
  speed: Footprints,
  focus: Eye,
};

/** PHASE 2: persistent upgrade shop — tiers are bought with banked coins. */
export const UpgradesModal: React.FC<UpgradesModalProps> = ({
  isOpen,
  profile,
  spendable,
  onBuy,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="safe-top safe-bottom safe-left safe-right fixed inset-0 z-[75] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-2xl w-full bg-[#0d0f15] border border-amber-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(245,158,11,0.2)] flex flex-col gap-4 text-neutral-200 relative menu-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-600/30 border border-amber-400/40 flex items-center justify-center shadow-lg">
              <Sword className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wider text-amber-300 uppercase font-mono">
                Safehouse Upgrades
              </h2>
              <p className="text-xs text-neutral-400">
                Permanent training — tiers carry across every contract
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

        {/* Balance */}
        <div className="flex items-center justify-between bg-black/50 border border-amber-500/20 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Coins className="w-5 h-5 text-yellow-400" />
            <div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-neutral-400">
                Specie Balance
              </div>
              <div className="text-lg font-black font-mono text-amber-300">
                {spendable} <span className="text-xs font-normal text-amber-400/80">GOLD COINS</span>
              </div>
            </div>
          </div>
          <div className="text-[11px] font-mono text-neutral-400 text-right max-w-[45%]">
            Coins from the field bank automatically on every wave clear.
          </div>
        </div>

        {/* Upgrade grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[56vh] overflow-y-auto pr-1">
          {UPGRADES.map((def) => {
            const tier = profile.upgrades[def.id] ?? 0;
            const maxed = tier >= def.maxTiers;
            const cost = upgradeCost(def.id, tier);
            const canAfford = spendable >= cost;
            const Icon = ICONS[def.id];

            return (
              <div
                key={def.id}
                className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                  maxed
                    ? 'bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.12)]'
                    : canAfford
                    ? 'bg-neutral-900/90 border-amber-500/30 hover:border-amber-400 shadow-md'
                    : 'bg-neutral-900/40 border-white/5 opacity-75'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2.5 rounded-xl shrink-0 ${
                      maxed
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-neutral-100 truncate">{def.name}</span>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-neutral-400 shrink-0">
                        {def.statLabel}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-300 mt-1 leading-relaxed">{def.blurb}</p>
                    <div className="text-[11px] font-mono text-amber-300/90 mt-1.5">
                      {def.effectText}
                    </div>
                    {/* Tier pips */}
                    <div className="flex items-center gap-1 mt-2">
                      {Array.from({ length: def.maxTiers }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-1.5 flex-1 rounded-full ${
                            i < tier ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'bg-neutral-800'
                          }`}
                        />
                      ))}
                      <span className="text-[10px] font-mono text-neutral-400 ml-1">
                        {tier}/{def.maxTiers}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-auto">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-amber-400">
                    <Coins className="w-3.5 h-3.5 text-yellow-400" />
                    <span>{maxed ? 'MAX TIER' : `${cost} COINS`}</span>
                  </div>
                  {maxed ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold font-mono">
                      <Check className="w-3.5 h-3.5" />
                      MAXED
                    </div>
                  ) : (
                    <button
                      disabled={!canAfford}
                      onClick={() => onBuy(def.id)}
                      className={`px-4 py-1.5 min-h-[44px] rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 ${
                        canAfford
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black shadow-lg cursor-pointer active:scale-95'
                          : 'bg-white/5 text-neutral-500 cursor-not-allowed border border-white/5'
                      }`}
                    >
                      {canAfford ? (
                        <>
                          <Sword className="w-3.5 h-3.5" />
                          UPGRADE
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          NEED {cost - spendable}
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono text-neutral-400">
          <span className="text-[11px]">Speed, Focus and loadout perks apply on the next run.</span>
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
