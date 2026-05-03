import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createCableClient } from "../transport/cable-client.js";
import { resolveBaseUrl } from "../auth/api-client.js";
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

/**
 * Derive the ActionCable WebSocket URL from an HTTP(S) API base URL.
 * https://api.framepayments.com → wss://api.framepayments.com/cable
 */
function deriveCableUrl(apiBaseUrl: string): string {
  const wsScheme = apiBaseUrl.startsWith("https://") ? "wss://" : "ws://";
  return apiBaseUrl.replace(/^https?:\/\//, wsScheme) + "/cable";
}

// ─── Command entry-point ───────────────────────────────────────────────────────

/**
 * Run `frame logs tail`.
 *
 * @param opts   CLI options (filters, --json, optional wsUrl override).
 * @param signal AbortSignal that terminates the stream; omit to run until process exit.
 */
export async function run(opts: LogsTailOptions, signal?: AbortSignal): Promise<void> {
  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }

  await runWithBanner({ merchant: cred.merchant, mode: "sandbox" }, async () => {
    const wsUrl = opts.wsUrl ?? deriveCableUrl(resolveBaseUrl(cred));
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

    await new Promise<void>((resolve) => {
      if (!signal) return; // no signal → run forever (until process exits)
      if (signal.aborted) return resolve();
      signal.addEventListener("abort", () => resolve(), { once: true });
    });

    client.disconnect();
  });
}
