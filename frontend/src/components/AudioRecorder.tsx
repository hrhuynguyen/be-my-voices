interface AudioRecorderProps {
  canStartSession: boolean;
  isSessionActive: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isAwaitingAudioOutput: boolean;
  noiseReductionEnabled: boolean;
  eegAssistedToneEnabled: boolean;
  eegToneAvailable: boolean;
  currentTonePolicy: string | null;
  recorderError: string | null;
  processError: string | null;
  liveTranscript: string;
  latestBrokenText: string;
  waveformLevels: number[];
  onNoiseReductionChange: (enabled: boolean) => void;
  onEegAssistedToneChange: (enabled: boolean) => void;
  onProcessCurrentSentence: () => void;
  onStartSession: () => Promise<void>;
  onStopSession: () => void;
}

export function AudioRecorder({
  canStartSession,
  isSessionActive,
  isRecording,
  isProcessing,
  isAwaitingAudioOutput,
  noiseReductionEnabled,
  eegAssistedToneEnabled,
  eegToneAvailable,
  currentTonePolicy,
  recorderError,
  processError,
  liveTranscript,
  latestBrokenText,
  waveformLevels,
  onNoiseReductionChange,
  onEegAssistedToneChange,
  onProcessCurrentSentence,
  onStartSession,
  onStopSession,
}: AudioRecorderProps) {
  const statusLabel = isProcessing
    ? "Recovering speech..."
    : isAwaitingAudioOutput
      ? "Playing response"
    : isRecording
      ? "Listening and transcribing"
      : isSessionActive
        ? "Waiting for the next utterance"
        : canStartSession
          ? "Ready to start"
        : "Select a voice first";

  return (
    <section className="surface-panel flex h-full flex-col items-center justify-center gap-8 text-center">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-ink/55">
          Recorder
        </p>
      </div>

      <div className="relative flex items-center justify-center">
        <div
          className={`absolute h-64 w-64 rounded-full bg-sage/15 blur-2xl transition ${
            isRecording ? "scale-110 opacity-100" : "scale-90 opacity-70"
          }`}
        />
        <button
          type="button"
          disabled={!canStartSession && !isSessionActive}
          onClick={() =>
            isSessionActive ? onStopSession() : void onStartSession()
          }
          className={`relative flex h-48 w-48 items-center justify-center rounded-full border text-center transition duration-200 ${
            isSessionActive
              ? "border-clay bg-clay text-white shadow-[0_30px_80px_-28px_rgba(180,110,86,0.85)]"
              : "border-ink/10 bg-white text-ink shadow-[0_24px_60px_-34px_rgba(34,51,42,0.6)]"
          } disabled:cursor-not-allowed disabled:border-ink/10 disabled:bg-white/60 disabled:text-ink/35`}
        >
          <span className="font-display text-3xl">
            {isSessionActive ? "Stop session" : "Start session"}
          </span>
        </button>
      </div>

      <div className="grid gap-3">
        <p className="text-sm uppercase tracking-[0.22em] text-ink/55">
          {statusLabel}
        </p>
        <div className="mx-auto flex h-16 items-end gap-1.5">
          {waveformLevels.map((level, index) => (
            <span
              key={`${index}-${level}`}
              className={`w-2 rounded-full transition-all duration-150 ${
                isRecording ? "bg-clay/90" : "bg-ink/12"
              }`}
              style={{
                height: `${Math.max(level * 56, 10)}px`,
                opacity: isRecording ? 0.45 + level * 0.55 : 0.8,
              }}
            />
          ))}
        </div>
        <div className="mx-auto flex items-center gap-2">
          {[0, 1, 2, 3].map((dot) => (
            <span
              key={dot}
              className={`h-2.5 w-2.5 rounded-full transition ${
                isRecording ? "animate-pulse bg-clay" : "bg-ink/15"
              }`}
              style={
                isRecording
                  ? { animationDelay: `${dot * 120}ms` }
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {isSessionActive ? (
        <button
          type="button"
          disabled={!isRecording || isProcessing || isAwaitingAudioOutput}
          onClick={onProcessCurrentSentence}
          className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm uppercase tracking-[0.18em] text-ink transition hover:border-ink/20 hover:bg-cream disabled:cursor-not-allowed disabled:border-ink/8 disabled:bg-white/60 disabled:text-ink/35"
        >
          Process Current Sentence
        </button>
      ) : null}

      <label className="flex w-full max-w-xl items-center justify-between gap-4 rounded-[28px] border border-ink/8 bg-white/70 px-5 py-4 text-left">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
            Noise reduction mode
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/65">
            Use ElevenLabs Voice Isolator before transcription for noisy rooms.
            This adds latency, so keep it off in quiet close-mic setups.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={noiseReductionEnabled}
          onClick={() => onNoiseReductionChange(!noiseReductionEnabled)}
          className={`relative h-8 w-16 shrink-0 rounded-full transition ${
            noiseReductionEnabled ? "bg-clay" : "bg-ink/15"
          }`}
        >
          <span
            className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${
              noiseReductionEnabled ? "left-9" : "left-1"
            }`}
          />
        </button>
      </label>

      <label className="flex w-full max-w-xl items-center justify-between gap-4 rounded-[28px] border border-ink/8 bg-white/70 px-5 py-4 text-left">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
            EEG-assisted tone mode
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/65">
            Use live Muse 2 affective-state telemetry to steer the TTS tone
            policy during synthesis.
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-ink/45">
            {eegToneAvailable
              ? `Live tone available · ${currentTonePolicy ?? "neutral"}`
              : "Connect Muse 2 first"}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={eegAssistedToneEnabled}
          disabled={!eegToneAvailable}
          onClick={() => onEegAssistedToneChange(!eegAssistedToneEnabled)}
          className={`relative h-8 w-16 shrink-0 rounded-full transition ${
            eegAssistedToneEnabled ? "bg-clay" : "bg-ink/15"
          } disabled:cursor-not-allowed disabled:bg-ink/10`}
        >
          <span
            className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${
              eegAssistedToneEnabled ? "left-9" : "left-1"
            }`}
          />
        </button>
      </label>

      <div className="w-full max-w-xl rounded-[28px] border border-ink/8 bg-white/70 p-5 text-left">
        <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
          Dictation
        </p>
        <p className="mt-3 min-h-20 text-base leading-7 text-ink/82">
          {isRecording
            ? liveTranscript || "Listening for speech..."
            : isProcessing
              ? "Processing the latest utterance..."
              : latestBrokenText
                ? latestBrokenText
                : isAwaitingAudioOutput
                  ? "Playback is finishing before listening resumes."
                  : isSessionActive
                    ? "Waiting for speech. The next phrase will be captured automatically."
                    : "Start session to show the captured broken dictation here."}
        </p>
      </div>

      {recorderError || processError ? (
        <p className="max-w-md rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {recorderError || processError}
        </p>
      ) : null}
    </section>
  );
}
