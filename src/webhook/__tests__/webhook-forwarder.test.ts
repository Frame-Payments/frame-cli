/**
 * Unit tests for webhook-forwarder.
 *
 * The forwarder is a pure transformation: given a BroadcastEventMessage,
 * the session secret (whsec), and the forward-to URL, it POSTs the event
 * with X-Frame-Event and X-Frame-Signature headers and returns
 * {status, durationMs, responseBody}.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { forwardEvent, type ForwardResult } from "../webhook-forwarder.js";
import type { BroadcastEventMessage } from "../../transport/webhook-listen-protocol.js";

const WHSEC = "whsec_cli_test_secret";
const FORWARD_TO = "http://localhost:4000/webhooks";

function makeEvent(overrides: Partial<BroadcastEventMessage> = {}): BroadcastEventMessage {
  return {
    webhook_message_id: "wmsg_001",
    event_type: "account.created",
    headers: {
      "X-Frame-Event": "account.created",
      "X-Frame-Signature": "sha256=" + "0".repeat(64),
      "X-Frame-Webhook-Id": "wmsg_001",
      "User-Agent": "Frame-Robot v1.0.0",
      "Content-Type": "application/json",
    },
    payload: { id: "acct_1", name: "Test" },
    ...overrides,
  };
}

describe("webhook-forwarder — forwardEvent", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 1. HMAC signing ──────────────────────────────────────────────────────────

  it("signs the request body with sha256=<hex> using the whsec", async () => {
    const event = makeEvent();
    const body = JSON.stringify(event.payload);
    const expectedSig = "sha256=" + createHmac("sha256", WHSEC).update(body).digest("hex");

    const mockFetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await forwardEvent(event, WHSEC, FORWARD_TO);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(opts.headers["X-Frame-Signature"]).toBe(expectedSig);
  });

  it("HMAC signature is deterministic for the same body+secret", async () => {
    const event = makeEvent({ payload: { amount: 100 } });

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);

    const r1 = await forwardEvent(event, WHSEC, FORWARD_TO);
    const r2 = await forwardEvent(event, WHSEC, FORWARD_TO);

    // Both calls should produce the same signature
    const sig1 = (mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }])[1].headers["X-Frame-Signature"];
    const sig2 = (mockFetch.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }])[1].headers["X-Frame-Signature"];
    expect(sig1).toBe(sig2);

    // And same results
    expect(r1.status).toBe(r2.status);
  });

  // ── 2. Request shape ─────────────────────────────────────────────────────────

  it("POSTs to the forwardTo URL with X-Frame-Event header and application/json", async () => {
    const event = makeEvent({ event_type: "transfer.completed" });

    const mockFetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await forwardEvent(event, WHSEC, FORWARD_TO);

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(FORWARD_TO);
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-Frame-Event"]).toBe("transfer.completed");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("sends the payload as the JSON body", async () => {
    const event = makeEvent({ payload: { amount: 500, currency: "usd" } });

    const mockFetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);

    await forwardEvent(event, WHSEC, FORWARD_TO);

    const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(opts.body)).toEqual({ amount: 500, currency: "usd" });
  });

  // ── 3. Return value ──────────────────────────────────────────────────────────

  it("returns status from the HTTP response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      status: 201,
      text: () => Promise.resolve("created"),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await forwardEvent(makeEvent(), WHSEC, FORWARD_TO);
    expect(result.status).toBe(201);
    expect(result.responseBody).toBe("created");
  });

  it("non-2xx response is reported as-is without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await forwardEvent(makeEvent(), WHSEC, FORWARD_TO);
    expect(result.status).toBe(500);
    expect(result.responseBody).toBe("Internal Server Error");
  });

  it("returns a positive durationMs", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await forwardEvent(makeEvent(), WHSEC, FORWARD_TO);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.durationMs)).toBe(true);
  });

  // ── 4. Error handling ────────────────────────────────────────────────────────

  it("fetch failure returns status 0 and the error message, does not throw", async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await forwardEvent(makeEvent(), WHSEC, FORWARD_TO);
    expect(result.status).toBe(0);
    expect(result.responseBody).toContain("ECONNREFUSED");
  });

  it("unreachable host returns status 0, does not crash", async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", mockFetch);

    const result: ForwardResult = await forwardEvent(makeEvent(), WHSEC, FORWARD_TO);
    expect(result.status).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
