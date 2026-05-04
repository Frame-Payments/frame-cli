/**
 * Regression guard: every fixtures/*.yaml event field must match
 * SUPPORTED_EVENTS from src/commands/trigger-events.ts — and vice versa.
 *
 * Prevents the canonical event list from silently drifting out of sync
 * with the bundled YAML files.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { SUPPORTED_EVENTS } from "../src/commands/trigger-events.js";

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

  // Regression: fixture paths used to start with `/api/v1/...`, which
  // double-versioned the URL because the API client base already ends in
  // `/v1` (see src/auth/api-client.ts :: HARDCODED_DEFAULT_BASE_URL). The
  // contract is: fixture `path` is joined as `${base}${path}`, so it must
  // be relative to the versioned base (e.g. `/accounts`, not `/api/v1/accounts`
  // and not `/v1/accounts`).
  it("no fixture path starts with /api or /v1 (would double-version the URL)", () => {
    const yamlFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".yaml"));
    for (const file of yamlFiles) {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf8");
      const parsed = parse(raw) as { steps: Array<{ path?: string }> };
      for (const step of parsed.steps ?? []) {
        if (step.path === undefined) continue;
        expect(
          step.path,
          `${file}: path '${step.path}' must not start with /api or /v1 (base URL already includes /v1)`,
        ).not.toMatch(/^\/(api|v1)(\/|$)/);
        expect(step.path, `${file}: path '${step.path}' must start with '/'`).toMatch(/^\//);
      }
    }
  });
});
