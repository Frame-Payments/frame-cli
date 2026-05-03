/**
 * Contract tests for auth/keyring.
 *
 * keytar is mocked so no OS keychain is touched during tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock keytar before importing keyring so the module picks up the mock.
//
// IMPORTANT: the mock shape mirrors keytar's *real* CJS export shape
// (`module.exports = { getPassword, setPassword, ... }`), exposed under
// `default` for ESM default-import consumers. `keyring.ts` uses
// `import keytar from "keytar"` — see the comment in that file for the
// ESM-interop background.
vi.mock("keytar", () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

import keytar from "keytar";
import { get, set, clear, type Credential } from "../keyring.js";

const mockGet = vi.mocked(keytar.getPassword);
const mockSet = vi.mocked(keytar.setPassword);
const mockDelete = vi.mocked(keytar.deletePassword);

const CRED: Credential = { apiKey: "sk_test_abc123", merchant: "acct_test_001" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("keyring.get", () => {
  it("returns null when no credential is stored", async () => {
    mockGet.mockResolvedValueOnce(null);
    const result = await get();
    expect(result).toBeNull();
  });

  it("returns a parsed Credential when one is stored", async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify(CRED));
    const result = await get();
    expect(result).toEqual(CRED);
  });

  it("calls keytar.getPassword with the correct service and account", async () => {
    mockGet.mockResolvedValueOnce(null);
    await get();
    expect(mockGet).toHaveBeenCalledWith("frame-cli", "api-key");
  });
});

describe("keyring.set", () => {
  it("calls keytar.setPassword with JSON-serialised credential", async () => {
    mockSet.mockResolvedValueOnce(undefined);
    await set(CRED);
    expect(mockSet).toHaveBeenCalledWith(
      "frame-cli",
      "api-key",
      JSON.stringify(CRED),
    );
  });
});

describe("keyring.clear", () => {
  it("calls keytar.deletePassword with the correct service and account", async () => {
    mockDelete.mockResolvedValueOnce(true);
    await clear();
    expect(mockDelete).toHaveBeenCalledWith("frame-cli", "api-key");
  });
});
