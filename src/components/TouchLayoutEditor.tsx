import React from 'react';
import { Check, X, RotateCcw, MoveHorizontal, MapPinned } from 'lucide-react';
import { computeMirroredOffsets } from './VirtualControls';
import { type TouchLayout } from './settings';

interface TouchLayoutEditorProps {
  isOpen: boolean;
  /** Draft layout being edited (null = shipped default positions). */
  layout: TouchLayout | null;
  /** Live drag updates from VirtualControls. */
  onChange: (layout: TouchLayout | null) => void;
  /** Applies the shipped default positions. */
  onDefault: () => void;
  /** Reverts the draft to the layout saved in settings (undo this session). */
  onRevert: () => void;
  onSave: () => void;
  onCancel: () => void;
}

const BTN =
  'min-h-[40px] px-3 rounded-xl border font-black uppercase tracking-widest text-[11px] ' +
  'flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95';

/**
 * PHASE 3 2 — the drag-to-place touch layout editor.
 *
 * The bar itself is transparent to touch (pointer-events-none), so every drag
 * lands on the live VirtualControls underneath; only the buttons are tappable.
 */
export const TouchLayoutEditor: React.FC<TouchLayoutEditorProps> = ({
  isOpen,
  layout,
  onChange,
  onDefault,
  onRevert,
  onSave,
  onCancel,
}) => {
  if (!isOpen) return null;

  const preset = layout?.preset ?? 'default';

  const applySouthpaw = () => {
    // Read the live DOM at click time — the controls mount in the same
    // commit as this bar, so a render-time lookup can still be null.
    const root = typeof document !== 'undefined' ? document.getElementById('virtual-controls') : null;
    if (!root) return;
    onChange({ preset: 'southpaw', offsets: computeMirroredOffsets(root, layout) });
  };

  const TAB = (active: boolean) =>
    active
      ? `${BTN} bg-amber-500/25 border-amber-400 text-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.3)]`
      : `${BTN} bg-black/70 border-white/20 text-neutral-300 hover:border-white/40`;

  return (
    <div className="fixed inset-x-0 top-0 z-[66] p-2 sm:p-3 pointer-events-none">
      <div className="mx-auto max-w-3xl bg-black/85 backdrop-blur-md border border-amber-500/40 rounded-2xl px-3 py-2.5 shadow-[0_0_30px_rgba(245,158,11,0.25)] flex flex-col gap-2 pointer-events-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MapPinned className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-300 truncate">
              Edit touch layout
            </span>
            <span className="text-[10px] font-mono uppercase text-neutral-500 truncate hidden sm:inline">
              drag any control · {preset}
            </span>
          </div>
          <span className="text-[10px] font-mono text-neutral-500 hidden md:inline">
            ±35% of screen
          </span>
        </div>

        <div className="grid grid-cols-3 sm:flex sm:justify-end gap-2">
          <button className={TAB(preset === 'default')} onClick={onDefault}>
            Default
          </button>
          <button className={TAB(preset === 'southpaw')} onClick={applySouthpaw}>
            <MoveHorizontal className="w-3.5 h-3.5" />
            Southpaw
          </button>
          <button className={TAB(false)} onClick={onRevert} title="Undo this session">
            <RotateCcw className="w-3.5 h-3.5" />
            Undo
          </button>
          <button
            className={`${BTN} bg-neutral-900 border-white/20 text-neutral-300 hover:border-red-400/60`}
            onClick={onCancel}
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            className={`${BTN} bg-gradient-to-r from-amber-500 to-yellow-400 border-amber-300 text-black col-span-3 sm:col-span-1`}
            onClick={onSave}
          >
            <Check className="w-3.5 h-3.5" />
            Save layout
          </button>
        </div>
      </div>
    </div>
  );
};
