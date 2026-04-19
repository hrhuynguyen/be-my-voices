export type MuseConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type MuseProvider = "lsl";
export type TonePolicy = "calm" | "neutral" | "stressed" | "urgent";

export interface EEGScores {
  stress: number;
  valence: number;
  arousal: number;
}

export interface EEGFeatureSnapshot {
  band_powers: Record<string, Record<string, number>>;
  mean_amplitude: Record<string, number>;
  variance: Record<string, number>;
  frontal_alpha_asymmetry: number | null;
  signal_quality: number;
}

export interface EEGTelemetry {
  experimental: boolean;
  provider: MuseProvider;
  connection_state: MuseConnectionState;
  device_name: string;
  stream_alive: boolean;
  eeg_assisted_tone_available: boolean;
  sample_rate_hz: number;
  window_seconds: number;
  channel_names: string[];
  sample_name: string | null;
  tone_policy: TonePolicy | null;
  scores: EEGScores | null;
  features: EEGFeatureSnapshot | null;
  last_sample_at: string | null;
  last_window_at: string | null;
  last_error: string | null;
  status_message: string;
  stack_status: Record<string, boolean>;
}

export interface EEGDebugSnapshot {
  telemetry: EEGTelemetry;
  recent_events: string[];
  debug_flags: Record<string, string>;
}
