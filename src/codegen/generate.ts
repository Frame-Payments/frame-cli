import {
  RESERVED_FLAGS,
  type DeprecatedResource,
  type FlagDefinition,
  type FlagType,
  type OperationDefinition,
  type PathParamDefinition,
  type ResourceDefinition,
} from "../resources/definition.js";
import { isObject, type JsonObject } from "../json.js";

export interface GeneratedFile {
  path: string;
  contents: string;
}

const HTTP_METHODS: readonly string[] = ["get", "post", "put", "patch", "delete"];
const SCALAR_TYPES: readonly FlagType[] = ["string", "integer", "number", "boolean"];
const DEFINITION_MODULE = "../../resources/definition.js";

function asObject(value: unknown, what: string): JsonObject {
  if (!isObject(value)) throw new Error(`${what} must be an object`);
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} must be a string`);
  return value;
}

function asStringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${what} must be a list`);
  return value.map((item, index) => asString(item, `${what}[${index}]`));
}

function resolve(spec: JsonObject, node: unknown): JsonObject {
  if (!isObject(node)) return {};
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  if (!ref.startsWith("#/")) throw new Error(`Only local $refs are supported, got ${ref}`);
  const target = ref
    .slice(2)
    .split("/")
    .reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), spec);
  if (target === undefined) throw new Error(`Unresolvable $ref ${ref}`);
  return resolve(spec, target);
}

function describe(...candidates: unknown[]): string {
  const found = candidates.find((candidate) => typeof candidate === "string");
  return typeof found === "string" ? found.trim() : "";
}

function isFlagType(value: unknown): value is FlagType {
  return SCALAR_TYPES.some((type) => type === value);
}

function scalarType(schema: JsonObject): FlagType | null {
  return isFlagType(schema.type) ? schema.type : null;
}

function withChoices(flag: FlagDefinition, schema: JsonObject): FlagDefinition {
  if (!Array.isArray(schema.enum)) return flag;
  return { ...flag, choices: schema.enum.map(String) };
}

function parseOperationRef(ref: string, where: string): { method: string; path: string } {
  const match = /^([A-Z]+)\s+(\/\S*)$/.exec(ref.trim());
  if (match === null || !HTTP_METHODS.includes(match[1]!.toLowerCase())) {
    throw new Error(`${where} must look like "GET /v2/transfers", got "${ref}"`);
  }
  return { method: match[1]!, path: match[2]! };
}

function collectParameters(
  spec: JsonObject,
  pathItem: JsonObject,
  operation: JsonObject
): JsonObject[] {
  const declared = [pathItem.parameters, operation.parameters].flatMap((list) =>
    Array.isArray(list) ? list.map((param) => resolve(spec, param)) : []
  );
  const byKey = new Map(
    declared.map((param) => [`${String(param.in)}:${String(param.name)}`, param])
  );
  return [...byKey.values()];
}

function pathParamsFor(
  spec: JsonObject,
  path: string,
  params: JsonObject[]
): PathParamDefinition[] {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
  return names.map((name) => {
    const param = params.find((candidate) => candidate.in === "path" && candidate.name === name);
    return {
      name,
      description: describe(param?.description, resolve(spec, param?.schema).description),
    };
  });
}

function queryFlags(spec: JsonObject, params: JsonObject[]): FlagDefinition[] {
  return params
    .filter((param) => param.in === "query")
    .flatMap((param) => {
      const name = asString(param.name, "query parameter name");
      const schema = resolve(spec, param.schema);
      const type = scalarType(schema);
      if (type === null) return [];
      const flag: FlagDefinition = {
        flag: name,
        location: "query",
        path: [name],
        type,
        description: describe(param.description, schema.description),
      };
      return [withChoices(flag, schema)];
    });
}

function bodyFlags(spec: JsonObject, schema: JsonObject, prefix: string[]): FlagDefinition[] {
  const properties = isObject(schema.properties) ? schema.properties : {};
  return Object.entries(properties).flatMap(([name, raw]) => {
    const property = resolve(spec, raw);
    const path = [...prefix, name];
    if (isObject(property.properties)) return bodyFlags(spec, property, path);
    const type = scalarType(property);
    if (type === null) return [];
    const flag: FlagDefinition = {
      flag: path.join("."),
      location: "body",
      path,
      type,
      description: describe(property.description),
    };
    return [withChoices(flag, property)];
  });
}

function requestSchema(spec: JsonObject, operation: JsonObject): JsonObject | null {
  if (operation.requestBody === undefined) return null;
  const requestBody = resolve(spec, operation.requestBody);
  const content = isObject(requestBody.content) ? requestBody.content : {};
  const json = isObject(content["application/json"]) ? content["application/json"] : {};
  return resolve(spec, json.schema);
}

function assertNoCollisions(where: string, flags: FlagDefinition[]): void {
  const seen = new Set<string>(RESERVED_FLAGS);
  for (const { flag } of flags) {
    if (seen.has(flag))
      throw new Error(`${where}: flag --${flag} is defined twice or shadows a built-in flag`);
    seen.add(flag);
  }
}

function buildOperation(
  spec: JsonObject,
  resource: string,
  verb: string,
  ref: string
): OperationDefinition {
  const where = `${resource} ${verb}`;
  const { method, path } = parseOperationRef(ref, where);
  const paths = asObject(spec.paths, "OpenAPI paths");
  const pathItem = paths[path];
  const operation = isObject(pathItem) ? pathItem[method.toLowerCase()] : undefined;
  if (!isObject(pathItem) || !isObject(operation)) {
    throw new Error(
      `Allow-listed operation ${where} (${method} ${path}) is missing from the OpenAPI document`
    );
  }

  const params = collectParameters(spec, pathItem, operation);
  const body = requestSchema(spec, operation);
  const flags = [...queryFlags(spec, params), ...(body === null ? [] : bodyFlags(spec, body, []))];
  assertNoCollisions(where, flags);

  return {
    verb,
    method,
    path,
    summary: describe(operation.summary, operation.description),
    pathParams: pathParamsFor(spec, path, params),
    flags,
    acceptsBody: body !== null,
  };
}

function buildResource(spec: JsonObject, command: string, raw: unknown): ResourceDefinition {
  const entry = asObject(raw, `allow-list resource ${command}`);
  const operations = asObject(entry.operations, `allow-list ${command}.operations`);
  return {
    command,
    description: asString(entry.description, `allow-list ${command}.description`),
    columns: asStringList(entry.columns, `allow-list ${command}.columns`),
    operations: Object.entries(operations).map(([verb, ref]) =>
      buildOperation(spec, command, verb, asString(ref, `allow-list ${command}.operations.${verb}`))
    ),
  };
}

function identifierFor(command: string): string {
  return command.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function resourceModule(resource: ResourceDefinition): string {
  return [
    `import type { ResourceDefinition } from "${DEFINITION_MODULE}";`,
    "",
    `export const ${identifierFor(resource.command)}: ResourceDefinition = ${JSON.stringify(resource, null, 2)};`,
    "",
  ].join("\n");
}

function indexModule(resources: ResourceDefinition[], deprecated: DeprecatedResource[]): string {
  const imports = resources.map(
    ({ command }) => `import { ${identifierFor(command)} } from "./${command}.js";`
  );
  const names = resources.map(({ command }) => identifierFor(command)).join(", ");
  return [
    `import type { DeprecatedResource, ResourceDefinition } from "${DEFINITION_MODULE}";`,
    ...imports,
    "",
    `export const resources: ResourceDefinition[] = [${names}];`,
    "",
    `export const deprecatedResources: DeprecatedResource[] = ${JSON.stringify(deprecated, null, 2)};`,
    "",
  ].join("\n");
}

export function generateResourceCommands(spec: unknown, allowList: unknown): GeneratedFile[] {
  const document = asObject(spec, "OpenAPI document");
  const list = asObject(allowList, "allow-list");
  const resources = Object.entries(asObject(list.resources, "allow-list resources")).map(
    ([command, entry]) => buildResource(document, command, entry)
  );
  const deprecated = Object.entries(
    list.deprecated === undefined ? {} : asObject(list.deprecated, "allow-list deprecated")
  ).map(([command, canonical]) => ({
    command,
    canonical: asString(canonical, `allow-list deprecated.${command}`),
  }));

  return [
    ...resources.map((resource) => ({
      path: `${resource.command}.ts`,
      contents: resourceModule(resource),
    })),
    { path: "index.ts", contents: indexModule(resources, deprecated) },
  ];
}
