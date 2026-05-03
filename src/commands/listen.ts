/**
 * `frame listen` — subscribe to WebhookListenChannel via ActionCable and
 * forward incoming webhook events to a local --forward-to URL.
 *
 * Flags:
 *   --forward-to <url>        POST each event here with X-Frame-Event and
 *                             X-Frame-Signature headers signed with the session
 *                             secret received from the channel on connect.
 *   --events <a,b,...>        Filter stream to these event codes (server-side
 *                             via channel params + client-side safety check).
 *   --skip-endpoints          Instruct server to suppress sibling sandbox
 *                             endpoints for the duration of the session.
 *
 * The welcome session secret (whsec_cli_*) is printed prominently on startup
 * so the merchant can paste it into their local .env to verify signatures.
 */

import { createHmac } from "node:crypto";
import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createCableClient } from "../transport/cable-client.js";
import { resolveBaseUrl } from "../auth/api-client.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ListenOptions {
  /** URL to forward events to via POST. */
  forwardTo?: string;
  /** Only forward these event codes; if empty/absent, all events are forwarded. */
  events?: string[];
  /** Instruct server to suppress sibling sandbox endpoints. */
  skipEndpoints?: boolean;
  /**
   * Override the ActionCable WebSocket URL.
   * Defaults to the wss:// equivalent of the resolved API base URL + /cable.
   * Injected in tests to point at the FakeCableServer.
   */
  cableUrl?: string;
  /**
   * AbortSignal that stops the listen loop cleanly.
   * If omitted, the command runs until SIGINT/SIGTERM.
   */
  signal?: AbortSignal;
}

interface SessionStartedMessage {
  type: "session_started";
  session_secret: string;
}

interface EventMessage {
  type: "event";
  event_type: string;
  event_id: string;
  payload: Record<string, unknown>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive the ActionCable WebSocket URL from the HTTP API base URL.
 * https://api.framepayments.com → wss://api.framepayments.com/cable
 */
function deriveCableUrl(apiBaseUrl: string): string {
  const wsScheme = apiBaseUrl.startsWith("https://") ? "wss://" : "ws://";
  return apiBaseUrl.replace(/^https?:\/\//, wsScheme) + "/cable";
}

/** Compute the X-Frame-Signature header value for a request body. */
function computeSignature(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Format the current wall-clock time as HH:MM:SS for the event log line. */
function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function run(opts: ListenOptions = {}): Promise<void> {
  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }

  // Build the WebSocket URL, appending the API key as a query parameter so
  // the Rails server can authenticate the connection.
  const baseWsUrl =
    opts.cableUrl ?? deriveCableUrl(resolveBaseUrl(cred));
  const wsUrl = new URL(baseWsUrl);
  wsUrl.searchParams.set("api_key", cred.apiKey);

  const channelParams: Record<string, unknown> = {};
  if (opts.events && opts.events.length > 0) {
    channelParams.events = opts.events;
  }
  if (opts.skipEndpoints) {
    channelParams.skip_endpoints = true;
  }

  await runWithBanner(
    { merchant: cred.merchant, mode: cred.devMode ? "sandbox" : "live" },
    async () => {
    const client = createCableClient(wsUrl.toString());

    let sessionSecret: string | null = null;

    const subscription = client
      .subscribe("WebhookListenChannel", channelParams)
      .on("session_started", (raw) => {
        const msg = raw as SessionStartedMessage;
        sessionSecret = msg.session_secret;
        process.stdout.write(
          `\n  ✓ Session started\n    Webhook secret: ${sessionSecret}\n    Paste this into your local .env as FRAME_WEBHOOK_SECRET.\n\n`,
        );
      })
      .on("event", (raw) => {
        void handleEvent(raw as EventMessage);
      });

    async function handleEvent(evt: EventMessage): Promise<void> {
      // Client-side filter (belt-and-suspenders; server also filters via params)
      if (
        opts.events &&
        opts.events.length > 0 &&
        !opts.events.includes(evt.event_type)
      ) {
        return;
      }

      const bodyStr = JSON.stringify(evt.payload ?? {});
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Frame-Event": evt.event_type,
        ...(sessionSecret != null
          ? { "X-Frame-Signature": computeSignature(sessionSecret, bodyStr) }
          : {}),
      };

      let localStatus = 0;
      if (opts.forwardTo) {
        try {
          const resp = await fetch(opts.forwardTo, {
            method: "POST",
            headers,
            body: bodyStr,
          });
          localStatus = resp.status;
        } catch (err) {
          process.stderr.write(
            `  ✗ Forward failed: ${(err as Error).message}\n`,
          );
        }
      }

      // Acknowledge receipt back to the server
      try {
        subscription.perform("ack", {
          event_id: evt.event_id,
          status: localStatus,
        });
      } catch {
        // Not connected (transient); server will retry
      }

      process.stdout.write(
        `${timestamp()}  ${evt.event_type}  → ${localStatus || "-"}\n`,
      );
    }

    // ── Wait until aborted or SIGINT ────────────────────────────────────────

    await new Promise<void>((resolve) => {
      if (opts.signal) {
        if (opts.signal.aborted) {
          resolve();
          return;
        }
        opts.signal.addEventListener("abort", () => resolve(), { once: true });
      } else {
        // Running interactively — stop on Ctrl-C
        const onSignal = () => resolve();
        process.once("SIGINT", onSignal);
        process.once("SIGTERM", onSignal);
      }
    });

    subscription.unsubscribe();
    client.disconnect();
  });
}
