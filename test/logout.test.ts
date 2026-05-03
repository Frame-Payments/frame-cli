/**
 * Tests for `frame logout` command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

import * as keyring from "../src/auth/keyring.js";
import { run } from "../src/commands/logout.js";

const mockClear = vi.mocked(keyring.clear);

let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
});

describe("frame logout", () => {
  it("calls keyring.clear()", async () => {
    mockClear.mockResolvedValueOnce(undefined);
    await run();
    expect(mockClear).toHaveBeenCalledOnce();
  });

  it("prints a confirmation message", async () => {
    mockClear.mockResolvedValueOnce(undefined);
    await run();
    const allOutput = stdoutSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(allOutput).toContain("Logged out");
  });
});
