/**
 * Tests for `frame login` command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock keyring and api-client before importing login
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
}));

// Mock readline/promises so we can inject the API key without stdin
vi.mock("readline/promises", () => ({
  createInterface: vi.fn(),
}));

import * as keyring from "../src/auth/keyring.js";
import * as apiClientModule from "../src/auth/api-client.js";
import * as rlPromises from "readline/promises";
import { run } from "../src/commands/login.js";

const mockSet = vi.mocked(keyring.set);
const mockCreateApiClient = vi.mocked(apiClientModule.createApiClient);
const mockCreateInterface = vi.mocked(rlPromises.createInterface);

function makeRlInterface(answer: string) {
  return {
    question: vi.fn().mockResolvedValue(answer),
    close: vi.fn(),
  };
}

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

describe("frame login — happy path", () => {
  it("prompts for API key, calls GET /me, and saves credential to keyring", async () => {
    const rl = makeRlInterface("sk_test_abc123");
    mockCreateInterface.mockReturnValueOnce(rl as ReturnType<typeof rlPromises.createInterface>);

    const mockGet = vi.fn().mockResolvedValueOnce({ id: "acct_001", name: "ACME Corp" });
    mockCreateApiClient.mockReturnValueOnce({ get: mockGet });
    mockSet.mockResolvedValueOnce(undefined);

    await run();

    expect(mockGet).toHaveBeenCalledWith("/me");
    expect(mockSet).toHaveBeenCalledWith({
      apiKey: "sk_test_abc123",
      merchant: "acct_001",
    });
  });

  it("prints success confirmation after login", async () => {
    const rl = makeRlInterface("sk_test_abc123");
    mockCreateInterface.mockReturnValueOnce(rl as ReturnType<typeof rlPromises.createInterface>);

    const mockGet = vi.fn().mockResolvedValueOnce({ id: "acct_001", name: "ACME Corp" });
    mockCreateApiClient.mockReturnValueOnce({ get: mockGet });
    mockSet.mockResolvedValueOnce(undefined);

    await run();

    const allOutput = stdoutSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(allOutput).toContain("Logged in");
  });
});

describe("frame login — live key rejection", () => {
  it("rejects sk_live_ keys and does not write to keyring", async () => {
    const rl = makeRlInterface("sk_live_dangerous123");
    mockCreateInterface.mockReturnValueOnce(rl as ReturnType<typeof rlPromises.createInterface>);

    await expect(run()).rejects.toThrow(/live/i);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("does not call api-client when key is a live key", async () => {
    const rl = makeRlInterface("sk_live_dangerous123");
    mockCreateInterface.mockReturnValueOnce(rl as ReturnType<typeof rlPromises.createInterface>);

    try {
      await run();
    } catch {
      // expected
    }
    expect(mockCreateApiClient).not.toHaveBeenCalled();
  });
});

describe("frame login — api error", () => {
  it("propagates ApiError when /me returns non-2xx", async () => {
    const rl = makeRlInterface("sk_test_bad");
    mockCreateInterface.mockReturnValueOnce(rl as ReturnType<typeof rlPromises.createInterface>);

    const { ApiError } = await import("../src/auth/api-client.js");
    const mockGet = vi.fn().mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    mockCreateApiClient.mockReturnValueOnce({ get: mockGet });

    await expect(run()).rejects.toThrow("Unauthorized");
    expect(mockSet).not.toHaveBeenCalled();
  });
});
