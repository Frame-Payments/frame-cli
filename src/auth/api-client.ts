/**
 * auth/api-client — single fetch wrapper for the Frame API.
 *
 * Injects an `Authorization: Bearer <key>` header on every request and
 * normalises non-2xx (and non-JSON) responses into an `ApiError`.
 *
 * NOTE: the Frame API does not currently support Stripe-style dated API
 * versioning. When it does, an `X-Frame-API-Version: YYYY-MM-DD` header
 * should be added here. Until then we deliberately send no version header
 * rather than commit to a value the server doesn't honour.
 */

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

/**
 * Shape returned by GET /me.
 *
 * Field names mirror the wire format (snake_case). This is intentional —
 * see ADR-0002. Map to camelCase domain types at the call site.
 */
export interface MeResponse {
  merchant_id: string;
  merchant_name: string;
  dev_mode: boolean;
  api_version: string;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Field-level validation breakdown returned by the Frame API on 422 responses.
 * Shape mirrors `dry-validation` errors: `{ field: ["message", …] }`, possibly
 * nested for hash-typed fields (e.g. `profile: { individual: […] }`).
 */
export type ApiErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  /** Server-side error category (e.g. "validation_error", "not_found"). */
  public readonly errorType: string | undefined;
  /** Field-level validation breakdown when present (422s). */
  public readonly details: ApiErrorDetails | undefined;

  constructor(
    public readonly status: number,
    message: string,
    extras: { errorType?: string; details?: ApiErrorDetails } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.errorType = extras.errorType;
    this.details = extras.details;
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

/**
 * Pull the canonical Frame API error envelope `{ error: { type, message, errors } }`
 * out of a parsed response body. Returns `null` if the body doesn't match.
 */
function parseServerError(
  body: unknown,
): { message: string; errorType?: string; details?: ApiErrorDetails } | null {
  if (
    body === null ||
    typeof body !== "object" ||
    !("error" in body) ||
    body.error === null ||
    typeof body.error !== "object"
  ) {
    return null;
  }
  const err = body.error as Record<string, unknown>;
  if (typeof err.message !== "string") return null;

  const out: { message: string; errorType?: string; details?: ApiErrorDetails } = {
    message: err.message,
  };
  if (typeof err.type === "string") out.errorType = err.type;
  if (err.errors !== null && typeof err.errors === "object") {
    out.details = err.errors as ApiErrorDetails;
  }
  return out;
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
      const parsed = parseServerError(responseBody);
      if (parsed === null) {
        throw new ApiError(resp.status, `HTTP ${resp.status}`);
      }
      const extras: { errorType?: string; details?: ApiErrorDetails } = {};
      if (parsed.errorType !== undefined) extras.errorType = parsed.errorType;
      if (parsed.details !== undefined) extras.details = parsed.details;
      throw new ApiError(resp.status, parsed.message, extras);
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
