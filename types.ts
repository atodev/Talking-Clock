export interface AudioVisualizerProps {
  isPlaying: boolean;
  volume: number;
}

export interface ClockState {
  time: Date;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
