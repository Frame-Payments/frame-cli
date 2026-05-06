/**
 * In-memory fake ActionCable server.
 *
 * Reusable fixture for cable-client tests and for listen / logs-tail tests.
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
 *
 * Wire-contract documentation
 * ───────────────────────────
 * This fixture mirrors the constraints enforced by the production Rails cable
 * connection class (`Cli::ApplicationCable::Connection`) and the ActionCable
 * engine. Any change to the real Rails cable connection's wire requirements
 * MUST be reflected here so test suites catch regressions immediately:
 *
 *   Authorization header  — `Authorization: Bearer <api_key>` on every WS
 *     upgrade. Enforced when `expectedApiKey` is set (HTTP 401 on mismatch).
 *
 *   Origin header  — ActionCable's `allow_same_origin_as_host` protection
 *     requires a non-empty `Origin` header on every upgrade. Enforced when
 *     `requireOrigin: true` (HTTP 403 when absent). The CLI cable-client
 *     derives and sends Origin automatically from the WS URL.
 *
 *   Channel class allow-list  — `subscribe` commands referencing a channel
 *     not in `allowedChannels` (when set) receive a `reject_subscription`
 *     reply, mirroring Rails' "Subscription class not found" behaviour.
 *
 * Use `createFullyWiredFakeCableServer` to get all three constraints in one
 * call. Individual tests that only need a subset can still call
 * `createFakeCableServer` directly with the options they care about.
 */

import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  parseAck,
  CHANNEL_NAME as WEBHOOK_LISTEN_CHANNEL,
  type AckPayload,
  type BroadcastEventMessage,
} from "../../../transport/webhook-listen-protocol.js";

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
  /** Upgrade rejections, in arrival order. Each entry has a reason string. */
  readonly rejectedUpgrades: { reason: string }[];
  /** Subscribe rejections sent to clients, in arrival order. */
  readonly rejectedSubscriptions: { identifier: string; reason: string }[];
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

// ─── webhookListenChannel preset types ────────────────────────────────────────

/**
 * Options for the webhookListenChannel preset. When supplied, the fake server
 * mirrors `Cli::WebhookListenChannel` on the Rails side:
 *   - Auto-sends a real-shaped welcome on subscribe
 *   - Validates ack messages and records them in receivedAcks
 *   - Optionally rejects empty event_codes (pre-FRA-3537 behavior)
 */
export interface WebhookListenChannelPresetOptions {
  /** Session secret sent in the welcome. Defaults to a test-safe constant. */
  whsec?: string;
  /** Endpoint ID sent in the welcome. Default: "wep_test_001" */
  endpointId?: string;
  /** Session token sent in the welcome. Default: "cs_test_001" */
  sessionToken?: string;
  /**
   * When true, rejects subscriptions with empty event_codes array.
   * Mirrors pre-FRA-3537 server behavior where event_codes presence: true
   * caused Webhook::Endpoint.create! to raise on bare subscribe.
   * Default: false (FRA-3537 relaxed the validation).
   */
  rejectEmptyEventCodes?: boolean;
}

export interface WebhookListenFakeCableServer extends FakeCableServer {
  /** The session secret (whsec) included in the welcome. */
  readonly whsec: string;
  /** The session token included in the welcome. */
  readonly sessionToken: string;
  /** The endpoint ID included in the welcome. */
  readonly endpointId: string;
  /** Validated AckPayload objects received from the client, in arrival order. */
  readonly receivedAcks: AckPayload[];
  /**
   * Broadcast a webhook event in the real wire shape (BroadcastEventMessage)
   * to all clients subscribed to Cli::WebhookListenChannel.
   */
  broadcastEvent(event: BroadcastEventMessage): void;
}

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
  /**
   * When true, the server requires a non-empty `Origin` header on every WS
   * upgrade and rejects requests that omit it with HTTP 403. Mirrors
   * ActionCable's `allow_same_origin_as_host` forgery protection.
   *
   * The CLI cable-client automatically derives and sends Origin from the WS
   * URL, so positive-path tests are unaffected. Only raw WebSocket connections
   * that skip the CLI client (or incorrectly configured clients) will fail.
   *
   * Default: false → no Origin enforcement (back-compat for older tests).
   */
  requireOrigin?: boolean;
  /**
   * When set, the server only acknowledges `subscribe` commands whose channel
   * identifier references one of these class strings. Subscriptions for any
   * other channel class receive a `reject_subscription` reply, mirroring Rails'
   * `Subscription class not found` behaviour.
   *
   * Use fully-namespaced Rails class names (e.g. `"Cli::LogsChannel"`).
   *
   * Default: undefined → any channel is accepted (back-compat for older tests).
   */
  allowedChannels?: string[];
  /**
   * @internal
   * Hook called after confirm_subscription is sent, with the ws socket
   * and the identifier. Used by preset wrappers.
   */
  _onSubscribed?: (ws: WebSocket, identifier: string) => void;
  /**
   * @internal
   * Hook called when a "message" command is received (after recording in
   * received). Used by preset wrappers to inspect ack payloads.
   */
  _onMessage?: (identifier: string, data: unknown) => void;
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
  const rejectedSubscriptions: { identifier: string; reason: string }[] = [];

  httpServer.on("upgrade", (req, socket, head) => {
    const authHeader = req.headers["authorization"];
    // ── Authorization check ────────────────────────────────────────────────
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
    // ── Origin check ──────────────────────────────────────────────────────
    if (opts.requireOrigin) {
      const originHeader = req.headers["origin"];
      if (typeof originHeader !== "string" || originHeader.length === 0) {
        rejectedUpgrades.push({ reason: "missing Origin header" });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
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

        // ── Channel allow-list check ─────────────────────────────────────
        if (opts.allowedChannels != null) {
          let channelName: string | undefined;
          try {
            const parsed = JSON.parse(identifier) as Record<string, unknown>;
            channelName = parsed["channel"] as string | undefined;
          } catch {
            // malformed identifier — treat as unknown
          }
          if (!channelName || !opts.allowedChannels.includes(channelName)) {
            const reason = `Subscription class not found: ${JSON.stringify(channelName ?? identifier)}`;
            rejectedSubscriptions.push({ identifier, reason });
            ws.send(JSON.stringify({ type: "reject_subscription", identifier }));
            return;
          }
        }

        clientSubs.get(ws)?.add(identifier);
        ws.send(JSON.stringify({ type: "confirm_subscription", identifier }));

        // Fire the subscribe hook (used by preset wrappers)
        opts._onSubscribed?.(ws, identifier);

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
        opts._onMessage?.(identifier, data);
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
    rejectedSubscriptions,

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

// ─── Convenience factory ───────────────────────────────────────────────────────

/**
 * One-liner for the fully-wired setup that mirrors every production Rails
 * cable-connection constraint:
 *
 *   - Authorization: Bearer <apiKey>  (HTTP 401 if missing / wrong)
 *   - Origin header                   (HTTP 403 if missing)
 *   - Channel allow-list              (reject_subscription if not in list)
 *
 * Individual tests that need a subset of these constraints can still call
 * `createFakeCableServer` directly with the options they want.
 *
 * Example:
 *   const server = await createFullyWiredFakeCableServer(
 *     "sk_test_xyz",
 *     ["Cli::LogsChannel", "Cli::WebhookListenChannel"],
 *   );
 */
export function createFullyWiredFakeCableServer(
  apiKey: string,
  allowedChannels: string[],
  extra: Omit<FakeCableServerOptions, "expectedApiKey" | "requireOrigin" | "allowedChannels"> = {},
): Promise<FakeCableServer> {
  return createFakeCableServer({
    ...extra,
    expectedApiKey: apiKey,
    requireOrigin: true,
    allowedChannels,
  });
}

// ─── webhookListenChannel preset factory ─────────────────────────────────────────────────

/**
 * Creates a FakeCableServer wired to mirror `Cli::WebhookListenChannel`:
 *
 *   - On subscribe: validates event_codes param, auto-sends real-shaped welcome
 *   - On ack message: parses and records the AckPayload in receivedAcks
 *   - broadcastEvent() sends a BroadcastEventMessage to all channel subscribers
 *
 * All existing FakeCableServerOptions are forwarded (auth, origin, etc.),
 * so you can combine this preset with the fully-wired auth constraints.
 *
 * @param presetOpts  WebhookListenChannel-specific options.
 * @param baseOpts    Forwarded to createFakeCableServer (auth, etc.).
 */
export async function createWebhookListenFakeCableServer(
  presetOpts: WebhookListenChannelPresetOptions = {},
  baseOpts: Omit<FakeCableServerOptions, "_onSubscribed" | "_onMessage"> = {},
): Promise<WebhookListenFakeCableServer> {
  const whsec = presetOpts.whsec ?? "whsec_cli_preset_test_00000000000000";
  const endpointId = presetOpts.endpointId ?? "wep_test_001";
  const sessionToken = presetOpts.sessionToken ?? "cs_test_001";
  const receivedAcks: AckPayload[] = [];

  // Identifier that matches any Cli::WebhookListenChannel subscriber.
  // Since the channel params vary per-subscriber (event_codes, session_token,
  // skip_endpoints, etc.), we send directly on the subscribe hook rather than
  // via server.send() to avoid identifier mismatch.
  const base = await createFakeCableServer({
    ...baseOpts,
    _onSubscribed(ws, identifier) {
      // Check if this is a WebhookListenChannel subscribe
      let channelName: string | undefined;
      let eventCodes: unknown;
      try {
        const parsed = JSON.parse(identifier) as Record<string, unknown>;
        channelName = parsed["channel"] as string | undefined;
        eventCodes = parsed["event_codes"];
      } catch {
        return;
      }

      if (channelName !== WEBHOOK_LISTEN_CHANNEL) return;

      // Optionally reject empty event_codes (pre-FRA-3537 behavior)
      if (presetOpts.rejectEmptyEventCodes) {
        if (!Array.isArray(eventCodes) || eventCodes.length === 0) {
          ws.send(
            JSON.stringify({
              type: "reject_subscription",
              identifier,
              message: "event_codes must be present",
            }),
          );
          return;
        }
      }

      // Auto-send real-shaped welcome
      const welcome = {
        type: "session",
        whsec,
        endpoint_id: endpointId,
        session_token: sessionToken,
      };
      ws.send(JSON.stringify({ identifier, message: welcome }));
    },
    _onMessage(_identifier, data) {
      if (
        typeof data === "object" &&
        data !== null &&
        (data as Record<string, unknown>)["action"] === "ack"
      ) {
        try {
          // Strip the `action` field before passing to parseAck since it's
          // part of the ActionCable message wrapper, not the AckPayload.
          const { action: _action, ...rest } = data as Record<string, unknown>;
          const ack = parseAck(rest);
          receivedAcks.push(ack);
        } catch {
          // Malformed ack — don't push, let tests inspect via .received
        }
      }
    },
  });

  return {
    ...base,
    get whsec() { return whsec; },
    get sessionToken() { return sessionToken; },
    get endpointId() { return endpointId; },
    get receivedAcks() { return receivedAcks; },
    broadcastEvent(event: BroadcastEventMessage) {
      // Send to all clients subscribed to Cli::WebhookListenChannel
      // (any params variant) by scanning received subscribe messages.
      const sentTo = new Set<string>();
      for (const msg of base.received) {
        if (msg.command !== "subscribe" || !msg.identifier) continue;
        try {
          const parsed = JSON.parse(msg.identifier) as Record<string, unknown>;
          if (parsed["channel"] !== WEBHOOK_LISTEN_CHANNEL) continue;
          if (sentTo.has(msg.identifier)) continue;
          sentTo.add(msg.identifier);
          const { channel: _channel, ...channelParams } = parsed;
          base.send(WEBHOOK_LISTEN_CHANNEL, channelParams, event);
        } catch {
          // skip malformed identifiers
        }
      }
    },
  };
}
