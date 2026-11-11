import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, createPcmBlob } from '../utils/audioUtils';
import { ConnectionState } from '../types';

// Ask our server for a single-use Gemini Live token
// Thrown when the server wants a (correct) passcode before starting a session
export class PasscodeError extends Error {}

const fetchSessionToken = async (passcode: string): Promise<{ token: string; model: string }> => {
  let res: Response;
  try {
    // Send our time zone so Chronos can tell the local time
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    res = await fetch(`/api/token?tz=${encodeURIComponent(tz)}`, {
      cache: 'no-store',
      headers: passcode ? { 'x-app-passcode': passcode } : {},
    });
  } catch {
    throw new Error("Couldn't reach the server to start a session. Check your connection.");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && body.passcodeRequired) {
    throw new PasscodeError(body.error || 'Enter the passcode to connect.');
  }
  if (!res.ok || !body.token) {
    throw new Error(body.error || `The server couldn't start a session (HTTP ${res.status}).`);
  }
  return body;
};

// Turn a getUserMedia error into a message that says what to do about it
const describeMicError = (err: any): string => {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "Microphone permission is blocked. Allow it in the browser's site settings (the icon left of the address bar), and on a Mac check System Settings → Privacy & Security → Microphone for your browser.";
    case 'NotFoundError':
    case 'OverconstrainedError':
      return "No microphone was found. Plug one in or pick an input device in your system sound settings.";
    case 'NotReadableError':
    case 'AbortError':
      return "The microphone couldn't be started. Another app may be using it, or the system is blocking it.";
    default:
      return `Couldn't open the microphone: ${err?.message || err}`;
  }
};

export const useLiveSession = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [volume, setVolume] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [passcodeRequired, setPasscodeRequired] = useState(false);

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
         try { session?.close(); } catch(e) { console.error("Error closing session", e)}
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

  const connect = useCallback(async (passcode = '') => {
    try {
      setConnectionState('connecting');
      setErrorMsg(null);

      // 2. Get Microphone Access
      // Browsers only allow the microphone on https:// pages or localhost
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          `This browser blocks the microphone on ${window.location.origin}. Open http://localhost:${window.location.port || '3000'} instead (or serve the app over https).`
        );
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      } catch (err: any) {
        console.error("Microphone access error:", err);
        throw new Error(describeMicError(err));
      }

      // 3. Initialize Audio Contexts
      // Output: 24kHz for Gemini responses
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      // Input: use the mic's own rate (Firefox can't connect a mic to a context
      // with a different rate). Gemini resamples whatever rate we declare.
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
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
      // Get a short-lived session token from our server (the API key stays there).
      // Fetched after the mic prompt because a token must be used within a minute.
      const { token, model } = await fetchSessionToken(passcode);
      // The token is used in place of an API key and needs the v1beta API
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1beta' } });

      // 5. Connect to Live API
      const sessionPromise = ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
          },
        },
        callbacks: {
          onopen: () => {
            setConnectionState('connected');
            setPasscodeRequired(false);
            
            // Setup Mic Streaming
            if (!inputContextRef.current || !streamRef.current) return;
            
            const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
            const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData, e.inputBuffer.sampleRate);
              sessionPromise.then(session => {
                  try {
                    session?.sendRealtimeInput({ audio: pcmBlob });
                  } catch(err) {
                    console.error("Error sending audio", err);
                  }
              });
            };

            source.connect(processor);
            processor.connect(inputContextRef.current.destination);

            // The model waits for input before speaking, so nudge it to
            // give its opening greeting (time + historical event) right away
            sessionPromise.then(session => {
              session?.sendRealtimeInput({ text: 'Hello Chronos.' });
            });
          },
          onmessage: async (msg: LiveServerMessage) => {
            const serverContent = msg.serverContent;
            
            // Handle Audio Output (one message can hold several parts)
            const parts = serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
              const base64Audio = part.inlineData?.data;
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
            }

            // Handle Interruption
            if (serverContent?.interrupted) {
                // Clear queue
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
            }
          },
          onclose: (e: CloseEvent) => {
            console.log("Session closed", e.code, e.reason);
            // 1000 = normal close (e.g. the user pressed End Session)
            if (e.code !== 1000 && e.reason) {
              setErrorMsg(`Gemini closed the connection: ${e.reason}`);
            }
            cleanup();
          },
          onerror: (err) => {
            console.error("Session error", err);
            setErrorMsg("Connection to Gemini Live API failed.");
            cleanup();
          }
        }
      }).catch((err: any) => {
        // Connection failures (bad API key, unknown model, network) land here
        console.error("Live connect failed", err);
        setErrorMsg(err?.message || "Connection to Gemini Live API failed.");
        cleanup();
        return null;
      });
      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      if (e instanceof PasscodeError) setPasscodeRequired(true);
      setConnectionState('error');
      setErrorMsg(e.message || "Failed to connect.");
      cleanup();
    }
  }, [cleanup]);

  return {
    connectionState,
    volume,
    errorMsg,
    passcodeRequired,
    connect,
    disconnect: cleanup
  };
};