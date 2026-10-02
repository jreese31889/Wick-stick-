import React, { useRef, useState, useCallback } from 'react';
import { InputManager } from '../engine/InputManager';
import { Shield, Zap, Sparkles, Wind, Hand, ArrowUp, Crosshair, RotateCcw, Sword, LogIn, Flame } from 'lucide-react';
import { WeaponType } from '../types/game';

interface VirtualControlsProps {
  inputManager: InputManager;
  equippedWeapon?: WeaponType;
  nearDoor?: boolean;
}

export const VirtualControls: React.FC<VirtualControlsProps> = ({
  inputManager,
  equippedWeapon,
  nearDoor
}) => {
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickKnobRef = useRef<HTMLDivElement>(null);

  const [touchId, setTouchId] = useState<number | null>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });

  // Joystick touch handlers (Mobile touch-only)
  const handleJoystickStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (touchId !== null) return;
    const touch = e.changedTouches[0];
    setTouchId(touch.identifier);
    updateJoystick(touch.clientX, touch.clientY);
  }, [touchId]);

  const handleJoystickMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === touchId) {
        updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }, [touchId]);

  const handleJoystickEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        setTouchId(null);
        setKnobPos({ x: 0, y: 0 });
        inputManager.setVirtualJoystick(0, 0);
        break;
      }
    }
  }, [touchId, inputManager]);

  const updateJoystick = (clientX: number, clientY: number) => {
    if (!joystickBaseRef.current) return;
    const rect = joystickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const maxRadius = rect.width * 0.42;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;

    setKnobPos({ x: kx, y: ky });

    // Normalized output (-1 to 1)
    const normX = kx / maxRadius;
    const normY = ky / maxRadius;
    inputManager.setVirtualJoystick(normX, normY);
  };

  // Pure mobile touch button binder (No mouse listeners)
  const bindTouchButton = (button: 'jump' | 'dodge' | 'attack' | 'heavy' | 'block' | 'grab' | 'shoot' | 'reload' | 'interact' | 'focus') => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault();
      inputManager.setVirtualButton(button, true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(15);
        } catch {
          // safe
        }
      }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault();
      inputManager.setVirtualButton(button, false);
    },
    onTouchCancel: (e: React.TouchEvent) => {
      e.preventDefault();
      inputManager.setVirtualButton(button, false);
    },
  });

  return (
    <div className="absolute inset-0 pointer-events-none select-none touch-none z-20 flex justify-between p-3 sm:p-5 pb-6">
      {/* LEFT: VIRTUAL JOYSTICK */}
      <div className="flex items-end pb-1">
        <div
          id="virtual-joystick"
          ref={joystickBaseRef}
          onTouchStart={handleJoystickStart}
          onTouchMove={handleJoystickMove}
          onTouchEnd={handleJoystickEnd}
          onTouchCancel={handleJoystickEnd}
          className="w-36 h-36 sm:w-44 sm:h-44 rounded-full border-2 border-white/20 bg-black/45 backdrop-blur-md flex items-center justify-center pointer-events-auto active:border-amber-400/40 transition-colors shadow-2xl relative"
        >
          {/* Subtle directional indicators */}
          <div className="absolute top-2 w-1.5 h-3 bg-white/25 rounded-full" />
          <div className="absolute bottom-2 w-1.5 h-3 bg-white/25 rounded-full" />
          <div className="absolute left-2 w-3 h-1.5 bg-white/25 rounded-full" />
          <div className="absolute right-2 w-3 h-1.5 bg-white/25 rounded-full" />

          {/* Stick Knob */}
          <div
            ref={joystickKnobRef}
            style={{ transform: `translate(${knobPos.x}px, ${knobPos.y}px)` }}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-neutral-200 to-neutral-400 border border-white/60 shadow-lg flex items-center justify-center pointer-events-none"
          >
            <div className="w-6 h-6 rounded-full bg-neutral-900/40 border border-white/40" />
          </div>
        </div>
      </div>

      {/* RIGHT: TOUCH COMBAT CLUSTER */}
      <div className="flex flex-col items-end justify-end pb-1 pointer-events-auto">
        {/* TOP ROW: Tactical Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5 mb-2.5">
          {/* FOCUS / BULLET-TIME RAGE */}
          <button
            id="btn-focus"
            {...bindTouchButton('focus')}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 active:scale-90 active:bg-amber-500/40 transition-transform flex flex-col items-center justify-center shadow-lg backdrop-blur-sm"
          >
            <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400 animate-pulse" />
            <span className="text-[8px] font-bold uppercase tracking-wider mt-0.5">Focus</span>
          </button>

          {/* INTERACT / KNIFE THROW */}
          <button
            id="btn-interact"
            {...bindTouchButton('interact')}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full border transition-all flex flex-col items-center justify-center shadow-lg backdrop-blur-sm active:scale-90 ${
              equippedWeapon === 'KNIFE'
                ? 'bg-amber-900/80 border-amber-400 text-amber-200 animate-pulse'
                : nearDoor
                ? 'bg-emerald-900/80 border-emerald-400 text-emerald-200 animate-bounce'
                : 'bg-neutral-900/80 border-neutral-600/40 text-neutral-300'
            }`}
          >
            {equippedWeapon === 'KNIFE' ? (
              <Sword className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300" />
            ) : nearDoor ? (
              <LogIn className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-300" />
            ) : (
              <Sword className="w-4 h-4 sm:w-5 sm:h-5" />
            )}
            <span className="text-[8px] font-semibold uppercase tracking-wider mt-0.5">
              {equippedWeapon === 'KNIFE' ? 'Throw' : nearDoor ? 'Enter' : 'Action'}
            </span>
          </button>

          {/* RELOAD */}
          <button
            id="btn-reload"
            {...bindTouchButton('reload')}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-neutral-900/80 border border-neutral-600/40 text-neutral-300 active:scale-90 active:bg-neutral-700/50 transition-transform flex flex-col items-center justify-center shadow-lg backdrop-blur-sm relative"
          >
            <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-[8px] font-semibold uppercase tracking-wider mt-0.5">Reload</span>
            <span className="absolute -top-1.5 -right-1 text-[8px] font-mono px-1 rounded bg-black/80 border border-white/20 text-neutral-400">LT</span>
          </button>

          {/* GRAB / TAKEDOWN */}
          <button
            id="btn-grab"
            {...bindTouchButton('grab')}
            className="w-13 h-13 sm:w-15 sm:h-15 rounded-full bg-neutral-900/80 border border-amber-500/40 text-amber-300 active:scale-90 active:bg-amber-600/40 transition-transform flex flex-col items-center justify-center shadow-lg backdrop-blur-sm relative"
          >
            <Hand className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="text-[9px] font-semibold uppercase tracking-wider mt-0.5">Grab</span>
            <span className="absolute -top-1.5 -right-1 text-[8px] font-mono px-1 rounded bg-black/80 border border-amber-400/40 text-amber-300">RB</span>
          </button>

          {/* JUMP */}
          <button
            id="btn-jump"
            {...bindTouchButton('jump')}
            className="w-13 h-13 sm:w-15 sm:h-15 rounded-full bg-neutral-900/80 border border-sky-500/40 text-sky-300 active:scale-90 active:bg-sky-600/40 transition-transform flex flex-col items-center justify-center shadow-lg backdrop-blur-sm relative"
          >
            <ArrowUp className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="text-[9px] font-semibold uppercase tracking-wider mt-0.5">Jump</span>
            <span className="absolute -top-1.5 -right-1 text-[8px] font-mono px-1 rounded bg-black/80 border border-sky-400/40 text-sky-300">A</span>
          </button>

          {/* FIRE / SHOT */}
          <button
            id="btn-shoot"
            {...bindTouchButton('shoot')}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-amber-600 to-yellow-700 border-2 border-amber-300/80 text-amber-100 active:scale-90 active:from-amber-700 active:to-yellow-800 transition-transform flex flex-col items-center justify-center shadow-xl backdrop-blur-sm relative"
          >
            <Crosshair className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">Shoot</span>
            <span className="absolute -top-1.5 -right-1 text-[8px] font-mono px-1 rounded bg-black/80 border border-amber-300/80 text-amber-200">RT</span>
          </button>
        </div>

        {/* BOTTOM CLUSTER: Core Combat Quadrant (Block, Dodge, Attack, Heavy) */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
          {/* BLOCK */}
          <button
            id="btn-block"
            {...bindTouchButton('block')}
            className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-neutral-900/85 border border-blue-500/50 text-blue-300 active:scale-90 active:bg-blue-600/50 transition-transform flex flex-col items-center justify-center shadow-xl backdrop-blur-sm relative"
          >
            <Shield className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-[11px] font-semibold uppercase tracking-wider mt-1">Block</span>
            <span className="absolute top-1.5 right-2 text-[8px] font-mono px-1 rounded bg-black/80 border border-blue-400/40 text-blue-300">LB</span>
          </button>

          {/* HEAVY ATTACK */}
          <button
            id="btn-heavy"
            {...bindTouchButton('heavy')}
            className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-neutral-900/85 border border-rose-500/50 text-rose-300 active:scale-90 active:bg-rose-600/50 transition-transform flex flex-col items-center justify-center shadow-xl backdrop-blur-sm relative"
          >
            <Sparkles className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-[11px] font-semibold uppercase tracking-wider mt-1">Heavy</span>
            <span className="absolute top-1.5 right-2 text-[8px] font-mono px-1 rounded bg-black/80 border border-rose-400/40 text-rose-300">Y</span>
          </button>

          {/* DODGE / SLIDE */}
          <button
            id="btn-dodge"
            {...bindTouchButton('dodge')}
            className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-neutral-900/85 border border-emerald-500/50 text-emerald-300 active:scale-90 active:bg-emerald-600/50 transition-transform flex flex-col items-center justify-center shadow-xl backdrop-blur-sm relative"
          >
            <Wind className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-[11px] font-semibold uppercase tracking-wider mt-1">Dodge</span>
            <span className="absolute top-1.5 right-2 text-[8px] font-mono px-1 rounded bg-black/80 border border-emerald-400/40 text-emerald-300">B</span>
          </button>

          {/* LIGHT ATTACK (Primary Big Strike Button) */}
          <button
            id="btn-attack"
            {...bindTouchButton('attack')}
            className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-gradient-to-br from-red-600 to-rose-800 border-2 border-rose-300 text-white active:scale-90 active:from-red-700 active:to-rose-900 transition-transform flex flex-col items-center justify-center shadow-2xl font-bold relative"
          >
            <Zap className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
            <span className="text-[11px] font-bold uppercase tracking-wider mt-1">Strike</span>
            <span className="absolute top-1.5 right-2 text-[9px] font-mono px-1 rounded bg-black/80 border border-white/40 text-white">X</span>
          </button>
        </div>
      </div>
    </div>
  );
};
