/**
 * transport/webhook-listen-protocol
 *
 * Single source of truth for the wire contract between `frame listen` (this
 * CLI) and `Cli::WebhookListenChannel` in the `frame/` Rails repo. Every
 * wire-facing field name appears in this file exactly once; the rest of the
 * codebase imports the constants and types from here so a server rename
 * causes a TypeScript error rather than a silent runtime drift.
 *
 * See ADR-0008 § "Wire contract" in `frame/docs/adr/0008-actioncable-cli-streaming-transport.md`
 * for the canonical four-shape contract and the cross-repo drift rule. The
 * matching server file (`frame/app/channels/cli/webhook_listen_channel.rb`)
 * carries an equivalent header comment pointing at the same ADR section.
 *
 * Drift rule (mirrored from the ADR): changing any field name on either side
 * requires updating the other side in the same release. The contract test
 * (`test/webhook-listen-protocol.test.ts`) asserts these shapes against a
 * fixture captured from a real Rails server via `scripts/capture-listen-transcript.sh`.
 *
 * Validation strictness: parse functions reject unknown fields and missing
 * required fields with a concrete diff in the error message. This is
 * intentional — the goal is loud-on-drift, not forward-compatible.
 *
 * Status: defined and exported in this slice (FRA-3536) but not yet consumed
 * by `commands/listen.ts`. Orchestration migration happens in a follow-up
 * slice under FRA-3535.
 */

// ─── Wire-facing constants ─────────────────────────────────────────────────────
//
// Every wire-facing identifier the CLI sends or recognises lives here. If a
// name appears as a string literal anywhere else in this codebase, that's a
// bug — import from this module instead.

/** Server-side channel class name. */
export const CHANNEL_NAME = "Cli::WebhookListenChannel" as const;

/**
 * ActionCable subscription-status message types (server → client).
 * Used by cable-client to surface rejection and confirmation-timeout events.
 */
export const SUBSCRIPTION_STATUS = {
  /** Server confirmed the subscribe command. */
  CONFIRM: "confirm_subscription",
  /** Server explicitly rejected the subscribe command. */
  REJECT: "reject_subscription",
} as const;

/** Subscribe-time params (CLI → server, on the ActionCable subscribe command). */
export const SUBSCRIBE_PARAMS = {
  EVENT_CODES: "event_codes",
  SESSION_TOKEN: "session_token",
} as const;

/** Welcome (server → CLI, transmitted once per subscribe). */
export const WELCOME = {
  TYPE: "type",
  TYPE_VALUE: "session",
  WHSEC: "whsec",
  ENDPOINT_ID: "endpoint_id",
  SESSION_TOKEN: "session_token",
  REPLAYED: "replayed",
} as const;

/**
 * Broadcast event message (server → CLI, one per webhook delivery).
 *
 * Note: this shape has no `type` discriminator — the cable client routes
 * data messages by `message.type` defaulting to `"message"`, so handlers
 * registered with `.on("message", …)` or `.on("*", …)` receive these.
 * The asymmetry with WELCOME (`type: "session"`) is intentional and
 * encoded in the ADR; do not add a `type` field server-side without a
 * paired CLI release.
 */
export const BROADCAST_EVENT = {
  WEBHOOK_MESSAGE_ID: "webhook_message_id",
  EVENT_TYPE: "event_type",
  HEADERS: "headers",
  PAYLOAD: "payload",
} as const;

/**
 * Headers carried inside a broadcast event's `headers` field. The server
 * pre-signs with the same `whsec` it gave the CLI in the welcome, so a
 * forwarder MAY trust these as-is rather than re-signing. Out-of-scope
 * recommendation captured in ADR-0008.
 */
export const BROADCAST_EVENT_HEADERS = {
  X_FRAME_EVENT: "X-Frame-Event",
  X_FRAME_SIGNATURE: "X-Frame-Signature",
  X_FRAME_WEBHOOK_ID: "X-Frame-Webhook-Id",
  USER_AGENT: "User-Agent",
  CONTENT_TYPE: "Content-Type",
} as const;

/** Ack action (CLI → server, via `subscription.perform`). */
export const ACK = {
  ACTION_NAME: "ack",
  WEBHOOK_MESSAGE_ID: "webhook_message_id",
  STATUS: "status",
  RESPONSE_BODY: "response_body",
  DURATION_MS: "duration_ms",
} as const;

// ─── Type definitions ──────────────────────────────────────────────────────────

export interface SubscribeParams {
  /** Empty array means "all events for this merchant"; otherwise filter list. */
  event_codes: string[];
  /** Present only on reconnect within the replay window, asks the server to revive the prior session. */
  session_token?: string;
}

export interface WelcomeMessage {
  type: "session";
  whsec: string;
  endpoint_id: string;
  session_token: string;
  /** Present (and `true`) only when the server revived a prior session via `session_token`. */
  replayed?: true;
}

export interface BroadcastEventHeaders {
  "X-Frame-Event": string;
  "X-Frame-Signature": string;
  "X-Frame-Webhook-Id": string;
  "User-Agent": string;
  "Content-Type": string;
}

export interface BroadcastEventMessage {
  webhook_message_id: string;
  event_type: string;
  headers: BroadcastEventHeaders;
  payload: Record<string, unknown>;
}

export interface AckPayload {
  webhook_message_id: string;
  status: number;
  response_body: string;
  duration_ms: number;
}

// ─── Parse functions ───────────────────────────────────────────────────────────
//
// Strict: reject unknown fields, fail on missing required, narrow types.
// Each returns the typed value on success and throws a `WireContractError`
// with a precise message on failure. The error message names the offending
// field and the expected shape so a server drift produces a one-line diff.

export class WireContractError extends Error {
  constructor(
    message: string,
    /** The shape that failed to parse. */
    public readonly shape: "welcome" | "broadcast_event" | "ack" | "subscribe_params",
  ) {
    super(message);
    this.name = "WireContractError";
  }
}

function fail(shape: WireContractError["shape"], reason: string): never {
  throw new WireContractError(
    `Wire contract violation in ${shape}: ${reason}`,
    shape,
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertExactKeys(
  shape: WireContractError["shape"],
  obj: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set<string>([...required, ...optional]);
  const present = new Set(Object.keys(obj));
  for (const k of required) {
    if (!present.has(k)) fail(shape, `missing required field "${k}"`);
  }
  for (const k of present) {
    if (!allowed.has(k)) fail(shape, `unknown field "${k}"`);
  }
}

export function parseWelcome(raw: unknown): WelcomeMessage {
  if (!isPlainObject(raw)) fail("welcome", "expected object");
  assertExactKeys(
    "welcome",
    raw,
    [WELCOME.TYPE, WELCOME.WHSEC, WELCOME.ENDPOINT_ID, WELCOME.SESSION_TOKEN],
    [WELCOME.REPLAYED],
  );
  if (raw[WELCOME.TYPE] !== WELCOME.TYPE_VALUE) {
    fail("welcome", `expected ${WELCOME.TYPE}="${WELCOME.TYPE_VALUE}", got ${JSON.stringify(raw[WELCOME.TYPE])}`);
  }
  if (typeof raw[WELCOME.WHSEC] !== "string") fail("welcome", `${WELCOME.WHSEC} must be string`);
  // endpoint_id may be int or string on the wire (Rails `id` serialises as
  // either depending on schema); we coerce-and-narrow rather than assert.
  const endpointIdRaw = raw[WELCOME.ENDPOINT_ID];
  if (typeof endpointIdRaw !== "string" && typeof endpointIdRaw !== "number") {
    fail("welcome", `${WELCOME.ENDPOINT_ID} must be string or number`);
  }
  if (typeof raw[WELCOME.SESSION_TOKEN] !== "string") fail("welcome", `${WELCOME.SESSION_TOKEN} must be string`);
  if (WELCOME.REPLAYED in raw && raw[WELCOME.REPLAYED] !== true) {
    fail("welcome", `${WELCOME.REPLAYED} must be exactly \`true\` when present`);
  }
  return {
    type: "session",
    whsec: raw[WELCOME.WHSEC] as string,
    endpoint_id: String(endpointIdRaw),
    session_token: raw[WELCOME.SESSION_TOKEN] as string,
    ...(WELCOME.REPLAYED in raw ? { replayed: true as const } : {}),
  };
}

export function parseBroadcastEvent(raw: unknown): BroadcastEventMessage {
  if (!isPlainObject(raw)) fail("broadcast_event", "expected object");
  assertExactKeys("broadcast_event", raw, [
    BROADCAST_EVENT.WEBHOOK_MESSAGE_ID,
    BROADCAST_EVENT.EVENT_TYPE,
    BROADCAST_EVENT.HEADERS,
    BROADCAST_EVENT.PAYLOAD,
  ]);
  const idRaw = raw[BROADCAST_EVENT.WEBHOOK_MESSAGE_ID];
  if (typeof idRaw !== "string" && typeof idRaw !== "number") {
    fail("broadcast_event", `${BROADCAST_EVENT.WEBHOOK_MESSAGE_ID} must be string or number`);
  }
  if (typeof raw[BROADCAST_EVENT.EVENT_TYPE] !== "string") {
    fail("broadcast_event", `${BROADCAST_EVENT.EVENT_TYPE} must be string`);
  }
  const headers = raw[BROADCAST_EVENT.HEADERS];
  if (!isPlainObject(headers)) fail("broadcast_event", `${BROADCAST_EVENT.HEADERS} must be object`);
  assertExactKeys("broadcast_event", headers, [
    BROADCAST_EVENT_HEADERS.X_FRAME_EVENT,
    BROADCAST_EVENT_HEADERS.X_FRAME_SIGNATURE,
    BROADCAST_EVENT_HEADERS.X_FRAME_WEBHOOK_ID,
    BROADCAST_EVENT_HEADERS.USER_AGENT,
    BROADCAST_EVENT_HEADERS.CONTENT_TYPE,
  ]);
  for (const k of Object.keys(headers)) {
    if (typeof headers[k] !== "string") {
      fail("broadcast_event", `headers.${k} must be string`);
    }
  }
  const payload = raw[BROADCAST_EVENT.PAYLOAD];
  if (!isPlainObject(payload)) fail("broadcast_event", `${BROADCAST_EVENT.PAYLOAD} must be object`);
  return {
    webhook_message_id: String(idRaw),
    event_type: raw[BROADCAST_EVENT.EVENT_TYPE] as string,
    headers: headers as unknown as BroadcastEventHeaders,
    payload,
  };
}

export function parseAck(raw: unknown): AckPayload {
  if (!isPlainObject(raw)) fail("ack", "expected object");
  assertExactKeys("ack", raw, [
    ACK.WEBHOOK_MESSAGE_ID,
    ACK.STATUS,
    ACK.RESPONSE_BODY,
    ACK.DURATION_MS,
  ]);
  const idRaw = raw[ACK.WEBHOOK_MESSAGE_ID];
  if (typeof idRaw !== "string" && typeof idRaw !== "number") {
    fail("ack", `${ACK.WEBHOOK_MESSAGE_ID} must be string or number`);
  }
  if (typeof raw[ACK.STATUS] !== "number" || !Number.isFinite(raw[ACK.STATUS])) {
    fail("ack", `${ACK.STATUS} must be finite number (HTTP status code)`);
  }
  if (typeof raw[ACK.RESPONSE_BODY] !== "string") {
    fail("ack", `${ACK.RESPONSE_BODY} must be string`);
  }
  if (typeof raw[ACK.DURATION_MS] !== "number" || !Number.isFinite(raw[ACK.DURATION_MS])) {
    fail("ack", `${ACK.DURATION_MS} must be finite number`);
  }
  return {
    webhook_message_id: String(idRaw),
    status: raw[ACK.STATUS] as number,
    response_body: raw[ACK.RESPONSE_BODY] as string,
    duration_ms: raw[ACK.DURATION_MS] as number,
  };
}

export function parseSubscribeParams(raw: unknown): SubscribeParams {
  if (!isPlainObject(raw)) fail("subscribe_params", "expected object");
  assertExactKeys(
    "subscribe_params",
    raw,
    [SUBSCRIBE_PARAMS.EVENT_CODES],
    [SUBSCRIBE_PARAMS.SESSION_TOKEN],
  );
  const codes = raw[SUBSCRIBE_PARAMS.EVENT_CODES];
  if (!Array.isArray(codes) || codes.some((c) => typeof c !== "string")) {
    fail("subscribe_params", `${SUBSCRIBE_PARAMS.EVENT_CODES} must be string[]`);
  }
  const tok = raw[SUBSCRIBE_PARAMS.SESSION_TOKEN];
  if (tok !== undefined && typeof tok !== "string") {
    fail("subscribe_params", `${SUBSCRIBE_PARAMS.SESSION_TOKEN} must be string when present`);
  }
  return {
    event_codes: codes as string[],
    ...(typeof tok === "string" ? { session_token: tok } : {}),
  };
}

/** Build a subscribe-params object for the cable client. Useful so callers don't reach for raw field names. */
export function buildSubscribeParams(args: {
  eventCodes?: readonly string[];
  sessionToken?: string;
}): SubscribeParams {
  return {
    event_codes: args.eventCodes ? [...args.eventCodes] : [],
    ...(args.sessionToken ? { session_token: args.sessionToken } : {}),
  };
}

/** Build an ack payload from a forwarder result. Single source of truth for ack field names. */
export function buildAckPayload(args: {
  webhookMessageId: string;
  status: number;
  responseBody: string;
  durationMs: number;
}): AckPayload {
  return {
    webhook_message_id: args.webhookMessageId,
    status: args.status,
    response_body: args.responseBody,
    duration_ms: args.durationMs,
  };
}
