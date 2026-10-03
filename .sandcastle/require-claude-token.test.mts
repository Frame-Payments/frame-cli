import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertGhTokenCanPush,
  assertGhTokenCanRead,
  resolveClaudeToken,
  resolveSandboxEnvKey,
} from "./require-claude-token.mts";

// Write a throwaway .env with the given contents and return its path. The
// caller is responsible for nothing — each file lands in its own tmp dir that
// the OS reclaims.
function envFileWith(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sc-token-test-"));
  const envPath = path.join(dir, ".env");
  writeFileSync(envPath, contents);
  return envPath;
}

test("returns the token when present and non-empty in the env file", () => {
  const envPath = envFileWith("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-abc123\n");
  assert.equal(
    resolveClaudeToken({ envPath, processEnv: {} }),
    "sk-ant-oat-abc123",
  );
});

test("throws when the key is absent from the env file, even if exported in the shell", () => {
  // sandcastle's resolveEnv only iterates keys that appear as lines in
  // .sandcastle/.env — a shell-only export is never injected into the
  // sandbox, so a value in processEnv must NOT rescue an absent file key.
  const envPath = envFileWith("GH_TOKEN=ghp_xxx\n");
  assert.throws(
    () =>
      resolveClaudeToken({
        envPath,
        processEnv: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-from-shell" },
      }),
    /CLAUDE_CODE_OAUTH_TOKEN.*\.sandcastle\/\.env/s,
  );
});

test("throws when the key is present but empty and nothing fills it in", () => {
  const envPath = envFileWith("CLAUDE_CODE_OAUTH_TOKEN=\n");
  assert.throws(
    () => resolveClaudeToken({ envPath, processEnv: {} }),
    /CLAUDE_CODE_OAUTH_TOKEN/,
  );
});

test("falls back to processEnv when the file value is empty", () => {
  // Mirrors sandcastle's `fileVars[key] || process.env[key]`: an empty file
  // value is filled from the host environment.
  const envPath = envFileWith("CLAUDE_CODE_OAUTH_TOKEN=\n");
  assert.equal(
    resolveClaudeToken({
      envPath,
      processEnv: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-fallback" },
    }),
    "sk-ant-oat-fallback",
  );
});

test("throws when ANTHROPIC_API_KEY appears as a line in the env file", () => {
  // Claude Code prefers the API key over the OAuth token and would silently
  // bill the API instead of the subscription.
  const envPath = envFileWith(
    "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-abc123\nANTHROPIC_API_KEY=sk-ant-api-xyz\n",
  );
  assert.throws(
    () => resolveClaudeToken({ envPath, processEnv: {} }),
    /ANTHROPIC_API_KEY.*\.sandcastle\/\.env/s,
  );
});

test("ignores ANTHROPIC_API_KEY that is only exported in the shell, not in the env file", () => {
  // sandcastle only injects keys present as lines in .sandcastle/.env, so a
  // host-only export never reaches the sandbox and must not fail the guard.
  const envPath = envFileWith("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-abc123\n");
  assert.equal(
    resolveClaudeToken({
      envPath,
      processEnv: { ANTHROPIC_API_KEY: "sk-ant-api-from-shell" },
    }),
    "sk-ant-oat-abc123",
  );
});

test("resolveSandboxEnvKey returns the file value when present", () => {
  const envPath = envFileWith("SENTRY_AUTH_TOKEN=sntrys_abc\n");
  assert.equal(
    resolveSandboxEnvKey({
      envPath,
      key: "SENTRY_AUTH_TOKEN",
      processEnv: {},
      hint: "get a token",
    }),
    "sntrys_abc",
  );
});

test("resolveSandboxEnvKey falls back to processEnv only when the line exists but is empty", () => {
  const envPath = envFileWith("SENTRY_AUTH_TOKEN=\n");
  assert.equal(
    resolveSandboxEnvKey({
      envPath,
      key: "SENTRY_AUTH_TOKEN",
      processEnv: { SENTRY_AUTH_TOKEN: "sntrys_host" },
      hint: "get a token",
    }),
    "sntrys_host",
  );
});

test("resolveSandboxEnvKey throws when the key has no line in the env file", () => {
  // sandcastle only injects keys that appear as lines in .sandcastle/.env —
  // a shell-only export never reaches the sandbox.
  const envPath = envFileWith("GH_TOKEN=x\n");
  assert.throws(
    () =>
      resolveSandboxEnvKey({
        envPath,
        key: "SENTRY_AUTH_TOKEN",
        processEnv: { SENTRY_AUTH_TOKEN: "sntrys_host" },
        hint: "get a token",
      }),
    /SENTRY_AUTH_TOKEN.*get a token/s,
  );
});

test("resolveSandboxEnvKey throws when the line exists, is empty, and nothing fills it", () => {
  const envPath = envFileWith("SENTRY_AUTH_TOKEN=\n");
  assert.throws(
    () =>
      resolveSandboxEnvKey({
        envPath,
        key: "SENTRY_AUTH_TOKEN",
        processEnv: {},
        hint: "get a token",
      }),
    /SENTRY_AUTH_TOKEN/,
  );
});

test("throws when ANTHROPIC_API_KEY is an empty line but filled from the host", () => {
  // An empty file value is filled from the host (fileVars[key] || processEnv),
  // so an empty ANTHROPIC_API_KEY line still resolves to a conflicting value.
  const envPath = envFileWith(
    "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-abc123\nANTHROPIC_API_KEY=\n",
  );
  assert.throws(
    () =>
      resolveClaudeToken({
        envPath,
        processEnv: { ANTHROPIC_API_KEY: "sk-ant-api-from-shell" },
      }),
    /ANTHROPIC_API_KEY/,
  );
});

// ---------------------------------------------------------------------------
// assertGhTokenCanPush
// ---------------------------------------------------------------------------

// A fetch stub keyed by URL: routes the /repos/... metadata call, the
// git-receive-pack push probe, and /user to canned responses so each probe
// outcome is exercised without the network.
function fakeFetch(routes: {
  repo: { status: number; body?: unknown };
  push?: { status: number };
  user?: { status: number; body?: unknown };
}): typeof fetch {
  return (async (url: unknown) => {
    const href = String(url);
    const target = href.includes("git-receive-pack")
      ? routes.push!
      : href.includes("/repos/")
        ? routes.repo
        : routes.user!;
    return {
      ok: target.status >= 200 && target.status < 300,
      status: target.status,
      json: async () => ("body" in target ? (target.body ?? {}) : {}),
    } as Response;
  }) as typeof fetch;
}

const PROBE_DEFAULTS = { token: "github_pat_x", repoSlug: "Frame-Payments/frame-cli", timeoutMs: 1000 };

test("assertGhTokenCanPush passes when the receive-pack probe grants push", async () => {
  await assertGhTokenCanPush({
    ...PROBE_DEFAULTS,
    fetchImpl: fakeFetch({ repo: { status: 200 }, push: { status: 200 } }),
  });
});

test("assertGhTokenCanPush rejects a read-only grant via the receive-pack probe", async () => {
  // The /repos `permissions` field mirrors the USER's role, not the token's
  // grants, so a repo-visible token must be judged by the push endpoint:
  // metadata 200 + receive-pack 403 = read-only Contents grant.
  await assert.rejects(
    assertGhTokenCanPush({
      ...PROBE_DEFAULTS,
      fetchImpl: fakeFetch({ repo: { status: 200 }, push: { status: 403 } }),
    }),
    /cannot push.*receive-pack.*Contents: Read and write/s,
  );
});

test("assertGhTokenCanPush wraps network-layer failures with non-token context", async () => {
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    assertGhTokenCanPush({ ...PROBE_DEFAULTS, fetchImpl: offline }),
    /could not reach GitHub.*not a token problem/s,
  );
});

test("assertGhTokenCanPush names the resource-owner trap when a valid token cannot see the repo", async () => {
  // The 2026-07-09 failure: fine-grained PAT with Resource owner = the
  // operator's personal account → repo 404 while /user still returns 200.
  await assert.rejects(
    assertGhTokenCanPush({
      ...PROBE_DEFAULTS,
      fetchImpl: fakeFetch({
        repo: { status: 404 },
        user: { status: 200, body: { login: "ryanframepayments" } },
      }),
    }),
    /valid token \(owner: ryanframepayments\).*Resource owner.*Frame-Payments/s,
  );
});

test("assertGhTokenCanPush reports a dead token distinctly", async () => {
  await assert.rejects(
    assertGhTokenCanPush({
      ...PROBE_DEFAULTS,
      fetchImpl: fakeFetch({ repo: { status: 401 }, user: { status: 401 } }),
    }),
    /expired or revoked/,
  );
});

// ---------------------------------------------------------------------------
// assertGhTokenCanRead
// ---------------------------------------------------------------------------

test("assertGhTokenCanRead passes on repo visibility alone — no push probe", async () => {
  // deps-triage sandboxes only fetch; a read-only Contents grant must pass.
  // fakeFetch has no push route wired, so touching it would throw.
  await assertGhTokenCanRead({
    ...PROBE_DEFAULTS,
    fetchImpl: fakeFetch({ repo: { status: 200 } }),
  });
});

test("assertGhTokenCanRead reports a dead token distinctly", async () => {
  await assert.rejects(
    assertGhTokenCanRead({
      ...PROBE_DEFAULTS,
      fetchImpl: fakeFetch({ repo: { status: 401 }, user: { status: 401 } }),
    }),
    /expired or revoked/,
  );
});

test("assertGhTokenCanRead names the resource-owner trap for an invisible repo", async () => {
  await assert.rejects(
    assertGhTokenCanRead({
      ...PROBE_DEFAULTS,
      fetchImpl: fakeFetch({
        repo: { status: 404 },
        user: { status: 200, body: { login: "ryanframepayments" } },
      }),
    }),
    /valid token \(owner: ryanframepayments\).*Resource owner.*Frame-Payments/s,
  );
});

test("assertGhTokenCanRead wraps network-layer failures with non-token context", async () => {
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    assertGhTokenCanRead({ ...PROBE_DEFAULTS, fetchImpl: offline }),
    /could not reach GitHub.*not a token problem/s,
  );
});
