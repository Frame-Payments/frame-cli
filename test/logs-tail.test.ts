/**
 * Tests for `frame logs tail` command.
 *
 * All external dependencies are mocked:
 *   - auth/keyring: returns a canned credential
 *   - transport/cable-client: returns a fake client whose subscribe() delivers
 *     events synchronously via the registered handler
 *
 * The AbortController pattern is used to terminate the otherwise-infinite stream:
 * aborting before calling run() makes the internal `await new Promise` resolve
 * immediately, while still allowing synchronously-delivered events (from the mock
 * subscription) to be processed during setup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock auth/keyring ──────────────────────────────────────────────────────────

vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

// ── Mock transport/cable-client ────────────────────────────────────────────────

vi.mock("../src/transport/cable-client.js", () => ({
  createCableClient: vi.fn(),
}));

import * as keyring from "../src/auth/keyring.js";
import * as cableModule from "../src/transport/cable-client.js";
import { run } from "../src/commands/logs-tail.js";

const mockGet = vi.mocked(keyring.get);
const mockCreateCableClient = vi.mocked(cableModule.createCableClient);

// ── Spy helpers ────────────────────────────────────────────────────────────────

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  // Default: logged-in credential
  mockGet.mockResolvedValue({ apiKey: "sk_test_xyz", merchant: "acct_001" });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

// ── Factory helpers ────────────────────────────────────────────────────────────

/** Build a mock cable subscription that immediately delivers `events` to the "*" handler. */
function makeMockClient(events: unknown[]) {
  const mockSub = {
    on: vi.fn().mockImplementation((evt: string, handler: (data: unknown) => void) => {
      if (evt === "*") {
        for (const ev of events) {
          handler(ev);
        }
      }
      return mockSub;
    }),
    perform: vi.fn(),
    unsubscribe: vi.fn(),
  };
  const mockClient = {
    subscribe: vi.fn().mockReturnValue(mockSub),
    disconnect: vi.fn(),
  };
  mockCreateCableClient.mockReturnValue(
    mockClient as unknown as ReturnType<typeof cableModule.createCableClient>,
  );
  return { mockClient, mockSub };
}

/** Run the command with an already-aborted signal so it resolves immediately. */
async function runAborted(opts: Parameters<typeof run>[0]) {
  const ac = new AbortController();
  ac.abort();
  await run(opts, ac.signal);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("frame logs tail", () => {
  // ── Output format ────────────────────────────────────────────────────────────

  it("prints method, path, status, and duration on one line per entry", async () => {
    makeMockClient([{ method: "GET", path: "/transfers", status: 200, duration: 42 }]);

    await runAborted({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("GET");
    expect(out).toContain("/transfers");
    expect(out).toContain("200");
    expect(out).toContain("42ms");
  });

  it("wraps 2xx status in green ANSI color", async () => {
    makeMockClient([{ method: "GET", path: "/me", status: 200, duration: 10 }]);

    await runAborted({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("\x1b[32m200\x1b[0m");
  });

  it("wraps 4xx status in yellow ANSI color", async () => {
    makeMockClient([{ method: "POST", path: "/transfers", status: 422, duration: 15 }]);

    await runAborted({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("\x1b[33m422\x1b[0m");
  });

  it("wraps 5xx status in red ANSI color", async () => {
    makeMockClient([{ method: "GET", path: "/accounts", status: 500, duration: 100 }]);

    await runAborted({});

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("\x1b[31m500\x1b[0m");
  });

  // ── --json mode ──────────────────────────────────────────────────────────────

  it("--json emits a JSON object per line with no ANSI codes", async () => {
    const entry = { method: "GET", path: "/transfers", status: 200, duration: 42 };
    makeMockClient([entry]);

    await runAborted({ json: true });

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    // Must be parseable JSON
    const parsed = JSON.parse(out.trim()) as unknown;
    expect(parsed).toMatchObject(entry);
    // Must contain no ANSI escape codes
    expect(out).not.toContain("\x1b[");
  });

  it("--json emits one object per line for multiple events", async () => {
    makeMockClient([
      { method: "GET", path: "/me", status: 200, duration: 5 },
      { method: "POST", path: "/transfers", status: 422, duration: 20 },
    ]);

    await runAborted({ json: true });

    const lines = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]) as unknown).toMatchObject({ status: 200 });
    expect(JSON.parse(lines[1]) as unknown).toMatchObject({ status: 422 });
  });

  // ── Filters ──────────────────────────────────────────────────────────────────

  it("--filter-status 4xx keeps only 4xx entries", async () => {
    makeMockClient([
      { method: "GET", path: "/me", status: 200, duration: 5 },
      { method: "POST", path: "/transfers", status: 422, duration: 20 },
      { method: "GET", path: "/accounts", status: 500, duration: 30 },
    ]);

    await runAborted({ filterStatus: ["4xx"], json: true });

    const lines = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]) as unknown).toMatchObject({ status: 422 });
  });

  it("--filter-status accepts multiple classes (4xx,5xx)", async () => {
    makeMockClient([
      { method: "GET", path: "/me", status: 200, duration: 5 },
      { method: "POST", path: "/transfers", status: 422, duration: 20 },
      { method: "GET", path: "/accounts", status: 500, duration: 30 },
    ]);

    await runAborted({ filterStatus: ["4xx", "5xx"], json: true });

    const lines = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("--filter-status accepts exact code (200)", async () => {
    makeMockClient([
      { method: "GET", path: "/me", status: 200, duration: 5 },
      { method: "GET", path: "/other", status: 201, duration: 5 },
      { method: "POST", path: "/transfers", status: 422, duration: 20 },
    ]);

    await runAborted({ filterStatus: ["200"], json: true });

    const lines = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]) as unknown).toMatchObject({ status: 200 });
  });

  it("--filter-method POST keeps only POST requests", async () => {
    makeMockClient([
      { method: "GET", path: "/me", status: 200, duration: 5 },
      { method: "POST", path: "/transfers", status: 201, duration: 20 },
      { method: "DELETE", path: "/transfers/tr_1", status: 200, duration: 10 },
    ]);

    await runAborted({ filterMethod: ["POST"], json: true });

    const lines = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]) as unknown).toMatchObject({ method: "POST" });
  });

  it("--filter-path /transfers/* keeps only matching paths", async () => {
    makeMockClient([
      { method: "GET", path: "/transfers", status: 200, duration: 5 },
      { method: "GET", path: "/transfers/tr_123", status: 200, duration: 10 },
      { method: "GET", path: "/accounts/acc_1", status: 200, duration: 8 },
    ]);

    await runAborted({ filterPath: "/transfers/*", json: true });

    const lines = stdoutSpy.mock.calls
      .map((c) => String(c[0]))
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]) as unknown).toMatchObject({ path: "/transfers/tr_123" });
  });

  // ── Banner ───────────────────────────────────────────────────────────────────

  it("prints the safety banner on stderr before streaming", async () => {
    makeMockClient([]);

    await runAborted({});

    const bannerOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(bannerOutput).toContain("mode: sandbox");
    expect(bannerOutput).toContain("acct_001");
  });

  // ── Auth guard ───────────────────────────────────────────────────────────────

  it("throws when no credential is stored", async () => {
    mockGet.mockResolvedValueOnce(null);
    makeMockClient([]);

    const ac = new AbortController();
    ac.abort();
    await expect(run({}, ac.signal)).rejects.toThrow(/not logged in/i);
  });

  // ── Subscription ─────────────────────────────────────────────────────────────

  it("subscribes to LogsChannel", async () => {
    const { mockClient } = makeMockClient([]);

    await runAborted({});

    expect(mockClient.subscribe).toHaveBeenCalledWith("LogsChannel");
  });
});
