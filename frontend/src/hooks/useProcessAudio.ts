import { useCallback, useState } from "react";

import { resolveApiUrl } from "../lib/api";
import { processAudio } from "../services/sessionApi";

export interface RecoveryResult {
  sessionId: number;
  brokenText: string;
  recoveredText: string;
  audioUrl: string;
  appliedTonePolicy: string | null;
}

interface UseProcessAudioResult {
  result: RecoveryResult | null;
  isProcessing: boolean;
  error: string | null;
  processRecording: (
    audioBlob: Blob,
    voiceId: number,
    noiseReductionEnabled?: boolean,
    eegAssistedToneEnabled?: boolean,
    brokenTextOverride?: string,
  ) => Promise<RecoveryResult | null>;
  clearResult: () => void;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unable to process audio.";
}

export function useProcessAudio(): UseProcessAudioResult {
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processRecording = useCallback(
    async (
      audioBlob: Blob,
      voiceId: number,
      noiseReductionEnabled = false,
      eegAssistedToneEnabled = false,
      brokenTextOverride?: string,
    ) => {
      setError(null);
      setIsProcessing(true);

      try {
        const response = await processAudio(
          audioBlob,
          voiceId,
          noiseReductionEnabled,
          eegAssistedToneEnabled,
          brokenTextOverride,
        );
        const nextResult: RecoveryResult = {
          sessionId: response.session_id,
          brokenText: response.broken_text,
          recoveredText: response.recovered_text,
          audioUrl: resolveApiUrl(response.audio_url),
          appliedTonePolicy: response.applied_tone_policy,
        };
        setResult(nextResult);
        return nextResult;
      } catch (err) {
        setError(toMessage(err));
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [],
  );

  return {
    result,
    isProcessing,
    error,
    processRecording,
    clearResult: () => setResult(null),
  };
}
