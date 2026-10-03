import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { generateResourceCommands } from "../src/codegen/generate.js";

const root = join(import.meta.dirname, "..");
const outputDir = join(root, "src", "commands", "resources");

const readYaml = (path: string): unknown => parse(readFileSync(join(root, path), "utf8"));

const files = generateResourceCommands(
  readYaml("vendor/openapi/frame.yaml"),
  readYaml("codegen/allowlist.yaml"),
);

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
for (const file of files) writeFileSync(join(outputDir, file.path), file.contents);

console.log(`codegen: ${readdirSync(outputDir).length} files in src/commands/resources`);
