/**
 * Contract tests for auth/keyring.
 *
 * Uses a real temp directory pointed at via $XDG_CONFIG_HOME so we exercise
 * the actual filesystem code path without touching the developer's real
 * `~/.config/frame/credentials.json`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { get, set, clear, credentialsPath, type Credential } from "../keyring.js";

const CRED: Credential = {
  apiKey: "sk_test_abc123",
  merchant: "acct_test_001",
  devMode: true,
};

let tmpRoot: string;
let prevXdg: string | undefined;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "frame-keyring-test-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpRoot;
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("keyring.credentialsPath", () => {
  it("resolves under $XDG_CONFIG_HOME/frame/credentials.json", () => {
    expect(credentialsPath()).toBe(join(tmpRoot, "frame", "credentials.json"));
  });
});

describe("keyring.get", () => {
  it("returns null when no credential is stored", async () => {
    expect(await get()).toBeNull();
  });

  it("returns a parsed Credential when one is stored", async () => {
    await set(CRED);
    expect(await get()).toEqual(CRED);
  });
});

describe("keyring.set", () => {
  it("writes the credential as JSON at the resolved path", async () => {
    await set(CRED);
    const raw = await fs.readFile(credentialsPath(), "utf8");
    expect(JSON.parse(raw)).toEqual(CRED);
  });

  it("creates parent directories that did not exist", async () => {
    await set(CRED);
    const stat = await fs.stat(join(tmpRoot, "frame"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes the credential file with mode 0600", async () => {
    await set(CRED);
    const stat = await fs.stat(credentialsPath());
    // Mask off file-type bits, keep the permission bits.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("overwrites an existing credential", async () => {
    await set(CRED);
    const next: Credential = { ...CRED, apiKey: "sk_test_xyz", devMode: true };
    await set(next);
    expect(await get()).toEqual(next);
  });

  it("tightens permissions on a pre-existing looser file", async () => {
    await fs.mkdir(join(tmpRoot, "frame"), { recursive: true });
    await fs.writeFile(credentialsPath(), "{}", { mode: 0o644 });
    await set(CRED);
    const stat = await fs.stat(credentialsPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("keyring.clear", () => {
  it("removes the stored credential", async () => {
    await set(CRED);
    await clear();
    expect(await get()).toBeNull();
  });

  it("is a no-op when no credential exists", async () => {
    await expect(clear()).resolves.toBeUndefined();
  });
});
