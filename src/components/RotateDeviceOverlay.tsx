import React from 'react';
import { RotateCw, Smartphone } from 'lucide-react';

interface RotateDeviceOverlayProps {
  visible: boolean;
  lockSupported?: boolean;
  onRotateTap?: () => void;
  onDismiss?: () => void;
}

/**
 * Full-screen "rotate your device" hint shown while a handheld device is held
 * in portrait. Tapping the prompt retries the fullscreen + landscape lock.
 */
export const RotateDeviceOverlay: React.FC<RotateDeviceOverlayProps> = ({
  visible,
  lockSupported = true,
  onRotateTap,
  onDismiss,
}) => {
  if (!visible) return null;

  return (
    <div className="safe-top safe-bottom safe-left safe-right fixed inset-0 z-[65] flex flex-col items-center justify-center gap-5 bg-black/92 backdrop-blur-md px-6 text-center pointer-events-auto">
      <div className="relative">
        <Smartphone className="w-16 h-16 text-amber-400 animate-[rotateHint_2.4s_ease-in-out_infinite]" />
        <RotateCw className="w-7 h-7 text-amber-300 absolute -right-3 -top-1 animate-spin" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-[0.3em] text-white font-mono">
          Rotate Your Device
        </h2>
        <p className="text-xs sm:text-sm font-mono uppercase tracking-widest text-amber-300">
          John Stick plays in landscape
        </p>
        <p className="text-[11px] font-mono text-neutral-400 max-w-xs mx-auto leading-relaxed">
          Turn your phone sideways for the full widescreen fight.
        </p>
      </div>

      <button
        onClick={() => onRotateTap?.()}
        className="min-h-[48px] px-8 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-black uppercase tracking-[0.2em] text-xs sm:text-sm shadow-[0_0_40px_rgba(245,158,11,0.45)] active:scale-95 transition-transform cursor-pointer flex items-center gap-2.5"
      >
        <RotateCw className="w-4 h-4" />
        Try Landscape Lock
      </button>

      {!lockSupported && (
        <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
          Your browser locks orientation automatically — please rotate manually.
        </p>
      )}

      {onDismiss && (
        <button
          onClick={onDismiss}
          className="min-h-[44px] px-5 text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
        >
          Play in portrait anyway
        </button>
      )}

      <div className="text-[10px] font-mono uppercase tracking-[0.4em] text-neutral-600">
        The High Table is waiting
      </div>
    </div>
  );
};
