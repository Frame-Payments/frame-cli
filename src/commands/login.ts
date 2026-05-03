/**
 * `frame login` — prompt for an API key, validate against GET /me,
 * and persist to the OS keychain via auth/keyring.
 *
 * Live keys (sk_live_*) are rejected immediately; this CLI is
 * sandbox-only tooling.
 */

import { createInterface } from "readline/promises";
import { createApiClient, DEFAULT_BASE_URL, type MeResponse } from "../auth/api-client.js";
import { set } from "../auth/keyring.js";

export async function run(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let apiKey: string;
  try {
    apiKey = await rl.question("Enter your Frame API key: ");
  } finally {
    rl.close();
  }

  // Reject live keys immediately.
  if (apiKey.startsWith("sk_live_")) {
    throw new Error(
      "Live keys are not permitted. This CLI is sandbox-only. " +
        "Please use a key starting with sk_test_.",
    );
  }

  // Validate the key by calling GET /me.
  const client = createApiClient({ apiKey, baseUrl: DEFAULT_BASE_URL });
  const me = await client.get<MeResponse>("/me");

  // Persist to keychain.
  await set({ apiKey, merchant: me.id });

  process.stdout.write(
    `Logged in as ${me.name} (${me.id}). Credential saved to keychain.\n`,
  );
}
