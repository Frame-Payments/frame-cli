/**
 * transport/cable-client
 *
 * Speaks the ActionCable v1-JSON protocol over WebSocket (Node.js, using ws).
 * Does NOT import @rails/actioncable directly — that package requires a DOM.
 * Instead it implements the same wire protocol so tests and the fake server stay simple.
 *
 * Public surface:
 *   createCableClient(url, options?) → CableClient
 *   CableClient.subscribe(channelName, params?) → CableSubscription
 *   CableSubscription.on(eventName, handler) → this
 *   CableSubscription.perform(action, payload?) → void
 *   CableSubscription.unsubscribe() → void
 *
 * Internals:
 *   - exponential-backoff reconnect (initialDelay * factor^attempts, capped at maxDelay)
 *   - ping/pong heartbeat: server sends {"type":"ping"}, client echoes {"type":"pong"}
 *   - replay-on-reconnect: if reconnection happens within replayWindowMs of the disconnect,
 *     the subscribe command includes last_received_at so the server can replay missed events
 */

import { WebSocket } from "ws";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CableSubscription {
  /** Register a handler for a named event type (matches message.type) or "*" for all. */
  on(eventName: string, handler: (data: unknown) => void): this;
  /** Send an action to the server-side channel. */
  perform(action: string, payload?: Record<string, unknown>): void;
  /** Unsubscribe and stop receiving events. */
  unsubscribe(): void;
}

export interface CableClient {
  /** Subscribe to a channel. May be called before the socket is open. */
  subscribe(channelName: string, params?: Record<string, unknown>): CableSubscription;
  /** Permanently close the connection and cancel any pending reconnect. */
  disconnect(): void;
}

export interface CableClientOptions {
  /** Delay (ms) before the first reconnect attempt. Default: 1000 */
  initialDelay?: number;
  /** Multiplier applied to delay on each subsequent attempt. Default: 2 */
  factor?: number;
  /** Maximum reconnect delay (ms). Default: 30 000 */
  maxDelay?: number;
  /**
   * How long after a disconnect (ms) the client will still request event
   * replay on reconnect.  Default: 5 minutes.
   */
  replayWindowMs?: number;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

interface SubscriptionState {
  channelName: string;
  params: Record<string, unknown>;
  handlers: Map<string, Array<(data: unknown) => void>>;
  /** Timestamp (epoch ms) of the most-recently received data message. */
  lastReceivedAt: number | null;
  /** Set when the connection dropped; cleared when we receive a new message. */
  disconnectedAt: number | null;
}

function makeIdentifier(
  channelName: string,
  params: Record<string, unknown>,
): string {
  return JSON.stringify({ channel: channelName, ...params });
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createCableClient(
  url: string,
  options: CableClientOptions = {},
): CableClient {
  const {
    initialDelay = 1_000,
    factor = 2,
    maxDelay = 30_000,
    replayWindowMs = 5 * 60 * 1_000,
  } = options;

  const subscriptions = new Map<string, SubscriptionState>();
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Backoff ──────────────────────────────────────────────────────────────────

  function backoffDelay(attempts: number): number {
    return Math.min(initialDelay * Math.pow(factor, attempts), maxDelay);
  }

  // ── Send helpers ─────────────────────────────────────────────────────────────

  function rawSend(obj: unknown): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendSubscribe(state: SubscriptionState): void {
    const identifier = makeIdentifier(state.channelName, state.params);
    const now = Date.now();

    // Include last_received_at only when reconnecting within the replay window.
    // Use state.disconnectedAt (set on close) rather than the global which is
    // cleared before this function is called.
    const withinWindow =
      state.lastReceivedAt != null &&
      state.disconnectedAt != null &&
      now - state.disconnectedAt < replayWindowMs;

    const cmd: Record<string, unknown> = { command: "subscribe", identifier };
    if (withinWindow) {
      cmd["last_received_at"] = state.lastReceivedAt;
    }
    rawSend(cmd);
  }

  // ── Message handling ─────────────────────────────────────────────────────────

  function handleRawMessage(raw: Buffer | string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = msg["type"] as string | undefined;

    if (type === "ping") {
      rawSend({ type: "pong", message: msg["message"] });
      return;
    }

    if (type === "welcome" || type === "confirm_subscription" || type === "reject_subscription") {
      return;
    }

    // Data message: {identifier, message: {...}}
    if (msg["identifier"] !== undefined && msg["message"] !== undefined) {
      const identifier = msg["identifier"] as string;
      const message = msg["message"] as Record<string, unknown>;
      const state = subscriptions.get(identifier);
      if (!state) return;

      state.lastReceivedAt = Date.now();
      state.disconnectedAt = null;

      const eventType = (message["type"] as string | undefined) ?? "message";
      for (const [evtName, handlers] of state.handlers) {
        if (evtName === eventType || evtName === "*") {
          for (const handler of handlers) {
            handler(message);
          }
        }
      }
    }
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────────

  function doConnect(): void {
    if (stopped) return;

    ws = new WebSocket(url, ["actioncable-v1-json"]);

    ws.on("open", () => {
      reconnectAttempts = 0;
      for (const state of subscriptions.values()) {
        sendSubscribe(state);
      }
    });

    ws.on("message", (raw: Buffer | string) => handleRawMessage(raw));

    ws.on("close", () => {
      if (!stopped) {
        const disconnectedAt = Date.now();
        for (const state of subscriptions.values()) {
          state.disconnectedAt = disconnectedAt;
        }
        scheduleReconnect();
      }
    });

    ws.on("error", () => {
      // "error" is always followed by "close"; handled there.
    });
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    const delay = backoffDelay(reconnectAttempts);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      doConnect();
    }, delay);
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  doConnect();

  // ── Public API ───────────────────────────────────────────────────────────────

  return {
    subscribe(
      channelName: string,
      params: Record<string, unknown> = {},
    ): CableSubscription {
      const identifier = makeIdentifier(channelName, params);

      const state: SubscriptionState = {
        channelName,
        params,
        handlers: new Map(),
        lastReceivedAt: null,
        disconnectedAt: null,
      };
      subscriptions.set(identifier, state);

      // Subscribe immediately if the socket is already open
      if (ws?.readyState === WebSocket.OPEN) {
        sendSubscribe(state);
      }

      const subscription: CableSubscription = {
        on(eventName: string, handler: (data: unknown) => void) {
          const list = state.handlers.get(eventName) ?? [];
          list.push(handler);
          state.handlers.set(eventName, list);
          return this;
        },

        perform(action: string, payload?: Record<string, unknown>) {
          if (ws?.readyState !== WebSocket.OPEN) {
            throw new Error("CableClient: not connected");
          }
          rawSend({
            command: "message",
            identifier,
            data: JSON.stringify({ action, ...(payload ?? {}) }),
          });
        },

        unsubscribe() {
          subscriptions.delete(identifier);
          rawSend({ command: "unsubscribe", identifier });
        },
      };

      return subscription;
    },

    disconnect() {
      stopped = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
    },
  };
}
