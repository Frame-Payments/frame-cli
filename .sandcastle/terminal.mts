// Shared terminal-output vocabulary for the workflow orchestrators. The
// workflows converged on the same idioms independently — `=== ... ===`
// headings, `✓ / ✗ / ◦` per-unit marks, `⚠` diagnostics — so the semantics
// live here once: green always means done, yellow means something needs
// eyes, red means the run itself broke. Escape codes are emitted only when
// stdout is a TTY, so piped logs stay plain text; styleText additionally
// honors the NO_COLOR / FORCE_COLOR conventions.

import { styleText } from "node:util";

export const stdoutIsTty = process.stdout.isTTY === true;

export type PaintFormat = Parameters<typeof styleText>[0];

export function paint(format: PaintFormat, text: string): string {
  return stdoutIsTty ? styleText(format, text) : text;
}

// The `=== Section ===` lines.
export function heading(text: string): string {
  return paint("bold", text);
}

// Per-unit outcome glyphs: done / broke / nothing-happened.
export type MarkStatus = "ok" | "failed" | "skipped";

export function mark(status: MarkStatus): string {
  switch (status) {
    case "ok":
      return paint("green", "✓");
    case "failed":
      return paint("red", "✗");
    case "skipped":
      return paint("dim", "◦");
  }
}

// The `⚠ ...` diagnostics: something needs eyes, nothing broke.
export function warnLine(text: string): string {
  return paint("yellow", text);
}

// OSC 8 terminal hyperlink: renders as clickable `text` in terminals that
// support it (iTerm2, Terminal.app, VS Code, Kitty, WezTerm…). Callers must
// gate on stdoutIsTty — piped output (logs, tee) wants a plain URL instead.
export function osc8Link(text: string, url: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}
