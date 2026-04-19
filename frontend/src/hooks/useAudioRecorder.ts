import { useCallback, useEffect, useRef, useState } from "react";

import { createScribeToken } from "../services/sessionApi";

interface UseAudioRecorderOptions {
  silenceThreshold?: number;
  silenceDurationMs?: number;
  mimeType?: string;
  inputDeviceId?: string | null;
}

interface UseAudioRecorderResult {
  startRecording: () => Promise<void>;
  stopRecording: (discardAudio?: boolean) => void;
  audioBlob: Blob | null;
  clearAudioBlob: () => void;
  isRecording: boolean;
  error: string | null;
  liveTranscript: string;
  submittedTranscript: string;
  waveformLevels: number[];
}

const DEFAULT_SILENCE_THRESHOLD = 0.02;
const DEFAULT_SILENCE_DURATION_MS = 2500;
const CALIBRATION_DURATION_MS = 800;
const MIN_DYNAMIC_THRESHOLD = 0.012;
const MAX_DYNAMIC_THRESHOLD = 0.08;
const BACKGROUND_MULTIPLIER = 2.2;
const BACKGROUND_PADDING = 0.008;
const WAVEFORM_BAR_COUNT = 24;
const WAVEFORM_IDLE_LEVEL = 0.12;
const WAVEFORM_UPDATE_INTERVAL_MS = 60;
const REALTIME_SAMPLE_RATE = 16000;
const REALTIME_MODEL_ID = "scribe_v2_realtime";
const REALTIME_VAD_SILENCE_SECS = 2.2;
const REALTIME_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

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
        return error.message || "Unable to start microphone recording.";
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unable to start microphone recording.";
}

function pickMimeType(preferred?: string): string | undefined {
  const candidates = [
    preferred,
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ].filter((t): t is string => Boolean(t));
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function composeTranscript(committed: string, partial: string): string {
  return `${committed} ${partial}`.trim();
}

function downsampleToInt16Buffer(
  input: Float32Array,
  inputSampleRate: number,
): Int16Array {
  if (input.length === 0) {
    return new Int16Array();
  }

  if (inputSampleRate === REALTIME_SAMPLE_RATE) {
    const pcm = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = clamp(input[index] ?? 0, -1, 1);
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return pcm;
  }

  const ratio = inputSampleRate / REALTIME_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);

  let outputIndex = 0;
  let inputIndex = 0;
  while (outputIndex < outputLength) {
    const nextInputIndex = Math.min(
      input.length,
      Math.round((outputIndex + 1) * ratio),
    );
    let accumulator = 0;
    let sampleCount = 0;

    for (let cursor = inputIndex; cursor < nextInputIndex; cursor += 1) {
      accumulator += input[cursor] ?? 0;
      sampleCount += 1;
    }

    const averaged = sampleCount > 0 ? accumulator / sampleCount : 0;
    const sample = clamp(averaged, -1, 1);
    output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}

function pcm16ToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildRealtimeUrl(token: string): string {
  const url = new URL(REALTIME_WS_URL);
  url.searchParams.set("model_id", REALTIME_MODEL_ID);
  url.searchParams.set("token", token);
  url.searchParams.set("audio_format", "pcm_16000");
  url.searchParams.set("language_code", "en");
  url.searchParams.set("commit_strategy", "vad");
  url.searchParams.set(
    "vad_silence_threshold_secs",
    String(REALTIME_VAD_SILENCE_SECS),
  );
  return url.toString();
}

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {},
): UseAudioRecorderResult {
  const {
    silenceThreshold = DEFAULT_SILENCE_THRESHOLD,
    silenceDurationMs = DEFAULT_SILENCE_DURATION_MS,
    mimeType,
    inputDeviceId,
  } = options;

  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [submittedTranscript, setSubmittedTranscript] = useState("");
  const [waveformLevels, setWaveformLevels] = useState<number[]>(
    Array.from({ length: WAVEFORM_BAR_COUNT }, () => WAVEFORM_IDLE_LEVEL),
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const realtimeSilentGainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const calibrationStartRef = useRef<number | null>(null);
  const calibrationFramesRef = useRef(0);
  const baselineRmsRef = useRef(0);
  const dynamicThresholdRef = useRef(silenceThreshold);
  const speechDetectedRef = useRef(false);
  const isCalibratedRef = useRef(false);
  const discardNextBlobRef = useRef(false);
  const lastWaveformUpdateRef = useRef(0);
  const partialTranscriptRef = useRef("");
  const committedTranscriptRef = useRef("");

  const resetWaveform = useCallback(() => {
    setWaveformLevels(
      Array.from({ length: WAVEFORM_BAR_COUNT }, () => WAVEFORM_IDLE_LEVEL),
    );
  }, []);

  const cleanupRealtime = useCallback(() => {
    if (realtimeProcessorRef.current) {
      realtimeProcessorRef.current.onaudioprocess = null;
      realtimeProcessorRef.current.disconnect();
      realtimeProcessorRef.current = null;
    }

    if (realtimeSilentGainRef.current) {
      realtimeSilentGainRef.current.disconnect();
      realtimeSilentGainRef.current = null;
    }

    const realtimeSocket = realtimeSocketRef.current;
    if (
      realtimeSocket &&
      (realtimeSocket.readyState === WebSocket.OPEN ||
        realtimeSocket.readyState === WebSocket.CONNECTING)
    ) {
      realtimeSocket.close();
    }
    realtimeSocketRef.current = null;
    partialTranscriptRef.current = "";
    committedTranscriptRef.current = "";
  }, []);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    silenceStartRef.current = null;
    calibrationStartRef.current = null;
    calibrationFramesRef.current = 0;
    baselineRmsRef.current = 0;
    dynamicThresholdRef.current = silenceThreshold;
    speechDetectedRef.current = false;
    isCalibratedRef.current = false;
    discardNextBlobRef.current = false;
    lastWaveformUpdateRef.current = 0;

    cleanupRealtime();

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
    analyserRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    resetWaveform();
  }, [cleanupRealtime, resetWaveform, silenceThreshold]);

  const stopRecording = useCallback((discardAudio = false) => {
    discardNextBlobRef.current = discardAudio;
    const nextTranscript = composeTranscript(
      committedTranscriptRef.current,
      partialTranscriptRef.current,
    );
    if (!discardAudio) {
      setSubmittedTranscript(nextTranscript);
      setLiveTranscript(nextTranscript);
    }

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    setError(null);
    setAudioBlob(null);
    setLiveTranscript("");
    setSubmittedTranscript("");
    partialTranscriptRef.current = "";
    committedTranscriptRef.current = "";
    discardNextBlobRef.current = false;
    resetWaveform();

    let stream: MediaStream;
    try {
      const audioConstraints: MediaTrackConstraints = inputDeviceId
        ? { deviceId: { exact: inputDeviceId } }
        : {};
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
    } catch (e) {
      setError(toRecorderErrorMessage(e));
      return;
    }
    streamRef.current = stream;

    const chosenMime = pickMimeType(mimeType);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        chosenMime ? { mimeType: chosenMime } : undefined,
      );
    } catch (e) {
      cleanup();
      setError(toRecorderErrorMessage(e));
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const shouldDiscardBlob = discardNextBlobRef.current;
      discardNextBlobRef.current = false;
      const type = chosenMime ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (!shouldDiscardBlob) {
        setAudioBlob(blob);
      }
      setIsRecording(false);
      cleanup();
    };
    recorder.onerror = (event) => {
      const err = (event as unknown as { error?: DOMException }).error;
      setError(err?.message ?? "Recorder error.");
      stopRecording();
    };

    const AudioCtxCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtxCtor) {
      cleanup();
      setError("Web Audio API unavailable.");
      return;
    }
    const audioCtx = new AudioCtxCtor();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    try {
      const tokenResponse = await createScribeToken();
      const realtimeSocket = new WebSocket(buildRealtimeUrl(tokenResponse.token));
      realtimeSocketRef.current = realtimeSocket;

      realtimeSocket.onmessage = (event) => {
        const payload = JSON.parse(event.data) as {
          message_type?: string;
          text?: string;
          error?: string;
          message?: string;
        };
        const nextText = payload.text?.trim() ?? "";

        if (payload.message_type === "partial_transcript") {
          partialTranscriptRef.current = nextText;
          setLiveTranscript(
            composeTranscript(
              committedTranscriptRef.current,
              partialTranscriptRef.current,
            ),
          );
          return;
        }

        if (
          payload.message_type === "committed_transcript" ||
          payload.message_type === "committed_transcript_with_timestamps"
        ) {
          committedTranscriptRef.current = composeTranscript(
            committedTranscriptRef.current,
            nextText,
          );
          partialTranscriptRef.current = "";
          const committed = committedTranscriptRef.current.trim();
          setSubmittedTranscript(committed);
          setLiveTranscript(committed);
          return;
        }

        if (
          payload.message_type?.endsWith("error") ||
          payload.message_type === "error" ||
          payload.error
        ) {
          const detail = payload.message ?? payload.error ?? "Realtime dictation failed.";
          setError(`Realtime dictation unavailable. ${detail}`);
        }
      };

      realtimeSocket.onerror = () => {
        setError(
          "Realtime dictation connection failed. Recording will continue without live ElevenLabs transcript.",
        );
      };

      const realtimeProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      source.connect(realtimeProcessor);
      realtimeProcessor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      realtimeProcessorRef.current = realtimeProcessor;
      realtimeSilentGainRef.current = silentGain;

      realtimeProcessor.onaudioprocess = (event) => {
        if (realtimeSocket.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputChannel = event.inputBuffer.getChannelData(0);
        const pcm16 = downsampleToInt16Buffer(inputChannel, audioCtx.sampleRate);
        if (pcm16.length === 0) {
          return;
        }

        realtimeSocket.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: pcm16ToBase64(pcm16),
            sample_rate: REALTIME_SAMPLE_RATE,
          }),
        );
      };
    } catch (realtimeError) {
      setError(
        realtimeError instanceof Error
          ? `Realtime dictation unavailable. ${realtimeError.message}`
          : "Realtime dictation unavailable.",
      );
    }

    const buffer = new Float32Array(analyser.fftSize);
    const tick = () => {
      const currentAnalyser = analyserRef.current;
      const currentRecorder = recorderRef.current;
      if (!currentAnalyser || !currentRecorder) return;

      currentAnalyser.getFloatTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i] ?? 0;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);

      const now = performance.now();
      if (
        lastWaveformUpdateRef.current === 0 ||
        now - lastWaveformUpdateRef.current >= WAVEFORM_UPDATE_INTERVAL_MS
      ) {
        lastWaveformUpdateRef.current = now;
        const normalizedLevel = clamp(rms * 12, WAVEFORM_IDLE_LEVEL, 1);
        setWaveformLevels((previous) => [
          ...previous.slice(1),
          normalizedLevel,
        ]);
      }

      if (calibrationStartRef.current === null) {
        calibrationStartRef.current = now;
      }

      const calibrationElapsed = now - calibrationStartRef.current;
      if (calibrationElapsed < CALIBRATION_DURATION_MS) {
        baselineRmsRef.current += rms;
        calibrationFramesRef.current += 1;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (!isCalibratedRef.current && calibrationFramesRef.current > 0) {
        const averageBackgroundRms =
          baselineRmsRef.current / calibrationFramesRef.current;
        dynamicThresholdRef.current = clamp(
          Math.max(
            silenceThreshold,
            averageBackgroundRms * BACKGROUND_MULTIPLIER,
            averageBackgroundRms + BACKGROUND_PADDING,
          ),
          MIN_DYNAMIC_THRESHOLD,
          MAX_DYNAMIC_THRESHOLD,
        );
        isCalibratedRef.current = true;
      }

      if (rms >= dynamicThresholdRef.current) {
        speechDetectedRef.current = true;
        silenceStartRef.current = null;
      } else if (speechDetectedRef.current) {
        if (silenceStartRef.current === null) {
          silenceStartRef.current = now;
        } else if (now - silenceStartRef.current >= silenceDurationMs) {
          stopRecording();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    recorder.start(250);
    setIsRecording(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [cleanup, isRecording, mimeType, resetWaveform, silenceDurationMs, silenceThreshold, stopRecording]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      cleanup();
    };
  }, [cleanup]);

  const clearAudioBlob = useCallback(() => {
    setAudioBlob(null);
  }, []);

  return {
    startRecording,
    stopRecording,
    audioBlob,
    clearAudioBlob,
    isRecording,
    error,
    liveTranscript,
    submittedTranscript,
    waveformLevels,
  };
}
