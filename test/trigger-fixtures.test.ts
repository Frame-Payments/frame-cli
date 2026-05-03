/**
 * Regression guard: every fixtures/*.yaml event field must match
 * SUPPORTED_EVENTS from src/commands/trigger.ts — and vice versa.
 *
 * Prevents the canonical event list from silently drifting out of sync
 * with the bundled YAML files.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("../src/auth/api-client.js", () => ({
  createApiClient: vi.fn(),
  DEFAULT_BASE_URL: "https://api.frame.dev",
}));
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { SUPPORTED_EVENTS } from "../src/commands/trigger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

describe("trigger fixtures sync", () => {
  it("every fixtures/*.yaml event field is in SUPPORTED_EVENTS", () => {
    const yamlFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".yaml"));
    const fixtureEvents = yamlFiles.map((file) => {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf8");
      const parsed = parse(raw) as { event: string };
      return parsed.event;
    });

    const fixtureSet = new Set(fixtureEvents);
    const supportedSet = new Set(SUPPORTED_EVENTS);

    // Every fixture event must be in SUPPORTED_EVENTS
    for (const event of fixtureSet) {
      expect(supportedSet, `fixture event '${event}' is not in SUPPORTED_EVENTS`).toContain(event);
    }

    // Every supported event must have a fixture
    for (const event of supportedSet) {
      expect(fixtureSet, `SUPPORTED_EVENTS entry '${event}' has no fixture file`).toContain(event);
    }
  });

  it("fixture count matches SUPPORTED_EVENTS count", () => {
    const yamlFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".yaml"));
    expect(yamlFiles).toHaveLength(SUPPORTED_EVENTS.length);
  });
});
