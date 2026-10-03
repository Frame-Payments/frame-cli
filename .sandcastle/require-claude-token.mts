import { readFileSync } from "node:fs";

const TOKEN_KEY = "CLAUDE_CODE_OAUTH_TOKEN";
const API_KEY = "ANTHROPIC_API_KEY";

// Minimal KEY=VALUE parser for .sandcastle/.env. We only need the subset
// sandcastle itself reads — bare assignments, ignoring blank lines and
// `#` comments. Surrounding quotes on the value are stripped.
export function parseEnvFile(contents: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Resolve a credential the same way sandcastle's `resolveEnv` will when it
 * injects credentials into the sandbox, and fail loud on the host if it
 * won't be available: sandcastle only injects keys that appear as LINES in
 * .sandcastle/.env (`fileValue || process.env`) — a shell-only export never
 * reaches the sandbox. `hint` tells the operator how to fix the missing key.
 */
export function resolveSandboxEnvKey(opts: {
  envPath: string;
  key: string;
  processEnv?: Record<string, string | undefined>;
  hint: string;
}): string {
  const fileVars = parseEnvFile(readFileSync(opts.envPath, "utf8"));
  if (!(opts.key in fileVars)) {
    throw new Error(
      `${opts.key} is not set in ${opts.envPath}. Sandcastle only injects ` +
        `keys that appear as lines in that file (a shell export is ignored), ` +
        `so the agents inside the sandbox would run without it. ${opts.hint}`,
    );
  }
  const value = fileVars[opts.key] || opts.processEnv?.[opts.key];
  if (!value) {
    throw new Error(
      `${opts.key} is set in ${opts.envPath} but empty, and nothing fills ` +
        `it in from the host environment. ${opts.hint}`,
    );
  }
  return value;
}

/**
 * Preflight the GH_TOKEN the sandboxes will push with. The publisher is the
 * LAST agent of every pipeline and its prompt says to report push errors and
 * stop — so a token that can't push surfaces only as a 403 deep inside a
 * sandbox log, after the full diagnose→fix→review spend that preceded it
 * (the 2026-07-09 run: three pipelines, three 403s, zero PRs, and a run
 * summary that still read ✓). Probe the API up front and name the exact
 * misconfiguration. fetch, not curl-via-execSync: a command line is visible
 * in process listings, so the token must only travel in the request header.
 */
export async function assertGhTokenCanPush(opts: {
  token: string;
  repoSlug: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { token, repoSlug, timeoutMs, fetchImpl = fetch } = opts;
  const request = ghProbeRequest(fetchImpl, timeoutMs);
  const apiHeaders = ghApiHeaders(token);

  const repo = await request(`https://api.github.com/repos/${repoSlug}`, apiHeaders);
  if (repo.ok) {
    // The /repos `permissions` field reflects the USER's role on the repo,
    // not the fine-grained token's grants (observed 2026-07-09: a
    // Contents-RW-only PAT held by an org admin reports admin:true) — so it
    // cannot detect a read-only Contents grant. Ask the push endpoint
    // itself: the smart-HTTP ref advertisement for git-receive-pack
    // authorizes exactly like a real push (200 with push rights, 401/403
    // without) and has no side effects.
    const pushProbe = await request(
      `https://github.com/${repoSlug}.git/info/refs?service=git-receive-pack`,
      {
        Authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      },
    );
    if (pushProbe.ok) return;
    throw new Error(
      `GH_TOKEN in .sandcastle/.env can see ${repoSlug} but cannot push ` +
        `(HTTP ${pushProbe.status} from the git receive-pack endpoint) — ` +
        `the publisher would 403 on every branch. Edit the token's ` +
        `Repository permissions to Contents: Read and write ` +
        `(see .sandcastle/setup.md).`,
    );
  }

  return diagnoseInvisibleRepo(request, apiHeaders, repoSlug, repo.status);
}

/**
 * Preflight a GH_TOKEN that only needs READ access — deps-triage's sandboxes
 * fetch `pull/<n>/head` with it, while comments/labels go through the
 * operator's own host gh auth. Same fail-loud rationale as
 * assertGhTokenCanPush minus the receive-pack probe: a dead or mis-scoped
 * token would otherwise fail every sandbox at hook time, after the whole
 * selection pass.
 */
export async function assertGhTokenCanRead(opts: {
  token: string;
  repoSlug: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { token, repoSlug, timeoutMs, fetchImpl = fetch } = opts;
  const request = ghProbeRequest(fetchImpl, timeoutMs);
  const apiHeaders = ghApiHeaders(token);

  const repo = await request(`https://api.github.com/repos/${repoSlug}`, apiHeaders);
  if (repo.ok) return;
  return diagnoseInvisibleRepo(request, apiHeaders, repoSlug, repo.status);
}

function ghApiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}

// A fetch that dies at the network layer (timeout, DNS, offline) is not a
// token problem — rethrow with that context so the operator doesn't chase
// credentials, mirroring the Sentry probe's actionable-message discipline.
function ghProbeRequest(fetchImpl: typeof fetch, timeoutMs: number) {
  return async (url: string, headers: Record<string, string>) => {
    try {
      return await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(
        `GH_TOKEN preflight could not reach GitHub (${url.split("?")[0]}) — ` +
          `network or timeout, not a token problem: ${err}`,
      );
    }
  };
}

// The repo is invisible to the token. Distinguish a dead token from a
// mis-scoped one so the operator fixes the right thing.
async function diagnoseInvisibleRepo(
  request: ReturnType<typeof ghProbeRequest>,
  apiHeaders: Record<string, string>,
  repoSlug: string,
  repoStatus: number,
): Promise<never> {
  const user = await request("https://api.github.com/user", apiHeaders);
  if (!user.ok) {
    throw new Error(
      `GH_TOKEN in .sandcastle/.env is rejected by GitHub (HTTP ` +
        `${user.status} on /user) — expired or revoked. Mint a new ` +
        `fine-grained PAT per .sandcastle/setup.md and update the GH_TOKEN ` +
        `line.`,
    );
  }
  const login = ((await user.json()) as { login?: string }).login ?? "unknown";
  throw new Error(
    `GH_TOKEN in .sandcastle/.env is a valid token (owner: ${login}) but ` +
      `cannot see ${repoSlug} (HTTP ${repoStatus}). For a fine-grained PAT ` +
      `this means one of: the Resource owner is "${login}" instead of the ` +
      `"${repoSlug.split("/")[0]}" org (resource owner is fixed at creation ` +
      `— mint a NEW token and pick the org in the Resource owner dropdown), ` +
      `the repo isn't in the token's repository list, or the org's approval ` +
      `of the token is still pending. See .sandcastle/setup.md.`,
  );
}

/**
 * Resolve the Claude Code OAuth token via resolveSandboxEnvKey, plus the
 * ANTHROPIC_API_KEY conflict guard specific to this credential.
 */
export function resolveClaudeToken(opts: {
  envPath: string;
  processEnv?: Record<string, string | undefined>;
}): string {
  const fileVars = parseEnvFile(readFileSync(opts.envPath, "utf8"));

  // Reject a conflicting ANTHROPIC_API_KEY. Claude Code prefers the API key
  // over the OAuth token when both are present and silently bills the API
  // instead of the subscription (see decisions/0001-...). We only need to
  // guard the value sandcastle would actually inject, which is resolved the
  // same way as the token below — `fileVars[key] || process.env[key]`, and
  // ONLY for keys that appear as a line in .sandcastle/.env. A host-only
  // export is never injected, so we don't fail on it.
  if (API_KEY in fileVars) {
    const conflictingApiKey = fileVars[API_KEY] || opts.processEnv?.[API_KEY];
    if (conflictingApiKey) {
      throw new Error(
        `${API_KEY} is set in .sandcastle/.env. Claude Code prefers it over ` +
          `${TOKEN_KEY} and would silently bill the API instead of the ` +
          `subscription. Remove the ${API_KEY} line from .sandcastle/.env and ` +
          `keep only ${TOKEN_KEY}, then retry.`,
      );
    }
  }

  return resolveSandboxEnvKey({
    envPath: opts.envPath,
    key: TOKEN_KEY,
    processEnv: opts.processEnv,
    hint:
      "Run `claude setup-token` and put the value in .sandcastle/.env, then retry.",
  });
}
