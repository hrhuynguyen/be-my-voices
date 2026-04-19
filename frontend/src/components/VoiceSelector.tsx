import { ChangeEvent, FormEvent, useEffect, useId, useRef, useState } from "react";

import { useVoiceSampleRecorder } from "../hooks/useVoiceSampleRecorder";
import type { Voice } from "../types/voice";

interface VoiceSelectorProps {
  voices: Voice[];
  selectedVoiceId: number | null;
  isLoading: boolean;
  isCloning: boolean;
  loadError: string | null;
  cloneError: string | null;
  voiceMutationError: string | null;
  onRefresh: () => Promise<void>;
  onSelect: (voiceId: number) => void;
  onClone: (input: {
    name: string;
    description?: string | null;
    samples: File[];
  }) => Promise<Voice | null>;
  onUpdateVoice: (
    voiceId: number,
    input: { name: string; description?: string | null },
  ) => Promise<Voice | null>;
  onDeleteVoice: (voiceId: number) => Promise<boolean>;
}

const MAX_SAMPLE_COUNT = 3;
const SUPPORTED_SAMPLE_EXTENSIONS = [".mp3", ".wav"];
const SUPPORTED_SAMPLE_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
];
type SampleOrigin = "upload" | "recorded";

interface SampleEntry {
  id: string;
  file: File;
  origin: SampleOrigin;
  url: string;
}

function createSampleEntry(file: File, origin: SampleOrigin): SampleEntry {
  return {
    id: crypto.randomUUID(),
    file,
    origin,
    url: URL.createObjectURL(file),
  };
}

function isSupportedCloneFile(file: File): boolean {
  const extension = file.name.includes(".")
    ? `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    : "";
  const contentType = file.type.toLowerCase();
  return (
    SUPPORTED_SAMPLE_EXTENSIONS.includes(extension) ||
    SUPPORTED_SAMPLE_MIME_TYPES.includes(contentType)
  );
}

function formatSeconds(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function VoiceSelector({
  voices,
  selectedVoiceId,
  isLoading,
  isCloning,
  loadError,
  cloneError,
  voiceMutationError,
  onRefresh,
  onSelect,
  onClone,
  onUpdateVoice,
  onDeleteVoice,
}: VoiceSelectorProps) {
  const [isClonePanelOpen, setIsClonePanelOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [samples, setSamples] = useState<SampleEntry[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingVoiceId, setEditingVoiceId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingVoiceId, setDeletingVoiceId] = useState<number | null>(null);
  const fileInputId = useId();
  const samplesRef = useRef<SampleEntry[]>([]);
  const {
    startRecording,
    stopRecording,
    recordedBlob,
    clearRecordedBlob,
    isRecording,
    elapsedSeconds,
    error: recordingError,
  } = useVoiceSampleRecorder();

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  useEffect(() => {
    return () => {
      samplesRef.current.forEach((sample) => URL.revokeObjectURL(sample.url));
    };
  }, []);

  useEffect(() => {
    if (!recordedBlob) return;
    if (samples.length >= MAX_SAMPLE_COUNT) {
      setFormError(`Use up to ${MAX_SAMPLE_COUNT} audio samples.`);
      clearRecordedBlob();
      return;
    }

    const file = new File(
      [recordedBlob],
      `recorded-sample-${samples.length + 1}.wav`,
      { type: "audio/wav" },
    );

    setSamples((current) => [...current, createSampleEntry(file, "recorded")]);
    setFormError(null);
    clearRecordedBlob();
  }, [clearRecordedBlob, recordedBlob, samples.length]);

  const clearSamples = () => {
    samplesRef.current.forEach((sample) => URL.revokeObjectURL(sample.url));
    setSamples([]);
  };

  const removeSample = (sampleId: string) => {
    setSamples((current) => {
      const sample = current.find((item) => item.id === sampleId);
      if (sample) {
        URL.revokeObjectURL(sample.url);
      }
      return current.filter((item) => item.id !== sampleId);
    });
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (nextFiles.length === 0) return;

    const supportedFiles = nextFiles.filter(isSupportedCloneFile);
    const rejectedCount = nextFiles.length - supportedFiles.length;

    if (supportedFiles.length === 0) {
      setFormError("Only MP3 and WAV files are supported for voice cloning.");
      return;
    }

    const availableSlots = MAX_SAMPLE_COUNT - samples.length;
    if (availableSlots <= 0) {
      setFormError(`Use up to ${MAX_SAMPLE_COUNT} audio samples.`);
      return;
    }

    const filesToAdd = supportedFiles.slice(0, availableSlots);
    if (rejectedCount > 0) {
      setFormError("Only MP3 and WAV files were added.");
    } else if (filesToAdd.length < supportedFiles.length) {
      setFormError(`Only the first ${MAX_SAMPLE_COUNT} samples were kept.`);
    } else {
      setFormError(null);
    }

    setSamples((current) => [
      ...current,
      ...filesToAdd.map((file) => createSampleEntry(file, "upload")),
    ]);
  };

  const handleRecordedSample = async () => {
    if (samples.length >= MAX_SAMPLE_COUNT) {
      setFormError(`Use up to ${MAX_SAMPLE_COUNT} audio samples.`);
      return;
    }
    await startRecording();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError("Give the voice a short name.");
      return;
    }
    if (samples.length === 0) {
      setFormError("Add at least one audio sample.");
      return;
    }
    if (samples.length > MAX_SAMPLE_COUNT) {
      setFormError(`Use up to ${MAX_SAMPLE_COUNT} audio samples.`);
      return;
    }

    const created = await onClone({
      name: name.trim(),
      description: description.trim() || undefined,
      samples: samples.map((sample) => sample.file),
    });

    if (created) {
      setName("");
      setDescription("");
      clearSamples();
      setIsClonePanelOpen(false);
    }
  };

  const startEditingVoice = (voice: Voice) => {
    setEditingVoiceId(voice.id);
    setEditName(voice.name);
    setEditDescription(voice.description ?? "");
  };

  const cancelEditingVoice = () => {
    setEditingVoiceId(null);
    setEditName("");
    setEditDescription("");
  };

  const handleEditVoice = async (voiceId: number) => {
    if (!editName.trim()) {
      return;
    }

    setIsSavingEdit(true);
    const updated = await onUpdateVoice(voiceId, {
      name: editName.trim(),
      description: editDescription.trim() || null,
    });
    setIsSavingEdit(false);

    if (updated) {
      cancelEditingVoice();
    }
  };

  const handleDeleteVoice = async (voice: Voice) => {
    const shouldDelete = window.confirm(
      `Delete cloned voice "${voice.name}" from the app database?`,
    );
    if (!shouldDelete) {
      return;
    }

    setDeletingVoiceId(voice.id);
    await onDeleteVoice(voice.id);
    setDeletingVoiceId(null);

    if (editingVoiceId === voice.id) {
      cancelEditingVoice();
    }
  };

  return (
    <section className="surface-panel flex h-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-ink/55">
            Voices
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink">
            Choose a saved voice
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="rounded-full border border-ink/10 px-4 py-2 text-sm text-ink transition hover:border-ink/30 hover:bg-white/70"
        >
          Refresh
        </button>
      </div>

      {loadError || voiceMutationError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || voiceMutationError}
        </p>
      ) : null}

      <div
        className={`grid gap-3 ${
          voices.length > 4 ? "max-h-[30rem] overflow-y-auto pr-2" : ""
        }`}
      >
        {isLoading ? (
          <div className="rounded-[28px] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            Loading saved voices...
          </div>
        ) : voices.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            No voices in the database yet. Clone one to start the session flow.
          </div>
        ) : (
          voices.map((voice) => {
            const isSelected = voice.id === selectedVoiceId;
            const isEditing = editingVoiceId === voice.id;
            const isDeleting = deletingVoiceId === voice.id;
            return (
              <div
                key={voice.id}
                className={`rounded-[28px] border px-5 py-4 text-left transition ${
                  isSelected
                    ? "border-ink bg-ink text-white shadow-[0_24px_55px_-32px_rgba(34,51,42,0.9)]"
                    : "border-ink/10 bg-white/70 text-ink hover:border-ink/30 hover:bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelect(voice.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-xl">{voice.name}</p>
                        <p
                          className={`mt-1 text-sm ${
                            isSelected ? "text-white/75" : "text-ink/65"
                          }`}
                        >
                          {voice.description || "Custom recovery voice"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${
                          isSelected
                            ? "bg-white/12 text-white/80"
                            : "bg-mist text-ink/65"
                        }`}
                      >
                        {voice.is_cloned ? "Cloned" : "Imported"}
                      </span>
                    </div>
                  </button>
                  {voice.is_cloned ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          isEditing ? cancelEditingVoice() : startEditingVoice(voice)
                        }
                        className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] transition ${
                          isSelected
                            ? "border-white/18 text-white/80 hover:bg-white/10"
                            : "border-ink/10 text-ink/65 hover:bg-cream"
                        }`}
                      >
                        {isEditing ? "Cancel" : "Edit"}
                      </button>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void handleDeleteVoice(voice)}
                        className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] transition ${
                          isSelected
                            ? "border-white/18 text-white/80 hover:bg-white/10"
                            : "border-ink/10 text-ink/65 hover:bg-cream"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {isDeleting ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {isEditing ? (
                  <div
                    className={`mt-4 grid gap-3 rounded-[22px] border p-4 ${
                      isSelected
                        ? "border-white/10 bg-white/8"
                        : "border-ink/10 bg-cream/70"
                    }`}
                  >
                    <label className="grid gap-2 text-sm">
                      <span className={isSelected ? "text-white/75" : "text-ink/70"}>
                        Voice name
                      </span>
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-ink/35"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className={isSelected ? "text-white/75" : "text-ink/70"}>
                        Description
                      </span>
                      <textarea
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        className="min-h-24 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-ink/35"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={isSavingEdit}
                        onClick={() => void handleEditVoice(voice.id)}
                        className="rounded-full bg-clay px-4 py-2 text-sm uppercase tracking-[0.16em] text-white transition hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSavingEdit ? "Saving..." : "Save changes"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditingVoice}
                        className={`rounded-full border px-4 py-2 text-sm uppercase tracking-[0.16em] transition ${
                          isSelected
                            ? "border-white/18 text-white/80 hover:bg-white/10"
                            : "border-ink/10 text-ink/65 hover:bg-cream"
                        }`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-[28px] border border-ink/10 bg-white/55 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-xl text-ink">Clone a new voice</p>
            <p className="mt-1 text-sm text-ink/65">
              Upload MP3 or WAV samples, or record WAV samples in the browser.
              The saved voice will appear in the selector after cloning
              finishes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsClonePanelOpen((current) => !current)}
            className="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-ink/90"
          >
            {isClonePanelOpen ? "Close" : "Clone"}
          </button>
        </div>

        {isClonePanelOpen ? (
          <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm text-ink/75">
              Voice name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-2xl border border-ink/10 bg-cream px-4 py-3 text-base text-ink outline-none transition focus:border-ink/35"
                placeholder="Grandma Lan"
              />
            </label>

            <label className="grid gap-2 text-sm text-ink/75">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-24 rounded-2xl border border-ink/10 bg-cream px-4 py-3 text-base text-ink outline-none transition focus:border-ink/35"
                placeholder="Warm, steady, familiar tone"
              />
            </label>

            <div className="grid gap-4 rounded-[24px] border border-ink/10 bg-cream/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-ink/75">Sample audio</p>
                  <p className="mt-1 text-xs text-ink/55">
                    Use short, clear MP3 or WAV clips in a quiet room. One to
                    three samples are enough.
                  </p>
                </div>
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/60">
                  {samples.length}/{MAX_SAMPLE_COUNT}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label
                    className="text-sm text-ink/75"
                    htmlFor={fileInputId}
                  >
                    Upload files
                  </label>
                  <input
                    id={fileInputId}
                    type="file"
                    accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                    multiple
                    onChange={handleFileSelection}
                    className="block w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink file:mr-4 file:rounded-full file:border-0 file:bg-mist file:px-4 file:py-2 file:text-sm file:text-ink"
                  />
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink/75">Record in browser</span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs tabular-nums ${
                        isRecording
                          ? "bg-clay text-white"
                          : "bg-white/80 text-ink/55"
                      }`}
                    >
                      {formatSeconds(elapsedSeconds)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      isRecording ? stopRecording() : void handleRecordedSample()
                    }
                    className={`rounded-2xl border px-4 py-3 text-sm transition ${
                      isRecording
                        ? "border-clay bg-clay text-white"
                        : "border-ink/10 bg-white text-ink hover:border-ink/30"
                    }`}
                  >
                    {isRecording ? "Stop recording sample" : "Record sample"}
                  </button>
                  <p className="text-xs text-ink/55">
                    {isRecording
                      ? "Timer is running while this sample is being recorded."
                      : "Record one short sample at a time."}
                  </p>
                </div>
              </div>

              {recordingError ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {recordingError}
                </p>
              ) : null}

              {samples.length > 0 ? (
                <div className="grid gap-3">
                  {samples.map((sample, index) => (
                    <div
                      key={sample.id}
                      className="rounded-[22px] border border-ink/10 bg-white/80 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-ink">
                            Sample {index + 1}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-ink/50">
                            {sample.origin === "recorded"
                              ? "Recorded in browser"
                              : "Uploaded file"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSample(sample.id)}
                          className="rounded-full border border-ink/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-ink/60 transition hover:border-ink/30 hover:bg-cream"
                        >
                          Remove
                        </button>
                      </div>
                      <audio
                        className="mt-3 w-full"
                        controls
                        preload="metadata"
                        src={sample.url}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink/55">
                  No samples added yet.
                </p>
              )}
            </div>

            {formError || cloneError ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {formError || cloneError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isCloning}
              className="rounded-full bg-clay px-5 py-3 text-sm uppercase tracking-[0.18em] text-white transition hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCloning ? "Cloning..." : "Save voice"}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
