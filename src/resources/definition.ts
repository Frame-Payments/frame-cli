export type FlagType = "string" | "integer" | "number" | "boolean";

export interface FlagDefinition {
  flag: string;
  location: "query" | "body";
  path: string[];
  type: FlagType;
  description: string;
  choices?: string[];
}

export interface PathParamDefinition {
  name: string;
  description: string;
}

export interface BodyArgumentDefinition {
  name: string;
  description: string;
  choices?: string[];
}

export interface OperationDefinition {
  verb: string;
  method: string;
  path: string;
  summary: string;
  pathParams: PathParamDefinition[];
  bodyArgument?: BodyArgumentDefinition;
  flags: FlagDefinition[];
  acceptsBody: boolean;
}

export interface WaitDefinition {
  terminalStatuses: string[];
  verbs: string[];
}

export interface ResourceDefinition {
  command: string;
  description: string;
  columns: string[];
  operations: OperationDefinition[];
  wait?: WaitDefinition;
}

export interface DeprecatedResource {
  command: string;
  canonical: string;
}

export const RESERVED_FLAGS = [
  "json",
  "body",
  "base-url",
  "idempotency-key",
  "wait",
  "interval",
  "timeout",
  "help",
] as const;

export function acceptsWait(resource: ResourceDefinition, operation: OperationDefinition): boolean {
  return resource.wait?.verbs.includes(operation.verb) === true;
}

export function sendsIdempotencyKey(operation: OperationDefinition): boolean {
  return operation.method === "POST";
}
