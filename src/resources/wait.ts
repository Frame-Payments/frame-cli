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
  retrieve: (id: string) => Promise<ApiResponse>,
  { terminalStatuses, intervalMs, timeoutMs, onStatus }: PollOptions
): Promise<ApiResponse> {
  const id = idOf(initial);
  const deadline = performance.now() + timeoutMs;
  let latest = initial;
  let status = statusOf(latest);
  onStatus(id, status);
  while (!terminalStatuses.includes(status)) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) {
      throw new WaitTimeoutError(
        `Timed out after ${timeoutMs}ms waiting for ${id} to reach ${terminalStatuses.join(", ")}; last status: ${status}.`
      );
    }
    await sleep(Math.min(intervalMs, remainingMs));
    latest = await retrieve(id);
    const next = statusOf(latest);
    if (next !== status) onStatus(id, next);
    status = next;
  }
  return latest;
}
