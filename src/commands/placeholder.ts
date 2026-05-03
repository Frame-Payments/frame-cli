/**
 * Placeholder command — demonstrates the lazy-import pattern.
 *
 * This module is intentionally thin; its only job is to show that the
 * `runWithBanner` wrapper + dynamic-import pathway works end-to-end.
 * Real commands (login, listen, trigger …) will follow the same shape.
 */

import { runWithBanner, type BannerContext } from "../fmt/banner.js";

export async function run(ctx: BannerContext): Promise<void> {
  await runWithBanner(ctx, async () => {
    process.stdout.write(
      "placeholder: this command is a scaffold — replace with a real implementation.\n",
    );
  });
}
