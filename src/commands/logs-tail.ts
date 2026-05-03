import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createCableClient } from "../transport/cable-client.js";
import { deriveCableUrl } from "../transport/derive-cable-url.js";
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

  await runWithBanner(
    { merchant: cred.merchant, mode: cred.devMode ? "sandbox" : "live" },
    async () => {
    const wsUrl = opts.wsUrl ?? deriveCableUrl(resolveBaseUrl(cred));
    // Authentication is by `Authorization: Bearer <apiKey>` on the WS upgrade;
    // see `Cli::ApplicationCable::Connection` (Rails) and ADR-0008.
    const client = createCableClient(wsUrl, { apiKey: cred.apiKey });

    // The Rails channel class is namespaced (`Cli::LogsChannel`); Action
    // Cable looks up the constant from this exact string. Bare `LogsChannel`
    // logs `Subscription class not found: "LogsChannel"` server-side and
    // silently drops the subscribe — connection stays open, but no data flows.
    const sub = client.subscribe("Cli::LogsChannel");

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
