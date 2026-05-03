/**
 * `frame logs tail` — stream real-time API request logs from LogsChannel.
 *
 * Subscribes to the Rails-side LogsChannel via transport/cable-client,
 * formats each entry as one color-coded line (green 2xx, yellow 4xx, red 5xx),
 * and supports client-side filters and JSON output.
 */

import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createCableClient } from "../transport/cable-client.js";
import {
  formatLogLine,
  matchesFilters,
  type LogEntry,
  type LogFilters,
} from "../fmt/logs.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface LogsTailOptions extends LogFilters {
  /** Output one JSON object per line (no ANSI colorisation). */
  json?: boolean;
  /** WebSocket URL override — used in tests and for custom server targets. */
  wsUrl?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WS_URL = "wss://api.frame.dev/cable";

// ─── Command entry-point ───────────────────────────────────────────────────────

/**
 * Run `frame logs tail`.
 *
 * @param opts   CLI options (filters, --json, optional wsUrl override).
 * @param signal An AbortSignal that terminates the stream. In production usage
 *               no signal is passed and the process runs until SIGINT/kill.
 *               In tests, pass an already-aborted signal to resolve immediately
 *               after setup (synchronously-delivered mock events are still processed).
 */
export async function run(opts: LogsTailOptions, signal?: AbortSignal): Promise<void> {
  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }

  await runWithBanner({ merchant: cred.merchant, mode: "sandbox" }, async () => {
    const wsUrl = opts.wsUrl ?? DEFAULT_WS_URL;
    const client = createCableClient(wsUrl);

    const sub = client.subscribe("LogsChannel");

    sub.on("*", (data) => {
      const entry = data as LogEntry;

      if (!matchesFilters(entry, opts)) return;

      if (opts.json) {
        process.stdout.write(JSON.stringify(entry) + "\n");
      } else {
        process.stdout.write(formatLogLine(entry) + "\n");
      }
    });

    // Block until signalled or killed.
    await new Promise<void>((resolve) => {
      if (signal) {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      }
      // No signal → run forever (until process exits).
    });

    client.disconnect();
  });
}
