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

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("frame")
  .description("Frame CLI — sandbox developer tooling for the Frame API")
  .version(pkg.version);

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
  .action(async () => {
    const { run } = await import("./commands/login.js");
    await run();
  });

program
  .command("logout")
  .description("Remove stored credentials from the OS keychain")
  .action(async () => {
    const { run } = await import("./commands/logout.js");
    await run();
  });

program
  .command("whoami")
  .description("Show the currently authenticated merchant")
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

await program.parseAsync(process.argv);
