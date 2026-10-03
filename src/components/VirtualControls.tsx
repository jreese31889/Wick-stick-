import React, { useRef, useState, useCallback, useLayoutEffect, useEffect } from 'react';
import { InputManager } from '../engine/InputManager';
import { Haptics } from '../engine/Haptics';
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
  Repeat,
} from 'lucide-react';
import { WeaponType } from '../types/game';
import { PAD_BADGE } from './PadBindings';
import {
  LAYOUT_LIMIT,
  type TouchControlId,
  type TouchLayout,
  type TouchOffset,
} from './settings';

export interface VirtualControlsProps {
  inputManager: InputManager;
  equippedWeapon?: WeaponType;
  nearDoor?: boolean;
  /** PHASE 3 2: on-screen control size, 0.7–1.4 (1 = shipped size). */
  buttonScale?: number;
  /** PHASE 3 2: active touch layout; null = shipped default positions. */
  layout?: TouchLayout | null;
  /** PHASE 3 2: layout editor — controls become draggable, presses disabled. */
  editing?: boolean;
  /** PHASE 3 3: swipe gestures on the right-hand look area. */
  gesturesEnabled?: boolean;
  /** PHASE 3 2: control opacity, 40–100 (%). */
  opacity?: number;
  /** PHASE 3 2: called live while dragging a control (edit mode only). */
  onMoveControl?: (id: TouchControlId, offset: TouchOffset) => void;
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
  | 'focus'
  | 'swap';

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

/** PHASE 3 3 — look-area gesture thresholds (generous: no accidental fires). */
const FLICK_MIN_PX = 140;
const FLICK_MAX_MS = 320;
const FLICK_MIN_SPEED = 0.85; // px per ms
const TWO_FINGER_MAX_MS = 450;
const TWO_FINGER_DRIFT_PX = 30;

const EDIT_OUTLINE: React.CSSProperties = {
  outline: '2px dashed rgba(252, 211, 77, 0.85)',
  outlineOffset: '2px',
  cursor: 'grab',
};

interface SingleGesture {
  id: number;
  x: number;
  y: number;
  t: number;
}

interface DoubleGesture {
  t: number;
  points: { id: number; x: number; y: number }[];
  valid: boolean;
}

interface DragState {
  id: TouchControlId;
  pointerId: number;
  startX: number;
  startY: number;
  offX: number;
  offY: number;
}

/**
 * PHASE 3 2 — mirrors every control horizontally from its DEFAULT spot, so
 * "Southpaw-lefty" swaps the joystick and the action cluster for left-handed
 * players. Reads the live DOM (each control carries `data-control`) and
 * subtracts the offsets already applied to recover the default centres.
 */
export function computeMirroredOffsets(
  root: HTMLElement,
  current: TouchLayout | null
): Partial<Record<TouchControlId, TouchOffset>> {
  const out: Partial<Record<TouchControlId, TouchOffset>> = {};
  const width = root.clientWidth;
  if (width <= 0) return out;
  const nodes = root.querySelectorAll<HTMLElement>('[data-control]');
  nodes.forEach((el) => {
    const id = el.dataset.control as TouchControlId | undefined;
    if (!id) return;
    const rect = el.getBoundingClientRect();
    const applied = current?.offsets[id];
    const appliedPx = applied ? applied.x * width : 0;
    const defaultCenterX = rect.left + rect.width / 2 - appliedPx;
    const mirrored = (width - 2 * defaultCenterX) / width;
    const clamped = Math.min(LAYOUT_LIMIT, Math.max(-LAYOUT_LIMIT, mirrored));
    if (Math.abs(clamped) < 0.001 && !applied) return;
    out[id] = { x: clamped, y: applied ? applied.y : 0 };
  });
  return out;
}

export const VirtualControls: React.FC<VirtualControlsProps> = ({
  inputManager,
  equippedWeapon,
  nearDoor,
  buttonScale = 1,
  layout = null,
  editing = false,
  gesturesEnabled = true,
  opacity = 100,
  onMoveControl,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickKnobRef = useRef<HTMLDivElement>(null);

  // PHASE 1B B8: floating twin-stick AIM pad (bottom-centre). Its vector is
  // fed straight into InputManager.setVirtualAim → player.physics.aimAngle,
  // which is what switches fire from hip-fire to the precision aim model.
  const aimBaseRef = useRef<HTMLDivElement>(null);
  const aimKnobRef = useRef<HTMLDivElement>(null);

  const [touchId, setTouchId] = useState<number | null>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [aimTouchId, setAimTouchId] = useState<number | null>(null);
  const [aimKnobPos, setAimKnobPos] = useState({ x: 0, y: 0 });

  // PHASE 3 2: measured container — converts normalised offsets to pixels.
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // PHASE 3 2: never leave a scheduled drag frame behind on unmount.
  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    },
    []
  );

  const scale = buttonScale;

  /** Transform for one control: base transform + layout offset + size scale. */
  const ctlStyle = (id: TouchControlId, extraTransform?: string): React.CSSProperties => {
    const parts: string[] = [];
    if (extraTransform) parts.push(extraTransform);
    const off = size.w > 0 && size.h > 0 ? layout?.offsets[id] : undefined;
    if (off) parts.push(`translate(${off.x * size.w}px, ${off.y * size.h}px)`);
    if (scale !== 1) parts.push(`scale(${scale})`);
    return parts.length > 0 ? { transform: parts.join(' ') } : {};
  };

  /** Edit-mode affordance for the element the player grabs. */
  const editStyle: React.CSSProperties | undefined = editing ? EDIT_OUTLINE : undefined;

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
    // Screen-space travel of the knob; the knob transform lives inside the
    // scaled base, so it is divided back out before it is written.
    const vKx = Math.cos(angle) * clampedDist;
    const vKy = Math.sin(angle) * clampedDist;

    setKnobPos({ x: vKx / scale, y: vKy / scale });

    // Normalized output (-1 to 1)
    const normX = vKx / maxRadius;
    const normY = vKy / maxRadius;
    inputManager.setVirtualJoystick(normX, normY);
  };

  // PHASE 1B B8: the aim pad drives the twin-stick aim vector. Past ~18% of
  // the pad radius it counts as a live aim (aimActive), so resting a thumb
  // on the pad doesn't lock the player into precision aim.
  const handleAimStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (aimTouchId !== null) return;
      const touch = e.changedTouches[0];
      setAimTouchId(touch.identifier);
      updateAim(touch.clientX, touch.clientY);
    },
    [aimTouchId]
  );

  const handleAimMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === aimTouchId) {
          updateAim(touch.clientX, touch.clientY);
          break;
        }
      }
    },
    [aimTouchId]
  );

  const handleAimEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === aimTouchId) {
          setAimTouchId(null);
          setAimKnobPos({ x: 0, y: 0 });
          inputManager.setVirtualAim(0, 0, false);
          break;
        }
      }
    },
    [aimTouchId, inputManager]
  );

  const updateAim = (clientX: number, clientY: number) => {
    if (!aimBaseRef.current) return;
    const rect = aimBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const maxRadius = rect.width * 0.42;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);
    const vKx = Math.cos(angle) * clampedDist;
    const vKy = Math.sin(angle) * clampedDist;
    setAimKnobPos({ x: vKx / scale, y: vKy / scale });

    const normX = vKx / maxRadius;
    const normY = vKy / maxRadius;
    const active = Math.hypot(normX, normY) > 0.18;
    inputManager.setVirtualAim(normX, normY, active);
  };

  // Pure mobile touch button binder (No mouse listeners)
  const bindTouchButton = (button: TouchButton) =>
    editing
      ? {}
      : {
          onTouchStart: (e: React.TouchEvent) => {
            e.preventDefault();
            inputManager.setVirtualButton(button, true);
            Haptics.cue('tick');
          },
          onTouchEnd: (e: React.TouchEvent) => {
            e.preventDefault();
            inputManager.setVirtualButton(button, false);
          },
          onTouchCancel: (e: React.TouchEvent) => {
            e.preventDefault();
            inputManager.setVirtualButton(button, false);
          },
        };

  /* ------------------------------------------------------------------ */
  /* PHASE 3 2 — layout editor drag (pointer capture, one gesture)      */
  /* ------------------------------------------------------------------ */
  const dragRef = useRef<DragState | null>(null);

  const beginDrag =
    (id: TouchControlId) => (e: React.PointerEvent<HTMLElement>) => {
      if (!editing) return;
      const el = e.currentTarget;
      if (el.setPointerCapture) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // Pointer already gone — the next move simply won't land.
        }
      }
      const applied = size.w > 0 && size.h > 0 ? layout?.offsets[id] : undefined;
      dragRef.current = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offX: applied ? applied.x * size.w : 0,
        offY: applied ? applied.y * size.h : 0,
      };
    };

  const pendingDrag = useRef<{ id: TouchControlId; x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const flushDrag = () => {
    dragFrameRef.current = null;
    const next = pendingDrag.current;
    if (!next) return;
    pendingDrag.current = null;
    onMoveControl?.(next.id, { x: next.x, y: next.y });
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId || size.w <= 0 || size.h <= 0) return;
    const nx = (d.offX + (e.clientX - d.startX)) / size.w;
    const ny = (d.offY + (e.clientY - d.startY)) / size.h;
    pendingDrag.current = {
      id: d.id,
      x: Math.min(LAYOUT_LIMIT, Math.max(-LAYOUT_LIMIT, nx)),
      y: Math.min(LAYOUT_LIMIT, Math.max(-LAYOUT_LIMIT, ny)),
    };
    // Coalesce pointermove bursts into one layout update per frame — a drag
    // must not re-render the whole App on every hardware event.
    if (dragFrameRef.current === null) {
      dragFrameRef.current = requestAnimationFrame(flushDrag);
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      dragRef.current = null;
      // Flush whatever the last frame produced so the drop lands where it was.
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      flushDrag();
    }
  };

  const dragHandlers = (id: TouchControlId) =>
    editing
      ? {
          onPointerDown: beginDrag(id),
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
        }
      : {};

  /* ------------------------------------------------------------------ */
  /* PHASE 3 3 — swipe gestures on the look area                        */
  /* Flick right = swap · flick down = reload · two-finger tap = focus   */
  /* ------------------------------------------------------------------ */
  const singleRef = useRef<SingleGesture | null>(null);
  const doubleRef = useRef<DoubleGesture | null>(null);

  const onGestureStart = (e: React.TouchEvent) => {
    if (!gesturesEnabled || editing) {
      // Disabled mid-gesture (or the editor opened) — never strand a ref.
      singleRef.current = null;
      doubleRef.current = null;
      return;
    }
    const touches = e.targetTouches;
    if (touches.length === 1) {
      if (doubleRef.current) return;
      const t = touches[0];
      singleRef.current = {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        t: performance.now(),
      };
    } else if (touches.length >= 2) {
      singleRef.current = null;
      if (!doubleRef.current) {
        const points: { id: number; x: number; y: number }[] = [];
        for (let i = 0; i < Math.min(touches.length, 2); i++) {
          const t = touches[i];
          points.push({ id: t.identifier, x: t.clientX, y: t.clientY });
        }
        doubleRef.current = { t: performance.now(), points, valid: true };
      }
    }
  };

  const onGestureMove = (e: React.TouchEvent) => {
    const dbl = doubleRef.current;
    if (!dbl || !dbl.valid) return;
    for (const p of dbl.points) {
      let found = false;
      for (let i = 0; i < e.targetTouches.length; i++) {
        const t = e.targetTouches[i];
        if (t.identifier !== p.id) continue;
        found = true;
        if (Math.abs(t.clientX - p.x) > TWO_FINGER_DRIFT_PX || Math.abs(t.clientY - p.y) > TWO_FINGER_DRIFT_PX) {
          dbl.valid = false;
        }
        break;
      }
      if (!found) dbl.valid = false;
    }
  };

  const onGestureEnd = (e: React.TouchEvent) => {
    if (!gesturesEnabled || editing) {
      singleRef.current = null;
      doubleRef.current = null;
      return;
    }
    const now = performance.now();

    // Two-finger tap → FOCUS (bullet-time)
    const dbl = doubleRef.current;
    if (dbl) {
      if (e.targetTouches.length > 0) return;
      doubleRef.current = null;
      singleRef.current = null;
      if (dbl.valid && now - dbl.t <= TWO_FINGER_MAX_MS) {
        inputManager.pulseButton('focus');
        Haptics.cue('tick');
      }
      return;
    }

    const single = singleRef.current;
    if (!single) return;
    let lifted: Touch | null = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === single.id) {
        lifted = e.changedTouches[i];
        break;
      }
    }
    if (!lifted) return;
    singleRef.current = null;
    if (e.targetTouches.length > 0) return;

    const dx = lifted.clientX - single.x;
    const dy = lifted.clientY - single.y;
    const dt = now - single.t;
    if (dt <= 0 || dt > FLICK_MAX_MS) return;
    if (Math.hypot(dx, dy) / dt < FLICK_MIN_SPEED) return;

    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx >= FLICK_MIN_PX && adx >= ady * 2) {
      inputManager.pulseButton('swap');
      Haptics.cue('tick');
    } else if (dy >= FLICK_MIN_PX && ady >= adx * 2) {
      inputManager.pulseButton('reload');
      Haptics.cue('tick');
    }
  };

  /** Gaps scale with the buttons so bigger controls never overlap. */
  const gapStyle = (base: number): React.CSSProperties | undefined =>
    scale !== 1 ? { gap: `${Math.round(base * scale)}px` } : undefined;

  const badge = (id: TouchControlId) => PAD_BADGE[id];

  return (
    <div
      id="virtual-controls"
      ref={rootRef}
      className={`absolute inset-0 pointer-events-none select-none touch-none ${
        editing ? 'z-[64]' : 'z-20'
      }`}
      style={opacity !== 100 && !editing ? { opacity: opacity / 100 } : undefined}
    >
      {/* ============================================================
          PHASE 3 3 — LOOK AREA (right half, under every button):
          flick right = swap · flick down = reload · two-finger tap = focus
      ============================================================ */}
      {gesturesEnabled && !editing && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-auto"
          style={{ touchAction: 'none' }}
          onTouchStart={onGestureStart}
          onTouchMove={onGestureMove}
          onTouchEnd={onGestureEnd}
          onTouchCancel={onGestureEnd}
        />
      )}

      {/* ============================================================
          LEFT — MOVEMENT: floating 360° thumb joystick, bottom-left
      ============================================================ */}
      <div className="absolute left-0 bottom-0 flex items-end p-3 sm:p-4">
        <div
          id="virtual-joystick"
          data-control="joystick"
          ref={joystickBaseRef}
          {...(editing ? dragHandlers('joystick') : {
            onTouchStart: handleJoystickStart,
            onTouchMove: handleJoystickMove,
            onTouchEnd: handleJoystickEnd,
            onTouchCancel: handleJoystickEnd,
          })}
          style={{ ...ctlStyle('joystick'), ...editStyle }}
          className={
            'w-32 h-32 sm:w-40 sm:h-40 landscape:w-36 landscape:h-36 portrait:w-28 portrait:h-28 ' +
            'rounded-full border-2 border-white/20 bg-black/45 backdrop-blur-md flex items-center ' +
            'justify-center pointer-events-auto touch-none active:border-amber-400/40 transition-colors shadow-2xl relative'
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
          CENTRE — AIM: floating twin-stick aim pad (PHASE 1B B8).
          Drag past ~18% of the radius to enter precision aim: angled
          fire, tightened spread, laser + camera push-in.
      ============================================================ */}
      <div
        data-control="aimpad"
        {...dragHandlers('aimpad')}
        style={ctlStyle('aimpad', '-50%')}
        className="absolute left-1/2 bottom-3 sm:bottom-4"
      >
        <div
          id="virtual-aim"
          ref={aimBaseRef}
          {...(editing
            ? {}
            : {
                onTouchStart: handleAimStart,
                onTouchMove: handleAimMove,
                onTouchEnd: handleAimEnd,
                onTouchCancel: handleAimEnd,
              })}
          style={editStyle}
          className={
            'w-24 h-24 sm:w-28 sm:h-28 landscape:w-24 landscape:h-28 portrait:w-20 portrait:h-20 ' +
            'rounded-full border-2 bg-black/45 backdrop-blur-md flex items-center ' +
            'justify-center pointer-events-auto touch-none select-none relative shadow-2xl transition-colors ' +
            (aimTouchId !== null
              ? 'border-amber-400/80 active:border-amber-300'
              : equippedWeapon && equippedWeapon !== 'UNARMED'
              ? 'border-amber-400/35'
              : 'border-white/20')
          }
        >
          <Crosshair
            className={
              'w-5 h-5 sm:w-6 sm:h-6 absolute ' +
              (aimTouchId !== null ? 'text-amber-300' : 'text-white/35')
            }
          />
          <div
            ref={aimKnobRef}
            style={{ transform: `translate(${aimKnobPos.x}px, ${aimKnobPos.y}px)` }}
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-amber-200/90 to-amber-500/80 border border-amber-100/70 shadow-lg flex items-center justify-center pointer-events-none"
          >
            <div className="w-3 h-3 rounded-full bg-black/40 border border-white/50" />
          </div>
        </div>
      </div>

      {/* ============================================================
          RIGHT — ACTIONS: stacked thumb rows, bottom-right
          Row 1 (heroes): PUNCH + KICK — the biggest targets on screen
          Row 2 (combat): BLOCK / DODGE / JUMP / SHOOT
          Row 3 (utility): FOCUS / ACTION / SWAP / RELOAD / GRAB
      ============================================================ */}
      <div
        className="absolute right-0 bottom-0 flex flex-col items-end gap-2 landscape:gap-2.5 p-3 sm:p-4 pointer-events-auto"
        style={gapStyle(8)}
      >
        {/* HERO ROW — impossible to miss */}
        <div className="flex items-end gap-3 sm:gap-4" style={gapStyle(12)}>
          <div data-control="punch" {...dragHandlers('punch')} style={ctlStyle('punch')}>
            <button
              id="btn-punch"
              {...bindTouchButton('attack')}
              aria-label="Punch"
              style={editStyle}
              className={
                `${BTN} ${HERO} border-2 border-rose-200/70 text-white font-black ` +
                'bg-gradient-to-br from-red-500 via-rose-600 to-rose-800 ' +
                'shadow-[0_6px_24px_rgba(225,29,72,0.55)] active:from-red-600 active:to-rose-900'
              }
            >
              <HandFist className={`${HERO_ICON} fill-current drop-shadow`} />
              <span className={HERO_LABEL}>PUNCH</span>
              <span className="absolute top-1.5 right-2 text-[8px] font-mono px-1 rounded bg-black/70 border border-white/40 text-white">
                {badge('punch')}
              </span>
            </button>
          </div>

          <div data-control="kick" {...dragHandlers('kick')} style={ctlStyle('kick')}>
            <button
              id="btn-kick"
              {...bindTouchButton('heavy')}
              aria-label="Kick"
              style={editStyle}
              className={
                `${BTN} ${HERO} border-2 border-amber-200/70 text-white font-black ` +
                'bg-gradient-to-br from-amber-500 via-orange-600 to-orange-800 ' +
                'shadow-[0_6px_24px_rgba(249,115,22,0.55)] active:from-amber-600 active:to-orange-900'
              }
            >
              <Footprints className={`${HERO_ICON} fill-current drop-shadow`} />
              <span className={HERO_LABEL}>KICK</span>
              <span className="absolute top-1.5 right-2 text-[8px] font-mono px-1 rounded bg-black/70 border border-amber-200/60 text-amber-100">
                {badge('kick')}
              </span>
            </button>
          </div>
        </div>

        {/* COMBAT ROW — core defensive / mobility / gunplay actions */}
        <div className="flex items-end gap-2 sm:gap-2.5" style={gapStyle(8)}>
          <div data-control="block" {...dragHandlers('block')} style={ctlStyle('block')}>
            <button
              id="btn-block"
              {...bindTouchButton('block')}
              aria-label="Block"
              style={editStyle}
              className={`${BTN} ${COMBAT} rounded-2xl bg-neutral-900/85 border border-blue-500/50 text-blue-300 active:bg-blue-600/50`}
            >
              <Shield className={COMBAT_ICON} />
              <span className={COMBAT_LABEL}>Block</span>
              <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-blue-400/40 text-blue-300">
                {badge('block')}
              </span>
            </button>
          </div>

          <div data-control="dodge" {...dragHandlers('dodge')} style={ctlStyle('dodge')}>
            <button
              id="btn-dodge"
              {...bindTouchButton('dodge')}
              aria-label="Dodge"
              style={editStyle}
              className={`${BTN} ${COMBAT} rounded-2xl bg-neutral-900/85 border border-emerald-500/50 text-emerald-300 active:bg-emerald-600/50`}
            >
              <Wind className={COMBAT_ICON} />
              <span className={COMBAT_LABEL}>Dodge</span>
              <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-emerald-400/40 text-emerald-300">
                {badge('dodge')}
              </span>
            </button>
          </div>

          <div data-control="jump" {...dragHandlers('jump')} style={ctlStyle('jump')}>
            <button
              id="btn-jump"
              {...bindTouchButton('jump')}
              aria-label="Jump"
              style={editStyle}
              className={`${BTN} ${COMBAT} rounded-2xl bg-neutral-900/85 border border-sky-500/50 text-sky-300 active:bg-sky-600/50`}
            >
              <ArrowUp className={COMBAT_ICON} />
              <span className={COMBAT_LABEL}>Jump</span>
              <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-sky-400/40 text-sky-300">
                {badge('jump')}
              </span>
            </button>
          </div>

          <div data-control="shoot" {...dragHandlers('shoot')} style={ctlStyle('shoot')}>
            <button
              id="btn-shoot"
              {...bindTouchButton('shoot')}
              aria-label="Shoot"
              style={editStyle}
              className={
                `${BTN} ${COMBAT} rounded-2xl border-2 border-amber-300/80 text-amber-100 ` +
                'bg-gradient-to-br from-amber-600 to-yellow-700 active:from-amber-700 active:to-yellow-800 ' +
                'shadow-xl'
              }
            >
              <Crosshair className={COMBAT_ICON} />
              <span className={COMBAT_LABEL}>Shoot</span>
              <span className="absolute top-1 right-1.5 text-[7px] font-mono px-1 rounded bg-black/80 border border-amber-300/80 text-amber-200">
                {badge('shoot')}
              </span>
            </button>
          </div>
        </div>

        {/* UTILITY ROW — situational actions, compact but still ≥44px */}
        <div className="flex items-end gap-2" style={gapStyle(8)}>
          <div data-control="focus" {...dragHandlers('focus')} style={ctlStyle('focus')}>
            <button
              id="btn-focus"
              {...bindTouchButton('focus')}
              aria-label="Focus"
              style={editStyle}
              className={`${BTN} ${UTILITY} bg-amber-500/20 border border-amber-400/50 text-amber-300 active:bg-amber-500/40`}
            >
              <Flame className={`${UTILITY_ICON} text-amber-400 animate-pulse`} />
              <span className={UTILITY_LABEL}>Focus</span>
              <span className="absolute -top-1.5 -right-1 text-[7px] font-mono px-1 rounded bg-black/80 border border-amber-400/40 text-amber-300">
                {badge('focus')}
              </span>
            </button>
          </div>

          <div data-control="interact" {...dragHandlers('interact')} style={ctlStyle('interact')}>
            <button
              id="btn-interact"
              {...bindTouchButton('interact')}
              aria-label="Action"
              style={editStyle}
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
              <span className="absolute -top-1.5 -right-1 text-[7px] font-mono px-1 rounded bg-black/80 border border-white/20 text-neutral-300">
                {badge('interact')}
              </span>
            </button>
          </div>

          <div data-control="swap" {...dragHandlers('swap')} style={ctlStyle('swap')}>
            <button
              id="btn-swap"
              {...bindTouchButton('swap')}
              aria-label="Swap gun"
              style={editStyle}
              className={`${BTN} ${UTILITY} bg-sky-900/70 border border-sky-400/50 text-sky-200 active:bg-sky-700/70`}
            >
              <Repeat className={UTILITY_ICON} />
              <span className={UTILITY_LABEL}>Swap</span>
              <span className="absolute -top-1.5 -right-1 text-[7px] font-mono px-1 rounded bg-black/80 border border-sky-400/40 text-sky-300">
                {badge('swap')}
              </span>
            </button>
          </div>

          <div data-control="reload" {...dragHandlers('reload')} style={ctlStyle('reload')}>
            <button
              id="btn-reload"
              {...bindTouchButton('reload')}
              aria-label="Reload"
              style={editStyle}
              className={`${BTN} ${UTILITY} bg-neutral-900/80 border border-neutral-600/40 text-neutral-300 active:bg-neutral-700/50`}
            >
              <RotateCcw className={UTILITY_ICON} />
              <span className={UTILITY_LABEL}>Reload</span>
              <span className="absolute -top-1.5 -right-1 text-[7px] font-mono px-1 rounded bg-black/80 border border-white/20 text-neutral-400">
                {badge('reload')}
              </span>
            </button>
          </div>

          <div data-control="grab" {...dragHandlers('grab')} style={ctlStyle('grab')}>
            <button
              id="btn-grab"
              {...bindTouchButton('grab')}
              aria-label="Grab"
              style={editStyle}
              className={`${BTN} ${UTILITY} bg-neutral-900/80 border border-amber-500/40 text-amber-300 active:bg-amber-600/40`}
            >
              <HandGrab className={UTILITY_ICON} />
              <span className={UTILITY_LABEL}>Grab</span>
              <span className="absolute -top-1.5 -right-1 text-[7px] font-mono px-1 rounded bg-black/80 border border-amber-400/40 text-amber-300">
                {badge('grab')}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
