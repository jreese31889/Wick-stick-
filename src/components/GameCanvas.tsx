import React, { useRef, useEffect } from 'react';
import { GameLoop } from '../engine/GameLoop';

interface GameCanvasProps {
  gameLoop: GameLoop;
  onStateUpdate: () => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ gameLoop, onStateUpdate }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Handle high-DPI canvas sizing
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2 for mobile thermal and performance
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(container);

    // Start engine loop
    gameLoop.start(canvas, onStateUpdate);

    return () => {
      resizeObserver.disconnect();
      gameLoop.stop();
    };
  }, [gameLoop, onStateUpdate]);

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
