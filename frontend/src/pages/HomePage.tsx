import { useCallback, useEffect, useRef, useState } from "react";

import logoMark from "../assets/be-my-voices-logo.svg";
import { AudioRecorder } from "../components/AudioRecorder";
import { ConnectedDevices } from "../components/ConnectedDevices";
import { MuseDashboard } from "../components/MuseDashboard";
import { RecoveryDisplay } from "../components/RecoveryDisplay";
import { VoiceSelector } from "../components/VoiceSelector";
import { useAudioDevices } from "../hooks/useAudioDevices";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useMuseTelemetry } from "../hooks/useMuseTelemetry";
import { useProcessAudio } from "../hooks/useProcessAudio";
import { useVoices } from "../hooks/useVoices";

export function HomePage() {
  const submittedBlobRef = useRef<Blob | null>(null);
  const submittedVoiceIdRef = useRef<number | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isAwaitingAudioOutput, setIsAwaitingAudioOutput] = useState(false);
  const [noiseReductionEnabled, setNoiseReductionEnabled] = useState(false);
  const [eegAssistedToneEnabled, setEegAssistedToneEnabled] = useState(false);
  const {
    voices,
    selectedVoice,
    selectedVoiceId,
    isLoading,
    isCloning,
    error: voicesError,
    cloneError,
    voiceMutationError,
    refreshVoices,
    selectVoice,
    cloneNewVoice,
    updateExistingVoice,
    removeVoice,
  } = useVoices();
  const {
    telemetry: museTelemetry,
    isLoading: isMuseLoading,
    isMutating: isMuseMutating,
    error: museError,
    connectDevice,
    disconnectDevice,
  } = useMuseTelemetry();
  const {
    inputs: audioInputs,
    outputs: audioOutputs,
    selectedInputId,
    selectedOutputId,
    setSelectedInputId,
    setSelectedOutputId,
    permissionGranted: audioPermissionGranted,
    isScanning: isScanningAudio,
    error: audioDeviceError,
    scanDevices: scanAudioDevices,
    outputSelectionSupported,
  } = useAudioDevices();
  const {
    startRecording,
    stopRecording,
    audioBlob,
    isRecording,
    error: recorderError,
    clearAudioBlob,
    liveTranscript,
    submittedTranscript,
    waveformLevels,
  } = useAudioRecorder({ inputDeviceId: selectedInputId });
  const {
    result,
    isProcessing,
    error: processError,
    processRecording,
  } = useProcessAudio();

  const startSession = useCallback(async () => {
    if (selectedVoiceId === null || isSessionActive) {
      return;
    }

    setIsAwaitingAudioOutput(false);
    setIsSessionActive(true);
  }, [isSessionActive, selectedVoiceId]);

  const stopSession = useCallback(() => {
    setIsSessionActive(false);
    setIsAwaitingAudioOutput(false);
    stopRecording(true);
    clearAudioBlob();
  }, [clearAudioBlob, stopRecording]);

  const processCurrentSentence = useCallback(() => {
    if (!isSessionActive || !isRecording || isProcessing || isAwaitingAudioOutput) {
      return;
    }

    stopRecording();
  }, [
    isAwaitingAudioOutput,
    isProcessing,
    isRecording,
    isSessionActive,
    stopRecording,
  ]);

  useEffect(() => {
    if (isSessionActive && selectedVoiceId === null) {
      stopSession();
    }
  }, [isSessionActive, selectedVoiceId, stopSession]);

  useEffect(() => {
    if (!museTelemetry?.eeg_assisted_tone_available && eegAssistedToneEnabled) {
      setEegAssistedToneEnabled(false);
    }
  }, [eegAssistedToneEnabled, museTelemetry?.eeg_assisted_tone_available]);

  useEffect(() => {
    if (
      !isSessionActive ||
      selectedVoiceId === null ||
      isRecording ||
      isProcessing ||
      isAwaitingAudioOutput ||
      audioBlob
    ) {
      return;
    }

    void startRecording();
  }, [
    audioBlob,
    isAwaitingAudioOutput,
    isProcessing,
    isRecording,
    isSessionActive,
    selectedVoiceId,
    startRecording,
  ]);

  useEffect(() => {
    if (!audioBlob) {
      submittedBlobRef.current = null;
      submittedVoiceIdRef.current = null;
      return;
    }

    if (!audioBlob || selectedVoiceId === null || !isSessionActive) {
      return;
    }

    if (
      submittedBlobRef.current === audioBlob &&
      submittedVoiceIdRef.current === selectedVoiceId
    ) {
      return;
    }

    submittedBlobRef.current = audioBlob;
    submittedVoiceIdRef.current = selectedVoiceId;

    let isCancelled = false;

    const run = async () => {
      const nextResult = await processRecording(
        audioBlob,
        selectedVoiceId,
        noiseReductionEnabled,
        eegAssistedToneEnabled,
        submittedTranscript,
      );
      if (!isCancelled && nextResult?.audioUrl) {
        setIsAwaitingAudioOutput(true);
      }
      if (!isCancelled) {
        clearAudioBlob();
      }
    };

    void run();

    return () => {
      isCancelled = true;
    };
  }, [
    audioBlob,
    clearAudioBlob,
    eegAssistedToneEnabled,
    isSessionActive,
    noiseReductionEnabled,
    processRecording,
    selectedVoiceId,
    submittedTranscript,
  ]);

  return (
    <main className="min-h-screen overflow-hidden bg-cream text-ink">
      <div className="absolute inset-x-0 top-0 -z-0 h-[34rem] bg-[radial-gradient(circle_at_top_left,_rgba(215,228,221,0.92),_transparent_52%),radial-gradient(circle_at_top_right,_rgba(225,196,178,0.55),_transparent_42%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[110rem] flex-col px-4 py-6 sm:px-6 lg:px-10">
        <header className="surface-panel mb-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4 sm:gap-5">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[28px] border border-white/70 bg-white/75 shadow-[0_22px_45px_-28px_rgba(34,51,42,0.45)] sm:h-24 sm:w-24">
                <img
                  src={logoMark}
                  alt="Be My Voices logo"
                  className="h-14 w-14 sm:h-16 sm:w-16"
                />
              </div>
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.42em] text-ink/45 sm:text-xs">
                  Assistive Speech Recovery
                </p>
                <h1 className="mt-2 font-display text-[clamp(2.7rem,7vw,5.8rem)] uppercase leading-[0.9] text-ink">
                  <span className="header-wordmark-outline">Be</span>{" "}
                  <span className="header-wordmark-accent">My</span>{" "}
                  <span className="header-wordmark-solid">Voices</span>
                </h1>
              </div>
            </div>
            <p className="max-w-md text-sm leading-7 text-ink/62 md:text-right">
              Recover fragmented speech into a clear, familiar voice with a
              calmer and more personal communication loop.
            </p>
          </div>
        </header>

        <section className="grid flex-1 gap-6 lg:grid-cols-3">
          <div className="grid gap-6">
            <VoiceSelector
              voices={voices}
              selectedVoiceId={selectedVoiceId}
              isLoading={isLoading}
              isCloning={isCloning}
              loadError={voicesError}
              cloneError={cloneError}
              voiceMutationError={voiceMutationError}
              onRefresh={refreshVoices}
              onSelect={selectVoice}
              onClone={cloneNewVoice}
              onUpdateVoice={updateExistingVoice}
              onDeleteVoice={removeVoice}
            />

            <RecoveryDisplay
              result={result}
              isSessionActive={isSessionActive}
              isRecording={isRecording}
              isProcessing={isProcessing}
              isAwaitingAudioOutput={isAwaitingAudioOutput}
              error={processError}
              selectedVoiceName={selectedVoice?.name}
              outputDeviceId={selectedOutputId}
              onPlaybackComplete={() => {
                setIsAwaitingAudioOutput(false);
              }}
            />
          </div>

          <AudioRecorder
            canStartSession={selectedVoiceId !== null}
            isSessionActive={isSessionActive}
            isRecording={isRecording}
            isProcessing={isProcessing}
            isAwaitingAudioOutput={isAwaitingAudioOutput}
            noiseReductionEnabled={noiseReductionEnabled}
            eegAssistedToneEnabled={eegAssistedToneEnabled}
            eegToneAvailable={Boolean(museTelemetry?.eeg_assisted_tone_available)}
            currentTonePolicy={museTelemetry?.tone_policy ?? null}
            recorderError={recorderError}
            processError={processError}
            liveTranscript={liveTranscript}
            latestBrokenText={result?.brokenText ?? ""}
            waveformLevels={waveformLevels}
            onNoiseReductionChange={setNoiseReductionEnabled}
            onEegAssistedToneChange={setEegAssistedToneEnabled}
            onProcessCurrentSentence={processCurrentSentence}
            onStartSession={startSession}
            onStopSession={stopSession}
          />

          <div className="grid gap-6">
            <ConnectedDevices
              telemetry={museTelemetry}
              isLoading={isMuseLoading}
              isMutating={isMuseMutating}
              error={museError}
              onConnect={connectDevice}
              onDisconnect={disconnectDevice}
              audioInputs={audioInputs}
              audioOutputs={audioOutputs}
              selectedInputId={selectedInputId}
              selectedOutputId={selectedOutputId}
              onSelectInput={setSelectedInputId}
              onSelectOutput={setSelectedOutputId}
              onScanAudio={scanAudioDevices}
              isScanningAudio={isScanningAudio}
              audioPermissionGranted={audioPermissionGranted}
              audioError={audioDeviceError}
              outputSelectionSupported={outputSelectionSupported}
            />

            <MuseDashboard telemetry={museTelemetry} />
          </div>
        </section>
      </div>
    </main>
  );
}
