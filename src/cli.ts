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

// `frame events resend <evt_id>`
const eventsCmd = program
  .command("events")
  .description("Manage sandbox events");

eventsCmd
  .command("resend <evt_id>")
  .description("Re-deliver a previously emitted event verbatim")
  .action(async (evtId: string) => {
    const { run } = await import("./commands/events-resend.js");
    await run({ eventId: evtId });
  });

// `frame open [<page>]`
program
  .command("open [page]")
  .description("Open a dashboard page in the default browser")
  .action(async (page?: string) => {
    const { run } = await import("./commands/open.js");
    await run(page !== undefined ? { page } : {});
  });

await program.parseAsync(process.argv);
