/**
 * auth/keyring — thin wrapper over keytar.
 *
 * Stores a single Frame API credential (API key + merchant ID) in the
 * OS keychain under service "frame-cli" / account "api-key".
 *
 * IMPORTANT: keytar is a CommonJS native module. Use the **default import**
 * (`import keytar from "keytar"`), not a namespace import (`import * as`).
 * Under raw Node ESM — the loader the bundled CLI runs under — the namespace
 * style does not promote every CJS export to a named ESM export, leaving
 * `setPassword` / `deletePassword` undefined and producing
 * `TypeError: keytar.setPassword is not a function` at runtime. The bug is
 * masked by Vitest's transform pipeline, so unit tests that mock keytar do
 * not catch it. See `src/auth/__tests__/keytar-binding.test.ts` (subprocess
 * smoke test that mirrors this import style and runs under raw Node ESM).
 */

import keytar from "keytar";

export interface Credential {
  apiKey: string;
  merchant: string;
  /**
   * Whether the API key is a sandbox/dev-mode key. Captured from
   * `me.dev_mode` at login time so commands can render an honest banner
   * without re-fetching `/me`. The CLI is sandbox-only (ADR-0007); login
   * refuses to persist a credential with `devMode: false`.
   */
  devMode: boolean;
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
