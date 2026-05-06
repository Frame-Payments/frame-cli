/**
 * Integration tests for `frame listen`.
 *
 * Uses the real FakeCableServer with the webhookListenChannel preset so
 * the wire contract matches the real Rails channel. No network is required;
 * fetch is stubbed for the --forward-to POST calls.
 *
 * Coverage:
 *   1. Banner printed before listen output (regression)
 *   2. Session secret (whsec) printed after welcome
 *   3. Event POSTed to --forward-to with X-Frame-Event and X-Frame-Signature
 *   4. Signature is HMAC-SHA256 of the JSON body, formatted as sha256=<hex>
 *   5. Ack sent back with real wire field names (webhook_message_id, status,
 *      response_body, duration_ms) — not the old imagined shape (event_id)
 *   6. Per-event log line includes event type and local HTTP status
 *   7. --events a,b,c: subscribe params include event_codes filter array
 *   8. --skip-endpoints: channel identifier includes skip_endpoints: true
 *   9. Live-key credential rejected (sandbox-only enforcement)
 *  10. 5xx local response: reported in log, does not crash listener
 *  11. Unreachable forward URL: clear log line, does not crash listener
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  createWebhookListenFakeCableServer,
  type WebhookListenFakeCableServer,
} from "../src/transport/__tests__/helpers/fake-cable-server.js";
import { run } from "../src/commands/listen.js";
import type { BroadcastEventMessage } from "../src/transport/webhook-listen-protocol.js";

// ─── Mock keyring ──────────────────────────────────────────────────────────────

vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

import * as keyring from "../src/auth/keyring.js";
const mockGet = vi.mocked(keyring.get);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function waitFor(predicate: () => boolean, timeout = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline)
        return reject(new Error("waitFor timeout: " + predicate.toString()));
      setTimeout(tick, 20);
    };
    tick();
  });
}

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

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe("frame listen", () => {
  let server: WebhookListenFakeCableServer;
  let ac: AbortController;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    server = await createWebhookListenFakeCableServer(
      {},
      { expectedApiKey: "sk_test_xyz" },
    );
    ac = new AbortController();
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();

    mockGet.mockResolvedValue({
      apiKey: "sk_test_xyz",
      merchant: "acct_001",
      devMode: true,
    });
  });

  afterEach(async () => {
    ac.abort();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
    await server.close();
  });

  // ── 1. Banner printed ────────────────────────────────────────────────────────

  it("prints mode: sandbox + merchant in the banner before listen output", async () => {
    const runPromise = run({ cableUrl: server.url, signal: ac.signal });

    await waitFor(() =>
      stderrSpy.mock.calls.some((c) => String(c[0]).includes("mode: sandbox")),
    );

    const bannerOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(bannerOutput).toContain("mode: sandbox");
    expect(bannerOutput).toContain("acct_001");

    ac.abort();
    await runPromise;
  });

  // ── 2. Session secret (whsec) printed ────────────────────────────────────────

  it("prints the whsec from the welcome message as the session secret", async () => {
    const runPromise = run({ cableUrl: server.url, signal: ac.signal });

    // Preset auto-sends welcome on subscribe; wait for it to reach stdout
    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) =>
        String(c[0]).includes(server.whsec),
      ),
    );

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain(server.whsec);

    ac.abort();
    await runPromise;
  });

  // ── 3–4. POST headers + signature verification ───────────────────────────────

  it("POSTs the event to --forward-to with X-Frame-Event and X-Frame-Signature", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, text: () => Promise.resolve("ok") });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      cableUrl: server.url,
      signal: ac.signal,
    });

    // Wait for welcome to be processed
    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    // Broadcast a real-shaped event
    server.broadcastEvent(
      makeEvent({
        event_type: "transfer.completed",
        payload: { amount: 1000, currency: "usd" },
        headers: {
          "X-Frame-Event": "transfer.completed",
          "X-Frame-Signature": "sha256=" + "0".repeat(64),
          "X-Frame-Webhook-Id": "wmsg_001",
          "User-Agent": "Frame-Robot v1.0.0",
          "Content-Type": "application/json",
        },
      }),
    );

    await waitFor(() => mockFetch.mock.calls.length > 0);

    const [url, fetchOpts] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe("http://localhost:4000/webhooks");
    expect((fetchOpts as { method: string }).method).toBe("POST");
    expect(fetchOpts.headers["X-Frame-Event"]).toBe("transfer.completed");

    // Signature should be sha256=<hex>
    const sigHeader = fetchOpts.headers["X-Frame-Signature"];
    expect(sigHeader).toMatch(/^sha256=[0-9a-f]{64}$/);

    // Verify the signature is correct HMAC-SHA256 of the payload body
    const expectedSig =
      "sha256=" +
      createHmac("sha256", server.whsec)
        .update(JSON.stringify({ amount: 1000, currency: "usd" }))
        .digest("hex");
    expect(sigHeader).toBe(expectedSig);

    ac.abort();
    await runPromise;
  });

  // ── 5. Ack with real wire field names ────────────────────────────────────────

  it("sends ack back with real wire field names (webhook_message_id, status, response_body, duration_ms)", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200, text: () => Promise.resolve("ok") });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      cableUrl: server.url,
      signal: ac.signal,
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    server.broadcastEvent(
      makeEvent({ webhook_message_id: "wmsg_ack_test" }),
    );

    // Wait for ack to be received and validated by the preset
    await waitFor(() => server.receivedAcks.length > 0);

    const ack = server.receivedAcks[0];
    expect(ack.webhook_message_id).toBe("wmsg_ack_test");
    expect(ack.status).toBe(200);
    expect(ack.response_body).toBe("ok");
    expect(typeof ack.duration_ms).toBe("number");

    // Confirm old imagined field (event_id) is NOT present
    expect("event_id" in ack).toBe(false);

    ac.abort();
    await runPromise;
  });

  // ── 6. Per-event log line ─────────────────────────────────────────────────────

  it("prints a one-line record with event_type and local status code", async () => {
    mockFetch.mockResolvedValueOnce({ status: 202, text: () => Promise.resolve("") });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      cableUrl: server.url,
      signal: ac.signal,
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    server.broadcastEvent(
      makeEvent({ event_type: "refund.created" }),
    );

    await waitFor(() =>
      stdoutSpy.mock.calls.some(
        (c) =>
          String(c[0]).includes("refund.created") &&
          String(c[0]).includes("202"),
      ),
    );

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allOutput).toContain("refund.created");
    expect(allOutput).toContain("202");

    ac.abort();
    await runPromise;
  });

  // ── 7. --events filter ───────────────────────────────────────────────────────

  it("sends event_codes as subscribe param and skips non-matching events client-side", async () => {
    mockFetch.mockResolvedValue({ status: 200, text: () => Promise.resolve("") });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      events: ["transfer.completed"],
      cableUrl: server.url,
      signal: ac.signal,
    });

    // Wait for subscribe
    await waitFor(() =>
      server.received.some(
        (m) =>
          m.command === "subscribe" &&
          m.identifier?.includes("WebhookListenChannel"),
      ),
    );

    // Channel identifier should include event_codes array
    const subMsg = server.received.find(
      (m) =>
        m.command === "subscribe" &&
        m.identifier?.includes("WebhookListenChannel"),
    );
    const identifier = JSON.parse(subMsg!.identifier!) as Record<string, unknown>;
    expect(identifier["event_codes"]).toEqual(["transfer.completed"]);

    // Wait for welcome
    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    // Send a non-matching event — should NOT be forwarded
    server.broadcastEvent(
      makeEvent({ event_type: "refund.created", webhook_message_id: "wmsg_skip" }),
    );

    // Give it a moment
    await new Promise((r) => setTimeout(r, 80));

    // Send matching event — should be forwarded
    server.broadcastEvent(
      makeEvent({
        event_type: "transfer.completed",
        webhook_message_id: "wmsg_match",
      }),
    );

    await waitFor(() => mockFetch.mock.calls.length > 0);

    // Only the matching event should have been forwarded
    expect(mockFetch.mock.calls.length).toBe(1);
    const fetchHeaders = (
      mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }]
    )[1].headers;
    expect(fetchHeaders["X-Frame-Event"]).toBe("transfer.completed");

    ac.abort();
    await runPromise;
  });

  // ── 8. --skip-endpoints ──────────────────────────────────────────────────────

  it("sends skip_endpoints: true in the channel identifier when --skip-endpoints is set", async () => {
    const runPromise = run({
      skipEndpoints: true,
      cableUrl: server.url,
      signal: ac.signal,
    });

    await waitFor(() =>
      server.received.some(
        (m) =>
          m.command === "subscribe" &&
          m.identifier?.includes("WebhookListenChannel"),
      ),
    );

    const subMsg = server.received.find(
      (m) =>
        m.command === "subscribe" &&
        m.identifier?.includes("WebhookListenChannel"),
    );
    const identifier = JSON.parse(subMsg!.identifier!) as Record<string, unknown>;
    expect(identifier["skip_endpoints"]).toBe(true);

    ac.abort();
    await runPromise;
  });

  // ── 9. Live-key rejection ────────────────────────────────────────────────────

  it("refuses to start when credential is a live key (devMode: false)", async () => {
    mockGet.mockResolvedValueOnce({
      apiKey: "sk_live_xyz",
      merchant: "acct_001",
      devMode: false,
    });

    await expect(
      run({ cableUrl: server.url, signal: ac.signal }),
    ).rejects.toThrow(/sandbox|dev|live/i);
  });

  // ── 10. 5xx local response ────────────────────────────────────────────────────

  it("logs a 5xx local response and does not crash the listener", async () => {
    mockFetch.mockResolvedValueOnce({ status: 500, text: () => Promise.resolve("Internal Server Error") });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      cableUrl: server.url,
      signal: ac.signal,
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    server.broadcastEvent(
      makeEvent({ event_type: "account.created" }),
    );

    await waitFor(() =>
      stdoutSpy.mock.calls.some(
        (c) => String(c[0]).includes("account.created") && String(c[0]).includes("500"),
      ),
    );

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allOutput).toContain("500");

    // Server should still be running (not crashed)
    expect(runPromise).toBeDefined();

    ac.abort();
    await runPromise;
  });

  // ── 11. Unreachable forward URL ───────────────────────────────────────────────

  it("handles unreachable forward URL with a clear log line and does not crash", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const runPromise = run({
      forwardTo: "http://localhost:9999/webhooks",
      cableUrl: server.url,
      signal: ac.signal,
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    server.broadcastEvent(
      makeEvent({ event_type: "account.created" }),
    );

    // Should log the event with status 0 (error)
    await waitFor(() =>
      stdoutSpy.mock.calls.some(
        (c) => String(c[0]).includes("account.created"),
      ),
    );

    // The listener should still be alive
    expect(runPromise).toBeDefined();

    ac.abort();
    await runPromise;
  });

  // ── 12. Reconnect within replay window ──────────────────────────────────────

  it("reconnect within replay window: does not reprint Session started and drains buffered events", async () => {
    // Use a very long replay window so the reconnect is always within it
    await server.close();
    server = await createWebhookListenFakeCableServer(
      { replayWindowMs: 60_000 },
      { expectedApiKey: "sk_test_xyz" },
    );

    mockFetch.mockResolvedValue({ status: 200, text: () => Promise.resolve("ok") });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      cableUrl: server.url,
      signal: ac.signal,
    });

    // Wait for initial welcome
    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    // Count how many times "Session started" has been printed so far
    const sessionStartedBefore = stdoutSpy.mock.calls.filter((c) =>
      String(c[0]).includes("Session started"),
    ).length;
    expect(sessionStartedBefore).toBe(1);

    // Force disconnect — triggers cable-client reconnect
    server.forceDisconnect();

    // Wait for the client to reconnect (second subscribe)
    await waitFor(() => {
      const subs = server.received.filter((m) => m.command === "subscribe");
      return subs.length >= 2;
    }, 4_000);

    // The second subscribe should include session_token in the identifier
    const subs = server.received.filter((m) => m.command === "subscribe");
    const reconnectSub = subs.at(-1)!;
    const reconnectParams = JSON.parse(reconnectSub.identifier!) as Record<string, unknown>;
    expect(reconnectParams["session_token"]).toBe(server.sessionToken);

    // Wait for the replay welcome to arrive (server.welcomesSent should have 2 entries)
    await waitFor(() => server.welcomesSent.length >= 2, 3_000);
    expect(server.welcomesSent[1]!.replayed).toBe(true);
    expect(server.welcomesSent[1]!.whsec).toBe(server.whsec);

    // "Session started" must NOT have been printed a second time
    const sessionStartedAfter = stdoutSpy.mock.calls.filter((c) =>
      String(c[0]).includes("Session started"),
    ).length;
    expect(sessionStartedAfter).toBe(1);

    ac.abort();
    await runPromise;
  });

  // ── 13. Reconnect outside replay window ──────────────────────────────────────

  it("reconnect outside replay window: prints fresh Session started with new whsec", async () => {
    // Use a 0ms replay window so the first reconnect is always outside it
    await server.close();
    server = await createWebhookListenFakeCableServer(
      { replayWindowMs: 0 },
      { expectedApiKey: "sk_test_xyz" },
    );

    const runPromise = run({
      cableUrl: server.url,
      signal: ac.signal,
    });

    // Wait for initial welcome
    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes(server.whsec)),
    );

    const firstWhsec = server.whsec;

    // Force disconnect
    server.forceDisconnect();

    // Wait for the client to reconnect and server to send fresh welcome
    await waitFor(() => server.welcomesSent.length >= 2, 4_000);

    // The second welcome should NOT be replayed and should have a different whsec
    expect(server.welcomesSent[1]!.replayed).toBe(false);
    expect(server.welcomesSent[1]!.whsec).not.toBe(firstWhsec);

    // A second "Session started" line must have been printed
    await waitFor(() =>
      stdoutSpy.mock.calls.filter((c) =>
        String(c[0]).includes("Session started"),
      ).length >= 2,
      3_000,
    );

    // The new whsec must appear in the output
    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allOutput).toContain(server.welcomesSent[1]!.whsec);

    ac.abort();
    await runPromise;
  });

  // ── Not logged in ────────────────────────────────────────────────────────────

  it("throws when no credential is stored", async () => {
    mockGet.mockResolvedValueOnce(null);

    await expect(
      run({ cableUrl: server.url, signal: ac.signal }),
    ).rejects.toThrow(/not logged in/i);
  });
});
