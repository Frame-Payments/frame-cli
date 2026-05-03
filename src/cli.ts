// Top-level Commander entrypoint.
//
// Subcommands are registered via dynamic import() so each command's
// dependencies only load when its command is invoked. This keeps
// cold-start fast as the surface grows toward ~45 subcommands.
//
// See frame-cli/docs/plans/cli-v1-client.md for the v1 command list.

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
  version: string;
};

const program = new Command();

program
  .name("frame")
  .description("Frame CLI — sandbox developer tooling for the Frame API")
  .version(pkg.version);

// Register subcommands here as they're implemented.
// Pattern (do not implement now — placeholder for shape only):
//
// program
//   .command("login")
//   .description("Authenticate with a Frame sandbox API key")
//   .action(async () => {
//     const { run } = await import("./commands/login.js");
//     await run();
//   });

await program.parseAsync(process.argv);
