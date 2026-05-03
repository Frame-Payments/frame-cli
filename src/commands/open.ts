/**
 * `frame open [<page>]` — open a dashboard page in the default browser.
 *
 * With no arguments, opens the dashboard root.
 * With a page path, opens that resource URL.
 *
 * Platform openers:
 *   macOS  — `open`
 *   Linux  — `xdg-open`
 *   Windows — `start`
 */

import { spawn } from "node:child_process";
import { runWithBanner } from "../fmt/banner.js";

export const DASHBOARD_BASE_URL = "https://dashboard.frame.dev";

export interface OpenOptions {
  /** Optional page path, e.g. "transfers/tr_xxx" */
  page?: string;
}

export function dashboardUrl(page?: string): string {
  return page ? `${DASHBOARD_BASE_URL}/${page}` : DASHBOARD_BASE_URL;
}

function platformOpener(): string {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "start";
    default:
      return "xdg-open";
  }
}

export async function run(opts: OpenOptions): Promise<void> {
  const url = dashboardUrl(opts.page);
  const opener = platformOpener();

  await runWithBanner({ merchant: "dashboard", mode: "sandbox" }, async () => {
    process.stdout.write(`Opening ${url}\n`);
    const child = spawn(opener, [url], { detached: true, stdio: "ignore" });
    child.unref();
  });
}
