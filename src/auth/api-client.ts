/**
 * auth/api-client — single fetch wrapper for the Frame API.
 *
 * Injects `Authorization: Bearer <key>` and `X-Frame-API-Version` headers
 * on every request, and normalises non-2xx responses into an `ApiError`.
 */

export const API_VERSION = "2025-01-01";

/**
 * Hardcoded fallback when no env var or stored credential overrides it.
 *
 * NOTE: includes the `/v1` API version prefix. Callers (and stored
 * credentials, and `--base-url` overrides) MUST follow the same convention:
 * pass the full base including `/v1`. We deliberately do not auto-append it,
 * to keep base-URL semantics dumb and predictable.
 */
export const HARDCODED_DEFAULT_BASE_URL = "https://api.framepayments.com/v1";

/**
 * Resolved default base URL for the Frame API.
 *
 * Resolution order:
 *   1. `FRAME_API_BASE_URL` env var (one-off local/staging overrides)
 *   2. `HARDCODED_DEFAULT_BASE_URL`
 *
 * Per-credential overrides (set via `frame login --base-url …`) are layered
 * on top of this default by callers via `resolveBaseUrl(cred)`.
 */
export const DEFAULT_BASE_URL =
  process.env.FRAME_API_BASE_URL ?? HARDCODED_DEFAULT_BASE_URL;

/**
 * Resolve the base URL for a given stored credential.
 *
 *   env var > stored credential > hardcoded default
 *
 * The env var wins so a developer can quickly point an existing login at a
 * local/staging server without re-running `frame login`.
 */
export function resolveBaseUrl(cred: { baseUrl?: string } | null | undefined): string {
  if (process.env.FRAME_API_BASE_URL) return process.env.FRAME_API_BASE_URL;
  if (cred?.baseUrl) return cred.baseUrl;
  return HARDCODED_DEFAULT_BASE_URL;
}

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
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
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
/**
 * Truncate an opaque response body to a bounded snippet safe to embed in an
 * error message. Collapses whitespace so an HTML error page doesn't blow up
 * the user's terminal with hundreds of newlines.
 */
function truncateForError(text: string, max = 200): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max)}… (${collapsed.length} chars total)`;
}

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

    const rawText = await resp.text();
    let responseBody: unknown;
    try {
      responseBody = rawText.length === 0 ? undefined : JSON.parse(rawText);
    } catch {
      throw new ApiError(
        resp.status,
        `HTTP ${resp.status} from ${url}: response was not valid JSON. Body: ${truncateForError(rawText)}`,
      );
    }

    if (!resp.ok) {
      const msg = serverErrorMessage(responseBody) ?? `HTTP ${resp.status}`;
      throw new ApiError(resp.status, msg);
    }

    return responseBody as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}
