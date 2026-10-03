import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Option } from "commander";
import { get } from "../auth/keyring.js";
import {
  apiRoot,
  createApiClient,
  resolveBaseUrl,
  type ApiClient,
  type ApiResponse,
} from "../auth/api-client.js";
import { runWithBanner } from "../fmt/banner.js";
import { UsageError } from "../fmt/error.js";
import { renderTable, rowsOf } from "../fmt/table.js";
import { isObject, type JsonObject } from "../json.js";
import {
  sendsIdempotencyKey,
  type FlagDefinition,
  type OperationDefinition,
  type ResourceDefinition,
} from "./definition.js";
import { pollUntilTerminal } from "./wait.js";

type Options = Record<string, unknown>;
function parseBodyOption(raw: string): JsonObject {
  const source = raw.startsWith("@") ? readBodyFile(raw.slice(1)) : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new UsageError("--body must be a JSON object or @path to a JSON file.");
  }
  if (!isObject(parsed)) throw new UsageError("--body must be a JSON object.");
  return parsed;
}

function readBodyFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new UsageError(`Cannot read --body file ${path}.`);
  }
}

function setPath(target: JsonObject, path: string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const child = isObject(target[head]) ? target[head] : {};
  target[head] = child;
  setPath(child, rest, value);
}

function optionKey(flag: FlagDefinition): string {
  return new Option(`--${flag.flag}`).attributeName();
}

function suppliedFlags(
  operation: OperationDefinition,
  options: Options,
  location: FlagDefinition["location"]
): { flag: FlagDefinition; value: unknown }[] {
  return operation.flags
    .filter((flag) => flag.location === location)
    .map((flag) => ({ flag, value: options[optionKey(flag)] }))
    .filter(({ value }) => value !== undefined);
}

function requestPath(
  operation: OperationDefinition,
  positionals: string[],
  options: Options
): string {
  const path = operation.pathParams.reduce(
    (current, param, index) =>
      current.replace(`{${param.name}}`, encodeURIComponent(positionals[index] ?? "")),
    operation.path
  );
  const query = new URLSearchParams(
    suppliedFlags(operation, options, "query").map(({ flag, value }) => [
      flag.path.join("."),
      String(value),
    ])
  ).toString();
  return query === "" ? path : `${path}?${query}`;
}

function requestBody(
  operation: OperationDefinition,
  bodyArgumentValues: string[],
  options: Options
): JsonObject | undefined {
  if (!operation.acceptsBody) return undefined;
  const body = typeof options.body === "string" ? parseBodyOption(options.body) : {};
  for (const { flag, value } of suppliedFlags(operation, options, "body"))
    setPath(body, flag.path, value);
  if (operation.bodyArgument !== undefined) body[operation.bodyArgument.name] = bodyArgumentValues;
  return body;
}

function idempotencyKeyFor(operation: OperationDefinition, options: Options): string | undefined {
  if (!sendsIdempotencyKey(operation)) return undefined;
  return typeof options.idempotencyKey === "string" ? options.idempotencyKey : randomUUID();
}

function retrieveOperation(resource: ResourceDefinition): OperationDefinition {
  const retrieve = resource.operations.find(({ verb }) => verb === "retrieve");
  if (retrieve === undefined) throw new Error(`${resource.command} has no retrieve to poll.`);
  return retrieve;
}

async function settle(
  client: ApiClient,
  resource: ResourceDefinition,
  operation: OperationDefinition,
  response: ApiResponse,
  options: Options
): Promise<ApiResponse> {
  const { wait } = resource;
  if (options.wait !== true || wait === undefined) return response;
  const retrieve = retrieveOperation(resource);
  return pollUntilTerminal(
    response,
    (id, signal) =>
      client.send(retrieve.method, requestPath(retrieve, [id], {}), undefined, {}, signal),
    {
      terminalStatuses: wait.terminalStatuses,
      intervalMs: Number(options.interval),
      timeoutMs: Number(options.timeout),
      onStatus: (id, status) => process.stderr.write(`Waiting for ${id}: ${status}\n`),
    }
  );
}

export async function executeOperation(
  resource: ResourceDefinition,
  operation: OperationDefinition,
  positionals: string[],
  bodyArgumentValues: string[],
  options: Options
): Promise<void> {
  const path = requestPath(operation, positionals, options);
  const body = requestBody(operation, bodyArgumentValues, options);
  const idempotencyKey = idempotencyKeyFor(operation, options);
  const headers: Record<string, string> =
    idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey };

  const cred = await get();
  if (cred === null) {
    throw new Error("Not logged in. Run `frame login` first.");
  }
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : resolveBaseUrl(cred);
  const client = createApiClient({ apiKey: cred.apiKey, baseUrl: apiRoot(baseUrl) });

  await runWithBanner(
    {
      merchant: cred.merchant,
      mode: cred.devMode ? "sandbox" : "live",
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    },
    async () => {
      const response = await client.send(operation.method, path, body, headers);
      const replay = response.headers.get("Idempotent-Replay");
      if (replay !== null) process.stderr.write(`Idempotent-Replay: ${replay}\n`);
      const settled = await settle(client, resource, operation, response, options);
      process.stdout.write(
        options.json === true ? settled.text : renderTable(resource.columns, rowsOf(settled.body))
      );
    }
  );
}
