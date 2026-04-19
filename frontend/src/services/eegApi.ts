import { apiFetch } from "../lib/api";
import type { EEGDebugSnapshot, EEGTelemetry, MuseProvider } from "../types/eeg";

interface ConnectMuseInput {
  mode?: MuseProvider;
}

export function getMuseTelemetry(): Promise<EEGTelemetry> {
  return apiFetch<EEGTelemetry>("/api/eeg/telemetry");
}

export function getMuseDebugSnapshot(): Promise<EEGDebugSnapshot> {
  return apiFetch<EEGDebugSnapshot>("/api/eeg/debug");
}

export function connectMuse(input?: ConnectMuseInput): Promise<EEGTelemetry> {
  return apiFetch<EEGTelemetry>("/api/eeg/connect", {
    method: "POST",
    json: input ?? {},
  });
}

export function disconnectMuse(): Promise<EEGTelemetry> {
  return apiFetch<EEGTelemetry>("/api/eeg/disconnect", {
    method: "POST",
  });
}

export function checkMuseConnection(): Promise<EEGTelemetry> {
  return apiFetch<EEGTelemetry>("/api/eeg/check", {
    method: "POST",
  });
}
