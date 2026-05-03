/**
 * auth/api-client — single fetch wrapper for the Frame API.
 *
 * Injects `Authorization: Bearer <key>` and `X-Frame-API-Version` headers
 * on every request, and normalises non-2xx responses into an `ApiError`.
 */

export const API_VERSION = "2025-01-01";
export const DEFAULT_BASE_URL = "https://api.frame.dev";

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

/** Shape returned by GET /me. */
export interface MeResponse {
  id: string;
  name: string;
}

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
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
}

export interface ApiClientOptions {
  apiKey: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the human-readable message from a Frame API error body.
 * Returns null if the body doesn't follow the `{ error: { message } }` shape.
 */
function serverErrorMessage(body: unknown): string | null {
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    body.error !== null &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;

  async function request<T>(method: string, path: string, reqBody?: unknown): Promise<T> {
    const url = `${base}${path}`;
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "X-Frame-API-Version": API_VERSION,
        "Content-Type": "application/json",
      },
      ...(reqBody !== undefined ? { body: JSON.stringify(reqBody) } : {}),
    });

    const body = (await resp.json()) as unknown;

    if (!resp.ok) {
      const msg = serverErrorMessage(body) ?? `HTTP ${resp.status}`;
      throw new ApiError(resp.status, msg);
    }

    return body as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  };
}
