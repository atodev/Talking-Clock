import React, { useEffect, useState } from 'react';

export const ClockFace: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-history-panel rounded-3xl border-4 border-history-gold shadow-[0_0_50px_rgba(197,160,89,0.2)]">
      <div className="text-history-gold font-serif text-lg tracking-widest mb-2 uppercase opacity-80">
        Current Time
      </div>
      <div className="text-6xl md:text-8xl font-sans font-light text-white tabular-nums tracking-tighter mb-4 shadow-black drop-shadow-md">
        {formatTime(time)}
      </div>
      <div className="w-full h-px bg-gradient-to-r from-transparent via-history-gold to-transparent opacity-50 mb-4"></div>
      <div className="text-gray-400 font-serif text-xl md:text-2xl text-center">
        {formatDate(time)}
      </div>
    </div>
  );
};