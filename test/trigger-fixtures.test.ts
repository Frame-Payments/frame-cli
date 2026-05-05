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

  // Regression: every `POST /accounts` fixture step used to send `{ name: "Test Account" }`,
  // which the API rejects with HTTP 422 because Accounts::CreateContract requires both
  // `type` (individual|business) and a `profile.<type>` hash with at least one contact
  // method. See frame/app/contracts/accounts/create_contract.rb. Lock the minimum-valid
  // shape so future edits can't quietly regress every event trigger that creates an account.
  it("every POST /accounts fixture body satisfies the CreateContract minimum shape", () => {
    type AccountBody = {
      type?: string;
      profile?: { individual?: { email?: string; phone?: { number?: string } }; business?: unknown };
    };
    const yamlFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".yaml"));
    for (const file of yamlFiles) {
      const raw = readFileSync(join(FIXTURES_DIR, file), "utf8");
      const parsed = parse(raw) as {
        steps: Array<{ method?: string; path?: string; body?: AccountBody }>;
      };
      for (const step of parsed.steps ?? []) {
        if (step.method !== "POST" || step.path !== "/accounts") continue;
        const body = step.body ?? {};
        expect(body.type, `${file}: POST /accounts body missing 'type'`).toMatch(
          /^(individual|business)$/,
        );
        expect(body.profile, `${file}: POST /accounts body missing 'profile'`).toBeDefined();
        if (body.type === "individual") {
          const ind = body.profile?.individual;
          expect(ind, `${file}: POST /accounts missing profile.individual`).toBeDefined();
          const hasContact =
            (ind?.email !== undefined && ind.email !== "") ||
            (ind?.phone?.number !== undefined && ind.phone.number !== "");
          expect(
            hasContact,
            `${file}: profile.individual must include either email or phone.number`,
          ).toBe(true);
        } else {
          expect(
            body.profile?.business,
            `${file}: POST /accounts missing profile.business`,
          ).toBeDefined();
        }
      }
    }
  });
});
