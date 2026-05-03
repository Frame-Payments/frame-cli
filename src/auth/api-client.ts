/**
 * auth/api-client — single fetch wrapper for the Frame API.
 *
 * Injects `Authorization: Bearer <key>` and `X-Frame-API-Version` headers
 * on every request, and normalises non-2xx responses into an `ApiError`.
 */

export const API_VERSION = "2025-01-01";
export const DEFAULT_BASE_URL = "https://api.frame.dev";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Client shape
// ---------------------------------------------------------------------------

export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
}

export interface ApiClientOptions {
  apiKey: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;

  async function request<T>(path: string): Promise<T> {
    const url = `${base}${path}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "X-Frame-API-Version": API_VERSION,
        "Content-Type": "application/json",
      },
    });

    const body = (await resp.json()) as unknown;

    if (!resp.ok) {
      // Try to surface the server's error message.
      let msg = `HTTP ${resp.status}`;
      if (
        body !== null &&
        typeof body === "object" &&
        "error" in body &&
        body.error !== null &&
        typeof body.error === "object" &&
        "message" in body.error &&
        typeof body.error.message === "string"
      ) {
        msg = body.error.message;
      }
      throw new ApiError(resp.status, msg);
    }

    return body as T;
  }

  return { get: request };
}
