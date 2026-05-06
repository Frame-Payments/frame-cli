/**
 * scripts/_capture-listen-transcript.ts
 *
 * Standalone capture tool. Subscribes to `Cli::WebhookListenChannel` against
 * the configured local Rails server using the existing transport layer
 * (`src/transport/cable-client.ts`), records every received cable data
 * message as a JSON line, then exits. Does NOT touch `src/commands/listen.ts`
 * — that is unchanged in this slice (FRA-3536 AC: "no behavior change to
 * `frame listen` itself in this slice").
 *
 * Invoked by `scripts/capture-listen-transcript.sh`. Not a public CLI
 * command; the underscore prefix marks it as a build/test artefact.
 *
 * Env contract (set by the bash wrapper):
 *   FRAME_LISTEN_TRANSCRIPT_OUT  Path to write the JSON-lines transcript.
 *   FRAME_API_KEY                Optional override; otherwise read from keyring.
 *   FRAME_API_BASE_URL           Optional override of the credential's base URL.
 *   TRIGGER_EVENT_CODE           Event code to subscribe to (default account.created).
 *   CAPTURE_TIMEOUT_MS           Hard timeout (default 12000).
 */

import { writeFileSync, appendFileSync } from "node:fs";
import { get as getCred } from "../src/auth/keyring.js";
import { resolveBaseUrl } from "../src/auth/api-client.js";
import { createCableClient } from "../src/transport/cable-client.js";
import { deriveCableUrl } from "../src/transport/derive-cable-url.js";
import { CHANNEL_NAME, buildSubscribeParams } from "../src/transport/webhook-listen-protocol.js";

const OUT = process.env.FRAME_LISTEN_TRANSCRIPT_OUT;
if (!OUT) {
  console.error("error: FRAME_LISTEN_TRANSCRIPT_OUT is required");
  process.exit(2);
}

const TRIGGER = process.env.TRIGGER_EVENT_CODE ?? "account.created";
const TIMEOUT_MS = Number(process.env.CAPTURE_TIMEOUT_MS ?? 12_000);

async function main(): Promise<void> {
  let apiKey = process.env.FRAME_API_KEY;
  let baseUrl = process.env.FRAME_API_BASE_URL;

  if (!apiKey) {
    const cred = await getCred();
    if (!cred) {
      console.error("error: no credential. Run `frame login` or export FRAME_API_KEY.");
      process.exit(2);
    }
    apiKey = cred.apiKey;
    baseUrl = baseUrl ?? resolveBaseUrl(cred);
  } else {
    baseUrl = baseUrl ?? resolveBaseUrl(null);
  }

  const cableUrl = deriveCableUrl(baseUrl);
  console.error(`→ connecting to ${cableUrl}`);

  // Truncate the output file up front so partial captures don't leave stale data.
  writeFileSync(OUT!, "");

  const client = createCableClient(cableUrl, { apiKey });

  let messageCount = 0;
  const sub = client
    .subscribe(CHANNEL_NAME, buildSubscribeParams({ eventCodes: [TRIGGER] }) as unknown as Record<string, unknown>)
    .on("*", (raw) => {
      messageCount++;
      appendFileSync(OUT!, JSON.stringify(raw) + "\n");
      console.error(`  · captured message #${messageCount}: ${JSON.stringify(raw).slice(0, 80)}…`);
    });

  // Hard timeout — if we don't see a welcome + at least one event by then, exit non-zero.
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (messageCount >= 2) {
      // welcome + first broadcast — but allow a small extra window in case more arrive.
      await new Promise((r) => setTimeout(r, 1_500));
      break;
    }
  }

  sub.unsubscribe();
  client.disconnect();

  if (messageCount === 0) {
    console.error("error: captured zero messages within timeout");
    process.exit(3);
  }
  console.error(`✓ captured ${messageCount} messages`);
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
