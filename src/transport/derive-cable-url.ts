/**
 * transport/derive-cable-url
 *
 * Convert an HTTP(S) Frame API base URL into the wss:// URL of the
 * ActionCable mount.
 *
 * The CLI's base-URL convention deliberately includes the API version
 * prefix (e.g. `https://api.framepayments.com/v1` — see
 * `HARDCODED_DEFAULT_BASE_URL` in `auth/api-client.ts`). ActionCable, by
 * contrast, is mounted at the bare origin under `/cable` (Rails default),
 * NOT under the versioned path. Naively concatenating `/cable` to the API
 * base URL produces `wss://…/v1/cable`, which 404s.
 *
 * This helper strips a trailing `/v\d+` segment (with or without a trailing
 * slash) before appending `/cable`, so:
 *
 *   https://api.framepayments.com/v1   → wss://api.framepayments.com/cable
 *   https://api.framepayments.com/v1/  → wss://api.framepayments.com/cable
 *   http://localhost:3000              → ws://localhost:3000/cable
 *
 * Contract: the input is expected to be either a bare origin or
 * `<origin>/v<digits>` (optionally trailing-slashed). Anything more exotic
 * (e.g. a proxy path like `/v1/internal`) is out of scope and will not
 * round-trip cleanly — keep base-URL semantics dumb.
 */
export function deriveCableUrl(apiBaseUrl: string): string {
  const wsScheme = apiBaseUrl.startsWith("https://") ? "wss://" : "ws://";
  const origin = apiBaseUrl
    .replace(/^https?:\/\//, wsScheme)
    .replace(/\/v\d+\/?$/, "");
  return origin + "/cable";
}
