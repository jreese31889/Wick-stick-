import React, { useRef, useState, useCallback } from 'react';
import { InputManager } from '../engine/InputManager';
import {
  Shield,
  Wind,
  HandGrab,
  HandFist,
  Footprints,
  ArrowUp,
  Crosshair,
  RotateCcw,
  Sword,
  LogIn,
  Flame,
} from 'lucide-react';
import { WeaponType } from '../types/game';

interface VirtualControlsProps {
  inputManager: InputManager;
  equippedWeapon?: WeaponType;
  nearDoor?: boolean;
}

type TouchButton =
  | 'jump'
  | 'dodge'
  | 'attack'
  | 'heavy'
  | 'block'
  | 'grab'
  | 'shoot'
  | 'reload'
  | 'interact'
  | 'focus';

// Shared shell: thumb-sized circular button with press feedback.
const BTN =
  'relative flex flex-col items-center justify-center rounded-full backdrop-blur-sm ' +
  'transition-transform active:scale-90 touch-none select-none pointer-events-auto shadow-lg';

const UTILITY = 'w-11 h-11 sm:w-12 sm:h-12 portrait:w-10 portrait:h-10';
const COMBAT = 'w-14 h-14 sm:w-16 sm:h-16 portrait:w-12 portrait:h-12';
const HERO = 'w-20 h-20 sm:w-24 sm:h-24 landscape:w-24 landscape:h-24 portrait:w-16 portrait:h-16';

const UTILITY_ICON = 'w-4 h-4 sm:w-5 sm:h-5';
const COMBAT_ICON = 'w-5 h-5 sm:w-6 sm:h-6';
const HERO_ICON = 'w-7 h-7 sm:w-8 sm:h-8';

const UTILITY_LABEL = 'text-[7px] sm:text-[8px] font-bold uppercase tracking-wider mt-0.5';
const COMBAT_LABEL = 'text-[9px] sm:text-[10px] font-bold uppercase tracking-wide mt-0.5';
const HERO_LABEL = 'text-[11px] sm:text-[13px] font-black uppercase tracking-[0.15em] mt-0.5';

export const VirtualControls: React.FC<VirtualControlsProps> = ({
  inputManager,
  equippedWeapon,
  nearDoor,
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
  const bindTouchButton = (button: TouchButton) => ({
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
    <div className="absolute inset-0 pointer-events-none select-none touch-none z-20">
      {/* ============================================================
          LEFT — MOVEMENT: floating 360° thumb joystick, bottom-left
      ============================================================ */}
      <div className="absolute left-0 bottom-0 flex items-end p-3 sm:p-4">
        <div
          id="virtual-joystick"
          ref={joystickBaseRef}
          onTouchStart={handleJoystickStart}
          onTouchMove={handleJoystickMove}
          onTouchEnd={handleJoystickEnd}
          onTouchCancel={handleJoystickEnd}
          className={
            'w-32 h-32 sm:w-40 sm:h-40 landscape:w-36 landscape:h-36 portrait:w-28 portrait:h-28 ' +
            'rounded-full border-2 border-white/20 bg-black/45 backdrop-blur-md flex items-center ' +
            'justify-center pointer-events-auto active:border-amber-400/40 transition-colors shadow-2xl relative'
          }
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
            className="w-14 h-14 sm:w-16 sm:h-16 landscape:w-16 landscape:h-16 rounded-full bg-gradient-to-br from-neutral-200 to-neutral-400 border border-white/60 shadow-lg flex items-center justify-center pointer-events-none"
          >
            <div className="w-5 h-5 rounded-full bg-neutral-900/40 border border-white/40" />
          </div>
        </div>
      </div>

      {/* ============================================================
          RIGHT — ACTIONS: stacked thumb rows, bottom-right
          Row 1 (heroes): PUNCH + KICK — the biggest targets on screen
          Row 2 (combat): BLOCK / DODGE / JUMP / SHOOT
          Row 3 (utility): FOCUS / ACTION / RELOAD / GRAB
      ============================================================ */}
      <div className="absolute right-0 bottom-0 flex flex-col items-end gap-2 landscape:gap-2.5 p-3 sm:p-4 pointer-events-auto">
        {/* HERO ROW — impossible to miss */}
        <div className="flex items-end gap-3 sm:gap-4">
          <button
            id="btn-punch"
            {...bindTouchButton('attack')}
            aria-label="Punch"
            className={
              `${BTN} ${HERO} border-2 border-rose-200/70 text-white font-black ` +
              'bg-gradient-to-br from-red-500 via-rose-600 to-rose-800 ' +
              'shadow-[0_6px_24px_rgba(225,29,72,0.55)] active:from-red-600 active:to-rose-900'
            }
          >
            <HandFist className={`${HERO_ICON} fill-current drop-shadow`} />
            <span className={HERO_LABEL}>PUNCH</span>
            <span className="absolute top-1.5 right-2 text-[8px] font-mono px-1 rounded bg-black/70 border border-white/40 text-white">
              X
            </span>
          </button>

          <button
            id="btn-kick"
            {...bindTouchButton('heavy')}
            aria-label="Kick"
            className={
              `${BTN} ${HERO} border-2 border-amber-200/70 text-white font-black ` +
              'bg-gradient-to-br from-amber-500 via-orange-600 to-orange-800 ' +
              'shadow-[0_6px_24px_rgba(249,115,22,0.55)] active:from-amber-600 active:to-orange-900'
            }
          >
            <Footprints className={`${HERO_ICON} fill-current drop-shadow`} />
            <span className={HERO_LABEL}>KICK</span>
            <span className="absolute top-1.5 right-2 text-[8px] font-mono px-1 rounded bg-black/70 border border-amber-200/60 text-amber-100">
              Y
            </span>
          </button>
        </div>

        {/* COMBAT ROW — core defensive / mobility / gunplay actions */}
        <div className="flex items-end gap-2 sm:gap-2.5">
          <button
            id="btn-block"
            {...bindTouchButton('block')}
            aria-label="Block"
            className={`${BTN} ${COMBAT} rounded-2xl bg-neutral-900/85 border border-blue-500/50 text-blue-300 active:bg-blue-600/50`}
          >
            <Shield className={COMBAT_ICON} />
            <span className={COMBAT_LABEL}>Block</span>
            <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-blue-400/40 text-blue-300">
              LB
            </span>
          </button>

          <button
            id="btn-dodge"
            {...bindTouchButton('dodge')}
            aria-label="Dodge"
            className={`${BTN} ${COMBAT} rounded-2xl bg-neutral-900/85 border border-emerald-500/50 text-emerald-300 active:bg-emerald-600/50`}
          >
            <Wind className={COMBAT_ICON} />
            <span className={COMBAT_LABEL}>Dodge</span>
            <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-emerald-400/40 text-emerald-300">
              B
            </span>
          </button>

          <button
            id="btn-jump"
            {...bindTouchButton('jump')}
            aria-label="Jump"
            className={`${BTN} ${COMBAT} rounded-2xl bg-neutral-900/85 border border-sky-500/50 text-sky-300 active:bg-sky-600/50`}
          >
            <ArrowUp className={COMBAT_ICON} />
            <span className={COMBAT_LABEL}>Jump</span>
            <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-sky-400/40 text-sky-300">
              A
            </span>
          </button>

          <button
            id="btn-shoot"
            {...bindTouchButton('shoot')}
            aria-label="Shoot"
            className={
              `${BTN} ${COMBAT} rounded-2xl border-2 border-amber-300/80 text-amber-100 ` +
              'bg-gradient-to-br from-amber-600 to-yellow-700 active:from-amber-700 active:to-yellow-800 ' +
              'shadow-xl'
            }
          >
            <Crosshair className={COMBAT_ICON} />
            <span className={COMBAT_LABEL}>Shoot</span>
            <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-amber-300/80 text-amber-200">
              RT
            </span>
          </button>
        </div>

        {/* UTILITY ROW — situational actions, compact but still ≥44px */}
        <div className="flex items-end gap-2">
          <button
            id="btn-focus"
            {...bindTouchButton('focus')}
            aria-label="Focus"
            className={`${BTN} ${UTILITY} bg-amber-500/20 border border-amber-400/50 text-amber-300 active:bg-amber-500/40`}
          >
            <Flame className={`${UTILITY_ICON} text-amber-400 animate-pulse`} />
            <span className={UTILITY_LABEL}>Focus</span>
          </button>

          <button
            id="btn-interact"
            {...bindTouchButton('interact')}
            aria-label="Action"
            className={`${BTN} ${UTILITY} border ${
              equippedWeapon === 'KNIFE'
                ? 'bg-amber-900/80 border-amber-400 text-amber-200 animate-pulse'
                : nearDoor
                ? 'bg-emerald-900/80 border-emerald-400 text-emerald-200 animate-bounce'
                : 'bg-neutral-900/80 border-neutral-600/40 text-neutral-300'
            }`}
          >
            {equippedWeapon === 'KNIFE' ? (
              <Sword className={`${UTILITY_ICON} text-amber-300`} />
            ) : nearDoor ? (
              <LogIn className={`${UTILITY_ICON} text-emerald-300`} />
            ) : (
              <Sword className={UTILITY_ICON} />
            )}
            <span className={UTILITY_LABEL}>
              {equippedWeapon === 'KNIFE' ? 'Throw' : nearDoor ? 'Enter' : 'Action'}
            </span>
          </button>

          <button
            id="btn-reload"
            {...bindTouchButton('reload')}
            aria-label="Reload"
            className={`${BTN} ${UTILITY} bg-neutral-900/80 border border-neutral-600/40 text-neutral-300 active:bg-neutral-700/50`}
          >
            <RotateCcw className={UTILITY_ICON} />
            <span className={UTILITY_LABEL}>Reload</span>
            <span className="absolute -top-1.5 -right-1 text-[7px] font-mono px-1 rounded bg-black/80 border border-white/20 text-neutral-400">
              LT
            </span>
          </button>

          <button
            id="btn-grab"
            {...bindTouchButton('grab')}
            aria-label="Grab"
            className={`${BTN} ${UTILITY} bg-neutral-900/80 border border-amber-500/40 text-amber-300 active:bg-amber-600/40`}
          >
            <HandGrab className={UTILITY_ICON} />
            <span className={UTILITY_LABEL}>Grab</span>
            <span className="absolute -top-1.5 -right-1 text-[7px] font-mono px-1 rounded bg-black/80 border border-amber-400/40 text-amber-300">
              RB
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
