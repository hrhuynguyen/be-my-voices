import type { AudioDeviceOption } from "../hooks/useAudioDevices";
import type { EEGTelemetry } from "../types/eeg";

interface ConnectedDevicesProps {
  telemetry: EEGTelemetry | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  audioInputs: AudioDeviceOption[];
  audioOutputs: AudioDeviceOption[];
  selectedInputId: string | null;
  selectedOutputId: string | null;
  onSelectInput: (deviceId: string | null) => void;
  onSelectOutput: (deviceId: string | null) => void;
  onScanAudio: () => Promise<void>;
  isScanningAudio: boolean;
  audioPermissionGranted: boolean;
  audioError: string | null;
  outputSelectionSupported: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  disconnected: "bg-ink/10 text-ink/70",
  connecting: "bg-sage/30 text-ink",
  connected: "bg-clay text-white",
  error: "bg-red-100 text-red-700",
};

export function ConnectedDevices({
  telemetry,
  isLoading,
  isMutating,
  error,
  onConnect,
  onDisconnect,
  audioInputs,
  audioOutputs,
  selectedInputId,
  selectedOutputId,
  onSelectInput,
  onSelectOutput,
  onScanAudio,
  isScanningAudio,
  audioPermissionGranted,
  audioError,
  outputSelectionSupported,
}: ConnectedDevicesProps) {
  const status = telemetry?.connection_state ?? "disconnected";
  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.disconnected;
  const audioStatus = isScanningAudio
    ? "connecting"
    : audioPermissionGranted &&
        (audioInputs.length > 0 || audioOutputs.length > 0)
      ? "connected"
      : "disconnected";
  const audioStatusStyle = STATUS_STYLES[audioStatus] ?? STATUS_STYLES.disconnected;

  return (
    <section className="surface-panel flex flex-col gap-5">
      <p className="text-xs uppercase tracking-[0.28em] text-ink/55">
        Connected Devices
      </p>

      <div className="grid gap-3 rounded-[28px] border border-ink/8 bg-white/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
            Muse 2
          </p>
          <span
            className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] ${statusStyle}`}
          >
            {status}
          </span>
        </div>
        <p className="text-sm leading-7 text-ink/72">
          {telemetry?.status_message ??
            "Connect Muse 2 to stream affective-state telemetry into the tone policy."}
        </p>
        <div className="flex flex-nowrap items-center gap-2">
          <button
            type="button"
            disabled={isMutating || status === "connecting"}
            onClick={() => void onConnect()}
            className="whitespace-nowrap rounded-full bg-ink px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/40"
          >
            Connect Muse 2
          </button>
          <button
            type="button"
            disabled={isMutating || status === "disconnected"}
            onClick={() => void onDisconnect()}
            className="whitespace-nowrap rounded-full border border-ink/10 bg-transparent px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-ink/75 transition hover:border-ink/20 hover:bg-white/70 disabled:cursor-not-allowed disabled:text-ink/30"
          >
            Disconnect
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-[28px] border border-ink/8 bg-white/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
              Audio Devices
            </p>
            <p className="mt-1 text-sm leading-6 text-ink/70">
              Pair Bluetooth devices in System Settings first, then scan.
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.18em] ${audioStatusStyle}`}
          >
            {audioStatus}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isScanningAudio}
            onClick={() => void onScanAudio()}
            className="whitespace-nowrap rounded-full bg-ink px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/40"
          >
            {isScanningAudio ? "Scanning..." : "Scan audio devices"}
          </button>
        </div>

        <label className="grid gap-1 text-sm text-ink/75">
          <span className="text-xs uppercase tracking-[0.16em] text-ink/50">
            Microphone
          </span>
          <select
            value={selectedInputId ?? ""}
            onChange={(event) =>
              onSelectInput(event.target.value || null)
            }
            className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
            disabled={audioInputs.length === 0}
          >
            {audioInputs.length === 0 ? (
              <option value="">No input devices detected</option>
            ) : (
              audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="grid gap-1 text-sm text-ink/75">
          <span className="text-xs uppercase tracking-[0.16em] text-ink/50">
            Speaker
          </span>
          <select
            value={selectedOutputId ?? ""}
            onChange={(event) =>
              onSelectOutput(event.target.value || null)
            }
            className="rounded-2xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-ink/5"
            disabled={
              !outputSelectionSupported || audioOutputs.length === 0
            }
          >
            {!outputSelectionSupported ? (
              <option value="">
                Browser does not support output selection
              </option>
            ) : audioOutputs.length === 0 ? (
              <option value="">No output devices detected</option>
            ) : (
              audioOutputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))
            )}
          </select>
          {!outputSelectionSupported ? (
            <span className="text-xs text-ink/50">
              Use the OS default speaker when the browser cannot switch
              outputs.
            </span>
          ) : null}
        </label>

        {!audioPermissionGranted ? (
          <p className="text-xs text-ink/55">
            Device names stay hidden until you grant microphone permission.
            Click scan to unlock the full list.
          </p>
        ) : null}

        {audioError ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {audioError}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-ink/55">Loading Muse 2 telemetry...</p>
      ) : null}
    </section>
  );
}
