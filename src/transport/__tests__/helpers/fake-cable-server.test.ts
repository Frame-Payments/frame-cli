/**
 * Unit tests for fake-cable-server wire-constraint enforcement.
 *
 * These tests exercise the negative paths:
 *   1. Missing Authorization header  → HTTP 401
 *   2. Missing Origin header         → HTTP 403
 *   3. Unknown channel class         → reject_subscription
 *
 * Positive paths (auth passes, channel accepted) are covered by the broader
 * cable-client.test.ts, listen.test.ts, and the auth describe block in
 * cable-client.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  createFakeCableServer,
  createFullyWiredFakeCableServer,
  type FakeCableServer,
} from "./fake-cable-server.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Open a raw WebSocket with explicit headers (ws library ClientOptions). */
function openRawWs(
  url: string,
  headers: Record<string, string> = {},
): { ws: WebSocket; closeCode: Promise<number> } {
  const ws = new WebSocket(url, ["actioncable-v1-json"], { headers });
  const closeCode = new Promise<number>((resolve) => {
    ws.on("close", (code) => resolve(code));
    // If the upgrade is rejected before a WS handshake, ws fires "error" then "close"
    ws.on("error", () => {
      // handled by "close"
    });
  });
  return { ws, closeCode };
}

/** Collect raw text frames from a WebSocket until `predicate` returns true. */
function collectFrames(ws: WebSocket, predicate: (frames: string[]) => boolean, timeout = 2_000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const frames: string[] = [];
    const deadline = setTimeout(() => reject(new Error("collectFrames timeout")), timeout);
    ws.on("message", (raw) => {
      frames.push(raw.toString());
      if (predicate(frames)) {
        clearTimeout(deadline);
        resolve(frames);
      }
    });
  });
}

/** Poll until predicate() returns true or timeout exceeded. */
function waitFor(predicate: () => boolean, timeout = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe("fake-cable-server wire constraints", () => {
  let server: FakeCableServer;

  afterEach(async () => {
    await server.close();
  });

  // ── 1. Missing Authorization → HTTP 401 ──────────────────────────────────────

  describe("Authorization enforcement (expectedApiKey)", () => {
    beforeEach(async () => {
      server = await createFakeCableServer({ expectedApiKey: "sk_test_abc" });
    });

    it("rejects a WS upgrade that omits the Authorization header with 401", async () => {
      // Connect without any Authorization header
      const { closeCode } = openRawWs(server.url);

      await waitFor(() => server.rejectedUpgrades.length > 0);
      const code = await closeCode;

      expect(server.rejectedUpgrades[0]?.reason).toMatch(/missing Authorization/i);
      // ws closes with a non-1000 code when the HTTP upgrade is rejected
      expect(code).not.toBe(1000);
    });

    it("rejects a WS upgrade with wrong Bearer token with 401", async () => {
      const { closeCode } = openRawWs(server.url, {
        Authorization: "Bearer wrong_key",
        Origin: "http://127.0.0.1",
      });

      await waitFor(() => server.rejectedUpgrades.length > 0);
      const code = await closeCode;

      expect(server.rejectedUpgrades[0]?.reason).toMatch(/bad Authorization/i);
      expect(code).not.toBe(1000);
    });

    it("does NOT record a rejected upgrade when the correct token is supplied", async () => {
      const { ws } = openRawWs(server.url, {
        Authorization: "Bearer sk_test_abc",
        Origin: "http://127.0.0.1",
      });

      // Wait for welcome frame = successful connection
      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      expect(server.rejectedUpgrades).toHaveLength(0);
      ws.close();
    });
  });

  // ── 2. Missing Origin → HTTP 403 ─────────────────────────────────────────────

  describe("Origin enforcement (requireOrigin: true)", () => {
    beforeEach(async () => {
      server = await createFakeCableServer({ requireOrigin: true });
    });

    it("rejects a WS upgrade that omits the Origin header with 403", async () => {
      // ws library sends no Origin header by default when not configured
      const { closeCode } = openRawWs(server.url);

      await waitFor(() => server.rejectedUpgrades.length > 0);
      const code = await closeCode;

      expect(server.rejectedUpgrades[0]?.reason).toMatch(/missing Origin/i);
      expect(code).not.toBe(1000);
    });

    it("accepts a WS upgrade that includes a non-empty Origin header", async () => {
      const { ws } = openRawWs(server.url, {
        Origin: "http://127.0.0.1:3000",
      });

      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      expect(server.rejectedUpgrades).toHaveLength(0);
      ws.close();
    });

    it("checks Authorization before Origin when both are required", async () => {
      // Auth is checked first: a request missing all headers triggers 401, not 403.
      server = await createFakeCableServer({
        requireOrigin: true,
        expectedApiKey: "sk_test_abc",
      });

      // No headers at all → Authorization checked first → 401
      const { closeCode } = openRawWs(server.url);
      await waitFor(() => server.rejectedUpgrades.length > 0);
      await closeCode;

      expect(server.rejectedUpgrades[0]?.reason).toMatch(/missing Authorization/i);
    });

    it("rejects with 403 when auth passes but Origin is missing", async () => {
      server = await createFakeCableServer({
        requireOrigin: true,
        expectedApiKey: "sk_test_abc",
      });

      const { closeCode } = openRawWs(server.url, {
        Authorization: "Bearer sk_test_abc",
        // no Origin
      });

      await waitFor(() => server.rejectedUpgrades.length > 0);
      await closeCode;

      expect(server.rejectedUpgrades[0]?.reason).toMatch(/missing Origin/i);
    });
  });

  // ── 3. Channel allow-list → reject_subscription ───────────────────────────────

  describe("Channel allow-list enforcement (allowedChannels)", () => {
    beforeEach(async () => {
      server = await createFakeCableServer({
        allowedChannels: ["Cli::LogsChannel", "Cli::WebhookListenChannel"],
      });
    });

    it("replies with reject_subscription for a channel not in the allow-list", async () => {
      const { ws } = openRawWs(server.url);

      // Wait for welcome
      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      // Subscribe to an unknown channel
      ws.send(JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({ channel: "UnknownChannel" }),
      }));

      await waitFor(() => server.rejectedSubscriptions.length > 0);

      expect(server.rejectedSubscriptions[0]?.reason).toContain("Subscription class not found");
      expect(server.rejectedSubscriptions[0]?.identifier).toContain("UnknownChannel");
      ws.close();
    });

    it("sends reject_subscription frame back to the client for unknown channel", async () => {
      const { ws } = openRawWs(server.url);

      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      ws.send(JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({ channel: "BadChannel" }),
      }));

      const allFrames = await collectFrames(ws, (f) => f.some((raw) => raw.includes("reject_subscription")));

      const rejectFrame = allFrames.find((f) => f.includes("reject_subscription"));
      expect(rejectFrame).toBeDefined();
      const parsed = JSON.parse(rejectFrame!) as Record<string, unknown>;
      expect(parsed["type"]).toBe("reject_subscription");
      ws.close();
    });

    it("confirms subscription for a channel in the allow-list", async () => {
      const { ws } = openRawWs(server.url);

      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      ws.send(JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({ channel: "Cli::LogsChannel" }),
      }));

      const allFrames = await collectFrames(ws, (f) => f.some((raw) => raw.includes("confirm_subscription")));
      expect(allFrames.some((f) => f.includes("confirm_subscription"))).toBe(true);
      expect(server.rejectedSubscriptions).toHaveLength(0);
      ws.close();
    });

    it("allows any channel when allowedChannels is not configured", async () => {
      // Fresh server with no allow-list
      const openServer = await createFakeCableServer();
      const { ws } = openRawWs(openServer.url);

      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      ws.send(JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({ channel: "AnyRandomChannel" }),
      }));

      const allFrames = await collectFrames(ws, (f) => f.some((raw) => raw.includes("confirm_subscription")));
      expect(allFrames.some((f) => f.includes("confirm_subscription"))).toBe(true);
      expect(openServer.rejectedSubscriptions).toHaveLength(0);
      ws.close();
      await openServer.close();
    });

    it("tracks rejected subscriptions in both .rejectedSubscriptions and .received", async () => {
      const { ws } = openRawWs(server.url);

      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      ws.send(JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({ channel: "ForbiddenChannel" }),
      }));

      await waitFor(() => server.rejectedSubscriptions.length > 0);

      // The subscribe command should still be tracked in .received for debugging
      expect(server.received.some((m) => m.command === "subscribe" && m.identifier?.includes("ForbiddenChannel"))).toBe(true);
      ws.close();
    });
  });

  // ── 4. createFullyWiredFakeCableServer convenience helper ─────────────────────

  describe("createFullyWiredFakeCableServer", () => {
    it("enforces Authorization, Origin, and channel allow-list in one call", async () => {
      server = await createFullyWiredFakeCableServer("sk_fully_wired", [
        "Cli::LogsChannel",
      ]);

      // No headers at all → 401
      const { closeCode: code401 } = openRawWs(server.url);
      await waitFor(() => server.rejectedUpgrades.length >= 1);
      await code401;
      expect(server.rejectedUpgrades[0]?.reason).toMatch(/missing Authorization/i);

      // Auth OK, no Origin → 403
      const { closeCode: code403 } = openRawWs(server.url, {
        Authorization: "Bearer sk_fully_wired",
      });
      await waitFor(() => server.rejectedUpgrades.length >= 2);
      await code403;
      expect(server.rejectedUpgrades[1]?.reason).toMatch(/missing Origin/i);

      // Auth + Origin OK, bad channel → reject_subscription
      const { ws } = openRawWs(server.url, {
        Authorization: "Bearer sk_fully_wired",
        Origin: "http://127.0.0.1",
      });
      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));
      ws.send(JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({ channel: "UnknownChannel" }),
      }));
      await waitFor(() => server.rejectedSubscriptions.length >= 1);
      expect(server.rejectedSubscriptions[0]?.reason).toContain("Subscription class not found");
      ws.close();
    });

    it("accepts fully compliant connections and confirms allowed subscriptions", async () => {
      server = await createFullyWiredFakeCableServer("sk_fully_wired", [
        "Cli::LogsChannel",
      ]);

      const { ws } = openRawWs(server.url, {
        Authorization: "Bearer sk_fully_wired",
        Origin: "http://127.0.0.1",
      });

      await collectFrames(ws, (f) => f.some((raw) => raw.includes('"welcome"')));

      ws.send(JSON.stringify({
        command: "subscribe",
        identifier: JSON.stringify({ channel: "Cli::LogsChannel" }),
      }));

      const allFrames = await collectFrames(ws, (f) => f.some((raw) => raw.includes("confirm_subscription")));
      expect(allFrames.some((f) => f.includes("confirm_subscription"))).toBe(true);
      expect(server.rejectedUpgrades).toHaveLength(0);
      expect(server.rejectedSubscriptions).toHaveLength(0);
      ws.close();
    });
  });
});
