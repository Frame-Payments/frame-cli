/**
 * `frame trigger <event_code>` — drive the sandbox through a real API-call
 * sequence using bundled fixture YAML files.
 *
 * Fixture format (fixtures/<event_code>.yaml):
 *   event: transfer.completed
 *   steps:
 *     - method: POST
 *       path: /api/v1/transfers
 *       body: { account_id: "{account_id}", amount: 1000, currency: usd }
 *       capture: transfer_id          # stores response.id in context
 *     - method: force_transition       # posts to /api/v1/test/force_transition
 *       resource_type: transfer
 *       resource_id: "{transfer_id}"
 *       target_state: completed
 *
 * Context variables captured from previous steps can be interpolated into
 * `path`, `body`, and `resource_id` fields using {variable_name} syntax.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createApiClient, DEFAULT_BASE_URL, type ApiClient } from "../auth/api-client.js";

// ---------------------------------------------------------------------------
// Canonical 16-event list — the public contract for v1.
// ---------------------------------------------------------------------------

export const SUPPORTED_EVENTS: readonly string[] = [
  "account.created",
  "account.updated",
  "account.restricted",
  "account.unrestricted",
  "capability.requested",
  "capability.approved",
  "capability.denied",
  "capability.disabled",
  "transfer.created",
  "transfer.completed",
  "transfer.cancelled",
  "transfer.updated",
  "refund.created",
  "refund.completed",
  "invoice.created",
  "invoice.paid",
];

// ---------------------------------------------------------------------------
// Deprecated event codes → canonical equivalent hint.
// ---------------------------------------------------------------------------

export const DEPRECATED_EVENTS: Readonly<Record<string, string>> = {
  "customer.created": "frame accounts create",
  "customer.updated": "frame accounts update",
  "customer.deleted": "frame accounts update",
  "charge_intent.created": "frame transfers create",
  "charge_intent.completed": "frame trigger transfer.completed",
  "charge_intent.cancelled": "frame trigger transfer.cancelled",
  "payout.created": "frame transfers create",
  "charge.created": "frame transfers create",
};

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

interface ApiStep {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  capture?: string;
}

interface ForceTransitionStep {
  method: "force_transition";
  resource_type: string;
  resource_id: string;
  target_state: string;
}

type Step = ApiStep | ForceTransitionStep;

interface Fixture {
  event: string;
  steps: Step[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Shape returned by every resource-creation endpoint we call. */
type ApiIdResponse = { id?: string };

// ---------------------------------------------------------------------------
// Interpolation helpers
// ---------------------------------------------------------------------------

function interpolateString(value: string, ctx: Record<string, string>): string {
  return value.replace(/\{(\w+)\}/g, (_, key: string) => ctx[key] ?? `{${key}}`);
}

function interpolateValue(value: unknown, ctx: Record<string, string>): unknown {
  if (typeof value === "string") return interpolateString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, ctx));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateValue(v, ctx),
      ]),
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

async function executeStep(
  client: ApiClient,
  step: Step,
  ctx: Record<string, string>,
): Promise<void> {
  if (step.method === "force_transition") {
    const resourceId = interpolateString(step.resource_id, ctx);
    const body = {
      resource_type: step.resource_type,
      resource_id: resourceId,
      target_state: step.target_state,
    };
    await client.post("/api/v1/test/force_transition", body);
    process.stdout.write(
      `  force_transition ${step.resource_type} ${resourceId} → ${step.target_state}\n`,
    );
    return;
  }

  const path = interpolateString(step.path, ctx);
  const body =
    step.body !== undefined
      ? (interpolateValue(step.body, ctx) as Record<string, unknown>)
      : {};

  let result: ApiIdResponse;

  if (step.method === "POST") {
    result = await client.post<ApiIdResponse>(path, body);
  } else if (step.method === "PATCH") {
    result = await client.patch<ApiIdResponse>(path, body);
  } else if (step.method === "DELETE") {
    result = await client.delete<ApiIdResponse>(path);
  } else {
    result = await client.get<ApiIdResponse>(path);
  }

  const resourceId = result.id ?? "(no id)";
  process.stdout.write(`  ${step.method} ${path} → ${resourceId}\n`);

  if (step.capture !== undefined && result.id !== undefined) {
    ctx[step.capture] = result.id;
  }
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

// Resolve fixtures/ relative to this source file so it works in both
// development (src/commands/trigger.ts) and test (same location).
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

function loadFixture(eventCode: string): Fixture {
  const fixturePath = join(FIXTURES_DIR, `${eventCode}.yaml`);
  const raw = readFileSync(fixturePath, "utf8");
  return parse(raw) as Fixture;
}

// ---------------------------------------------------------------------------
// Public command entry-point
// ---------------------------------------------------------------------------

export async function run(eventCode: string): Promise<void> {
  // Check deprecated event codes first.
  const deprecatedHint = DEPRECATED_EVENTS[eventCode];
  if (deprecatedHint !== undefined) {
    throw new Error(
      `'${eventCode}' is a deprecated event code. ` +
        `Use: ${deprecatedHint}\n` +
        `See \`frame --help\` for the canonical command list.`,
    );
  }

  // Check unknown event codes.
  if (!SUPPORTED_EVENTS.includes(eventCode)) {
    const list = SUPPORTED_EVENTS.map((e) => `  • ${e}`).join("\n");
    throw new Error(
      `Unknown event code '${eventCode}'. Supported events:\n${list}`,
    );
  }

  // Require login.
  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }

  const client = createApiClient({ apiKey: cred.apiKey, baseUrl: DEFAULT_BASE_URL });
  const fixture = loadFixture(eventCode);

  await runWithBanner({ merchant: cred.merchant, mode: "sandbox" }, async () => {
    process.stdout.write(`Triggering ${eventCode}…\n`);
    const ctx: Record<string, string> = {};

    for (const step of fixture.steps) {
      await executeStep(client, step, ctx);
    }

    process.stdout.write(`✓ ${eventCode} triggered successfully.\n`);
  });
}
