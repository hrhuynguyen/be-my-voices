import { useCallback, useEffect, useState } from "react";

import {
  checkMuseConnection,
  connectMuse,
  disconnectMuse,
  getMuseDebugSnapshot,
  getMuseTelemetry,
} from "../services/eegApi";
import type { EEGDebugSnapshot, EEGTelemetry } from "../types/eeg";

interface UseMuseTelemetryResult {
  telemetry: EEGTelemetry | null;
  debugSnapshot: EEGDebugSnapshot | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  connectDevice: () => Promise<void>;
  disconnectDevice: () => Promise<void>;
  checkConnection: () => Promise<void>;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unable to read Muse 2 telemetry.";
}

export function useMuseTelemetry(): UseMuseTelemetryResult {
  const [telemetry, setTelemetry] = useState<EEGTelemetry | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<EEGDebugSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextTelemetry, nextDebug] = await Promise.all([
        getMuseTelemetry(),
        getMuseDebugSnapshot(),
      ]);
      setTelemetry(nextTelemetry);
      setDebugSnapshot(nextDebug);
      setError(null);
    } catch (refreshError) {
      setError(toMessage(refreshError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runMutation = useCallback(
    async (operation: () => Promise<EEGTelemetry>) => {
      setIsMutating(true);
      try {
        const nextTelemetry = await operation();
        setTelemetry(nextTelemetry);
        setError(null);
        const nextDebug = await getMuseDebugSnapshot();
        setDebugSnapshot(nextDebug);
      } catch (mutationError) {
        setError(toMessage(mutationError));
      } finally {
        setIsMutating(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh();
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, [refresh]);

  return {
    telemetry,
    debugSnapshot,
    isLoading,
    isMutating,
    error,
    refresh,
    connectDevice: () => runMutation(() => connectMuse({ mode: "lsl" })),
    disconnectDevice: () => runMutation(disconnectMuse),
    checkConnection: () => runMutation(checkMuseConnection),
  };
}
