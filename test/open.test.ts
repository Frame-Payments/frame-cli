/**
 * Tests for `frame open` command.
 *
 * Per the PRD testing decisions, thin command wrappers have limited tests.
 * Tests here cover argument parsing and platform-specific opener selection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process.spawn so we don't actually open a browser
vi.mock("node:child_process", () => ({
  spawn: vi.fn().mockReturnValue({
    unref: vi.fn(),
  }),
}));

// Mock auth/keyring (open doesn't need auth but the banner wrapper may)
vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

import * as child_process from "node:child_process";
import { run, dashboardUrl } from "../src/commands/open.js";

const mockSpawn = vi.mocked(child_process.spawn);

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

describe("frame open — URL construction", () => {
  it("opens the dashboard root when no page is provided", async () => {
    await run({});
    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall[1]).toContain(dashboardUrl());
  });

  it("opens a specific resource page when page is provided", async () => {
    await run({ page: "transfers/tr_xxx" });
    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall[1]).toContain(`${dashboardUrl()}/transfers/tr_xxx`);
  });
});

describe("frame open — platform-specific opener", () => {
  it("uses 'open' on macOS", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    await run({});
    expect(mockSpawn.mock.calls[0][0]).toBe("open");

    Object.defineProperty(process, "platform", { value: original, configurable: true });
  });

  it("uses 'xdg-open' on Linux", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    await run({});
    expect(mockSpawn.mock.calls[0][0]).toBe("xdg-open");

    Object.defineProperty(process, "platform", { value: original, configurable: true });
  });

  it("uses 'start' on Windows", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    await run({});
    expect(mockSpawn.mock.calls[0][0]).toBe("start");

    Object.defineProperty(process, "platform", { value: original, configurable: true });
  });
});

describe("frame open — banner", () => {
  it("prints the safety banner before opening", async () => {
    await run({});
    const bannerOutput = stderrSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(bannerOutput).toContain("mode: sandbox");
  });
});
