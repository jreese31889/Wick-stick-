import React from 'react';
import { X, Gamepad2, Smartphone, Zap, Crosshair, Shield } from 'lucide-react';

interface HowToPlayModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Real bindings, copied from InputManager.ts (touch virtual buttons via
// VirtualControls.tsx `bindTouchButton`, Type-C gamepad button indices in
// InputManager.poll) — the game has no keyboard bindings.
const BINDINGS: { action: string; touch: string; gamepad: string }[] = [
  { action: 'Move', touch: 'Left-thumb joystick', gamepad: 'Left stick / D-pad' },
  { action: 'Punch', touch: 'PUNCH button (big, bottom right)', gamepad: 'X (Square)' },
  { action: 'Kick', touch: 'KICK button (big, bottom right)', gamepad: 'Y (Triangle)' },
  { action: 'Combo finisher', touch: 'Chain 5+ hits, then strike', gamepad: 'Chain 5+ hits, then strike' },
  { action: 'Dodge roll', touch: 'DODGE button', gamepad: 'B (Circle)' },
  { action: 'Block', touch: 'BLOCK button', gamepad: 'LB (L1)' },
  { action: 'Parry', touch: 'Tap BLOCK just before impact', gamepad: 'Tap LB just before impact' },
  { action: 'Shoot gun', touch: 'SHOOT button', gamepad: 'RT (R2)' },
  { action: 'Grab / takedown', touch: 'GRAB button', gamepad: 'RB (R1)' },
  { action: 'Jump', touch: 'JUMP button', gamepad: 'A (Cross)' },
  { action: 'Reload', touch: 'RELOAD button', gamepad: 'LT (L2)' },
  { action: 'Swap firearm', touch: 'SWAP button', gamepad: 'L3 (left stick click)' },
  { action: 'Bullet-time focus', touch: 'FOCUS button', gamepad: 'Select / R3' },
  { action: 'Action / enter door', touch: 'ACTION / ENTER button', gamepad: 'A or RT (contextual)' },
  { action: 'Pause', touch: 'Pause button (top right)', gamepad: 'Start / Menu' },
];

const TIPS: { icon: typeof Zap; text: string }[] = [
  { icon: Shield, text: 'Perfect parry: tap BLOCK the instant before a hit lands to stun the attacker in slow motion.' },
  { icon: Crosshair, text: 'Point-blank: tap SHOOT within 95px of an enemy for a slow-mo execution shot.' },
  { icon: Zap, text: 'Combos: chain hits inside the timing window — damage scales +5% per hit and every 5 hits loads a FINISHER.' },
  { icon: Zap, text: 'Guard break: enemies flashing GUARD fall to KICK strikes or a well-timed slide.' },
];

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-md w-full bg-[#0d0f15] border border-amber-500/40 rounded-2xl p-4 sm:p-5 shadow-[0_0_60px_rgba(245,158,11,0.25)] flex flex-col gap-3.5 text-neutral-200 max-h-[88vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-600/30 border border-amber-400/40 flex items-center justify-center">
              <Gamepad2 className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black tracking-widest text-amber-300 uppercase font-mono">
                How to Play
              </h2>
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                John Stick combat controls
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bindings grid */}
        <div className="grid grid-cols-[minmax(0,5.75rem)_1fr_1fr] gap-x-3 gap-y-2 text-[11px] font-mono leading-snug">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold pb-1 border-b border-white/10">
            Action
          </div>
          <div className="text-[10px] uppercase tracking-wider text-sky-400/90 font-bold pb-1 border-b border-white/10 flex items-center gap-1">
            <Smartphone className="w-3 h-3" /> Touch
          </div>
          <div className="text-[10px] uppercase tracking-wider text-emerald-400/90 font-bold pb-1 border-b border-white/10 flex items-center gap-1">
            <Gamepad2 className="w-3 h-3" /> Gamepad
          </div>
          {BINDINGS.map((b) => (
            <React.Fragment key={b.action}>
              <div className="text-neutral-100 font-bold">{b.action}</div>
              <div className="text-sky-300">{b.touch}</div>
              <div className="text-emerald-300">{b.gamepad}</div>
            </React.Fragment>
          ))}
        </div>

        {/* Combat tips */}
        <div className="bg-black/50 border border-white/10 rounded-xl p-3 space-y-2">
          {TIPS.map((tip, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] font-mono text-neutral-300 leading-snug">
              <tip.icon className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>{tip.text}</span>
            </div>
          ))}
        </div>

        <p className="text-[10px] font-mono text-neutral-500 text-center leading-relaxed">
          John Stick runs on touch controls or a Type-C gamepad (Backbone / Kishi / GameSir / Xbox). No keyboard bindings.
        </p>

        <button
          onClick={onClose}
          className="w-full min-h-[44px] py-2.5 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black rounded-xl text-xs font-black uppercase tracking-wider transition-colors shadow-lg cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  );
};
