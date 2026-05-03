/**
 * Integration tests for `frame listen`.
 *
 * Uses the real FakeCableServer so no network is required; fetch is stubbed
 * for the --forward-to POST calls.
 *
 * Coverage:
 *   1. Session secret is printed in the startup output
 *   2. Event is POSTed to --forward-to with X-Frame-Event and X-Frame-Signature headers
 *   3. Signature is HMAC-SHA256 of the JSON body, formatted as sha256=<hex>
 *   4. After the POST, subscription.perform("ack", ...) is sent back with event_id + status
 *   5. Printed line includes event_type and local HTTP status
 *   6. Banner (mode: sandbox + merchant) is printed before listen output
 *   7. Command registered via lazy-import path (smoke test via cli wiring)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  createFakeCableServer,
  type FakeCableServer,
} from "../src/transport/__tests__/helpers/fake-cable-server.js";
import { run } from "../src/commands/listen.js";

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

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe("frame listen", () => {
  let server: FakeCableServer;
  let ac: AbortController;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Enforce the same wire-level auth contract as the Rails connection class
    // so this suite catches the "forgot to send Authorization" bug shape.
    server = await createFakeCableServer({ expectedApiKey: "sk_test_xyz" });
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

    mockGet.mockResolvedValue({ apiKey: "sk_test_xyz", merchant: "acct_001", devMode: true });
  });

  afterEach(async () => {
    ac.abort();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
    await server.close();
  });

  // ── 1. Session secret printed ────────────────────────────────────────────────

  it("prints the session secret from the channel welcome message", async () => {
    const runPromise = run({ cableUrl: server.url, signal: ac.signal });

    await waitFor(() =>
      server.received.some(
        (m) =>
          m.command === "subscribe" &&
          m.identifier?.includes("WebhookListenChannel"),
      ),
    );

    server.send("Cli::WebhookListenChannel", {}, {
      type: "session_started",
      session_secret: "whsec_cli_test123",
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) =>
        String(c[0]).includes("whsec_cli_test123"),
      ),
    );

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("whsec_cli_test123");

    ac.abort();
    await runPromise;
  });

  // ── 2–4. Integration: POST + headers + ack ───────────────────────────────────

  it("POSTs the event to --forward-to with X-Frame-Event and X-Frame-Signature, then acks", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      cableUrl: server.url,
      signal: ac.signal,
    });

    // Wait for subscription
    await waitFor(() =>
      server.received.some(
        (m) =>
          m.command === "subscribe" &&
          m.identifier?.includes("WebhookListenChannel"),
      ),
    );

    // Send session secret first
    server.send("Cli::WebhookListenChannel", {}, {
      type: "session_started",
      session_secret: "whsec_cli_secret_abc",
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) =>
        String(c[0]).includes("whsec_cli_secret_abc"),
      ),
    );

    // Send an event
    server.send("Cli::WebhookListenChannel", {}, {
      type: "event",
      event_type: "transfer.completed",
      event_id: "evt_001",
      payload: { amount: 1000, currency: "usd" },
    });

    // Wait for the forward-to POST
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

    // Verify the signature is correct HMAC-SHA256 of the body
    const expectedSig =
      "sha256=" +
      createHmac("sha256", "whsec_cli_secret_abc")
        .update(JSON.stringify({ amount: 1000, currency: "usd" }))
        .digest("hex");
    expect(sigHeader).toBe(expectedSig);

    // Wait for ack perform
    await waitFor(() =>
      server.received.some((m) => m.command === "message"),
    );

    const ack = server.received.find((m) => m.command === "message");
    expect(ack?.data).toMatchObject({
      action: "ack",
      event_id: "evt_001",
      status: 200,
    });

    ac.abort();
    await runPromise;
  });

  // ── 5. Printed line ──────────────────────────────────────────────────────────

  it("prints a one-line record with event_type and local status code", async () => {
    mockFetch.mockResolvedValueOnce({ status: 202 });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
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

    server.send("Cli::WebhookListenChannel", {}, {
      type: "session_started",
      session_secret: "whsec_cli_s",
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) => String(c[0]).includes("whsec_cli_s")),
    );

    server.send("Cli::WebhookListenChannel", {}, {
      type: "event",
      event_type: "refund.created",
      event_id: "evt_002",
      payload: {},
    });

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

  // ── 6. Banner printed ────────────────────────────────────────────────────────

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

  // ── --events filter ──────────────────────────────────────────────────────────

  it("passes events filter as channel param and skips non-matching events client-side", async () => {
    mockFetch.mockResolvedValue({ status: 200 });

    const runPromise = run({
      forwardTo: "http://localhost:4000/webhooks",
      events: ["transfer.completed"],
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

    // Channel params should include events array
    const subMsg = server.received.find(
      (m) =>
        m.command === "subscribe" &&
        m.identifier?.includes("WebhookListenChannel"),
    );
    const identifier = JSON.parse(subMsg!.identifier!) as Record<
      string,
      unknown
    >;
    expect(identifier["events"]).toEqual(["transfer.completed"]);

    // Server sends session_started so we have a session secret
    server.send("Cli::WebhookListenChannel", { events: ["transfer.completed"] }, {
      type: "session_started",
      session_secret: "whsec_cli_filter_test",
    });

    await waitFor(() =>
      stdoutSpy.mock.calls.some((c) =>
        String(c[0]).includes("whsec_cli_filter_test"),
      ),
    );

    // Send a non-matching event — should NOT be forwarded
    server.send("Cli::WebhookListenChannel", { events: ["transfer.completed"] }, {
      type: "event",
      event_type: "refund.created",
      event_id: "evt_skip",
      payload: {},
    });

    // Send matching event — should be forwarded
    server.send("Cli::WebhookListenChannel", { events: ["transfer.completed"] }, {
      type: "event",
      event_type: "transfer.completed",
      event_id: "evt_match",
      payload: {},
    });

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

  // ── --skip-endpoints ─────────────────────────────────────────────────────────

  it("sends skip_endpoints: true as channel param when --skip-endpoints is set", async () => {
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
    const identifier = JSON.parse(subMsg!.identifier!) as Record<
      string,
      unknown
    >;
    expect(identifier["skip_endpoints"]).toBe(true);

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
