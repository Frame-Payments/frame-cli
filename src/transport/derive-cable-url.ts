/**
 * transport/derive-cable-url
 *
 * Convert an HTTP(S) Frame API base URL into the wss:// URL of the
 * ActionCable mount.
 *
 * Two transformations happen here:
 *
 * 1. **Version-prefix stripping.** The CLI's base-URL convention
 *    deliberately includes the API version prefix (e.g.
 *    `https://api.framepayments.com/v1` — see `HARDCODED_DEFAULT_BASE_URL`
 *    in `auth/api-client.ts`). ActionCable, by contrast, is mounted at the
 *    bare origin under `/cable` (Rails default), NOT under the versioned
 *    path. Naively concatenating `/cable` to the API base URL produces
 *    `wss://…/v1/cable`, which 404s.
 *
 * 2. **`api.` → `ws.` host swap (framepayments.com only).** The `api.`
 *    hostnames resolve to Evervault Relay, an HTTP transform proxy that
 *    cannot tunnel a WebSocket: it forwards the upgrade handshake and
 *    returns the 101, then closes the connection before any frame flows.
 *    The cable therefore lives on a dedicated `ws.` hostname per
 *    environment that routes straight to the application origin (server
 *    ADR-0013). REST calls keep using `api.` — only the socket moves. The
 *    swap applies solely to `api.<env?>.framepayments.com` over https;
 *    local dev (`.test` hosts, localhost), `internal-api.`, and tunnels are
 *    left untouched.
 *
 *   https://api.framepayments.com/v1           → wss://ws.framepayments.com/cable
 *   https://api.staging.framepayments.com/v1   → wss://ws.staging.framepayments.com/cable
 *   https://internal-api.framepayments.com/v1  → wss://internal-api.framepayments.com/cable
 *   http://api.framepayments.test/v1           → ws://api.framepayments.test/cable
 *   http://localhost:3000                      → ws://localhost:3000/cable
 *
 * `FRAME_CABLE_URL` (see commands/listen.ts) overrides the derived URL
 * entirely, as the escape hatch for a broken or not-yet-provisioned `ws.`
 * record.
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
  const rerouted = origin.replace(
    /^(wss:\/\/)api\.((?:[a-z0-9-]+\.)?framepayments\.com)$/,
    "$1ws.$2",
  );
  return rerouted + "/cable";
}
