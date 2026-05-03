/**
 * update-check — startup hook that enforces min_cli_version and prints a
 * once-daily "new version available" nudge.
 *
 * Called from the Commander pre-action hook so it runs before every command.
 *
 * Behaviour summary:
 *   - Reads ~/.frame/version-cache.json; if fresh (<24 h) skips the network call.
 *   - Otherwise calls GET /api/v1/cli/latest_version and refreshes the cache.
 *   - If current_version < min_cli_version → hard-stop (non-zero exit).
 *   - If latest_version > current_version and nudge not shown in the last 24 h
 *     → one-line stderr nudge.
 *   - Network failures degrade silently unless a cached min_cli_version is known.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { DEFAULT_BASE_URL } from "../auth/api-client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VersionCacheEntry {
  latest_version: string;
  min_cli_version: string;
  /** ISO timestamp — when the API data was last fetched. */
  cachedAt: string;
  /** ISO timestamp — when the upgrade nudge was last shown (optional). */
  nudgeShownAt?: string;
}

interface VersionApiResponse {
  latest_version: string;
  min_cli_version: string;
}

export interface UpdateCheckOptions {
  /** The version string from package.json (e.g. "1.2.0"). */
  currentVersion: string;
  /** Override the base API URL (useful in tests). */
  baseUrl?: string;
  /** Override the cache file path (useful in tests). */
  cacheFile?: string;
  /** Override "now" (useful in tests). */
  now?: Date;
  /** Override process.exit (useful in tests to avoid killing the test runner). */
  exit?: (code: number) => never;
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Compare two semver-ish strings.
 * Returns  1 if a > b
 *          0 if a == b
 *         -1 if a < b
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function readCache(cacheFile: string): VersionCacheEntry | null {
  try {
    const raw = readFileSync(cacheFile, "utf8");
    return JSON.parse(raw) as VersionCacheEntry;
  } catch {
    return null;
  }
}

function writeCache(cacheFile: string, entry: VersionCacheEntry): void {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(entry, null, 2), "utf8");
  } catch {
    // Best-effort; don't let cache write errors surface to the user.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkForUpdates(opts: UpdateCheckOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const cacheFile =
    opts.cacheFile ?? join(homedir(), ".frame", "version-cache.json");
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;

  // ── 1. Read the on-disk cache ────────────────────────────────────────────
  let cache = readCache(cacheFile);

  // ── 2. Refresh the cache when stale or absent ────────────────────────────
  const isFresh =
    cache !== null &&
    now.getTime() - new Date(cache.cachedAt).getTime() < CACHE_TTL_MS;

  if (!isFresh) {
    try {
      const resp = await fetch(`${baseUrl}/api/v1/cli/latest_version`);
      if (resp.ok) {
        const data = (await resp.json()) as VersionApiResponse;
        // Preserve nudgeShownAt so we don't reset the 24h nudge window.
        const refreshed: VersionCacheEntry = {
          latest_version: data.latest_version,
          min_cli_version: data.min_cli_version,
          cachedAt: now.toISOString(),
          ...(cache?.nudgeShownAt !== undefined && { nudgeShownAt: cache.nudgeShownAt }),
        };
        writeCache(cacheFile, refreshed);
        cache = refreshed;
      }
      // Non-ok responses: keep whatever cache we had (may be null).
    } catch {
      // Network error — degrade silently; keep whatever cache we had.
    }
  }

  // No cached data at all (first run + network failure) → skip all checks.
  if (cache === null) return;

  // ── 3. Hard-stop if below min_cli_version ───────────────────────────────
  if (compareVersions(opts.currentVersion, cache.min_cli_version) < 0) {
    process.stderr.write(
      `\nError: Your Frame CLI (v${opts.currentVersion}) is below the minimum required version ` +
        `(v${cache.min_cli_version}).\n` +
        `Please upgrade: brew upgrade frame\n\n`,
    );
    exit(1);
    return; // Unreachable in production; guards tests where exit is mocked.
  }

  // ── 4. Nudge when a newer version is available ───────────────────────────
  if (compareVersions(cache.latest_version, opts.currentVersion) > 0) {
    const lastNudgeMs = cache.nudgeShownAt
      ? new Date(cache.nudgeShownAt).getTime()
      : 0;
    const nudgeIsStale = now.getTime() - lastNudgeMs >= CACHE_TTL_MS;

    if (nudgeIsStale) {
      process.stderr.write(
        `v${cache.latest_version} is available, run \`brew upgrade frame\` to update\n`,
      );
      // Persist the nudge timestamp so we don't show it again for 24 h.
      const updated: VersionCacheEntry = { ...cache, nudgeShownAt: now.toISOString() };
      writeCache(cacheFile, updated);
    }
  }
}
