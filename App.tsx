import React, { useEffect, useState } from 'react';
import { ClockFace } from './components/ClockFace';
import { Visualizer } from './components/Visualizer';
import { useLiveSession } from './hooks/useLiveSession';
import { Mic, MicOff, AlertCircle, KeyRound } from 'lucide-react';

// The passcode is remembered in this browser so it only has to be typed once
const PASSCODE_KEY = 'chronovoice-passcode';
const readSavedPasscode = () => {
  try { return localStorage.getItem(PASSCODE_KEY) ?? ''; } catch { return ''; }
};
const savePasscode = (value: string) => {
  try {
    if (value) localStorage.setItem(PASSCODE_KEY, value);
    else localStorage.removeItem(PASSCODE_KEY);
  } catch { /* storage unavailable (e.g. private window); just don't remember it */ }
};

const App: React.FC = () => {
  const { connectionState, volume, errorMsg, passcodeRequired, connect, disconnect } = useLiveSession();
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const [passcode, setPasscode] = useState(readSavedPasscode);

  // Remember the passcode once it has worked
  useEffect(() => {
    if (isConnected) savePasscode(passcode);
  }, [isConnected, passcode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConnected) disconnect();
    else if (!isConnecting) connect(passcode.trim());
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-history-dark bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <div className="max-w-2xl w-full flex flex-col gap-8 z-10">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="font-serif text-4xl md:text-5xl text-history-gold drop-shadow-lg">
            ChronoVoice
          </h1>
          <p className="text-gray-400 font-sans tracking-wide text-sm md:text-base">
            THE HISTORIC TALKING CLOCK
          </p>
        </div>

        {/* Clock Component */}
        <ClockFace />

        {/* Visualizer Area */}
        <div className="relative">
          <Visualizer isPlaying={isConnected} volume={volume} />
          
          {/* Status Overlay */}
          <div className="absolute top-2 right-2 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : isConnecting ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-500 uppercase tracking-widest font-semibold">
              {connectionState}
            </span>
          </div>
        </div>

        {/* Controls */}
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
          {errorMsg && (
            <div className="flex items-center gap-2 text-red-400 bg-red-900/20 px-4 py-2 rounded-lg text-sm border border-red-900/50">
              <AlertCircle size={16} />
              {errorMsg}
            </div>
          )}

          {passcodeRequired && !isConnected && (
            <label className="flex items-center gap-2 bg-history-panel border border-gray-700 rounded-full px-4 py-2 focus-within:border-history-gold">
              <KeyRound size={16} className="text-gray-400" />
              <span className="sr-only">Passcode</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                placeholder="Passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="bg-transparent outline-none text-gray-100 placeholder-gray-500 w-48 font-sans"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={isConnecting}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-serif text-lg transition-all duration-300
              ${isConnected 
                ? 'bg-red-900/80 hover:bg-red-800 text-red-100 border border-red-700' 
                : 'bg-history-gold hover:bg-[#D4B06A] text-history-dark border border-yellow-600'
              }
              ${isConnecting ? 'opacity-70 cursor-wait' : 'shadow-lg hover:shadow-xl hover:scale-105 active:scale-95'}
            `}
          >
            {isConnected ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            <span className="font-bold tracking-wide">
              {isConnected ? 'End Session' : isConnecting ? 'Connecting...' : 'Connect to Chronos'}
            </span>
          </button>
          
          <p className="text-gray-500 text-xs max-w-sm text-center font-sans">
            Connect to hear the current time and a historical event from this day.
            Speak to ask questions.
          </p>
        </form>

      </div>
    </div>
  );
};

export default App;