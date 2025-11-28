import React from 'react';
import { ClockFace } from './components/ClockFace';
import { Visualizer } from './components/Visualizer';
import { useLiveSession } from './hooks/useLiveSession';
import { Mic, MicOff, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const { connectionState, volume, errorMsg, connect, disconnect } = useLiveSession();
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

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
        <div className="flex flex-col items-center gap-4">
          {errorMsg && (
            <div className="flex items-center gap-2 text-red-400 bg-red-900/20 px-4 py-2 rounded-lg text-sm border border-red-900/50">
              <AlertCircle size={16} />
              {errorMsg}
            </div>
          )}

          <button
            onClick={isConnected ? disconnect : connect}
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
        </div>

      </div>
    </div>
  );
};

export default App;