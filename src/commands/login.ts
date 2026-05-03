/**
 * `frame login` — prompt for an API key, validate against GET /me,
 * and persist to the OS keychain via auth/keyring.
 *
 * Live keys (sk_live_*) are rejected immediately; this CLI is
 * sandbox-only tooling.
 *
 * Base URL resolution (highest priority first):
 *   1. `--base-url <url>` flag
 *   2. `FRAME_API_BASE_URL` env var
 *   3. Hardcoded production default
 *
 * Whatever resolves is persisted alongside the API key so subsequent
 * commands (`whoami`, `trigger`, `listen`, …) automatically target the
 * same host the credential was issued against.
 */

import { createInterface } from "readline/promises";
import {
  createApiClient,
  HARDCODED_DEFAULT_BASE_URL,
  type MeResponse,
} from "../auth/api-client.js";
import { set, type Credential } from "../auth/keyring.js";

export interface LoginOptions {
  /** Override the API base URL for this login. Persisted into the credential. */
  baseUrl?: string;
}

export async function run(opts: LoginOptions = {}): Promise<void> {
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

  // Resolve base URL: explicit flag > env var > hardcoded default.
  const resolvedBaseUrl =
    opts.baseUrl ?? process.env.FRAME_API_BASE_URL ?? HARDCODED_DEFAULT_BASE_URL;

  // Validate the key by calling GET /me.
  const client = createApiClient({ apiKey, baseUrl: resolvedBaseUrl });
  const me = await client.get<MeResponse>("/me");

  // Persist to keychain. Only record baseUrl when it differs from the
  // hardcoded production default — keeps the common case minimal.
  const cred: Credential = { apiKey, merchant: me.id };
  if (resolvedBaseUrl !== HARDCODED_DEFAULT_BASE_URL) {
    cred.baseUrl = resolvedBaseUrl;
  }
  await set(cred);

  process.stdout.write(
    `Logged in as ${me.name} (${me.id}). Credential saved to keychain.\n`,
  );
}
