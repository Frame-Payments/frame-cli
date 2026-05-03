/**
 * fmt/logs — formatting helpers for `frame logs tail`.
 *
 * Provides:
 *   - LogEntry interface (the shape pushed by LogsChannel)
 *   - colorStatus() — ANSI color code by status class
 *   - formatLogLine() — single human-readable line per entry
 *   - matchesFilters() — client-side filter predicate
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
  method: string;
  path: string;
  status: number;
  /** Request duration in milliseconds. */
  duration: number;
}

export interface LogFilters {
  /** Status classes ("2xx", "4xx", "5xx") or exact codes ("200", "404"). */
  filterStatus?: string[];
  /** HTTP methods to include (case-insensitive). */
  filterMethod?: string[];
  /** Glob pattern for path (only * is treated as a wildcard). */
  filterPath?: string;
}

// ─── ANSI helpers ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

/**
 * Wrap a status code string in the appropriate ANSI color.
 *   2xx → green, 4xx → yellow, 5xx → red, anything else → no color.
 */
export function colorStatus(status: number): string {
  const str = String(status);
  if (status >= 200 && status < 300) return `${GREEN}${str}${RESET}`;
  if (status >= 400 && status < 500) return `${YELLOW}${str}${RESET}`;
  if (status >= 500) return `${RED}${str}${RESET}`;
  return str;
}

// ─── Line formatter ────────────────────────────────────────────────────────────

/**
 * Format one log entry as a human-readable terminal line.
 * Example: `GET /transfers/tr_123 200 42ms`
 * The status code is wrapped in ANSI color codes.
 */
export function formatLogLine(entry: LogEntry): string {
  return `${entry.method} ${entry.path} ${colorStatus(entry.status)} ${entry.duration}ms`;
}

// ─── Client-side filters ───────────────────────────────────────────────────────

/**
 * Convert a filter-status token to a predicate.
 *   "4xx"  → status in [400, 499]
 *   "200"  → status === 200
 */
function statusMatches(token: string, status: number): boolean {
  const lower = token.toLowerCase().trim();
  if (/^\d{3}$/.test(lower)) {
    return status === Number(lower);
  }
  if (/^[1-5]xx$/.test(lower)) {
    const hundreds = Number(lower[0]) * 100;
    return status >= hundreds && status < hundreds + 100;
  }
  return false;
}

/**
 * Convert a glob pattern (only `*` is special) to a RegExp.
 * The match is anchored to the full path string.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Return true if the entry passes all provided filters.
 * An absent filter (undefined / empty array) is a no-op (allows everything).
 */
export function matchesFilters(entry: LogEntry, filters: LogFilters): boolean {
  const { filterStatus, filterMethod, filterPath } = filters;

  // Status filter — entry must match at least one token
  if (filterStatus && filterStatus.length > 0) {
    const passes = filterStatus.some((tok) => statusMatches(tok, entry.status));
    if (!passes) return false;
  }

  // Method filter — entry must match at least one method
  if (filterMethod && filterMethod.length > 0) {
    const entryMethod = entry.method.toUpperCase();
    const passes = filterMethod.some((m) => m.toUpperCase().trim() === entryMethod);
    if (!passes) return false;
  }

  // Path filter — glob match
  if (filterPath && filterPath.length > 0) {
    const re = globToRegExp(filterPath);
    if (!re.test(entry.path)) return false;
  }

  return true;
}
