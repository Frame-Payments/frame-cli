/**
 * auth/keyring — credential store backed by a file on disk.
 *
 * Stores a single Frame API credential (API key + merchant ID) as JSON at
 * `$XDG_CONFIG_HOME/frame/credentials.json` (defaulting to
 * `~/.config/frame/credentials.json`). Directory is created with mode 0700
 * and the file is written with mode 0600 — matching the pattern used by
 * `gh`, `aws`, `stripe`, and most other developer CLIs.
 *
 * History: this module used to wrap `keytar` to put credentials in the OS
 * keychain. keytar is unmaintained (last release 2021) and its prebuilt
 * native binaries do not cover modern Node versions, which made Homebrew
 * installs fail when Homebrew shipped Node 22+. The CLI is sandbox-only
 * (ADR-0007), so the threat model does not require OS-keychain storage —
 * a 0600 file is the pragmatic choice.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

/**
 * Resolve the credentials file path. Exported for tests; callers should
 * not depend on the path. Honours `$XDG_CONFIG_HOME` per the XDG Base
 * Directory spec, otherwise falls back to `~/.config/frame`.
 */
export function credentialsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "frame", "credentials.json");
}

/** Retrieve the stored credential, or null if none exists. */
export async function get(): Promise<Credential | null> {
  const path = credentialsPath();
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as Credential;
}

/** Persist a credential to disk. Creates parent dirs with mode 0700 and file with mode 0600. */
export async function set(cred: Credential): Promise<void> {
  const path = credentialsPath();
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.writeFile(path, JSON.stringify(cred), { mode: 0o600 });
  // writeFile only sets mode on creation; chmod ensures 0600 if the file pre-existed with looser perms.
  await fs.chmod(path, 0o600);
}

/** Remove the stored credential from disk. No-op if no credential is stored. */
export async function clear(): Promise<void> {
  const path = credentialsPath();
  try {
    await fs.unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}
