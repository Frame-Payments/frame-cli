import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { run as runPlaceholder } from "../src/commands/placeholder.js";

describe("placeholder command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("runs and prints a placeholder message", async () => {
    await runPlaceholder({ merchant: "acct_test_demo", mode: "sandbox" });
    const allOut = stdoutSpy.mock.calls.map((a) => String(a[0])).join("");
    expect(allOut).toContain("placeholder");
  });

  it("emits the banner before the placeholder output", async () => {
    let bannerPrintedFirst = false;
    let placeholderPrinted = false;

    stderrSpy.mockImplementation((chunk) => {
      if (!placeholderPrinted && String(chunk).includes("mode: sandbox")) {
        bannerPrintedFirst = true;
      }
      return true;
    });

    stdoutSpy.mockImplementation((chunk) => {
      if (String(chunk).includes("placeholder")) {
        placeholderPrinted = true;
      }
      return true;
    });

    await runPlaceholder({ merchant: "acct_test_demo", mode: "sandbox" });
    expect(bannerPrintedFirst).toBe(true);
  });
});
