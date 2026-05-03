import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatBanner, runWithBanner } from "../src/fmt/banner.js";

describe("formatBanner", () => {
  it("includes mode: sandbox", () => {
    const output = formatBanner({ merchant: "acct_test_123", mode: "sandbox" });
    expect(output).toContain("mode: sandbox");
  });

  it("includes the merchant identifier", () => {
    const output = formatBanner({ merchant: "acct_test_abc", mode: "sandbox" });
    expect(output).toContain("acct_test_abc");
  });

  it("includes Frame CLI label", () => {
    const output = formatBanner({ merchant: "acct_test_123", mode: "sandbox" });
    expect(output).toContain("Frame");
  });
});

describe("runWithBanner", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("prints banner to stderr before running the action", async () => {
    let bannerPrintedBeforeAction = false;
    await runWithBanner({ merchant: "acct_test_xyz", mode: "sandbox" }, async () => {
      bannerPrintedBeforeAction = stderrSpy.mock.calls.length > 0;
    });
    expect(bannerPrintedBeforeAction).toBe(true);
  });

  it("calls the action", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    await runWithBanner({ merchant: "acct_test_xyz", mode: "sandbox" }, action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("banner written to stderr contains mode: sandbox", async () => {
    await runWithBanner({ merchant: "acct_merchant_1", mode: "sandbox" }, async () => {});
    const allOutput = stderrSpy.mock.calls.map((args) => String(args[0])).join("");
    expect(allOutput).toContain("mode: sandbox");
  });

  it("banner written to stderr contains merchant identifier", async () => {
    await runWithBanner({ merchant: "acct_merchant_1", mode: "sandbox" }, async () => {});
    const allOutput = stderrSpy.mock.calls.map((args) => String(args[0])).join("");
    expect(allOutput).toContain("acct_merchant_1");
  });
});
