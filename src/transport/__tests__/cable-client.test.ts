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
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCableClient, type CableClient } from "../cable-client.js";
import { createFakeCableServer, type FakeCableServer } from "./helpers/fake-cable-server.js";

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

  // ── 4. ping/pong heartbeat ───────────────────────────────────────────────────

  it("responds to a server ping with a pong", async () => {
    client = createCableClient(server.url, { initialDelay: 50 });
    await sleep(40); // let the connection open

    server.ping();

    await waitFor(() => server.received.some((m) => m.command === "pong"), 1_000);
    expect(server.received.some((m) => m.command === "pong")).toBe(true);
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
});
