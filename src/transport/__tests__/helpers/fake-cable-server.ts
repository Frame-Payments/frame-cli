/**
 * In-memory fake ActionCable server.
 *
 * Reusable fixture for cable-client tests and, later, for listen / logs-tail tests.
 *
 * Features:
 *   - Speaks the ActionCable v1-JSON protocol (welcome → confirm_subscription → messages)
 *   - Buffers every outbound message with a timestamp for replay
 *   - Replays buffered messages when a subscriber reconnects with last_received_at
 *     within the replay window (default 5 minutes)
 *   - Tracks every inbound message (subscribe, message, unsubscribe, pong) via .received
 *   - send(channelName, params, data)  — push a message to all subscribers
 *   - ping()                           — send {"type":"ping"} to all clients
 *   - forceDisconnect()               — close all active connections
 *   - close()                         — shut down the server
 */

import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BufferedEvent {
  identifier: string;
  data: unknown;
  timestamp: number;
}

export interface ReceivedMessage {
  /** "subscribe" | "unsubscribe" | "message" | "pong" */
  command: string;
  identifier?: string;
  data?: unknown;
  /** Sent by the cable-client on reconnect to request replay. Only present when included. */
  last_received_at?: number | undefined;
}

export interface FakeCableServer {
  /** WebSocket URL clients should connect to. */
  readonly url: string;
  /** All messages received from clients, in arrival order. */
  readonly received: ReceivedMessage[];
  /** Authorization header values seen on each successful WS upgrade, in arrival order. */
  readonly authHeaders: string[];
  /** Number of WS upgrades the server rejected for missing/invalid Authorization. */
  readonly rejectedUpgrades: { reason: string }[];
  /**
   * Push a message to every client subscribed to channelName+params.
   * The message is also buffered for potential replay.
   */
  send(channelName: string, params: Record<string, unknown>, data: unknown): void;
  /** Send a ping frame to every connected client. */
  ping(): void;
  /** Close all current WebSocket connections (triggers client reconnect logic). */
  forceDisconnect(): void;
  /** Shut down the HTTP+WS server. */
  close(): Promise<void>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeIdentifier(
  channelName: string,
  params: Record<string, unknown>,
): string {
  return JSON.stringify({ channel: channelName, ...params });
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export interface FakeCableServerOptions {
  /** Replay window for buffered events. Default 5 minutes. */
  replayWindowMs?: number;
  /**
   * If set, the server requires `Authorization: Bearer <expectedApiKey>` on every
   * WS upgrade and rejects others with a 401. Mirrors
   * `Cli::ApplicationCable::Connection#bearer_token` on the Rails side, so the
   * fixture exercises the same wire contract as production.
   *
   * Default: undefined → no auth enforcement (back-compat for older tests).
   */
  expectedApiKey?: string;
}

export async function createFakeCableServer(
  optsOrReplayWindow: FakeCableServerOptions | number = {},
): Promise<FakeCableServer> {
  const opts: FakeCableServerOptions =
    typeof optsOrReplayWindow === "number"
      ? { replayWindowMs: optsOrReplayWindow }
      : optsOrReplayWindow;
  const replayWindowMs = opts.replayWindowMs ?? 5 * 60 * 1_000;
  const expectedApiKey = opts.expectedApiKey;

  const httpServer = createServer();
  // `noServer: true` lets us own the upgrade handshake so we can validate the
  // Authorization header before WebSocketServer accepts the socket.
  const wss = new WebSocketServer({ noServer: true });

  const authHeaders: string[] = [];
  const rejectedUpgrades: { reason: string }[] = [];

  httpServer.on("upgrade", (req, socket, head) => {
    const authHeader = req.headers["authorization"];
    if (expectedApiKey != null) {
      if (typeof authHeader !== "string" || authHeader.length === 0) {
        rejectedUpgrades.push({ reason: "missing Authorization header" });
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const [scheme, token] = authHeader.split(" ");
      if (scheme !== "Bearer" || token !== expectedApiKey) {
        rejectedUpgrades.push({ reason: `bad Authorization: ${authHeader}` });
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    if (typeof authHeader === "string") authHeaders.push(authHeader);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // Per-connection subscriptions: ws → Set<identifier>
  const clientSubs = new Map<WebSocket, Set<string>>();

  // Global message buffer for replay
  const buffer: BufferedEvent[] = [];
  const received: ReceivedMessage[] = [];

  wss.on("connection", (ws) => {
    clientSubs.set(ws, new Set());

    // ActionCable handshake: server always sends welcome first
    ws.send(JSON.stringify({ type: "welcome" }));

    ws.on("message", (raw: Buffer | string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const command = msg["command"] as string | undefined;

      if (command === "subscribe") {
        const identifier = msg["identifier"] as string;
        const lastReceivedAt = msg["last_received_at"] as number | undefined;

        const rec: ReceivedMessage = { command: "subscribe", identifier };
        if (lastReceivedAt != null) rec.last_received_at = lastReceivedAt;
        received.push(rec);

        clientSubs.get(ws)?.add(identifier);
        ws.send(JSON.stringify({ type: "confirm_subscription", identifier }));

        // Replay buffered events if client reconnected within the window
        if (lastReceivedAt != null) {
          const now = Date.now();
          if (now - lastReceivedAt < replayWindowMs) {
            for (const event of buffer) {
              if (
                event.identifier === identifier &&
                event.timestamp > lastReceivedAt
              ) {
                ws.send(JSON.stringify({ identifier, message: event.data }));
              }
            }
          }
        }
        return;
      }

      if (command === "unsubscribe") {
        const identifier = msg["identifier"] as string;
        received.push({ command: "unsubscribe", identifier });
        clientSubs.get(ws)?.delete(identifier);
        return;
      }

      if (command === "message") {
        const identifier = msg["identifier"] as string;
        const data = msg["data"] != null
          ? (JSON.parse(msg["data"] as string) as unknown)
          : undefined;
        received.push({ command: "message", identifier, data });
        return;
      }

      // Non-command frames: pong, etc.
      const type = msg["type"] as string | undefined;
      if (type === "pong") {
        received.push({ command: "pong" });
      }
    });

    ws.on("close", () => {
      clientSubs.delete(ws);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const addr = httpServer.address() as { port: number };
  const url = `ws://127.0.0.1:${addr.port}/cable`;

  return {
    url,
    received,
    authHeaders,
    rejectedUpgrades,

    send(channelName: string, params: Record<string, unknown>, data: unknown) {
      const identifier = makeIdentifier(channelName, params);
      const event: BufferedEvent = { identifier, data, timestamp: Date.now() };
      buffer.push(event);

      for (const [ws, subs] of clientSubs) {
        if (subs.has(identifier) && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ identifier, message: data }));
        }
      }
    },

    ping() {
      const ts = Math.floor(Date.now() / 1_000);
      for (const ws of clientSubs.keys()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping", message: ts }));
        }
      }
    },

    forceDisconnect() {
      for (const ws of clientSubs.keys()) {
        ws.close();
      }
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        for (const ws of clientSubs.keys()) {
          ws.terminate();
        }
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
  };
}
