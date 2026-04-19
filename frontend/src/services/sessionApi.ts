import { apiFetch } from "../lib/api";
import type { ProcessResponse, ScribeTokenResponse } from "../types/session";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function processAudio(
  audioBlob: Blob,
  voiceId: number,
  noiseReductionEnabled = false,
  eegAssistedToneEnabled = false,
  brokenTextOverride?: string,
): Promise<ProcessResponse> {
  if (audioBlob.size > MAX_AUDIO_BYTES) {
    throw new Error(
      `Audio file too large: ${audioBlob.size} bytes (max ${MAX_AUDIO_BYTES}).`,
    );
  }

  const form = new FormData();
  const filename =
    audioBlob instanceof File ? audioBlob.name : "recording.webm";
  form.append("audio", audioBlob, filename);
  form.append("voice_id", String(voiceId));
  form.append(
    "noise_reduction_enabled",
    noiseReductionEnabled ? "true" : "false",
  );
  form.append(
    "eeg_assisted_tone_enabled",
    eegAssistedToneEnabled ? "true" : "false",
  );
  if (brokenTextOverride?.trim()) {
    form.append("broken_text_override", brokenTextOverride.trim());
  }

  return apiFetch<ProcessResponse>("/api/sessions/process", {
    method: "POST",
    body: form,
  });
}

export function createScribeToken(): Promise<ScribeTokenResponse> {
  return apiFetch<ScribeTokenResponse>("/api/realtime/scribe-token", {
    method: "POST",
  });
}
