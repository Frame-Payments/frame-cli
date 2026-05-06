/**
 * Contract test for the `frame listen` ↔ Cli::WebhookListenChannel wire
 * contract. See ADR-0008 § "Wire contract" and `src/transport/webhook-listen-protocol.ts`.
 *
 * What this test asserts:
 *   1. Every message in the captured transcript fixture parses cleanly
 *      with the strict parsers in the protocol module.
 *   2. The protocol module's strict parsers reject malformed messages
 *      (missing required fields, unknown fields, wrong types) with a
 *      WireContractError that names the offending field.
 *   3. The build helpers produce wire-shaped objects that round-trip
 *      through the parsers.
 *
 * If this test fails after a server change, the fix is one of:
 *   - regenerate the fixture (`scripts/capture-listen-transcript.sh`) AND
 *     update the protocol module + ADR-0008 § "Wire contract" in the same
 *     release on both sides; or
 *   - revert the server change.
 *
 * Status (FRA-3536): protocol module is wired but not yet consumed by
 * `commands/listen.ts` — orchestration migration follows in a sibling slice
 * under FRA-3535. This test guards the contract until that work lands.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  parseWelcome,
  parseBroadcastEvent,
  parseAck,
  parseSubscribeParams,
  buildSubscribeParams,
  buildAckPayload,
  WireContractError,
  type WelcomeMessage,
  type BroadcastEventMessage,
} from "../src/transport/webhook-listen-protocol.js";

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/webhook-listen-transcript.json",
);

interface TranscriptFile {
  schema_version: number;
  messages: unknown[];
}

function loadTranscript(): TranscriptFile {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as TranscriptFile;
}

describe("webhook-listen-protocol — fixture parses cleanly", () => {
  const transcript = loadTranscript();

  it("schema version 1", () => {
    expect(transcript.schema_version).toBe(1);
  });

  it("contains exactly one welcome", () => {
    const welcomes = transcript.messages.filter(
      (m): m is { type: string } =>
        typeof m === "object" && m !== null && (m as { type?: unknown }).type === "session",
    );
    expect(welcomes).toHaveLength(1);
  });

  it("contains at least one broadcast event", () => {
    const broadcasts = transcript.messages.filter(
      (m): m is { event_type: string } =>
        typeof m === "object" &&
        m !== null &&
        "event_type" in (m as object) &&
        !("type" in (m as object)),
    );
    expect(broadcasts.length).toBeGreaterThanOrEqual(1);
  });

  it("every message is recognised by exactly one strict parser", () => {
    for (const msg of transcript.messages) {
      const tries: Array<"welcome" | "broadcast"> = [];
      try {
        parseWelcome(msg);
        tries.push("welcome");
      } catch {
        // not a welcome
      }
      try {
        parseBroadcastEvent(msg);
        tries.push("broadcast");
      } catch {
        // not a broadcast
      }
      expect(
        tries.length,
        `message ${JSON.stringify(msg).slice(0, 80)} matched ${tries.length} shapes (expected exactly 1)`,
      ).toBe(1);
    }
  });

  it("welcome parses with all required fields", () => {
    const welcomeRaw = transcript.messages.find(
      (m): m is { type: string } =>
        typeof m === "object" && m !== null && (m as { type?: unknown }).type === "session",
    );
    expect(welcomeRaw).toBeDefined();
    const welcome: WelcomeMessage = parseWelcome(welcomeRaw);
    expect(welcome.type).toBe("session");
    expect(typeof welcome.whsec).toBe("string");
    expect(welcome.whsec.length).toBeGreaterThan(0);
    expect(typeof welcome.endpoint_id).toBe("string");
    expect(typeof welcome.session_token).toBe("string");
  });

  it("broadcast event parses with verified header keys", () => {
    const eventRaw = transcript.messages.find(
      (m): m is Record<string, unknown> =>
        typeof m === "object" &&
        m !== null &&
        "event_type" in (m as object) &&
        !("type" in (m as object)),
    );
    expect(eventRaw).toBeDefined();
    const evt: BroadcastEventMessage = parseBroadcastEvent(eventRaw);
    expect(typeof evt.webhook_message_id).toBe("string");
    expect(evt.event_type).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    expect(evt.headers["X-Frame-Event"]).toBe(evt.event_type);
    expect(evt.headers["X-Frame-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(evt.headers["Content-Type"]).toBe("application/json");
    expect(evt.headers["User-Agent"]).toMatch(/^Frame-Robot/);
  });
});

describe("webhook-listen-protocol — strict parsers reject malformed input", () => {
  it("welcome: rejects unknown field", () => {
    expect(() =>
      parseWelcome({
        type: "session",
        whsec: "x",
        endpoint_id: "1",
        session_token: "t",
        rogue: 42,
      }),
    ).toThrow(/unknown field "rogue"/);
  });

  it("welcome: rejects missing whsec", () => {
    expect(() =>
      parseWelcome({ type: "session", endpoint_id: "1", session_token: "t" }),
    ).toThrow(/missing required field "whsec"/);
  });

  it("welcome: rejects wrong type discriminator", () => {
    expect(() =>
      parseWelcome({
        type: "hello",
        whsec: "x",
        endpoint_id: "1",
        session_token: "t",
      }),
    ).toThrow(/expected type="session"/);
  });

  it("welcome: rejects replayed:false (must be exactly true when present)", () => {
    expect(() =>
      parseWelcome({
        type: "session",
        whsec: "x",
        endpoint_id: "1",
        session_token: "t",
        replayed: false,
      }),
    ).toThrow(/replayed must be exactly `true`/);
  });

  it("broadcast: rejects unknown header", () => {
    expect(() =>
      parseBroadcastEvent({
        webhook_message_id: "1",
        event_type: "account.created",
        headers: {
          "X-Frame-Event": "account.created",
          "X-Frame-Signature": "sha256=" + "0".repeat(64),
          "X-Frame-Webhook-Id": "1",
          "User-Agent": "x",
          "Content-Type": "application/json",
          "X-Bonus": "nope",
        },
        payload: {},
      }),
    ).toThrow(/unknown field "X-Bonus"/);
  });

  it("broadcast: rejects payload as array", () => {
    expect(() =>
      parseBroadcastEvent({
        webhook_message_id: "1",
        event_type: "account.created",
        headers: {
          "X-Frame-Event": "account.created",
          "X-Frame-Signature": "sha256=" + "0".repeat(64),
          "X-Frame-Webhook-Id": "1",
          "User-Agent": "x",
          "Content-Type": "application/json",
        },
        payload: [],
      }),
    ).toThrow(/payload must be object/);
  });

  it("ack: rejects non-numeric duration_ms", () => {
    expect(() =>
      parseAck({
        webhook_message_id: "1",
        status: 200,
        response_body: "ok",
        duration_ms: "12.3",
      }),
    ).toThrow(/duration_ms must be finite number/);
  });

  it("ack: rejects unknown field", () => {
    expect(() =>
      parseAck({
        webhook_message_id: "1",
        status: 200,
        response_body: "ok",
        duration_ms: 12.3,
        attempted_at: "2025-04-30T00:00:00Z",
      }),
    ).toThrow(/unknown field "attempted_at"/);
  });

  it("subscribe params: rejects skip_endpoints (not part of v1 contract)", () => {
    // Guards against the FRA-3535 → FRA-3536 amendment: skip_endpoints was
    // dropped from the wire contract because the server doesn't read it. If
    // someone re-adds the field on the CLI side without a paired Rails change,
    // this test fails loudly.
    expect(() =>
      parseSubscribeParams({ event_codes: [], skip_endpoints: true }),
    ).toThrow(/unknown field "skip_endpoints"/);
  });

  it("WireContractError carries the failing shape tag", () => {
    try {
      parseAck({});
    } catch (e) {
      expect(e).toBeInstanceOf(WireContractError);
      expect((e as WireContractError).shape).toBe("ack");
    }
  });
});

describe("webhook-listen-protocol — build helpers round-trip through parsers", () => {
  it("buildSubscribeParams (default = all events)", () => {
    const params = buildSubscribeParams({});
    expect(parseSubscribeParams(params)).toEqual({ event_codes: [] });
  });

  it("buildSubscribeParams with filter list and session token", () => {
    const params = buildSubscribeParams({
      eventCodes: ["account.created", "transfer.completed"],
      sessionToken: "cs_abc",
    });
    expect(parseSubscribeParams(params)).toEqual({
      event_codes: ["account.created", "transfer.completed"],
      session_token: "cs_abc",
    });
  });

  it("buildAckPayload", () => {
    const payload = buildAckPayload({
      webhookMessageId: "wmsg_1",
      status: 200,
      responseBody: "ok",
      durationMs: 42.5,
    });
    expect(parseAck(payload)).toEqual({
      webhook_message_id: "wmsg_1",
      status: 200,
      response_body: "ok",
      duration_ms: 42.5,
    });
  });
});
