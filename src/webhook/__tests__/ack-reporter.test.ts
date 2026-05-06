/**
 * Unit tests for ack-reporter.
 *
 * The ack-reporter is a pure transformation: given a ForwardResult and the
 * webhook_message_id, it produces a wire-shaped AckPayload ready to be sent
 * via subscription.perform("ack", payload).
 */

import { describe, it, expect } from "vitest";
import { buildAck } from "../ack-reporter.js";
import {
  parseAck,
  ACK,
} from "../../transport/webhook-listen-protocol.js";

describe("ack-reporter — buildAck", () => {
  it("produces a valid AckPayload from a successful forward result", () => {
    const result = buildAck(
      { status: 200, durationMs: 42, responseBody: "ok" },
      "wmsg_123",
    );

    expect(result.webhook_message_id).toBe("wmsg_123");
    expect(result.status).toBe(200);
    expect(result.response_body).toBe("ok");
    expect(result.duration_ms).toBe(42);
  });

  it("field names match the protocol module constants", () => {
    const result = buildAck(
      { status: 500, durationMs: 123, responseBody: "error" },
      "wmsg_456",
    );

    // Verify exact key names match ACK constants
    expect(ACK.WEBHOOK_MESSAGE_ID in result).toBe(true);
    expect(ACK.STATUS in result).toBe(true);
    expect(ACK.RESPONSE_BODY in result).toBe(true);
    expect(ACK.DURATION_MS in result).toBe(true);
  });

  it("round-trips through the strict parseAck validator", () => {
    const result = buildAck(
      { status: 201, durationMs: 15.5, responseBody: "created" },
      "wmsg_789",
    );

    // parseAck throws on invalid shape — if this passes, shape is correct
    const parsed = parseAck(result);
    expect(parsed.webhook_message_id).toBe("wmsg_789");
    expect(parsed.status).toBe(201);
    expect(parsed.response_body).toBe("created");
    expect(parsed.duration_ms).toBe(15.5);
  });

  it("handles status 0 (network error) correctly", () => {
    const result = buildAck(
      { status: 0, durationMs: 0, responseBody: "ECONNREFUSED" },
      "wmsg_000",
    );

    expect(result.status).toBe(0);
    expect(result.response_body).toBe("ECONNREFUSED");
    expect(parseAck(result)).toBeDefined();
  });
});
