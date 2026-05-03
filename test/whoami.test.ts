/**
 * Tests for `frame whoami` command.
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
import { run } from "../src/commands/whoami.js";

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

describe("frame whoami", () => {
  it("prints the active merchant name via the banner wrapper", async () => {
    mockGet.mockResolvedValueOnce({
      apiKey: "sk_test_xyz",
      merchant: "acct_001",
      devMode: true,
    });
    const mockFetch = vi.fn().mockResolvedValueOnce({
      merchant_id: "acct_001",
      merchant_name: "ACME Corp",
      dev_mode: true,
      api_version: "v1",
    });
    mockCreateApiClient.mockReturnValueOnce({ get: mockFetch });

    await run();

    const allOutput =
      stdoutSpy.mock.calls.map((a) => String(a[0])).join("") +
      stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(allOutput).toContain("acct_001");
    expect(allOutput).toContain("ACME Corp");
  });

  it("prints mode: sandbox in the banner when /me reports dev_mode=true", async () => {
    mockGet.mockResolvedValueOnce({
      apiKey: "sk_test_xyz",
      merchant: "acct_001",
      devMode: true,
    });
    const mockFetch = vi.fn().mockResolvedValueOnce({
      merchant_id: "acct_001",
      merchant_name: "ACME Corp",
      dev_mode: true,
      api_version: "v1",
    });
    mockCreateApiClient.mockReturnValueOnce({ get: mockFetch });

    await run();

    const bannerOutput = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(bannerOutput).toContain("mode: sandbox");
  });

  it("prints mode: live in the banner when /me reports dev_mode=false", async () => {
    mockGet.mockResolvedValueOnce({
      apiKey: "sk_test_xyz",
      merchant: "acct_001",
      devMode: true, // stored cred says sandbox; banner derives from /me response
    });
    const mockFetch = vi.fn().mockResolvedValueOnce({
      merchant_id: "acct_001",
      merchant_name: "ACME Corp",
      dev_mode: false,
      api_version: "v1",
    });
    mockCreateApiClient.mockReturnValueOnce({ get: mockFetch });

    await run();

    const bannerOutput = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(bannerOutput).toContain("mode: live");
  });

  it("calls GET /me with the stored api key", async () => {
    mockGet.mockResolvedValueOnce({
      apiKey: "sk_test_xyz",
      merchant: "acct_001",
      devMode: true,
    });
    const mockFetch = vi.fn().mockResolvedValueOnce({
      merchant_id: "acct_001",
      merchant_name: "ACME Corp",
      dev_mode: true,
      api_version: "v1",
    });
    mockCreateApiClient.mockReturnValueOnce({ get: mockFetch });

    await run();

    expect(mockFetch).toHaveBeenCalledWith("/me");
    expect(mockCreateApiClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk_test_xyz" }),
    );
  });

  it("throws when no credential is stored", async () => {
    mockGet.mockResolvedValueOnce(null);

    await expect(run()).rejects.toThrow(/not logged in/i);
  });
});
