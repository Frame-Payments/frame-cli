/**
 * `frame whoami` — display the authenticated merchant and mode via the
 * safety-banner wrapper.
 */

import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createApiClient, resolveBaseUrl, type MeResponse } from "../auth/api-client.js";

export async function run(): Promise<void> {
  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }

  const client = createApiClient({ apiKey: cred.apiKey, baseUrl: resolveBaseUrl(cred) });
  const me = await client.get<MeResponse>("/me");

  await runWithBanner(
    { merchant: me.merchant_id, mode: me.dev_mode ? "sandbox" : "live" },
    async () => {
      process.stdout.write(
        `merchant: ${me.merchant_name} (${me.merchant_id})\n`,
      );
    },
  );
}
