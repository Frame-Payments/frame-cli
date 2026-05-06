/**
 * webhook/ack-reporter
 *
 * Pure transformation: given a ForwardResult and the webhook_message_id,
 * produces a wire-shaped AckPayload ready to send via subscription.perform.
 *
 * Field names are sourced exclusively from the protocol module so a wire
 * rename causes a TypeScript error rather than a silent drift.
 */

import { buildAckPayload, type AckPayload } from "../transport/webhook-listen-protocol.js";
import type { ForwardResult } from "./webhook-forwarder.js";

/**
 * Build the ack payload from a forwarder result.
 *
 * @param result           The result returned by forwardEvent.
 * @param webhookMessageId The webhook_message_id from the broadcast event.
 */
export function buildAck(
  result: Pick<ForwardResult, "status" | "durationMs" | "responseBody">,
  webhookMessageId: string,
): AckPayload {
  return buildAckPayload({
    webhookMessageId,
    status: result.status,
    responseBody: result.responseBody,
    durationMs: result.durationMs,
  });
}
