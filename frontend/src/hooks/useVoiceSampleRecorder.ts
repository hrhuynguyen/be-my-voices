import { useCallback, useEffect, useRef, useState } from "react";

interface UseVoiceSampleRecorderResult {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  recordedBlob: Blob | null;
  clearRecordedBlob: () => void;
  isRecording: boolean;
  elapsedSeconds: number;
  error: string | null;
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function toRecorderErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "Microphone access was denied. Allow microphone permission in the browser and try again.";
      case "NotFoundError":
        return "No microphone was found for this device.";
      case "NotReadableError":
        return "The microphone is already in use by another app.";
      default:
        return error.message || "Unable to record a sample.";
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unable to record a sample.";
}

export function useVoiceSampleRecorder(): UseVoiceSampleRecorderResult {
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(44100);

  const cleanup = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (gainRef.current) {
      gainRef.current.disconnect();
      gainRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => undefined);
    }
    audioContextRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    const merged = mergeChunks(chunksRef.current);
    chunksRef.current = [];
    setRecordedBlob(encodeWav(merged, sampleRateRef.current));
    setIsRecording(false);
    cleanup();
  }, [cleanup, isRecording]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    setError(null);
    setRecordedBlob(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setError(toRecorderErrorMessage(error));
      return;
    }
    streamRef.current = stream;

    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext();
    } catch (error) {
      cleanup();
      setError(toRecorderErrorMessage(error));
      return;
    }

    audioContextRef.current = audioContext;
    sampleRateRef.current = audioContext.sampleRate;
    chunksRef.current = [];

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const gain = audioContext.createGain();
    gain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      chunksRef.current.push(new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(gain);
    gain.connect(audioContext.destination);

    sourceRef.current = source;
    processorRef.current = processor;
    gainRef.current = gain;
    setIsRecording(true);
  }, [cleanup, isRecording]);

  useEffect(() => {
    if (!isRecording) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((Date.now() - startedAt) / 1000);
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    startRecording,
    stopRecording,
    recordedBlob,
    clearRecordedBlob: () => setRecordedBlob(null),
    isRecording,
    elapsedSeconds,
    error,
  };
}
