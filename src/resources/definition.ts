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

export interface OperationDefinition {
  verb: string;
  method: string;
  path: string;
  summary: string;
  pathParams: PathParamDefinition[];
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

export const RESERVED_FLAGS = ["json", "body", "base-url", "help"] as const;
