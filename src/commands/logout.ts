/**
 * `frame logout` — clear the stored Frame credential.
 */

import { clear } from "../auth/keyring.js";

export async function run(): Promise<void> {
  await clear();
  process.stdout.write("Logged out. Credential removed.\n");
}
