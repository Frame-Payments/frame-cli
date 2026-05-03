/**
 * Smoke test: keytar exposes the methods `auth/keyring` depends on, when
 * imported under **raw Node ESM** — the same loader the built CLI uses.
 *
 * Why a subprocess instead of an in-process import:
 *   keytar is a CommonJS native module. Different ESM↔CJS interop strategies
 *   produce different namespace shapes:
 *     - Vitest (Vite transform pipeline): every CJS export becomes a named
 *       ESM export. `import * as k from "keytar"` works fine.
 *     - Raw Node ESM (cjs-module-lexer): only some keys are promoted. With
 *       `import * as k from "keytar"`, the namespace is `{ default,
 *       getPassword }` — `setPassword` is missing, surfacing in production
 *       as `TypeError: keytar.setPassword is not a function`.
 *   An in-process vitest test cannot detect the bug because vitest's loader
 *   masks it. We shell out to `node --input-type=module` to reproduce the
 *   exact runtime the bundled CLI executes under.
 *
 *   See docs/post-mortems/keytar-esm-interop.md.
 *
 * INVARIANT: the import statement in `KEYRING_IMPORT` MUST match the import
 *            style used by `src/auth/keyring.ts`. If you change one, change
 *            the other in the same commit. This test is the canary.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Mirror of `src/auth/keyring.ts`'s import statement for keytar. */
const KEYRING_IMPORT = `import keytar from "keytar";`;

/**
 * Probe the type of a member under raw Node ESM. Returns the typeof string
 * (`"function"`, `"undefined"`, etc.) as Node would see it in production.
 */
function probeMemberType(importStmt: string, accessor: string): string {
  const script = `${importStmt} console.log(typeof ${accessor});`;
  const out = execFileSync("node", ["--input-type=module", "-e", script], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.trim();
}

describe("keytar runtime shape under raw Node ESM", () => {
  it("exposes setPassword as a callable function", () => {
    expect(probeMemberType(KEYRING_IMPORT, "keytar.setPassword")).toBe(
      "function",
    );
  });

  it("exposes getPassword as a callable function", () => {
    expect(probeMemberType(KEYRING_IMPORT, "keytar.getPassword")).toBe(
      "function",
    );
  });

  it("exposes deletePassword as a callable function", () => {
    expect(probeMemberType(KEYRING_IMPORT, "keytar.deletePassword")).toBe(
      "function",
    );
  });
});
