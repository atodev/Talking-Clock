import React, { useRef, useEffect } from 'react';
import { AudioVisualizerProps } from '../types';

export const Visualizer: React.FC<AudioVisualizerProps> = ({ isPlaying, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const volumeRef = useRef(volume);

  // Keep volume ref in sync to read it inside the animation loop
  // without re-triggering the main effect.
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let phase = 0;

    const draw = () => {
      // Resize
      if (canvas.width !== canvas.offsetWidth || canvas.height !== canvas.offsetHeight) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      const currentVolume = volumeRef.current;
      // If not playing, draw a flat line
      const activeVolume = isPlaying ? Math.max(0.1, currentVolume * 3) : 0.05;
      
      ctx.beginPath();
      ctx.strokeStyle = '#C5A059'; // History Gold
      ctx.lineWidth = 3;

      for (let i = -100; i <= 100; i++) {
        const x = centerX + i * (canvas.width / 200);
        // Wave formula: amplitude * sin(frequency * x + phase) * envelope
        // Envelope makes it taper at edges
        const envelope = 1 - Math.abs(i) / 100; 
        const y = centerY + Math.sin(i * 0.2 + phase) * activeVolume * 50 * envelope;
        
        if (i === -100) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      
      ctx.stroke();

      // Second Wave (Ghost)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(197, 160, 89, 0.3)';
      ctx.lineWidth = 2;
       for (let i = -100; i <= 100; i++) {
        const x = centerX + i * (canvas.width / 200);
        const envelope = 1 - Math.abs(i) / 100; 
        const y = centerY + Math.cos(i * 0.15 - phase) * activeVolume * 30 * envelope;
        
        if (i === -100) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      phase += 0.15;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [isPlaying]);

  return (
    <canvas ref={canvasRef} className="w-full h-32 rounded-xl bg-black/20" />
  );
};