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

export interface ResourceDefinition {
  command: string;
  description: string;
  columns: string[];
  operations: OperationDefinition[];
}

export interface DeprecatedResource {
  command: string;
  canonical: string;
}

export const RESERVED_FLAGS = ["json", "body", "base-url", "idempotency-key", "help"] as const;

export function sendsIdempotencyKey(operation: OperationDefinition): boolean {
  return operation.method === "POST";
}
