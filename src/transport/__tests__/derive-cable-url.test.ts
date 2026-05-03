/**
 * derive-cable-url tests
 *
 * Locks down the contract that the CLI's versioned API base URL
 * (e.g. `https://api.framepayments.com/v1`) maps to the unversioned
 * ActionCable mount (`wss://api.framepayments.com/cable`).
 *
 * Regression: prior to the fix, `deriveCableUrl` naively appended `/cable`
 * to the API base URL, producing `wss://…/v1/cable` — which 404s because
 * Rails mounts ActionCable at the bare origin, not under the API version.
 */

import { describe, expect, it } from "vitest";
import { deriveCableUrl } from "../derive-cable-url.js";
import { HARDCODED_DEFAULT_BASE_URL } from "../../auth/api-client.js";

describe("deriveCableUrl", () => {
  it("strips the /v1 prefix from the production default", () => {
    // The bug: this used to return wss://api.framepayments.com/v1/cable.
    expect(deriveCableUrl(HARDCODED_DEFAULT_BASE_URL)).toBe(
      "wss://api.framepayments.com/cable",
    );
  });

  it("strips a versioned path with a trailing slash", () => {
    expect(deriveCableUrl("https://api.framepayments.com/v1/")).toBe(
      "wss://api.framepayments.com/cable",
    );
  });

  it("handles multi-digit API versions", () => {
    expect(deriveCableUrl("https://api.framepayments.com/v22")).toBe(
      "wss://api.framepayments.com/cable",
    );
  });

  it("downgrades https:// to wss://", () => {
    expect(deriveCableUrl("https://api.framepayments.com/v1")).toMatch(
      /^wss:\/\//,
    );
  });

  it("downgrades http:// to ws:// (local/test base URLs)", () => {
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
