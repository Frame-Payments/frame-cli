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
 *   - subscribe-failure surfacing: fires "reject_subscription" event when the server
 *     explicitly rejects; fires "no_confirm_subscription" warning event when no
 *     confirm_subscription arrives within confirmTimeoutMs (default 5 s)
 */

import { WebSocket } from "ws";
import { SUBSCRIPTION_STATUS } from "./webhook-listen-protocol.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface CableSubscription {
  /** Register a handler for a named event type (matches message.type) or "*" for all. */
  on(eventName: string, handler: (data: unknown) => void): this;
  /** Send an action to the server-side channel. */
  perform(action: string, payload?: Record<string, unknown>): void;
  /** Unsubscribe and stop receiving events. */
  unsubscribe(): void;
  /**
   * Update the channel params used for subsequent reconnects and perform calls.
   * This is used by the listen orchestration after receiving a welcome message
   * to inject `session_token` so reconnects carry it via the subscribe params.
   *
   * Registers the new identifier in the subscriptions Map so messages arriving
   * under the new identifier are routed to this subscription. The old identifier
   * is kept until unsubscribe() so the server can continue delivering messages
   * under it until the client reconnects with the updated params.
   */
  updateParams(params: Record<string, unknown>): void;
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
  /**
   * How long (ms) the client waits for a `confirm_subscription` after sending
   * a `subscribe` command before firing the `"no_confirm_subscription"` warning
   * event on the subscription. Default: 5 000 ms.
   *
   * Overridable for tests so suites don't have to sleep for 5 seconds.
   */
  confirmTimeoutMs?: number;
  /**
   * API key sent as `Authorization: Bearer <apiKey>` on the WS upgrade
   * handshake. The Rails-side `Cli::ApplicationCable::Connection` reads this
   * header to authenticate the connection (see ADR-0008). Without it the
   * server accepts the TCP/WebSocket upgrade and immediately rejects the
   * cable connection, producing an "open then immediately close" loop.
   *
   * Re-supplied automatically on every reconnect attempt, since it lives in
   * closure scope alongside the WS factory.
   *
   * Browser clients can't set request headers on WebSocket; if/when a browser
   * SDK shares this connection class, the server will need a query-param
   * fallback. Today the CLI is Node-only, so a header is the right choice.
   */
  apiKey?: string;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Convert a `ws://` / `wss://` URL into the matching HTTP(S) origin, suitable
 * for use as an `Origin` request header on the WebSocket upgrade. Returns
 * an empty string for unparseable input — callers should treat that as
 * "don't send Origin".
 *
 *   wss://api.framepayments.com/cable          → https://api.framepayments.com
 *   ws://localhost:3000/cable                  → http://localhost:3000
 */
function deriveHttpOrigin(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    const httpScheme = u.protocol === "wss:" ? "https:" : "http:";
    return `${httpScheme}//${u.host}`;
  } catch {
    return "";
  }
}


interface SubscriptionState {
  channelName: string;
  params: Record<string, unknown>;
  handlers: Map<string, Array<(data: unknown) => void>>;
  /** Timestamp (epoch ms) of the most-recently received data message. */
  lastReceivedAt: number | null;
  /** Set when the connection dropped; cleared when we receive a new message. */
  disconnectedAt: number | null;
  /**
   * Timer handle set after each `subscribe` command is sent. Cleared when
   * `confirm_subscription` or `reject_subscription` arrives. If it fires,
   * the client emits a `"no_confirm_subscription"` event to registered handlers.
   */
  confirmTimer: ReturnType<typeof setTimeout> | null;
}

function clearConfirmTimer(state: SubscriptionState): void {
  if (state.confirmTimer != null) {
    clearTimeout(state.confirmTimer);
    state.confirmTimer = null;
  }
}

function dispatchHandlers(
  state: SubscriptionState,
  eventName: string,
  data: unknown,
): void {
  for (const h of state.handlers.get(eventName) ?? []) h(data);
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
    confirmTimeoutMs = 5_000,
    apiKey,
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

    // Start (or restart) the confirmation watchdog. If confirm_subscription or
    // reject_subscription does not arrive within confirmTimeoutMs, emit a warning
    // instead of silently hanging (the failure mode that produced FRA-3535).
    clearConfirmTimer(state);
    state.confirmTimer = setTimeout(() => {
      state.confirmTimer = null;
      dispatchHandlers(state, "no_confirm_subscription", { identifier });
    }, confirmTimeoutMs);
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
      // Action Cable's wire protocol (`actioncable-v1-json`) defines a
      // server→client `ping` for liveness, and *no* corresponding `pong`.
      // Replying with `{type: "pong"}` causes Rails to log
      // `Received unrecognized command in {"type" => "pong", ...}` every
      // 3 seconds. Just drop the ping; if we ever need client-side liveness
      // tracking we'd update a `lastPingAt` timestamp here.
      return;
    }

    if (type === "welcome") {
      return;
    }

    if (type === SUBSCRIPTION_STATUS.CONFIRM) {
      // Clear the confirmation watchdog — the server acknowledged the subscribe.
      const identifier = msg["identifier"] as string | undefined;
      if (identifier != null) {
        const state = subscriptions.get(identifier);
        if (state != null) clearConfirmTimer(state);
      }
      return;
    }

    if (type === SUBSCRIPTION_STATUS.REJECT) {
      // The server explicitly rejected the subscribe. Cancel the watchdog and
      // notify registered handlers so callers can surface the failure.
      const identifier = msg["identifier"] as string | undefined;
      if (identifier != null) {
        const state = subscriptions.get(identifier);
        if (state != null) {
          clearConfirmTimer(state);
          dispatchHandlers(state, SUBSCRIPTION_STATUS.REJECT, { identifier });
        }
      }
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

    // The third arg to `ws.WebSocket` is `ClientOptions`, which accepts a
    // `headers` map merged into the upgrade request. This is the only path
    // available for sending headers on the WS handshake from Node — the
    // browser WebSocket constructor has no equivalent.
    //
    // We send two headers:
    //   - `Authorization: Bearer <apiKey>` — read by
    //     `Cli::ApplicationCable::Connection` to authenticate the merchant.
    //   - `Origin: <https-origin-of-ws-url>` — required by Action Cable's
    //     `allow_same_origin_as_host` forgery protection. The Node `ws`
    //     client omits Origin by default, which Rails rejects with
    //     "Request origin not allowed: " (empty). Setting it to the same
    //     origin as the WS URL passes the same-origin-as-host check without
    //     weakening server-side CSRF protection.
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const origin = deriveHttpOrigin(url);
    if (origin) headers.Origin = origin;
    const wsOptions = Object.keys(headers).length > 0 ? { headers } : undefined;
    ws = new WebSocket(url, ["actioncable-v1-json"], wsOptions);

    ws.on("open", () => {
      reconnectAttempts = 0;

      // The Map can hold multiple identifiers pointing at the same
      // SubscriptionState — `updateParams` adds a new identifier without
      // removing the previous one so messages arriving on the OLD identifier
      // (still in flight on the prior connection) keep routing. After a
      // reconnect, the server has dropped all prior subscriptions, so only
      // the latest identifier matters: dedupe by state and re-key the Map
      // so we send exactly one subscribe per logical subscription.
      const uniqueStates = new Set(subscriptions.values());
      subscriptions.clear();
      for (const state of uniqueStates) {
        subscriptions.set(makeIdentifier(state.channelName, state.params), state);
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
      const state: SubscriptionState = {
        channelName,
        params,
        handlers: new Map(),
        lastReceivedAt: null,
        disconnectedAt: null,
        confirmTimer: null,
      };
      subscriptions.set(makeIdentifier(channelName, params), state);

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
            identifier: makeIdentifier(state.channelName, state.params),
            data: JSON.stringify({ action, ...(payload ?? {}) }),
          });
        },

        unsubscribe() {
          clearConfirmTimer(state);
          // Remove all identifiers (current + any stale from prior updateParams calls)
          // that point to this subscription state.
          for (const [id, s] of subscriptions) {
            if (s === state) subscriptions.delete(id);
          }
          rawSend({
            command: "unsubscribe",
            identifier: makeIdentifier(state.channelName, state.params),
          });
        },

        updateParams(newParams: Record<string, unknown>) {
          // Update params used by sendSubscribe (on reconnect) and perform.
          // Also register the new identifier in the subscriptions Map so that
          // messages arriving with the new identifier after the next reconnect
          // are routed correctly.
          // The OLD identifier is intentionally left in the Map: the server
          // continues delivering messages with it until the client reconnects
          // (which will happen automatically via cable-client's backoff).
          // Stale entries are cleaned up in unsubscribe().
          state.params = newParams;
          const newId = makeIdentifier(state.channelName, newParams);
          subscriptions.set(newId, state);
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
      // Cancel any pending confirmation watchdog timers so they can't fire
      // after the client is torn down.
      for (const state of subscriptions.values()) {
        clearConfirmTimer(state);
      }
      ws?.close();
      ws = null;
    },
  };
}
