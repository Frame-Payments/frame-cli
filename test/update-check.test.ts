/**
 * Tests for src/update-check/update-check.ts
 *
 * All file I/O is mocked via vi.mock so no real ~/.frame directory is touched.
 * fetch is stubbed via vi.stubGlobal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs (only the functions update-check uses)
// ---------------------------------------------------------------------------
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/test"),
}));

import * as fs from "node:fs";
import { checkForUpdates } from "../src/update-check/update-check.js";

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENT_VERSION = "1.2.0";
const LATEST_VERSION = "1.3.0";
const MIN_CLI_VERSION = "1.1.0";

const CACHE_FILE = "/tmp/test-version-cache.json";

/** Returns a Date that is `hours` hours in the past relative to `now`. */
function hoursAgo(hours: number, now: Date): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function makeCacheJson(opts: {
  latest_version?: string;
  min_cli_version?: string;
  cachedAt: Date;
  nudgeShownAt?: Date;
}): string {
  return JSON.stringify({
    latest_version: opts.latest_version ?? LATEST_VERSION,
    min_cli_version: opts.min_cli_version ?? MIN_CLI_VERSION,
    cachedAt: opts.cachedAt.toISOString(),
    ...(opts.nudgeShownAt
      ? { nudgeShownAt: opts.nudgeShownAt.toISOString() }
      : {}),
  });
}

function makeFetchResponse(
  body: object,
  status = 200,
  ok = true,
): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitMock: ReturnType<typeof vi.fn>;
const NOW = new Date("2026-01-15T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitMock = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  stderrSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Default opts helper
// ---------------------------------------------------------------------------

function defaultOpts(overrides: Partial<Parameters<typeof checkForUpdates>[0]> = {}) {
  return {
    currentVersion: CURRENT_VERSION,
    cacheFile: CACHE_FILE,
    now: NOW,
    exit: exitMock as unknown as (code: number) => never,
    baseUrl: "https://api.frame.dev",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkForUpdates — cache honoured within 24h", () => {
  it("does not make a network call when cache is fresh (<24h)", async () => {
    const cachedAt = hoursAgo(2, NOW); // 2 hours ago — fresh
    mockReadFileSync.mockReturnValueOnce(makeCacheJson({ cachedAt }));

    await checkForUpdates(defaultOpts());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses cached latest_version value without a network call", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, latest_version: "1.3.0" }),
    );

    await checkForUpdates(defaultOpts());

    // latest > current → nudge should appear
    const output = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(output).toContain("1.3.0");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkForUpdates — cache refresh after 24h", () => {
  it("calls GET /api/v1/cli/latest_version when cache is stale (>24h)", async () => {
    const cachedAt = hoursAgo(25, NOW); // 25 hours ago — stale
    mockReadFileSync.mockReturnValueOnce(makeCacheJson({ cachedAt }));
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        latest_version: LATEST_VERSION,
        min_cli_version: MIN_CLI_VERSION,
      }),
    );

    await checkForUpdates(defaultOpts());

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.frame.dev/api/v1/cli/latest_version",
    );
  });

  it("calls the endpoint when cache file is absent", async () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT: no such file");
    });
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        latest_version: LATEST_VERSION,
        min_cli_version: MIN_CLI_VERSION,
      }),
    );

    await checkForUpdates(defaultOpts());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writes the fetched data to the cache file", async () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        latest_version: "1.4.0",
        min_cli_version: "1.1.0",
      }),
    );

    await checkForUpdates(defaultOpts());

    expect(mockWriteFileSync).toHaveBeenCalled();
    const written = JSON.parse(
      mockWriteFileSync.mock.calls[0][1] as string,
    ) as { latest_version: string };
    expect(written.latest_version).toBe("1.4.0");
  });
});

describe("checkForUpdates — min_cli_version hard stop", () => {
  it("calls exit(1) when current version is below min_cli_version", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, min_cli_version: "2.0.0" }), // current 1.2.0 < 2.0.0
    );

    await checkForUpdates(defaultOpts());

    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("prints a clear error message before exiting", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, min_cli_version: "2.0.0" }),
    );

    await checkForUpdates(defaultOpts());

    const output = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(output).toContain("minimum required version");
    expect(output).toContain("2.0.0");
  });

  it("does not exit when current version equals min_cli_version", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, min_cli_version: CURRENT_VERSION }),
    );

    await checkForUpdates(defaultOpts({ currentVersion: "1.2.0" }));

    expect(exitMock).not.toHaveBeenCalled();
  });

  it("does not exit when current version is above min_cli_version", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, min_cli_version: "1.0.0" }),
    );

    await checkForUpdates(defaultOpts());

    expect(exitMock).not.toHaveBeenCalled();
  });
});

describe("checkForUpdates — upgrade nudge", () => {
  it("prints a nudge when latest > current and nudge has not been shown today", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, latest_version: "1.3.0" }),
      // no nudgeShownAt
    );

    await checkForUpdates(defaultOpts());

    const output = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(output).toContain("1.3.0");
    expect(output).toContain("brew upgrade frame");
  });

  it("does not print a nudge when latest === current", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, latest_version: CURRENT_VERSION }),
    );

    await checkForUpdates(defaultOpts());

    const output = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(output).not.toContain("brew upgrade frame");
  });

  it("does not print a nudge when it was already shown within the last 24h", async () => {
    const cachedAt = hoursAgo(1, NOW);
    const nudgeShownAt = hoursAgo(2, NOW); // shown 2 hours ago
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, latest_version: "1.3.0", nudgeShownAt }),
    );

    await checkForUpdates(defaultOpts());

    const output = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(output).not.toContain("brew upgrade frame");
  });

  it("prints the nudge again once 24h have passed since last nudge", async () => {
    const cachedAt = hoursAgo(1, NOW);
    const nudgeShownAt = hoursAgo(25, NOW); // shown 25 hours ago
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, latest_version: "1.3.0", nudgeShownAt }),
    );

    await checkForUpdates(defaultOpts());

    const output = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(output).toContain("brew upgrade frame");
  });

  it("updates nudgeShownAt in cache after printing the nudge", async () => {
    const cachedAt = hoursAgo(1, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, latest_version: "1.3.0" }),
    );

    await checkForUpdates(defaultOpts());

    // writeFileSync should have been called to update nudgeShownAt
    expect(mockWriteFileSync).toHaveBeenCalled();
    const lastWrite = mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1];
    const written = JSON.parse(lastWrite[1] as string) as { nudgeShownAt?: string };
    expect(written.nudgeShownAt).toBe(NOW.toISOString());
  });
});

describe("checkForUpdates — network error degrades silently", () => {
  it("does not throw when fetch fails and cache is absent", async () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    await expect(checkForUpdates(defaultOpts())).resolves.toBeUndefined();
  });

  it("does not call exit when fetch fails and no cached min_cli_version is known", async () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    await checkForUpdates(defaultOpts());

    expect(exitMock).not.toHaveBeenCalled();
  });

  it("still enforces min_cli_version from a stale cache even when refresh fails", async () => {
    // Cache is stale, refresh fails — but we still use the stale cached value
    const cachedAt = hoursAgo(25, NOW);
    mockReadFileSync.mockReturnValueOnce(
      makeCacheJson({ cachedAt, min_cli_version: "2.0.0" }),
    );
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    await checkForUpdates(defaultOpts());

    // Should still exit because min_cli_version is known from stale cache
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
