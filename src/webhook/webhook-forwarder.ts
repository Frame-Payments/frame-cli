/**
 * webhook/webhook-forwarder
 *
 * Pure transformation: given a parsed BroadcastEventMessage, the session
 * secret (whsec), and the forward-to URL, POSTs the event payload to the
 * local server with signed headers and returns a ForwardResult describing
 * what happened.
 *
 * Owns: HMAC signing, fetch, per-event error handling.
 * No knowledge of ActionCable or the cable client.
 */

import { createHmac } from "node:crypto";
import type { BroadcastEventMessage } from "../transport/webhook-listen-protocol.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ForwardResult {
  /** HTTP status returned by the local server, or 0 on network error. */
  status: number;
  /** Round-trip duration in milliseconds. */
  durationMs: number;
  /** Response body text (first 4 KB). Empty string on network error. */
  responseBody: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_RESPONSE_BODY_BYTES = 4096;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Forward a single broadcast event to the merchant's local server.
 *
 * @param event     Parsed broadcast event from the cable channel.
 * @param whsec     Session secret received in the welcome message.
 * @param forwardTo URL to POST the event to.
 * @returns         ForwardResult — never throws.
 */
export async function forwardEvent(
  event: BroadcastEventMessage,
  whsec: string,
  forwardTo: string,
): Promise<ForwardResult> {
  const body = JSON.stringify(event.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Frame-Event": event.event_type,
    "X-Frame-Signature": sign(whsec, body),
    "X-Frame-Webhook-Id": event.webhook_message_id,
  };

  const start = Date.now();
  try {
    const resp = await fetch(forwardTo, {
      method: "POST",
      headers,
      body,
    });

    const durationMs = Date.now() - start;
    const raw = await resp.text();
    const responseBody = raw.length > MAX_RESPONSE_BODY_BYTES
      ? raw.slice(0, MAX_RESPONSE_BODY_BYTES)
      : raw;

    return { status: resp.status, durationMs, responseBody };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      status: 0,
      durationMs,
      responseBody: err instanceof Error ? err.message : String(err),
    };
  }
}
