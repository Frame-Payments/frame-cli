import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Option } from "commander";
import { get } from "../auth/keyring.js";
import { apiRoot, createApiClient, resolveBaseUrl } from "../auth/api-client.js";
import { runWithBanner } from "../fmt/banner.js";
import { UsageError } from "../fmt/error.js";
import { renderTable, rowsOf } from "../fmt/table.js";
import { isObject, type JsonObject } from "../json.js";
import {
  sendsIdempotencyKey,
  type FlagDefinition,
  type OperationDefinition,
  type Positional,
  type ResourceDefinition,
} from "./definition.js";

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
  positionals: Positional[],
  options: Options
): string {
  const path = operation.pathParams.reduce(
    (current, param, index) =>
      current.replace(`{${param.name}}`, encodeURIComponent(String(positionals[index] ?? ""))),
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
  positionals: Positional[],
  options: Options
): JsonObject | undefined {
  if (!operation.acceptsBody) return undefined;
  const body = typeof options.body === "string" ? parseBodyOption(options.body) : {};
  for (const { flag, value } of suppliedFlags(operation, options, "body"))
    setPath(body, flag.path, value);
  operation.bodyArguments.forEach(({ name }, index) => {
    body[name] = positionals[operation.pathParams.length + index];
  });
  return body;
}

function idempotencyKeyFor(operation: OperationDefinition, options: Options): string | undefined {
  if (!sendsIdempotencyKey(operation)) return undefined;
  return typeof options.idempotencyKey === "string" ? options.idempotencyKey : randomUUID();
}

export async function executeOperation(
  resource: ResourceDefinition,
  operation: OperationDefinition,
  positionals: Positional[],
  options: Options
): Promise<void> {
  const path = requestPath(operation, positionals, options);
  const body = requestBody(operation, positionals, options);
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
      process.stdout.write(
        options.json === true ? response.text : renderTable(resource.columns, rowsOf(response.body))
      );
    }
  );
}
