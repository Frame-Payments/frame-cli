/**
 * Tests for `frame events resend` command.
 *
 * Per the PRD testing decisions, thin command wrappers are not fully
 * unit-tested. Tests here are limited to:
 *   - argument parsing (evt_id is required)
 *   - deprecated-resource error path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("../src/auth/api-client.js", () => ({
  createApiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  DEFAULT_BASE_URL: "https://api.frame.dev",
  HARDCODED_DEFAULT_BASE_URL: "https://api.frame.dev",
  resolveBaseUrl: () => "https://api.frame.dev",
}));

import * as keyring from "../src/auth/keyring.js";
import * as apiClientModule from "../src/auth/api-client.js";
import { run } from "../src/commands/events-resend.js";

const mockGet = vi.mocked(keyring.get);
const mockCreateApiClient = vi.mocked(apiClientModule.createApiClient);

let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  stdoutSpy.mockRestore();
});

describe("frame events resend — argument parsing", () => {
  it("throws when no event id is provided", async () => {
    await expect(run({ eventId: "" })).rejects.toThrow(/event id/i);
  });

  it("throws when not logged in", async () => {
    mockGet.mockResolvedValueOnce(null);
    await expect(run({ eventId: "evt_123" })).rejects.toThrow(/not logged in/i);
  });
});

describe("frame events resend — happy path", () => {
  it("calls POST /events/:id/resend and prints result", async () => {
    mockGet.mockResolvedValueOnce({ apiKey: "sk_test_xyz", merchant: "acct_001", devMode: true });
    const mockPost = vi.fn().mockResolvedValueOnce({ id: "evt_123", status: "delivered" });
    mockCreateApiClient.mockReturnValueOnce({ get: vi.fn(), post: mockPost });

    await run({ eventId: "evt_123" });

    expect(mockPost).toHaveBeenCalledWith("/events/evt_123/resend");

    const allOutput = stdoutSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(allOutput).toContain("evt_123");
  });

  it("prints the safety banner before output", async () => {
    mockGet.mockResolvedValueOnce({ apiKey: "sk_test_xyz", merchant: "acct_001", devMode: true });
    const mockPost = vi.fn().mockResolvedValueOnce({ id: "evt_123", status: "delivered" });
    mockCreateApiClient.mockReturnValueOnce({ get: vi.fn(), post: mockPost });

    await run({ eventId: "evt_123" });

    const bannerOutput = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(bannerOutput).toContain("mode: sandbox");
  });
});

describe("frame events resend — deprecated-resource error path", () => {
  it("surfaces a deprecated-resource message from the API", async () => {
    mockGet.mockResolvedValueOnce({ apiKey: "sk_test_xyz", merchant: "acct_001", devMode: true });
    const { ApiError } = await import("../src/auth/api-client.js");
    const mockPost = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(422, "deprecated_resource: customers is a deprecated resource"),
      );
    mockCreateApiClient.mockReturnValueOnce({ get: vi.fn(), post: mockPost });

    await expect(run({ eventId: "evt_abc" })).rejects.toThrow(/deprecated_resource/i);
  });
});
