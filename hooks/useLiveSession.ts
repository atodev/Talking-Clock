import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, createPcmBlob } from '../utils/audioUtils';
import { ConnectionState } from '../types';

export const useLiveSession = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [volume, setVolume] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const nextStartTimeRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    // Stop all playing sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();

    // Close Audio Contexts
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch(e) {}
      audioContextRef.current = null;
    }
    if (inputContextRef.current) {
      try { inputContextRef.current.close(); } catch(e) {}
      inputContextRef.current = null;
    }

    // Stop Microphone Stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Stop Processor
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch(e) {}
      processorRef.current = null;
    }

    // Close Session
    if (sessionPromiseRef.current) {
       sessionPromiseRef.current.then(session => {
         try { session.close(); } catch(e) { console.error("Error closing session", e)}
       });
       sessionPromiseRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    setVolume(0);
    setConnectionState('disconnected');
    nextStartTimeRef.current = 0;
  }, []);

  const connect = useCallback(async () => {
    try {
      setConnectionState('connecting');
      setErrorMsg(null);

      // 0. Handle API Key Selection (for AI Studio environment)
      if (typeof window !== 'undefined' && (window as any).aistudio) {
        const aistudio = (window as any).aistudio;
        try {
            const hasKey = await aistudio.hasSelectedApiKey();
            if (!hasKey) {
                await aistudio.openSelectKey();
            }
        } catch (err) {
            console.warn("AI Studio key selection helpers failed, proceeding to check process.env", err);
        }
      }

      // 1. Validate API Key with robust fallback for local dev
      let apiKey = process.env.API_KEY;

      // Check for common local environment variable patterns if primary is missing
      if (!apiKey) {
        try {
           // Check for REACT_APP_ (Create React App) or NEXT_PUBLIC_ (Next.js)
           if (typeof process !== 'undefined' && process.env) {
              apiKey = (process.env as any).REACT_APP_API_KEY || (process.env as any).NEXT_PUBLIC_API_KEY;
           }
           // Check for VITE_ (Vite)
           if (!apiKey && typeof import.meta !== 'undefined' && (import.meta as any).env) {
              apiKey = (import.meta as any).env.VITE_API_KEY;
           }
        } catch (e) {
           console.warn("Error checking fallback env vars", e);
        }
      }

      if (!apiKey) {
        throw new Error(
          "API Key not found. If using .env.local, please ensure your variable is named correctly (e.g., REACT_APP_API_KEY, NEXT_PUBLIC_API_KEY, or VITE_API_KEY) and the server has been restarted."
        );
      }

      // 2. Get Microphone Access
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      } catch (err) {
        console.error("Microphone access error:", err);
        throw new Error("Microphone access denied. Please grant permission to use the microphone.");
      }

      // 3. Initialize Audio Contexts
      // Output: 24kHz for Gemini responses
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      // Input: 16kHz for User Mic
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      // Explicitly resume contexts to handle browser autoplay policies
      await outputCtx.resume();
      await inputCtx.resume();

      audioContextRef.current = outputCtx;
      inputContextRef.current = inputCtx;

      // Setup Analyzer for visualizer
      const analyzer = outputCtx.createAnalyser();
      analyzer.fftSize = 256;
      analyzerRef.current = analyzer;
      const outputNode = outputCtx.createGain();
      outputNode.connect(analyzer);
      analyzer.connect(outputCtx.destination);

      // Animation loop for volume visualization
      const updateVolume = () => {
        if (analyzerRef.current) {
            const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
            analyzerRef.current.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
            setVolume(avg / 255); // Normalize 0-1
        }
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      // 4. Initialize GenAI Client
      const ai = new GoogleGenAI({ apiKey });

      const now = new Date();
      const systemInstruction = `
        You are Chronos, a dignified and knowledgeable Talking Clock and Historian.
        Current Session Date: ${now.toLocaleDateString()}.
        Current Session Time: ${now.toLocaleTimeString()}.
        
        Your instructions:
        1. When the session starts, immediately greet the user warmly with the time.
        2. Example greeting: "Greetings. The time is [Current Time]."
        3. Immediately follow the time with a fascinating, brief historical event that happened on this day (${now.toLocaleString('default', { month: 'long' })} ${now.getDate()}) in history.
        4. Engage in conversation if the user asks questions about the event or time.
        5. If asked for the time again, recite it.
        6. Keep your tone elegant, slightly archaic but accessible, like a museum curator.
        7. Keep responses concise suitable for spoken conversation.
      `;

      // 5. Connect to Live API
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
          },
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: () => {
            setConnectionState('connected');
            
            // Setup Mic Streaming
            if (!inputContextRef.current || !streamRef.current) return;
            
            const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
            const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                  try {
                    session.sendRealtimeInput({ media: pcmBlob });
                  } catch(err) {
                    console.error("Error sending audio", err);
                  }
              });
            };

            source.connect(processor);
            processor.connect(inputContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const serverContent = msg.serverContent;
            
            // Handle Audio Output
            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
               const ctx = audioContextRef.current;
               try {
                 const audioData = base64ToUint8Array(base64Audio);
                 // 24kHz output sample rate
                 const buffer = await decodeAudioData(audioData, ctx, 24000, 1);
                 
                 // Schedule Playback
                 nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                 
                 const source = ctx.createBufferSource();
                 source.buffer = buffer;
                 source.connect(outputNode); // Connect to gain->analyzer->dest
                 
                 source.addEventListener('ended', () => {
                   sourcesRef.current.delete(source);
                 });
                 
                 source.start(nextStartTimeRef.current);
                 nextStartTimeRef.current += buffer.duration;
                 sourcesRef.current.add(source);
               } catch (e) {
                 console.error("Error decoding audio", e);
               }
            }

            // Handle Interruption
            if (serverContent?.interrupted) {
                // Clear queue
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
            }
          },
          onclose: () => {
            console.log("Session closed");
            cleanup();
          },
          onerror: (err) => {
            console.error("Session error", err);
            setErrorMsg("Connection to Gemini Live API failed.");
            cleanup();
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      setConnectionState('error');
      setErrorMsg(e.message || "Failed to connect.");
      cleanup();
    }
  }, [cleanup]);

  return {
    connectionState,
    volume,
    errorMsg,
    connect,
    disconnect: cleanup
  };
};