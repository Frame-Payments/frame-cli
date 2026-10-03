import { test } from "node:test";
import assert from "node:assert/strict";

import { heading, mark, osc8Link, paint, warnLine } from "./terminal.mts";

// The test runner's stdout is not a TTY, so every helper must come back as
// plain text — that IS the contract piped logs rely on.
test("paint and friends emit plain text when stdout is not a TTY", () => {
  assert.equal(paint("green", "done"), "done");
  assert.equal(heading("=== Cycle 1/10 ==="), "=== Cycle 1/10 ===");
  assert.equal(warnLine("⚠ look here"), "⚠ look here");
  assert.equal(mark("ok"), "✓");
  assert.equal(mark("failed"), "✗");
  assert.equal(mark("skipped"), "◦");
});

test("osc8Link: wraps text in an OSC 8 hyperlink", () => {
  assert.equal(
    osc8Link("#3481", "https://github.com/Frame-Payments/frame-cli/pull/3481"),
    "\u001B]8;;https://github.com/Frame-Payments/frame-cli/pull/3481\u0007#3481\u001B]8;;\u0007",
  );
});
