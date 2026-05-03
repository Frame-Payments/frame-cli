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

program
  .command("trigger <event_code>")
  .description("Trigger a sandbox event using bundled fixtures")
  .action(async (eventCode: string) => {
    const { run } = await import("./commands/trigger.js");
    await run(eventCode);
  });

await program.parseAsync(process.argv);
