/**
 * Top-level Commander entrypoint.
 *
 * Subcommands are registered via dynamic import() so each command's
 * dependencies only load when its command is invoked. This keeps
 * cold-start fast as the surface grows toward ~45 subcommands.
 *
 * See frame-cli/docs/plans/cli-v1-client.md for the v1 command list.
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkForUpdates } from "./update-check/update-check.js";
import { SUPPORTED_EVENTS, DEPRECATED_EVENTS } from "./commands/trigger-events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("frame")
  .description("Frame CLI — sandbox developer tooling for the Frame API")
  .version(pkg.version)
  .addHelpText(
    "after",
    `
Getting started:
  frame login        Authenticate with your sandbox API key
  frame whoami       Show the currently authenticated merchant

More information:
  https://github.com/framepayments/frame-cli
`,
  );

// ---------------------------------------------------------------------------
// Subcommand registration — lazy via dynamic import().
//
// Shape every command follows:
//
//   program
//     .command("<name>")
//     .description("…")
//     .action(async () => {
//       const { run } = await import("./commands/<name>.js");
//       await run({ merchant: "<from keyring / env>", mode: "sandbox" });
//     });
//
// ---------------------------------------------------------------------------

// Placeholder — demonstrates the lazy-import + runWithBanner pathway.
// Replace with real commands (login, listen, trigger …) as they are built.
program
  .command("placeholder")
  .description("Scaffold placeholder — demonstrates the lazy-import pathway")
  .action(async () => {
    const { run } = await import("./commands/placeholder.js");
    await run({ merchant: "acct_demo", mode: "sandbox" });
  });

program
  .command("login")
  .description("Authenticate with your Frame sandbox API key")
  .addHelpText(
    "after",
    `
Examples:
  frame login
`,
  )
  .action(async () => {
    const { run } = await import("./commands/login.js");
    await run();
  });

program
  .command("logout")
  .description("Remove stored credentials from the OS keychain")
  .addHelpText(
    "after",
    `
Examples:
  frame logout
`,
  )
  .action(async () => {
    const { run } = await import("./commands/logout.js");
    await run();
  });

program
  .command("whoami")
  .description("Show the currently authenticated merchant")
  .addHelpText(
    "after",
    `
Examples:
  frame whoami
`,
  )
  .action(async () => {
    const { run } = await import("./commands/whoami.js");
    await run();
  });

// ── logs ────────────────────────────────────────────────────────────────────────

/** Accumulate comma-separated values across repeated --flag invocations. */
function collectCsv(val: string, prev: string[]): string[] {
  return [...prev, ...val.split(",").map((s) => s.trim())];
}

const logs = program.command("logs").description("Log streaming commands");

logs
  .command("tail")
  .description("Stream real-time sandbox API request logs")
  .addHelpText(
    "after",
    `
Examples:
  frame logs tail
  frame logs tail --filter-status 4xx,5xx
  frame logs tail --filter-method POST --filter-path '/transfers/*'
  frame logs tail --json
`,
  )
  .option(
    "--filter-status <statuses>",
    "Filter by status class or exact code, comma-separated (e.g. 4xx,5xx or 200)",
    collectCsv,
    [] as string[],
  )
  .option(
    "--filter-method <methods>",
    "Filter by HTTP method, comma-separated (e.g. POST,GET)",
    collectCsv,
    [] as string[],
  )
  .option("--filter-path <pattern>", "Filter by path glob (e.g. /transfers/*)")
  .option("--json", "Output one JSON object per line (no color)")
  .action(async (opts: {
    filterStatus: string[];
    filterMethod: string[];
    filterPath?: string;
    json?: boolean;
  }) => {
    const { run } = await import("./commands/logs-tail.js");
    const runOpts: Parameters<typeof run>[0] = {};
    if (opts.filterStatus.length) runOpts.filterStatus = opts.filterStatus;
    if (opts.filterMethod.length) runOpts.filterMethod = opts.filterMethod;
    if (opts.filterPath) runOpts.filterPath = opts.filterPath;
    if (opts.json) runOpts.json = opts.json;
    await run(runOpts);
  });

program
  .command("listen")
  .description("Forward sandbox webhook events to a local URL")
  .addHelpText(
    "after",
    `
Examples:
  frame listen --forward-to http://localhost:3000/webhooks
  frame listen --forward-to http://localhost:3000/webhooks --events transfer.completed,refund.created
  frame listen --forward-to http://localhost:3000/webhooks --skip-endpoints
`,
  )
  .option("--forward-to <url>", "Local URL to POST each event to")
  .option(
    "--events <codes>",
    "Comma-separated event codes to filter (e.g. transfer.completed,refund.created)",
  )
  .option("--skip-endpoints", "Suppress sibling sandbox endpoints for this session")
  .action(async (opts: { forwardTo?: string; events?: string; skipEndpoints?: boolean }) => {
    const { run } = await import("./commands/listen.js");
    // Build options without passing undefined to satisfy exactOptionalPropertyTypes
    await run({
      ...(opts.forwardTo !== undefined && { forwardTo: opts.forwardTo }),
      ...(opts.events !== undefined && { events: opts.events.split(",").map((e) => e.trim()) }),
      ...(opts.skipEndpoints !== undefined && { skipEndpoints: opts.skipEndpoints }),
    });
  });

const triggerHelpText = [
  "",
  "Supported events:",
  ...SUPPORTED_EVENTS.map((e) => `  ${e}`),
  "",
  "Deprecated event codes (and their canonical replacements):",
  ...Object.entries(DEPRECATED_EVENTS).map(([dep, hint]) => `  ${dep}  →  ${hint}`),
  "",
  "Examples:",
  "  frame trigger transfer.completed",
  "  frame trigger account.created",
  "  frame trigger invoice.paid",
  "",
].join("\n");

program
  .command("trigger <event_code>")
  .description("Trigger a sandbox event using bundled fixtures")
  .addHelpText("after", triggerHelpText)
  .action(async (eventCode: string) => {
    const { run } = await import("./commands/trigger.js");
    await run(eventCode);
  });

// `frame events resend <evt_id>`
const eventsCmd = program
  .command("events")
  .description("Manage sandbox events");

eventsCmd
  .command("resend <evt_id>")
  .description("Re-deliver a previously emitted event verbatim")
  .addHelpText(
    "after",
    `
Examples:
  frame events resend evt_abc123
`,
  )
  .action(async (evtId: string) => {
    const { run } = await import("./commands/events-resend.js");
    await run({ eventId: evtId });
  });

// `frame open [<page>]`
program
  .command("open [page]")
  .description("Open a dashboard page in the default browser")
  .addHelpText(
    "after",
    `
Valid [page] values (examples):
  (none)                     Dashboard home
  transfers                  Transfers list
  transfers/<transfer_id>    Individual transfer
  refunds                    Refunds list
  refunds/<refund_id>        Individual refund
  accounts                   Accounts list
  accounts/<account_id>      Individual account
  invoices                   Invoices list
  events                     Events list
  logs                       API request logs
  settings                   Sandbox settings

Examples:
  frame open
  frame open transfers
  frame open accounts/acct_abc123
  frame open logs
`,
  )
  .action(async (page?: string) => {
    const { run } = await import("./commands/open.js");
    await run(page !== undefined ? { page } : {});
  });

// Runs before every subcommand. Silent on network errors; hard-stops on min_cli_version violation.
program.hook("preAction", async () => {
  await checkForUpdates({ currentVersion: pkg.version });
});

await program.parseAsync(process.argv);
