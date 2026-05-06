/**
 * cable-client tests
 *
 * All tests run against the in-memory FakeCableServer so no real network is
 * needed and no internals are pinned — only observable behaviour is asserted.
 *
 * Coverage:
 *   1. subscribe + receive → handler called
 *   2. perform → round-trips to fake server
 *   3. forced disconnect → exponential-backoff reconnect (timing asserted)
 *   4. ping/pong heartbeat → client responds to server pings
 *   5. reconnect within window → missed events are replayed
 *   6. reconnect outside window → missed events are NOT replayed
 *   7. reject_subscription → handler called when server rejects subscribe
 *   8. no_confirm_subscription → warning fires when server stays silent past timeout
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCableClient, type CableClient } from "../cable-client.js";
import { createFakeCableServer, type FakeCableServer } from "./helpers/fake-cable-server.js";
import { createServer as createHttpServer } from "node:http";
import { WebSocketServer } from "ws";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Poll until predicate() returns true or timeout (ms) is exceeded. */
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe("cable-client", () => {
  let server: FakeCableServer;
  let client: CableClient;

  beforeEach(async () => {
    server = await createFakeCableServer();
  });

  afterEach(async () => {
    client.disconnect();
    await server.close();
  });

  // ── 1. subscribe + receive event ─────────────────────────────────────────────

  it("delivers a received event to the registered handler", async () => {
    client = createCableClient(server.url, { initialDelay: 50 });

    const received: unknown[] = [];
    client
      .subscribe("TestChannel")
      .on("message", (data) => received.push(data));

    // Wait until the server has confirmed subscription
    await waitFor(() => server.received.some((m) => m.command === "subscribe"));
    await sleep(20); // give the confirm_subscription frame time to arrive

    server.send("TestChannel", {}, { type: "message", text: "hello world" });

    await waitFor(() => received.length > 0);
    expect(received[0]).toMatchObject({ type: "message", text: "hello world" });
  });

  it("routes events to the correct subscription by channel + params", async () => {
    client = createCableClient(server.url, { initialDelay: 50 });

    const eventsA: unknown[] = [];
    const eventsB: unknown[] = [];

    client.subscribe("RoomChannel", { room: "a" }).on("*", (d) => eventsA.push(d));
    client.subscribe("RoomChannel", { room: "b" }).on("*", (d) => eventsB.push(d));

    await waitFor(() => server.received.filter((m) => m.command === "subscribe").length >= 2);
    await sleep(20);

    server.send("RoomChannel", { room: "a" }, { type: "msg", text: "for A" });
    server.send("RoomChannel", { room: "b" }, { type: "msg", text: "for B" });

    await waitFor(() => eventsA.length > 0 && eventsB.length > 0);
    expect(eventsA[0]).toMatchObject({ text: "for A" });
    expect(eventsB[0]).toMatchObject({ text: "for B" });
  });

  // ── 2. perform round-trip ────────────────────────────────────────────────────

  it("perform(action, payload) sends a message command to the server", async () => {
    client = createCableClient(server.url, { initialDelay: 50 });

    const sub = client.subscribe("ChatChannel", { room: "lounge" });

    await waitFor(() => server.received.some((m) => m.command === "subscribe"));
    await sleep(20);

    sub.perform("speak", { body: "hey there" });

    await waitFor(() => server.received.some((m) => m.command === "message"));
    const msg = server.received.find((m) => m.command === "message");
    expect(msg?.data).toMatchObject({ action: "speak", body: "hey there" });
  });

  it("perform sends to the correct channel identifier", async () => {
    client = createCableClient(server.url, { initialDelay: 50 });

    const sub = client.subscribe("ChatChannel", { room: "lounge" });
    await waitFor(() => server.received.some((m) => m.command === "subscribe"));
    await sleep(20);

    sub.perform("ping_action");

    await waitFor(() => server.received.some((m) => m.command === "message"));
    const msg = server.received.find((m) => m.command === "message");
    const expectedId = JSON.stringify({ channel: "ChatChannel", room: "lounge" });
    expect(msg?.identifier).toBe(expectedId);
  });

  // ── 3. exponential-backoff reconnect ─────────────────────────────────────────

  it("reconnects after forced disconnect and re-subscribes", async () => {
    // Use a short initialDelay so the test doesn't take long
    const INITIAL = 60;
    client = createCableClient(server.url, { initialDelay: INITIAL, factor: 2 });

    client.subscribe("WatchChannel");
    await waitFor(() => server.received.some((m) => m.command === "subscribe"));

    // Record how many subscribes we have before the disconnect
    const beforeCount = server.received.filter((m) => m.command === "subscribe").length;

    const t0 = Date.now();
    server.forceDisconnect();

    // Wait for a new subscribe (re-subscription after reconnect)
    await waitFor(
      () => server.received.filter((m) => m.command === "subscribe").length > beforeCount,
      4_000,
    );

    const elapsed = Date.now() - t0;

    // The first reconnect should happen after ~INITIAL ms.
    // We give generous upper slack for slow CI environments.
    expect(elapsed).toBeGreaterThanOrEqual(INITIAL * 0.5);
    expect(elapsed).toBeLessThan(INITIAL * 20);
  });

  it("backoff delays grow exponentially across successive failed attempts", async () => {
    // HTTP server that rejects WebSocket upgrades with 503 so the ws client
    // never fires "open" — the counter therefore never resets and we can
    // observe genuine exponential growth.
    const { createServer } = await import("node:http");
    const httpRaw = createServer();
    const attemptTimes: number[] = [];

    httpRaw.on("upgrade", (req, socket) => {
      attemptTimes.push(Date.now());
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });

    await new Promise<void>((res) => httpRaw.listen(0, "127.0.0.1", res));
    const { port } = httpRaw.address() as { port: number };
    const rejectUrl = `ws://127.0.0.1:${port}/cable`;

    const INITIAL = 30;
    const rejectClient = createCableClient(rejectUrl, {
      initialDelay: INITIAL,
      factor: 2,
      maxDelay: 10_000,
    });

    // Collect at least 4 attempts (initial connection + 3 backoff retries)
    await waitFor(() => attemptTimes.length >= 4, 6_000);
    rejectClient.disconnect();

    await new Promise<void>((res) => httpRaw.close(() => res()));

    // Calculate gaps between consecutive upgrade attempts
    const gaps: number[] = [];
    for (let i = 1; i < attemptTimes.length; i++) {
      gaps.push(attemptTimes[i]! - attemptTimes[i - 1]!);
    }

    // Delays should be growing: INITIAL → 2×INITIAL → 4×INITIAL …
    // Allow generous 40 % tolerance for timing jitter in CI.
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeGreaterThan(gaps[i - 1]! * 0.6);
    }
    // Overall: last gap should be substantially larger than the first
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0]! * 1.5);
  });

  // ── 4. ping handling (server→client liveness, no client reply) ─────────────

  it("silently drops server pings (no pong reply)", async () => {
    // Action Cable's `actioncable-v1-json` protocol defines a server→client
    // `ping` for liveness, and *no* corresponding `pong`. An earlier version
    // of this client replied with `{type: "pong"}`, which Rails logged as
    // `Received unrecognized command in {"type" => "pong", ...}` every 3s.
    client = createCableClient(server.url, { initialDelay: 50 });
    await sleep(40); // let the connection open

    const beforePings = server.received.length;
    server.ping();
    await sleep(100);

    // The client must not have sent anything in response to the ping.
    const newMessages = server.received.slice(beforePings);
    expect(newMessages).toHaveLength(0);
  });

  it("continues to deliver events after multiple ping/pong cycles", async () => {
    client = createCableClient(server.url, { initialDelay: 50 });

    const received: unknown[] = [];
    client.subscribe("HeartbeatChannel").on("*", (d) => received.push(d));

    await waitFor(() => server.received.some((m) => m.command === "subscribe"));
    await sleep(20);

    // Three ping-pong cycles
    server.ping();
    await sleep(20);
    server.ping();
    await sleep(20);
    server.ping();
    await sleep(20);

    // Connection should still be alive
    server.send("HeartbeatChannel", {}, { type: "check", ok: true });
    await waitFor(() => received.length > 0, 1_000);
    expect(received[0]).toMatchObject({ ok: true });
  });

  // ── 5. replay within window ──────────────────────────────────────────────────

  it("replays missed events when reconnecting within the replay window", async () => {
    // Use a short replay window (500 ms) so we can also test the outside-window
    // case without waiting 5 minutes.
    const REPLAY_WINDOW = 500;
    const replayServer = await createFakeCableServer(REPLAY_WINDOW);

    const replayClient = createCableClient(replayServer.url, {
      initialDelay: 60,
      replayWindowMs: REPLAY_WINDOW,
    });

    const received: unknown[] = [];
    replayClient.subscribe("FeedChannel").on("*", (d) => received.push(d));

    await waitFor(() => replayServer.received.some((m) => m.command === "subscribe"));
    await sleep(20);

    // Send an event so lastReceivedAt is set on the client side
    replayServer.send("FeedChannel", {}, { type: "item", id: 1 });
    await waitFor(() => received.length === 1);

    // Force disconnect — client will reconnect within the window
    replayServer.forceDisconnect();

    // While the client is reconnecting, buffer a missed event on the server
    await sleep(20);
    replayServer.send("FeedChannel", {}, { type: "item", id: 2 });

    // Wait for the reconnect + replay
    await waitFor(() => received.length >= 2, 3_000);
    const ids = received.map((e) => (e as { id: number }).id);
    expect(ids).toContain(2);

    replayClient.disconnect();
    await replayServer.close();
  });

  // ── 6. no replay outside window ──────────────────────────────────────────────

  it("does NOT replay missed events when reconnecting outside the replay window", async () => {
    // Use a short replay window AND an initialDelay that exceeds it so the
    // reconnect always arrives after the window has already expired.
    const REPLAY_WINDOW = 80;
    const RECONNECT_DELAY = 200; // deliberately > REPLAY_WINDOW
    const replayServer = await createFakeCableServer(REPLAY_WINDOW);

    const replayClient = createCableClient(replayServer.url, {
      initialDelay: RECONNECT_DELAY,
      replayWindowMs: REPLAY_WINDOW,
    });

    const received: unknown[] = [];
    replayClient.subscribe("FeedChannel").on("*", (d) => received.push(d));

    await waitFor(() => replayServer.received.some((m) => m.command === "subscribe"));
    await sleep(20);

    // Seed a real event so the client has a lastReceivedAt
    replayServer.send("FeedChannel", {}, { type: "item", id: 10 });
    await waitFor(() => received.length === 1);

    // Disconnect — the client will try to reconnect after RECONNECT_DELAY (200 ms),
    // which is longer than REPLAY_WINDOW (80 ms).  By the time the reconnect
    // fires, state.disconnectedAt is > 80 ms in the past, so the client should
    // NOT include last_received_at in the subscribe command.
    replayServer.forceDisconnect();

    await waitFor(
      () => replayServer.received.filter((m) => m.command === "subscribe").length >= 2,
      3_000,
    );

    const subscribes = replayServer.received.filter((m) => m.command === "subscribe");
    const reSubscribe = subscribes[1];
    expect(reSubscribe?.last_received_at).toBeUndefined();

    replayClient.disconnect();
    await replayServer.close();
  });

  // ── unsubscribe ──────────────────────────────────────────────────────────────

  it("stops delivering events after unsubscribe()", async () => {
    client = createCableClient(server.url, { initialDelay: 50 });

    const received: unknown[] = [];
    const sub = client.subscribe("NewsChannel").on("*", (d) => received.push(d));

    await waitFor(() => server.received.some((m) => m.command === "subscribe"));
    await sleep(20);

    sub.unsubscribe();
    await sleep(20);

    server.send("NewsChannel", {}, { type: "update", text: "post-unsub" });
    await sleep(80); // nothing should arrive

    expect(received.length).toBe(0);
  });

  // ── auth ────────────────────────────────────────────────────────────────────
  //
  // Regression test for the wire-path auth gap that bit `frame logs tail` and
  // (silently) `frame listen`. The Rails-side `Cli::ApplicationCable::Connection`
  // reads an `Authorization: Bearer <api-key>` header on the WS upgrade and
  // rejects the connection if it's missing. Earlier versions of the cable-client
  // had no way to send that header, so the upgrade succeeded at the socket layer
  // and was immediately rejected by ActionCable — producing the "open then
  // immediately close" pattern in the Rails log.
  //
  // The fix is twofold:
  //   1. cable-client accepts an `apiKey` option and forwards it as a
  //      Bearer-token Authorization header on every (re)connect.
  //   2. The fake server enforces the same contract Rails does, so the test
  //      fixture catches the bug rather than papering over it.

  describe("authentication", () => {
    it("sends Authorization: Bearer <apiKey> on the WS upgrade when configured", async () => {
      const authedServer = await createFakeCableServer({
        expectedApiKey: "sk_test_xyz",
      });

      const authedClient = createCableClient(authedServer.url, {
        initialDelay: 50,
        apiKey: "sk_test_xyz",
      });

      authedClient.subscribe("TestChannel");
      await waitFor(() =>
        authedServer.received.some((m) => m.command === "subscribe"),
      );

      expect(authedServer.authHeaders).toContain("Bearer sk_test_xyz");
      expect(authedServer.rejectedUpgrades).toEqual([]);

      authedClient.disconnect();
      await authedServer.close();
    });

    it("is rejected by the server when no apiKey is supplied", async () => {
      const authedServer = await createFakeCableServer({
        expectedApiKey: "sk_test_xyz",
      });

      // No apiKey — mirrors the bug shape in `frame logs tail` before the fix.
      const unauthedClient = createCableClient(authedServer.url, {
        initialDelay: 10_000, // suppress reconnect storm during the test
      });

      unauthedClient.subscribe("TestChannel");
      await waitFor(() => authedServer.rejectedUpgrades.length > 0);

      expect(authedServer.rejectedUpgrades.length).toBeGreaterThan(0);
      expect(authedServer.received).toEqual([]);

      unauthedClient.disconnect();
      await authedServer.close();
    });

    it("re-supplies Authorization on reconnect", async () => {
      const authedServer = await createFakeCableServer({
        expectedApiKey: "sk_test_xyz",
      });

      const authedClient = createCableClient(authedServer.url, {
        initialDelay: 50,
        apiKey: "sk_test_xyz",
      });

      authedClient.subscribe("TestChannel");
      await waitFor(() => authedServer.authHeaders.length >= 1);

      authedServer.forceDisconnect();
      await waitFor(() => authedServer.authHeaders.length >= 2, 3_000);

      expect(authedServer.authHeaders[0]).toBe("Bearer sk_test_xyz");
      expect(authedServer.authHeaders[1]).toBe("Bearer sk_test_xyz");
      expect(authedServer.rejectedUpgrades).toEqual([]);

      authedClient.disconnect();
      await authedServer.close();
    });
  });

  // ── 7. reject_subscription ──────────────────────────────────────────────────────────────────

  describe("subscribe failure surfacing", () => {
    it("fires 'reject_subscription' handler when server sends reject_subscription", async () => {
      // Use the allowedChannels option so the fake server sends reject_subscription
      // for any channel not in the list — mirrors Rails' "Subscription class not found".
      const rejectServer = await createFakeCableServer({
        allowedChannels: ["AllowedChannel"],
      });

      client = createCableClient(rejectServer.url, { initialDelay: 50 });

      const rejections: unknown[] = [];
      client
        .subscribe("UnknownChannel")
        .on("reject_subscription", (data) => rejections.push(data));

      await waitFor(() => rejections.length > 0, 2_000);
      expect(rejections.length).toBeGreaterThanOrEqual(1);

      await rejectServer.close();
    });

    it("fires 'no_confirm_subscription' handler when server stays silent past the timeout", async () => {
      // Build a minimal WebSocket server that accepts the upgrade and sends
      // welcome but NEVER sends confirm_subscription — exactly the failure
      // mode that produced FRA-3535's silent hang.
      const httpRaw = createHttpServer();
      const silentWss = new WebSocketServer({ noServer: true });

      silentWss.on("connection", (ws) => {
        // Send welcome, then stay silent forever (no confirm_subscription).
        ws.send(JSON.stringify({ type: "welcome" }));
      });

      httpRaw.on("upgrade", (req, socket, head) => {
        silentWss.handleUpgrade(req, socket, head, (ws) => {
          silentWss.emit("connection", ws, req);
        });
      });

      await new Promise<void>((res) => httpRaw.listen(0, "127.0.0.1", res));
      const { port } = httpRaw.address() as { port: number };
      const silentUrl = `ws://127.0.0.1:${port}/cable`;

      const warnings: unknown[] = [];
      // Use a very short confirmTimeoutMs so the test runs quickly.
      const silentClient = createCableClient(silentUrl, {
        initialDelay: 50_000, // suppress reconnect storm
        confirmTimeoutMs: 100,
      });

      silentClient
        .subscribe("SomeChannel")
        .on("no_confirm_subscription", (data) => warnings.push(data));

      await waitFor(() => warnings.length > 0, 2_000);
      expect(warnings.length).toBeGreaterThanOrEqual(1);

      silentClient.disconnect();
      await new Promise<void>((res) =>
        silentWss.close(() => httpRaw.close(() => res())),
      );
    });

    it("does NOT fire 'no_confirm_subscription' when server confirms in time", async () => {
      // Standard fake server always sends confirm_subscription promptly.
      client = createCableClient(server.url, {
        initialDelay: 50,
        confirmTimeoutMs: 300,
      });

      const warnings: unknown[] = [];
      client
        .subscribe("SafeChannel")
        .on("no_confirm_subscription", (data) => warnings.push(data));

      // Wait well past the timeout — no warning should appear because the
      // fake server confirms promptly.
      await waitFor(() =>
        server.received.some((m) => m.command === "subscribe"),
      );
      await sleep(400); // past confirmTimeoutMs

      expect(warnings).toHaveLength(0);
    });
  });

  // ── 8. updateParams ─────────────────────────────────────────────────────────

  describe("updateParams", () => {
    it("perform after updateParams uses the identifier the server currently knows about (not the future-reconnect identifier)", async () => {
      // Regression: pre-fix, perform always built its identifier from
      // state.params, the latest values. After listen.ts called
      // updateParams to fold session_token into the params (post-welcome),
      // the next subscription.perform("ack", ...) carried an identifier the
      // server had never seen on this connection. Rails responded with
      // `RuntimeError - Unable to find subscription with identifier: ...`
      // and the ack was silently dropped, leaving every Webhook::Message in
      // status: pending and zero MessageAttempt rows recorded.
      client = createCableClient(server.url, { initialDelay: 50 });

      const sub = client.subscribe("ChatChannel", { room: "lobby" });
      await waitFor(() => server.received.some((m) => m.command === "subscribe"));
      await sleep(20);

      sub.updateParams({ room: "lobby", session_token: "tok_abc" });

      sub.perform("say", { text: "hi" });

      await waitFor(() => server.received.some((m) => m.command === "message"));
      const msg = server.received.find((m) => m.command === "message");
      // The original (server-known) identifier, NOT the post-updateParams one.
      const originalId = JSON.stringify({ channel: "ChatChannel", room: "lobby" });
      expect(msg?.identifier).toBe(originalId);
    });

    it("perform AFTER reconnect uses the new identifier (because the server now knows about it)", async () => {
      client = createCableClient(server.url, { initialDelay: 50 });

      const sub = client.subscribe("ChatChannel", { room: "lobby" });
      await waitFor(() => server.received.some((m) => m.command === "subscribe"));
      await sleep(20);

      sub.updateParams({ room: "lobby", session_token: "tok_abc" });

      const subsBefore = server.received.filter((m) => m.command === "subscribe").length;
      server.forceDisconnect();
      await waitFor(
        () => server.received.filter((m) => m.command === "subscribe").length > subsBefore,
        3_000,
      );
      await sleep(50);

      const messagesBefore = server.received.filter((m) => m.command === "message").length;
      sub.perform("say", { text: "hi" });
      await waitFor(
        () => server.received.filter((m) => m.command === "message").length > messagesBefore,
      );

      const msg = server.received.filter((m) => m.command === "message").at(-1);
      const expectedId = JSON.stringify({ channel: "ChatChannel", room: "lobby", session_token: "tok_abc" });
      expect(msg?.identifier).toBe(expectedId);
    });

    it("causes the reconnect subscribe to use the new params", async () => {
      client = createCableClient(server.url, { initialDelay: 50 });

      const sub = client.subscribe("ChatChannel", { room: "lobby" });
      await waitFor(() => server.received.some((m) => m.command === "subscribe"));
      await sleep(20);

      // Update params before the disconnect
      sub.updateParams({ room: "lobby", session_token: "tok_reconnect" });

      const subsBefore = server.received.filter((m) => m.command === "subscribe").length;

      server.forceDisconnect();

      await waitFor(
        () => server.received.filter((m) => m.command === "subscribe").length > subsBefore,
        3_000,
      );

      // The re-subscribe should use the updated identifier (with session_token)
      const reconnectSub = server.received
        .filter((m) => m.command === "subscribe")
        .at(-1)!;
      const parsed = JSON.parse(reconnectSub.identifier!) as Record<string, unknown>;
      expect(parsed["session_token"]).toBe("tok_reconnect");
    });

    it("sends exactly one subscribe per logical subscription on reconnect, even after updateParams", async () => {
      // Regression: pre-fix, updateParams added the new identifier to the
      // internal Map without removing the old one. ws.on("open") iterated
      // Map.values() and called sendSubscribe once per Map entry — with
      // both entries pointing at the same state, two duplicate subscribes
      // were sent on every reconnect, which on a flaky server (revive
      // failures) produced multiple :cli_session endpoint rows per
      // `frame listen` process and a fresh "Session started" line per
      // reconnect. See FRA-3535 thread.
      client = createCableClient(server.url, { initialDelay: 50 });

      const sub = client.subscribe("ChatChannel", { room: "lobby" });
      await waitFor(() => server.received.some((m) => m.command === "subscribe"));
      await sleep(20);

      // Two updateParams calls (simulating a session being re-issued) leave
      // the internal Map with three accumulated identifiers for the same
      // state, magnifying the duplicate-subscribe bug if it regresses.
      sub.updateParams({ room: "lobby", session_token: "tok_one" });
      sub.updateParams({ room: "lobby", session_token: "tok_two" });

      const subsBefore = server.received.filter((m) => m.command === "subscribe").length;

      server.forceDisconnect();

      await waitFor(
        () => server.received.filter((m) => m.command === "subscribe").length > subsBefore,
        3_000,
      );
      // Give the open handler a tick in case duplicates are queued.
      await sleep(50);

      const reconnectSubs = server.received
        .filter((m) => m.command === "subscribe")
        .slice(subsBefore);
      expect(reconnectSubs).toHaveLength(1);
      const parsed = JSON.parse(reconnectSubs[0]!.identifier!) as Record<string, unknown>;
      expect(parsed["session_token"]).toBe("tok_two");
    });

    it("routes incoming messages to the subscription after params update + reconnect", async () => {
      client = createCableClient(server.url, { initialDelay: 50 });

      const received: unknown[] = [];
      const sub = client
        .subscribe("ChatChannel", { room: "lobby" })
        .on("message", (d) => received.push(d));
      await waitFor(() => server.received.some((m) => m.command === "subscribe"));
      await sleep(20);

      // Update params with session_token; this will be sent on the next reconnect
      sub.updateParams({ room: "lobby", session_token: "tok_route" });

      const subsBefore = server.received.filter((m) => m.command === "subscribe").length;

      // Force a disconnect so the cable-client reconnects with the new params
      server.forceDisconnect();

      // Wait for the re-subscribe with the new identifier
      await waitFor(
        () => server.received.filter((m) => m.command === "subscribe").length > subsBefore,
        3_000,
      );
      await sleep(20); // give confirm_subscription time to arrive

      // Now send via the new identifier — should reach our handler
      server.send("ChatChannel", { room: "lobby", session_token: "tok_route" }, { type: "message", text: "routed" });

      await waitFor(() => received.length > 0, 2_000);
      expect(received[0]).toMatchObject({ text: "routed" });
    });
  });
});

