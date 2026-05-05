/**
 * Tests for fmt/error — pretty-printing ApiError (and other thrown values)
 * for terminal display, without leaking stack traces.
 */

import { describe, it, expect } from "vitest";
import { ApiError } from "../../auth/api-client.js";
import { formatError } from "../error.js";

describe("formatError", () => {
  it("formats a plain ApiError on one line with status and message", () => {
    const err = new ApiError(401, "Unauthorized");
    expect(formatError(err)).toBe("Error: Unauthorized (HTTP 401)");
  });

  it("includes per-field validation details on 422 responses", () => {
    const err = new ApiError(422, "Validation failed", {
      errorType: "validation_error",
      details: {
        type: ["is missing"],
        profile: ["is missing"],
      },
    });
    const out = formatError(err);
    expect(out).toContain("Error: Validation failed (HTTP 422)");
    expect(out).toContain("type: is missing");
    expect(out).toContain("profile: is missing");
    // No stack trace should leak through.
    expect(out).not.toContain("at ");
    expect(out).not.toContain("api-client.ts");
  });

  it("renders nested validation details with dotted paths", () => {
    const err = new ApiError(422, "Validation failed", {
      errorType: "validation_error",
      details: {
        profile: {
          individual: ["must provide either email or phone number"],
        },
      },
    });
    expect(formatError(err)).toContain(
      "profile.individual: must provide either email or phone number",
    );
  });

  it("formats a generic Error without stack", () => {
    const err = new Error("boom");
    expect(formatError(err)).toBe("Error: boom");
  });
});
