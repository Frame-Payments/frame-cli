/**
 * Tests for `frame trigger <event_code>` command.
 *
 * Strategy: mock auth/keyring and auth/api-client; read real fixture YAML
 * from the fixtures/ directory; assert the API call sequence via snapshot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("../src/auth/api-client.js", () => ({
  createApiClient: vi.fn(),
  DEFAULT_BASE_URL: "https://api.frame.dev",
  HARDCODED_DEFAULT_BASE_URL: "https://api.frame.dev",
  resolveBaseUrl: () => "https://api.frame.dev",
}));

import * as keyring from "../src/auth/keyring.js";
import * as apiClientModule from "../src/auth/api-client.js";
import { run, SUPPORTED_EVENTS, DEPRECATED_EVENTS } from "../src/commands/trigger.js";

const mockKeyringGet = vi.mocked(keyring.get);
const mockCreateApiClient = vi.mocked(apiClientModule.createApiClient);

let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

/** Build a mock ApiClient that records every call and returns incrementing IDs. */
function makeMockClient() {
  let callIndex = 0;
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];

  function respond() {
    callIndex++;
    return Promise.resolve({ id: `mock_id_${callIndex}` });
  }

  const client = {
    get: vi.fn((path: string) => {
      calls.push({ method: "GET", path });
      return respond();
    }),
    post: vi.fn((path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
      return respond();
    }),
    patch: vi.fn((path: string, body: unknown) => {
      calls.push({ method: "PATCH", path, body });
      return respond();
    }),
    delete: vi.fn((path: string) => {
      calls.push({ method: "DELETE", path });
      return respond();
    }),
  };

  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  mockKeyringGet.mockResolvedValue({ apiKey: "sk_test_abc", merchant: "acct_test", devMode: true });
});

afterEach(() => {
  stderrSpy.mockRestore();
  stdoutSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Deprecated event codes
// ---------------------------------------------------------------------------

describe("frame trigger — deprecated event codes", () => {
  it("rejects customer.created with a message pointing to frame accounts create", async () => {
    await expect(run("customer.created")).rejects.toThrow(/frame accounts create/i);
  });

  it("rejects charge_intent.created with a deprecation message", async () => {
    await expect(run("charge_intent.created")).rejects.toThrow(/deprecated/i);
  });

  it("does not call api-client for deprecated event codes", async () => {
    const { client } = makeMockClient();
    mockCreateApiClient.mockReturnValue(client);

    try {
      await run("customer.created");
    } catch {
      // expected
    }

    expect(mockCreateApiClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unknown event codes
// ---------------------------------------------------------------------------

describe("frame trigger — unknown event codes", () => {
  it("rejects fake.event with a list of supported events", async () => {
    const err = await run("fake.event").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/fake\.event/);
    // Should list at least a few supported events
    expect((err as Error).message).toContain("transfer.completed");
    expect((err as Error).message).toContain("account.created");
  });

  it("does not call api-client for unknown event codes", async () => {
    const { client } = makeMockClient();
    mockCreateApiClient.mockReturnValue(client);

    try {
      await run("fake.event");
    } catch {
      // expected
    }

    expect(mockCreateApiClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

describe("frame trigger — banner", () => {
  it("prints the safety banner before command output", async () => {
    const { client } = makeMockClient();
    mockCreateApiClient.mockReturnValue(client);

    await run("account.created");

    const bannerOutput = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(bannerOutput).toContain("mode: sandbox");
    expect(bannerOutput).toContain("acct_test");
  });
});

// ---------------------------------------------------------------------------
// Per-step output
// ---------------------------------------------------------------------------

describe("frame trigger — step output", () => {
  it("prints each API call and the created resource id", async () => {
    const { client } = makeMockClient();
    mockCreateApiClient.mockReturnValue(client);

    await run("account.created");

    const output = stdoutSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(output).toContain("POST /api/v1/accounts");
    expect(output).toContain("mock_id_1");
  });

  it("throws when not logged in", async () => {
    mockKeyringGet.mockResolvedValue(null);
    await expect(run("account.created")).rejects.toThrow(/not logged in/i);
  });
});

// ---------------------------------------------------------------------------
// Parameterised snapshot: every supported event code
// ---------------------------------------------------------------------------

describe("frame trigger — parameterised API call sequences", () => {
  it.each(SUPPORTED_EVENTS)("trigger %s makes the expected API call sequence", async (eventCode) => {
    const { client, calls } = makeMockClient();
    mockCreateApiClient.mockReturnValue(client);

    await run(eventCode);

    // Snapshot the sequence of (method, path) pairs — body omitted to keep
    // snapshots readable and decoupled from fixture body values.
    const sequence = calls.map((c) => `${c.method} ${c.path}`);
    expect(sequence).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_EVENTS and DEPRECATED_EVENTS exports
// ---------------------------------------------------------------------------

describe("SUPPORTED_EVENTS", () => {
  it("contains exactly 16 canonical event codes", () => {
    expect(SUPPORTED_EVENTS).toHaveLength(16);
  });

  it("only contains events on canonical namespaces", () => {
    const canonicalPrefixes = ["account.", "capability.", "transfer.", "refund.", "invoice."];
    for (const code of SUPPORTED_EVENTS) {
      expect(canonicalPrefixes.some((p) => code.startsWith(p))).toBe(true);
    }
  });
});

describe("DEPRECATED_EVENTS", () => {
  it("maps customer.created to a message mentioning frame accounts create", () => {
    expect(DEPRECATED_EVENTS["customer.created"]).toMatch(/frame accounts create/i);
  });
});
