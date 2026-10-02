import React, { useRef, useEffect } from 'react';
import { GameLoop } from '../engine/GameLoop';
import { Quality } from './settings';

interface GameCanvasProps {
  gameLoop: GameLoop;
  onStateUpdate: () => void;
  /** P5-01: quality tier → canvas DPR cap + render scale. */
  quality: Quality;
}

/**
 * P5-01 resolution scaling. The backing store is
 * CSS × min(deviceDPR, tierCap) × renderScale, while the renderer keeps
 * drawing in the DPR-capped *logical* view (CSS × min(deviceDPR, 2)) — so
 * framing and character size are identical at every tier and only the number
 * of physical pixels behind the scene changes.
 */
const QUALITY_TIERS: Record<Quality, { cap: number; scale: number }> = {
  high: { cap: 2, scale: 1 },
  medium: { cap: 1.5, scale: 1 },
  low: { cap: 1, scale: 0.75 },
};

export const GameCanvas: React.FC<GameCanvasProps> = ({ gameLoop, onStateUpdate, quality }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Read by the resize closure; a separate effect keeps it current WITHOUT
  // re-running the main effect (that would gameLoop.stop() and destroy input).
  const qualityRef = useRef<Quality>(quality);
  const updateSizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Handle high-DPI canvas sizing (P5-01: per-tier DPR cap + render scale)
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const tier = QUALITY_TIERS[qualityRef.current];
      const logicalW = Math.max(1, Math.floor(rect.width * Math.min(dpr, 2)));
      const logicalH = Math.max(1, Math.floor(rect.height * Math.min(dpr, 2)));
      const backW = Math.max(
        1,
        Math.floor(rect.width * Math.min(dpr, tier.cap) * tier.scale)
      );
      const backH = Math.max(
        1,
        Math.floor(rect.height * Math.min(dpr, tier.cap) * tier.scale)
      );
      canvas.width = backW;
      canvas.height = backH;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      // Logical view the renderer lays out in — GameLoop maps it onto the
      // backing store each frame (identity at the high tier).
      gameLoop.viewWidth = logicalW;
      gameLoop.viewHeight = logicalH;
    };
    updateSizeRef.current = updateSize;

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
      // Resizing resets the backing store (black frame) — if the loop is
      // throttled behind a paused/game-over overlay, force one repaint.
      gameLoop.requestIdleRender();
    });
    resizeObserver.observe(container);

    // Start engine loop
    gameLoop.start(canvas, onStateUpdate);

    return () => {
      resizeObserver.disconnect();
      gameLoop.stop();
    };
  }, [gameLoop, onStateUpdate]);

  // P5-01: tier changes only re-cut the backing store — never restart the
  // loop (stop() would destroy the keyboard/gamepad listeners).
  useEffect(() => {
    qualityRef.current = quality;
    updateSizeRef.current();
    gameLoop.requestIdleRender();
  }, [quality, gameLoop]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden bg-black select-none">
      <canvas
        id="wick-stick-canvas"
        ref={canvasRef}
        className="w-full h-full block touch-none"
      />
    </div>
  );
};
