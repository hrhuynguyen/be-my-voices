import { useEffect, useRef, useState } from "react";

import type { RecoveryResult } from "../hooks/useProcessAudio";

interface RecoveryDisplayProps {
  result: RecoveryResult | null;
  isSessionActive: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isAwaitingAudioOutput: boolean;
  error: string | null;
  selectedVoiceName?: string | null;
  outputDeviceId?: string | null;
  onPlaybackComplete?: () => void;
}

type AudioWithSink = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

export function RecoveryDisplay({
  result,
  isSessionActive,
  isRecording,
  isProcessing,
  isAwaitingAudioOutput,
  error,
  selectedVoiceName,
  outputDeviceId,
  onPlaybackComplete,
}: RecoveryDisplayProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [pendingAutoPlayUrl, setPendingAutoPlayUrl] = useState<string | null>(null);
  const playbackRate = 0.8;

  const phase = isProcessing
    ? "processing"
    : isAwaitingAudioOutput
      ? "playback"
      : isRecording
        ? "listening"
        : isSessionActive
          ? "armed"
          : "idle";

  const phaseLabel =
    phase === "processing"
      ? "Processing"
      : phase === "playback"
        ? "Playing response"
        : phase === "listening"
          ? "Listening"
          : phase === "armed"
            ? "Waiting for speech"
            : "Session idle";

  const phaseDescription =
    phase === "processing"
      ? "The latest utterance is moving through transcription, recovery, and speech synthesis."
      : phase === "playback"
        ? "The response is playing before the next listening cycle begins."
        : phase === "listening"
          ? "The microphone is open and the app is listening for the next sentence."
          : phase === "armed"
            ? "The session is ready. Start speaking and the next phrase will be captured automatically."
            : "Start a session to listen for speech and show recovery updates here.";

  useEffect(() => {
    if (!result?.audioUrl) {
      setPlaybackError(null);
      setPendingAutoPlayUrl(null);
      return;
    }

    setPlaybackError(null);
    setPendingAutoPlayUrl(result.audioUrl);
  }, [result?.audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    const audio = audioRef.current as AudioWithSink | null;
    if (!audio || !outputDeviceId || typeof audio.setSinkId !== "function") {
      return;
    }
    audio.setSinkId(outputDeviceId).catch(() => {
      // Fallback silently; browser may not permit the sink yet.
    });
  }, [outputDeviceId, result?.audioUrl]);

  const handleLoadedData = () => {
    if (!result?.audioUrl || pendingAutoPlayUrl !== result.audioUrl) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = 0;
    audio.playbackRate = playbackRate;
    setPendingAutoPlayUrl(null);

    void audio.play().catch((playError) => {
      setPlaybackError(
        playError instanceof Error
          ? `Auto-play was blocked. Use Play response instead. ${playError.message}`
          : "Auto-play was blocked. Use Play response instead.",
      );
    });
  };

  return (
    <section className="surface-panel flex h-full flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-ink/55">
          Recovery
        </p>
        <h2 className="mt-2 font-display text-2xl text-ink">
          Broken speech to clear output
        </h2>
      </div>

      <div className="rounded-[28px] border border-ink/8 bg-white/70 p-5">
        <div className="flex flex-wrap gap-2">
          {[
            { key: "listening", label: "Listening" },
            { key: "processing", label: "Processing" },
            { key: "playback", label: "Playback" },
          ].map((item) => {
            const isActive = item.key === phase;
            return (
              <span
                key={item.key}
                className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                  isActive
                    ? "bg-clay text-white"
                    : "bg-mist text-ink/55"
                }`}
              >
                {item.label}
              </span>
            );
          })}
        </div>
        <p className="mt-4 text-sm uppercase tracking-[0.2em] text-ink/48">
          {phaseLabel}
        </p>
        <p className="mt-2 text-sm leading-7 text-ink/65">
          {phaseDescription}
        </p>
      </div>

      {error || playbackError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || playbackError}
        </p>
      ) : null}

      {isProcessing ? (
        <div className="grid flex-1 place-items-center rounded-[28px] border border-dashed border-ink/15 bg-white/50 p-6 text-center">
          <div>
            <p className="font-display text-3xl text-ink">Processing</p>
            <p className="mt-3 text-sm leading-7 text-ink/60">
              ElevenLabs Speech to Text, Gemini, and ElevenLabs Text to Speech
              are working through the latest utterance.
            </p>
          </div>
        </div>
      ) : result ? (
        <div className="grid flex-1 gap-4">
          <article className="rounded-[28px] bg-mist p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
              Dictation
            </p>
            <p className="mt-3 text-lg leading-8 text-ink">
              {result.brokenText}
            </p>
          </article>

          <article className="rounded-[28px] border border-ink/8 bg-white/70 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
              Emotion
            </p>
            <p className="mt-3 font-display text-2xl capitalize text-ink">
              {result.appliedTonePolicy ?? "Default"}
            </p>
            <p className="mt-2 text-sm leading-6 text-ink/60">
              Tone applied to the synthesized response.
            </p>
          </article>

          <article className="rounded-[28px] bg-ink p-5 text-white">
            <p className="text-xs uppercase tracking-[0.2em] text-white/55">
              Recovered sentence
            </p>
            <p className="mt-3 font-display text-[clamp(1.6rem,2.3vw,2.2rem)] leading-tight">
              {result.recoveredText}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setPlaybackError(null);
                  void audioRef.current?.play().catch((playError) => {
                    setPlaybackError(
                      playError instanceof Error
                        ? playError.message
                        : "Unable to play audio.",
                    );
                  });
                }}
                className="rounded-full bg-clay px-5 py-3 text-sm uppercase tracking-[0.18em] text-white transition hover:bg-clay/90"
              >
                Play response
              </button>
              <p className="text-sm text-white/70">
                {selectedVoiceName
                  ? `Using ${selectedVoiceName}`
                  : "Using the selected voice"}
              </p>
            </div>
            <audio
              ref={audioRef}
              className="mt-4 w-full"
              controls
              preload="auto"
              src={result.audioUrl}
              onLoadedData={handleLoadedData}
              onEnded={onPlaybackComplete}
            />
          </article>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center rounded-[28px] border border-dashed border-ink/15 bg-white/50 p-6 text-center">
          <div>
            <p className="font-display text-3xl text-ink">
              {isRecording || isSessionActive ? "Ready for the next sentence" : "No recovery yet"}
            </p>
            <p className="mt-3 text-sm leading-7 text-ink/60">
              {isRecording || isSessionActive
                ? "Speak naturally. Once the sentence is captured, the broken and recovered text will appear here with playback."
                : "Start a session and the reconstructed sentence will appear here with synthesized playback."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
