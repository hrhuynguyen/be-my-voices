import { startTransition, useCallback, useEffect, useState } from "react";

import { cloneVoice, deleteVoice, getVoices, updateVoice } from "../services/voiceApi";
import type { CloneVoiceInput, UpdateVoiceInput, Voice } from "../types/voice";

interface UseVoicesResult {
  voices: Voice[];
  selectedVoice: Voice | null;
  selectedVoiceId: number | null;
  isLoading: boolean;
  isCloning: boolean;
  error: string | null;
  cloneError: string | null;
  voiceMutationError: string | null;
  refreshVoices: () => Promise<void>;
  selectVoice: (voiceId: number) => void;
  cloneNewVoice: (input: CloneVoiceInput) => Promise<Voice | null>;
  updateExistingVoice: (
    voiceId: number,
    input: UpdateVoiceInput,
  ) => Promise<Voice | null>;
  removeVoice: (voiceId: number) => Promise<boolean>;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
}

export function useVoices(): UseVoicesResult {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [voiceMutationError, setVoiceMutationError] = useState<string | null>(null);

  const syncVoices = useCallback(
    (nextVoices: Voice[], preferredVoiceId?: number | null) => {
      startTransition(() => {
        setVoices(nextVoices);
        setSelectedVoiceId((currentVoiceId) => {
          if (
            preferredVoiceId &&
            nextVoices.some((voice) => voice.id === preferredVoiceId)
          ) {
            return preferredVoiceId;
          }
          if (
            currentVoiceId &&
            nextVoices.some((voice) => voice.id === currentVoiceId)
          ) {
            return currentVoiceId;
          }
          return nextVoices[0]?.id ?? null;
        });
      });
    },
    [],
  );

  const refreshVoices = useCallback(async () => {
    setError(null);
    try {
      const nextVoices = await getVoices();
      syncVoices(nextVoices);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [syncVoices]);

  const cloneNewVoice = useCallback(
    async (input: CloneVoiceInput) => {
      setCloneError(null);
      setIsCloning(true);

      try {
        const createdVoice = await cloneVoice(input);
        const nextVoices = await getVoices();
        syncVoices(nextVoices, createdVoice.id);
        return createdVoice;
      } catch (err) {
        setCloneError(toMessage(err));
        return null;
      } finally {
        setIsCloning(false);
      }
    },
    [syncVoices],
  );

  const updateExistingVoice = useCallback(
    async (voiceId: number, input: UpdateVoiceInput) => {
      setVoiceMutationError(null);

      try {
        const updatedVoice = await updateVoice(voiceId, input);
        const nextVoices = await getVoices();
        syncVoices(nextVoices, updatedVoice.id);
        return updatedVoice;
      } catch (err) {
        setVoiceMutationError(toMessage(err));
        return null;
      }
    },
    [syncVoices],
  );

  const removeVoice = useCallback(
    async (voiceId: number) => {
      setVoiceMutationError(null);

      try {
        await deleteVoice(voiceId);
        const nextVoices = await getVoices();
        syncVoices(nextVoices);
        return true;
      } catch (err) {
        setVoiceMutationError(toMessage(err));
        return false;
      }
    },
    [syncVoices],
  );

  useEffect(() => {
    void refreshVoices();
  }, [refreshVoices]);

  const selectedVoice =
    voices.find((voice) => voice.id === selectedVoiceId) ?? null;

  return {
    voices,
    selectedVoice,
    selectedVoiceId,
    isLoading,
    isCloning,
    error,
    cloneError,
    voiceMutationError,
    refreshVoices,
    selectVoice: setSelectedVoiceId,
    cloneNewVoice,
    updateExistingVoice,
    removeVoice,
  };
}
