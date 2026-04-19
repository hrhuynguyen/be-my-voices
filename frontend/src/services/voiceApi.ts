import { apiFetch } from "../lib/api";
import type {
  CloneVoiceInput,
  CreateVoiceInput,
  UpdateVoiceInput,
  Voice,
} from "../types/voice";

export function getVoices(): Promise<Voice[]> {
  return apiFetch<Voice[]>("/api/voices");
}

export function createVoice(input: CreateVoiceInput): Promise<Voice> {
  return apiFetch<Voice>("/api/voices", {
    method: "POST",
    json: input,
  });
}

export function cloneVoice(input: CloneVoiceInput): Promise<Voice> {
  const form = new FormData();
  form.append("name", input.name);
  if (input.description) {
    form.append("description", input.description);
  }
  for (const sample of input.samples) {
    form.append("samples", sample, sample.name);
  }

  return apiFetch<Voice>("/api/voices/clone", {
    method: "POST",
    body: form,
  });
}

export function deleteVoice(id: number): Promise<void> {
  return apiFetch<void>(`/api/voices/${id}`, { method: "DELETE" });
}

export function updateVoice(id: number, input: UpdateVoiceInput): Promise<Voice> {
  return apiFetch<Voice>(`/api/voices/${id}`, {
    method: "PATCH",
    json: input,
  });
}
