/**
 * Safety-banner helpers.
 *
 * Every command goes through `runWithBanner` so merchants always see
 * which environment and merchant they are operating against before any
 * command output appears.
 */

export interface BannerContext {
  merchant: string;
  mode: "sandbox" | "live";
}

export function formatBanner(ctx: BannerContext): string {
  return [
    `┌─ Frame CLI ─────────────────────────────────────`,
    `│  mode: ${ctx.mode}`,
    `│  merchant: ${ctx.merchant}`,
    `└─────────────────────────────────────────────────`,
  ].join("\n");
}

/**
 * Print the safety banner to stderr, then run `action`.
 *
 * Using stderr keeps the banner out of stdout so piped JSON output
 * is not polluted.
 */
export async function runWithBanner(
  ctx: BannerContext,
  action: () => Promise<void>,
): Promise<void> {
  process.stderr.write(formatBanner(ctx) + "\n");
  await action();
}
