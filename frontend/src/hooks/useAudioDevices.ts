import { useCallback, useEffect, useState } from "react";

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

interface UseAudioDevicesResult {
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
  selectedInputId: string | null;
  selectedOutputId: string | null;
  setSelectedInputId: (deviceId: string | null) => void;
  setSelectedOutputId: (deviceId: string | null) => void;
  permissionGranted: boolean;
  isScanning: boolean;
  error: string | null;
  scanDevices: () => Promise<void>;
  outputSelectionSupported: boolean;
}

const INPUT_STORAGE_KEY = "be-my-voices:audio-input-id";
const OUTPUT_STORAGE_KEY = "be-my-voices:audio-output-id";

function readStoredId(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredId(key: string, value: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore quota / disabled storage
  }
}

function toOption(device: MediaDeviceInfo, index: number): AudioDeviceOption {
  return {
    deviceId: device.deviceId,
    label: device.label || `Device ${index + 1}`,
  };
}

export function useAudioDevices(): UseAudioDevicesResult {
  const [inputs, setInputs] = useState<AudioDeviceOption[]>([]);
  const [outputs, setOutputs] = useState<AudioDeviceOption[]>([]);
  const [selectedInputId, setSelectedInputIdState] = useState<string | null>(
    () => readStoredId(INPUT_STORAGE_KEY),
  );
  const [selectedOutputId, setSelectedOutputIdState] = useState<string | null>(
    () => readStoredId(OUTPUT_STORAGE_KEY),
  );
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outputSelectionSupported =
    typeof window !== "undefined" &&
    "setSinkId" in HTMLAudioElement.prototype;

  const setSelectedInputId = useCallback((deviceId: string | null) => {
    setSelectedInputIdState(deviceId);
    writeStoredId(INPUT_STORAGE_KEY, deviceId);
  }, []);

  const setSelectedOutputId = useCallback((deviceId: string | null) => {
    setSelectedOutputIdState(deviceId);
    writeStoredId(OUTPUT_STORAGE_KEY, deviceId);
  }, []);

  const enumerate = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const nextInputs = devices
      .filter((device) => device.kind === "audioinput")
      .map(toOption);
    const nextOutputs = devices
      .filter((device) => device.kind === "audiooutput")
      .map(toOption);
    setInputs(nextInputs);
    setOutputs(nextOutputs);
    setSelectedInputIdState((previous) =>
      previous && nextInputs.some((device) => device.deviceId === previous)
        ? previous
        : (nextInputs[0]?.deviceId ?? null),
    );
    setSelectedOutputIdState((previous) =>
      previous && nextOutputs.some((device) => device.deviceId === previous)
        ? previous
        : (nextOutputs[0]?.deviceId ?? null),
    );
  }, []);

  const scanDevices = useCallback(async () => {
    setIsScanning(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionGranted(true);
      await enumerate();
    } catch (scanError) {
      if (scanError instanceof DOMException) {
        if (scanError.name === "NotAllowedError") {
          setError(
            "Microphone access was denied. Allow microphone permission and try again.",
          );
        } else if (scanError.name === "NotFoundError") {
          setError("No audio devices were detected.");
        } else {
          setError(scanError.message || "Unable to scan audio devices.");
        }
      } else if (scanError instanceof Error) {
        setError(scanError.message);
      } else {
        setError("Unable to scan audio devices.");
      }
    } finally {
      setIsScanning(false);
    }
  }, [enumerate]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }
    const handler = () => {
      void enumerate();
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [enumerate]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }
    void enumerate();
  }, [enumerate]);

  return {
    inputs,
    outputs,
    selectedInputId,
    selectedOutputId,
    setSelectedInputId,
    setSelectedOutputId,
    permissionGranted,
    isScanning,
    error,
    scanDevices,
    outputSelectionSupported,
  };
}
