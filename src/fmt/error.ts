/**
 * fmt/error — terminal-friendly error formatting.
 *
 * The CLI's top-level catch routes every thrown value through `formatError`
 * so users see a clean, scannable message instead of a raw Node stack trace.
 *
 * For ApiError 422 responses, validation details (`error.errors`) are
 * unfolded into a dotted path → message list so users can see exactly which
 * fields failed and why.
 *
 * Stack traces are intentionally suppressed; they're noise for almost every
 * user-facing failure mode (auth, validation, network). When debugging the
 * CLI itself, callers can re-throw or set DEBUG=1 in the entrypoint.
 */

import { ApiError } from "../auth/api-client.js";

/**
 * Recursively flatten a dry-validation-shaped errors hash into
 * `dotted.path: message` lines.
 *
 * Input  → `{ profile: { individual: ["must provide either email or phone"] } }`
 * Output → `["profile.individual: must provide either email or phone"]`
 */
function flattenDetails(node: unknown, path: string[] = []): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item) =>
      typeof item === "string"
        ? [`${path.join(".")}: ${item}`]
        : flattenDetails(item, path),
    );
  }
  if (node !== null && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, val]) =>
      flattenDetails(val, [...path, key]),
    );
  }
  if (typeof node === "string") {
    return [`${path.join(".")}: ${node}`];
  }
  return [];
}

export function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const lines = [`Error: ${err.message} (HTTP ${err.status})`];
    if (err.details !== undefined) {
      const detail_lines = flattenDetails(err.details);
      if (detail_lines.length > 0) {
        lines.push("");
        lines.push("Validation errors:");
        for (const line of detail_lines) lines.push(`  • ${line}`);
      }
    }
    return lines.join("\n");
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
}
