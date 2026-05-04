/**
 * Regression: `frame trigger <event>` must locate fixtures/ correctly in
 * both the dev source layout (src/commands/trigger.ts) and the bundled
 * layout (dist/cli.js). The original bug used a fixed `../../` offset that
 * worked for the source file but resolved to the parent of the package
 * when run from the bundle, producing ENOENT.
 *
 * See: src/commands/trigger.ts :: resolveFixturesDir
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveFixturesDir } from "../src/commands/trigger.js";

const repoRoot = join(__dirname, "..");

describe("resolveFixturesDir", () => {
  it("resolves from the dev source location (src/commands/trigger.ts)", () => {
    const url = pathToFileURL(join(repoRoot, "src", "commands", "trigger.ts")).href;
    const dir = resolveFixturesDir(url);
    expect(existsSync(join(dir, "transfer.completed.yaml"))).toBe(true);
  });

  it("resolves from the bundled location (dist/cli.js)", () => {
    // Use a fictitious dist path that lives one level under the package
    // root; we don't need the file to exist, only its URL.
    const url = pathToFileURL(join(repoRoot, "dist", "cli.js")).href;
    const dir = resolveFixturesDir(url);
    expect(existsSync(join(dir, "transfer.completed.yaml"))).toBe(true);
  });

  it("throws a helpful error when no fixtures/ ancestor exists", () => {
    const url = pathToFileURL("/tmp/definitely-not-a-package/cli.js").href;
    expect(() => resolveFixturesDir(url)).toThrow(/Could not locate fixtures/);
  });
});
