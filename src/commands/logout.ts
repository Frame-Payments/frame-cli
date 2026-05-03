/**
 * `frame logout` — clear the stored credential from the OS keychain.
 */

import { clear } from "../auth/keyring.js";

export async function run(): Promise<void> {
  await clear();
  process.stdout.write("Logged out. Credential removed from keychain.\n");
}
