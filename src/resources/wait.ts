import { setTimeout as sleep } from "node:timers/promises";
import type { ApiResponse } from "../auth/api-client.js";
import { WaitTimeoutError } from "../fmt/error.js";
import { isObject } from "../json.js";

export interface PollOptions {
  terminalStatuses: string[];
  intervalMs: number;
  timeoutMs: number;
  onStatus: (id: string, status: string) => void;
}

function idOf(response: ApiResponse): string {
  const id = isObject(response.body) ? response.body.id : undefined;
  if (typeof id !== "string") throw new Error("--wait needs an id in the response body to poll.");
  return id;
}

function statusOf(response: ApiResponse): string {
  const status = isObject(response.body) ? response.body.status : undefined;
  return typeof status === "string" ? status : "unknown";
}

export async function pollUntilTerminal(
  initial: ApiResponse,
  retrieve: (id: string, signal: AbortSignal) => Promise<ApiResponse>,
  { terminalStatuses, intervalMs, timeoutMs, onStatus }: PollOptions
): Promise<ApiResponse> {
  const id = idOf(initial);
  const deadline = AbortSignal.timeout(timeoutMs);
  let latest = initial;
  let status = statusOf(latest);
  onStatus(id, status);
  try {
    while (!terminalStatuses.includes(status)) {
      await sleep(intervalMs, undefined, { signal: deadline });
      latest = await retrieve(id, deadline);
      const next = statusOf(latest);
      if (next !== status) onStatus(id, next);
      status = next;
    }
  } catch (err) {
    if (!deadline.aborted) throw err;
    throw new WaitTimeoutError(
      `Timed out after ${timeoutMs}ms waiting for ${id} to reach ${terminalStatuses.join(", ")}; last status: ${status}.`
    );
  }
  return latest;
}
