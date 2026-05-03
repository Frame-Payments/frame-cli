/**
 * auth/keyring — thin wrapper over keytar.
 *
 * Stores a single Frame API credential (API key + merchant ID) in the
 * OS keychain under service "frame-cli" / account "api-key".
 */

import * as keytar from "keytar";

export interface Credential {
  apiKey: string;
  merchant: string;
  /**
   * Optional API base URL this credential was issued against. Set when
   * `frame login --base-url <url>` (or the FRAME_API_BASE_URL env var) is
   * used to point the CLI at a non-production host. Omitted credentials
   * fall back to the hardcoded production default.
   */
  baseUrl?: string;
}

const SERVICE = "frame-cli";
const ACCOUNT = "api-key";

/** Retrieve the stored credential, or null if none exists. */
export async function get(): Promise<Credential | null> {
  const raw = await keytar.getPassword(SERVICE, ACCOUNT);
  if (raw === null) return null;
  return JSON.parse(raw) as Credential;
}

/** Persist a credential to the OS keychain. */
export async function set(cred: Credential): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(cred));
}

/** Remove the stored credential from the OS keychain. */
export async function clear(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}
