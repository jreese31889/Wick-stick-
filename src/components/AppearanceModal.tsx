import React from 'react';
import { X, Lock, Check, Hand, Crosshair, Sword, Target, Shirt, Palette } from 'lucide-react';
import {
  SKIN_PALETTES,
  TINT_PALETTES,
  UNLOCK_MAP,
  ACHIEVEMENT_MAP,
} from '../profile/Catalogs';
import type { GameProfile } from '../profile/ProfileStore';
import { DEFAULT_PLAYER_PALETTE, DEFAULT_WEAPON_TINT } from '../engine/Palettes';

interface AppearanceModalProps {
  isOpen: boolean;
  profile: GameProfile;
  onSelectLoadout: (id: string) => void;
  onSelectSkin: (id: string) => void;
  onSelectTint: (id: string) => void;
  onClose: () => void;
}

const LOADOUTS: { id: string; name: string; blurb: string; icon: typeof Sword }[] = [
  { id: 'FISTS', name: 'FISTS', blurb: 'Brass knuckles', icon: Hand },
  { id: 'SMG', name: 'SMG', blurb: 'Run & gun', icon: Crosshair },
  { id: 'KATANA', name: 'KATANA', blurb: 'Melee pressure', icon: Sword },
  { id: 'SHOTGUN', name: 'SHOTGUN', blurb: 'Room clearer', icon: Target },
  { id: 'RIFLE', name: 'RIFLE', blurb: 'Precision fire', icon: Crosshair },
];

const SKIN_IDS = ['skin_classic', 'skin_noir', 'skin_golden', 'skin_arctic', 'skin_violet', 'skin_crimson', 'skin_phantom'];
const TINT_IDS = ['tint_steel', 'tint_gold', 'tint_chrome', 'tint_crimson'];

/** "LEVEL 3" / "REAPER" — how a locked item is earned. */
function requirementText(id: string): string {
  const def = UNLOCK_MAP[id];
  if (!def) return '';
  if (def.achievement !== undefined) {
    const ach = ACHIEVEMENT_MAP[def.achievement];
    return ach ? `ACHIEVE: ${ach.title}` : 'LOCKED';
  }
  if (def.level !== undefined) return `LEVEL ${def.level}`;
  return 'LOCKED';
}

/** PHASE 2: loadout + figure colourway + weapon-tint picker with live swatches. */
export const AppearanceModal: React.FC<AppearanceModalProps> = ({
  isOpen,
  profile,
  onSelectLoadout,
  onSelectSkin,
  onSelectTint,
  onClose,
}) => {
  if (!isOpen) return null;

  const isOwned = (id: string) => profile.unlocks.includes(id);

  const renderCard = (
    id: string,
    name: string,
    blurb: string,
    selected: boolean,
    onSelect: () => void,
    swatches: string[],
    icon: React.ReactNode
  ) => {
    const owned = isOwned(id);
    return (
      <button
        key={id}
        disabled={!owned}
        onClick={onSelect}
        className={`text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
          selected
            ? 'bg-amber-500/15 border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.25)]'
            : owned
            ? 'bg-neutral-900/80 border-white/10 hover:border-white/30'
            : 'bg-neutral-900/40 border-white/5 opacity-70 cursor-not-allowed'
        }`}
      >
        <div className="shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-xs text-neutral-100 font-mono tracking-wider truncate">
              {name}
            </span>
            {selected && <Check className="w-4 h-4 text-amber-300 shrink-0" />}
            {!owned && <Lock className="w-3.5 h-3.5 text-neutral-500 shrink-0" />}
          </div>
          <div className="text-[11px] text-neutral-400 truncate">
            {owned ? blurb : requirementText(id)}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            {swatches.map((c, i) => (
              <span
                key={i}
                className="w-4 h-4 rounded-sm border border-black/60"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div
      className="safe-top safe-bottom safe-left safe-right fixed inset-0 z-[75] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-2xl w-full bg-[#0d0f15] border border-sky-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(56,189,248,0.18)] flex flex-col gap-4 text-neutral-200 relative animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sky-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-600/30 border border-sky-400/40 flex items-center justify-center shadow-lg">
              <Shirt className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wider text-sky-300 uppercase font-mono">
                Wardrobe & Loadout
              </h2>
              <p className="text-xs text-neutral-400">Figure colourways, blade tints and sidearm</p>
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

        <div className="space-y-4 max-h-[62vh] overflow-y-auto pr-1">
          {/* Loadout */}
          <section>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-2">
              Starting Loadout
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {LOADOUTS.map((l) =>
                renderCard(
                  l.id,
                  l.name,
                  l.blurb,
                  profile.selectedLoadout === l.id,
                  () => onSelectLoadout(l.id),
                  [],
                  <l.icon className="w-5 h-5 text-amber-300" />
                )
              )}
            </div>
          </section>

          {/* Skins */}
          <section>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-2">
              Figure Colourway
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SKIN_IDS.map((id) => {
                const skin = { ...DEFAULT_PLAYER_PALETTE, ...(SKIN_PALETTES[id] ?? {}) };
                const def = UNLOCK_MAP[id];
                return renderCard(
                  id,
                  def?.name ?? id,
                  def?.description ?? '',
                  profile.selectedSkin === id,
                  () => onSelectSkin(id),
                  [skin.ivory, skin.ivoryBack, skin.tie],
                  <span className="flex items-center gap-0.5">
                    <span
                      className="w-4 h-8 rounded-l-md border border-black/60"
                      style={{ backgroundColor: skin.ivory }}
                    />
                    <span
                      className="w-4 h-8 border-y border-r border-black/60"
                      style={{ backgroundColor: skin.ivoryBack }}
                    />
                    <span
                      className="w-4 h-8 rounded-r-md border border-black/60"
                      style={{ backgroundColor: skin.tie }}
                    />
                  </span>
                );
              })}
            </div>
          </section>

          {/* Tints */}
          <section>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-2">
              <Palette className="w-3 h-3 inline mb-0.5 mr-1" />
              Weapon Tint
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TINT_IDS.map((id) => {
                const tint = { ...DEFAULT_WEAPON_TINT, ...(TINT_PALETTES[id] ?? {}) };
                const def = UNLOCK_MAP[id];
                return renderCard(
                  id,
                  def?.name ?? id,
                  def?.description ?? '',
                  profile.selectedTint === id,
                  () => onSelectTint(id),
                  [tint.grip, tint.guard, tint.blade],
                  <span className="flex items-center gap-0.5">
                    <span
                      className="w-3 h-8 rounded-l-md border border-black/60"
                      style={{ backgroundColor: tint.grip }}
                    />
                    <span
                      className="w-3 h-8 border-y border-r border-black/60"
                      style={{ backgroundColor: tint.guard }}
                    />
                    <span
                      className="w-3 h-8 rounded-r-md border border-black/60"
                      style={{ backgroundColor: tint.blade }}
                    />
                  </span>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono text-neutral-400">
          <span className="text-[11px]">Coloured items repaint John the moment you select them.</span>
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
