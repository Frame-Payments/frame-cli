#!/usr/bin/env node
/**
 * Build script — uses esbuild's JS API so the platform-correct binary
 * is selected automatically (avoids macOS/Linux exec-format issues in CI).
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.js",
  external: ["readline", "readline/promises"],
  banner: {
    js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
  },
});

console.log("build: dist/cli.js");
