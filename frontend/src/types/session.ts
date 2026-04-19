export interface ProcessResponse {
  session_id: number;
  broken_text: string;
  recovered_text: string;
  audio_url: string;
  applied_tone_policy: string | null;
}

export interface ScribeTokenResponse {
  token: string;
}
