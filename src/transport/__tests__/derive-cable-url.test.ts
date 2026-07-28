/**
 * derive-cable-url tests
 *
 * Locks down two contracts:
 *
 * 1. The CLI's versioned API base URL (e.g.
 *    `https://api.framepayments.com/v1`) maps to the unversioned
 *    ActionCable mount (`/cable` at the origin, not under `/v1`).
 *
 * 2. `api.<env?>.framepayments.com` base URLs map to the dedicated
 *    `ws.` cable hostname (server ADR-0013): Evervault Relay fronts the
 *    `api.` hostnames and cannot tunnel WebSockets, so the socket lives on
 *    `ws.` while REST stays on `api.`. Local `.test` hosts, localhost, and
 *    `internal-api.` must NOT be rewritten.
 */

import { describe, expect, it } from "vitest";
import { deriveCableUrl } from "../derive-cable-url.js";
import { HARDCODED_DEFAULT_BASE_URL } from "../../auth/api-client.js";

describe("deriveCableUrl", () => {
  it("maps the production default to the ws. cable hostname, unversioned", () => {
    expect(deriveCableUrl(HARDCODED_DEFAULT_BASE_URL)).toBe(
      "wss://ws.framepayments.com/cable",
    );
  });

  it("strips a versioned path with a trailing slash", () => {
    expect(deriveCableUrl("https://api.framepayments.com/v1/")).toBe(
      "wss://ws.framepayments.com/cable",
    );
  });

  it("handles multi-digit API versions", () => {
    expect(deriveCableUrl("https://api.framepayments.com/v22")).toBe(
      "wss://ws.framepayments.com/cable",
    );
  });

  it("maps environment api hosts to their ws. counterparts", () => {
    expect(deriveCableUrl("https://api.staging.framepayments.com/v1")).toBe(
      "wss://ws.staging.framepayments.com/cable",
    );
    expect(deriveCableUrl("https://api.qa.framepayments.com/v1")).toBe(
      "wss://ws.qa.framepayments.com/cable",
    );
  });

  it("leaves internal-api untouched (manual Relay-bypass override)", () => {
    expect(deriveCableUrl("https://internal-api.framepayments.com/v1")).toBe(
      "wss://internal-api.framepayments.com/cable",
    );
  });

  it("does not rewrite look-alike hosts outside framepayments.com", () => {
    expect(deriveCableUrl("https://api.framepayments.com.evil.com/v1")).toBe(
      "wss://api.framepayments.com.evil.com/cable",
    );
  });

  it("downgrades https:// to wss://", () => {
    expect(deriveCableUrl("https://api.framepayments.com/v1")).toMatch(
      /^wss:\/\//,
    );
  });

  it("downgrades http:// to ws:// and leaves .test dev hosts on api.", () => {
    expect(deriveCableUrl("http://api.framepayments.test/v1")).toBe(
      "ws://api.framepayments.test/cable",
    );
  });

  it("works with a bare origin (no version segment)", () => {
    expect(deriveCableUrl("http://localhost:3000")).toBe(
      "ws://localhost:3000/cable",
    );
  });

  it("preserves a non-default port", () => {
    expect(deriveCableUrl("http://localhost:3000/v1")).toBe(
      "ws://localhost:3000/cable",
    );
  });
});
