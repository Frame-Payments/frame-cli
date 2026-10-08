import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { generateResourceCommands } from "../src/codegen/generate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "src", "commands", "resources");

const readYaml = (path: string): unknown => parse(readFileSync(join(root, path), "utf8"));

const files = generateResourceCommands(
  readYaml("vendor/openapi/frame.yaml"),
  readYaml("codegen/allowlist.yaml")
);

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
for (const file of files) writeFileSync(join(outputDir, file.path), file.contents);

console.log(`codegen: ${files.length} files in src/commands/resources`);
