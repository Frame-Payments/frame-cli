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
import { formatError } from "./fmt/error.js";

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
// Replace with real commands (login, listen, …) as they are built.
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
  .option(
    "--base-url <url>",
    "Override the API base URL, INCLUDING the /v1 path prefix (e.g. http://localhost:3000/v1 for local dev). Persisted with the credential. Falls back to $FRAME_API_BASE_URL, then the production default.",
  )
  .addHelpText(
    "after",
    `
Examples:
  frame login
  frame login --base-url http://localhost:3000/v1
  FRAME_API_BASE_URL=https://api.staging.framepayments.com/v1 frame login
`,
  )
  .action(async (opts: { baseUrl?: string }) => {
    const { run } = await import("./commands/login.js");
    await run(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {});
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

// Top-level error handling.
//
// Without this, any thrown error (most commonly an ApiError from a failed
// request) propagates to bin/frame and is rendered as a raw Node stack trace,
// which is noisy and unhelpful for the actual failure modes (auth, validation,
// network). We funnel everything through `formatError` for a clean message.
//
// Set FRAME_DEBUG=1 to opt back into the full stack when debugging the CLI
// itself.
try {
  await program.parseAsync(process.argv);
} catch (err) {
  process.stderr.write(`${formatError(err)}\n`);
  if (process.env.FRAME_DEBUG === "1" && err instanceof Error && err.stack) {
    process.stderr.write(`\n${err.stack}\n`);
  }
  process.exit(1);
}
