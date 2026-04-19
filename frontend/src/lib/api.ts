const DEFAULT_API_BASE = "http://localhost:8000";

export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit;
};

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { json, headers, body, ...rest } = options;
  const finalHeaders = new Headers(headers);
  let finalBody: BodyInit | undefined = body;

  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    finalBody = JSON.stringify(json);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: finalHeaders,
      body: finalBody,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Cannot reach backend at ${API_BASE}. ${error.message}`
        : `Cannot reach backend at ${API_BASE}.`,
    );
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let detail = response.statusText;

    if (contentType.includes("application/json")) {
      const payload = (await response.json().catch(() => null)) as
        | { detail?: unknown }
        | null;
      if (typeof payload?.detail === "string") {
        detail = payload.detail;
      }
    } else {
      const text = await response.text().catch(() => response.statusText);
      if (text) {
        detail = text;
      }
    }

    throw new ApiError(response.status, detail || response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return new URL(path, `${API_BASE}/`).toString();
}
