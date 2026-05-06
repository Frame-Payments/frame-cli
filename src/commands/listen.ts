/**
 * `frame listen` — subscribe to Cli::WebhookListenChannel via ActionCable
 * and forward incoming webhook events to a local --forward-to URL.
 *
 * Flags:
 *   --forward-to <url>        POST each event here with X-Frame-Event and
 *                             X-Frame-Signature headers signed with the
 *                             session secret (whsec) received in the welcome.
 *   --events <a,b,...>        Filter stream to these event codes (server-side
 *                             via channel params; client-side as belt-and-suspenders).
 *   --skip-endpoints          Instruct server to suppress sibling sandbox
 *                             endpoints for the duration of the session.
 *
 * Wire contract:
 *   Subscribe params   → event_codes: string[], session_token?: string
 *                        (plus skip_endpoints in identifier when set)
 *   Welcome (server→)  → { type: "session", whsec, endpoint_id, session_token }
 *   Broadcast (server→)→ { webhook_message_id, event_type, headers, payload }
 *   Ack (→server)      → { action: "ack", webhook_message_id, status,
 *                          response_body, duration_ms }
 *
 * See src/transport/webhook-listen-protocol.ts and ADR-0008 § "Wire contract".
 *
 * Sandbox-only enforcement per ADR-0007: live-key credentials cause an
 * immediate error before any network connection is attempted.
 */

import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createCableClient } from "../transport/cable-client.js";
import { deriveCableUrl } from "../transport/derive-cable-url.js";
import { resolveBaseUrl } from "../auth/api-client.js";
import {
  parseWelcome,
  parseBroadcastEvent,
  CHANNEL_NAME,
  type WelcomeMessage,
  type BroadcastEventMessage,
} from "../transport/webhook-listen-protocol.js";
import { forwardEvent } from "../webhook/webhook-forwarder.js";
import { buildAck } from "../webhook/ack-reporter.js";

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

// ─── Session state ─────────────────────────────────────────────────────────────

interface SessionState {
  whsec: string;
  endpointId: string;
  sessionToken: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

  // Sandbox-only enforcement (ADR-0007): live-key credentials must never
  // subscribe production traffic into a dev tool.
  if (!cred.devMode) {
    throw new Error(
      "frame listen only works in sandbox mode. " +
        "Your current credential is a live key. " +
        "Switch to a sandbox credential with `frame login`.",
    );
  }

  const wsUrl = opts.cableUrl ?? deriveCableUrl(resolveBaseUrl(cred));

  // Build channel identifier params.
  // event_codes: empty array = "all events"; non-empty = server-side filter.
  // skip_endpoints is a channel param (not in the wire protocol's
  // parseSubscribeParams, but the Rails channel reads it from params directly).
  const channelParams: Record<string, unknown> = {
    event_codes: opts.events && opts.events.length > 0 ? opts.events : [],
  };
  if (opts.skipEndpoints) {
    channelParams.skip_endpoints = true;
  }

  await runWithBanner(
    { merchant: cred.merchant, mode: cred.devMode ? "sandbox" : "live" },
    async () => {
      const client = createCableClient(wsUrl, { apiKey: cred.apiKey });

      let session: SessionState | null = null;

      // Subscribe and hold a reference so the welcome handler can call updateParams.
      const subscription = client.subscribe(CHANNEL_NAME, channelParams);

      // Welcome message: type = "session" (from the ActionCable channel)
      subscription.on("session", (raw) => {
        let welcome: WelcomeMessage;
        try {
          welcome = parseWelcome(raw);
        } catch (err) {
          process.stderr.write(
            `  ✗ Welcome parse error: ${(err as Error).message}\n`,
          );
          return;
        }

        session = {
          whsec: welcome.whsec,
          endpointId: welcome.endpoint_id,
          sessionToken: welcome.session_token,
        };

        // Update the subscription params so the next reconnect carries
        // session_token, enabling the server to resume the session within
        // its replay window (FRA-3540).
        subscription.updateParams({
          ...channelParams,
          session_token: welcome.session_token,
        });

        // Replayed welcome: the server resumed an existing session — the
        // whsec is unchanged so the merchant need not update their .env.
        if (welcome.replayed) return;

        process.stdout.write(
          `\n  ✓ Session started\n` +
            `    Webhook secret: ${welcome.whsec}\n` +
            `    Paste this into your local .env as FRAME_WEBHOOK_SECRET.\n\n`,
        );
      });

      // Broadcast events have no `type` field → cable client defaults to "message"
      subscription.on("message", (raw) => {
        void handleEvent(raw);
      });

      async function handleEvent(raw: unknown): Promise<void> {
        let event: BroadcastEventMessage;
        try {
          event = parseBroadcastEvent(raw);
        } catch {
          // Not a broadcast event (e.g. the welcome was routed here) — ignore
          return;
        }

        // Client-side filter (belt-and-suspenders; server also filters)
        if (
          opts.events &&
          opts.events.length > 0 &&
          !opts.events.includes(event.event_type)
        ) {
          return;
        }

        let result = { status: 0, durationMs: 0, responseBody: "" };
        if (opts.forwardTo && session) {
          result = await forwardEvent(event, session.whsec, opts.forwardTo);
        } else if (opts.forwardTo) {
          // Welcome not yet received — log but don't forward unsigned
          process.stderr.write(
            `  ✗ Event received before welcome; skipping forward\n`,
          );
        }

        // Acknowledge receipt back to the server
        try {
          const ackPayload = buildAck(result, event.webhook_message_id);
          subscription.perform("ack", ackPayload as unknown as Record<string, unknown>);
        } catch {
          // Not connected (transient); server will retry
        }

        process.stdout.write(
          `${timestamp()}  ${event.event_type}  → ${result.status || "-"}\n`,
        );
      }

      // ── Wait until aborted or SIGINT ──────────────────────────────────────

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
    },
  );
}
