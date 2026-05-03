/**
 * `frame whoami` — display the authenticated merchant and mode via the
 * safety-banner wrapper.
 */

import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createApiClient, DEFAULT_BASE_URL, type MeResponse } from "../auth/api-client.js";

export async function run(): Promise<void> {
  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }

  const client = createApiClient({ apiKey: cred.apiKey, baseUrl: DEFAULT_BASE_URL });
  const me = await client.get<MeResponse>("/me");

  await runWithBanner({ merchant: me.id, mode: "sandbox" }, async () => {
    process.stdout.write(`merchant: ${me.name} (${me.id})\n`);
  });
}
