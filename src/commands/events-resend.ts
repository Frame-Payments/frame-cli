/**
 * `frame events resend <evt_id>` — re-deliver a previously emitted sandbox
 * event verbatim. No mutation — re-delivery only.
 */

import { runWithBanner } from "../fmt/banner.js";
import { get } from "../auth/keyring.js";
import { createApiClient, resolveBaseUrl } from "../auth/api-client.js";

export interface EventsResendOptions {
  eventId: string;
}

interface ResendResponse {
  id: string;
  status: string;
}

export async function run(opts: EventsResendOptions): Promise<void> {
  if (!opts.eventId) {
    throw new Error("Event id is required. Usage: frame events resend <evt_id>");
  }

  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }

  const client = createApiClient({ apiKey: cred.apiKey, baseUrl: resolveBaseUrl(cred) });
  const result = await client.post<ResendResponse>(`/events/${opts.eventId}/resend`);

  await runWithBanner({ merchant: cred.merchant, mode: "sandbox" }, async () => {
    process.stdout.write(`event id: ${result.id}\nstatus:   ${result.status}\n`);
  });
}
