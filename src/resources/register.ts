import { Argument, InvalidArgumentError, Option, type Command } from "commander";
import { UsageError } from "../fmt/error.js";
import {
  sendsIdempotencyKey,
  type Positional,
  type BodyArgumentDefinition,
  type DeprecatedResource,
  type FlagDefinition,
  type OperationDefinition,
  type ResourceDefinition,
} from "./definition.js";

function parseNumber(integer: boolean): (raw: string) => number {
  return (raw: string): number => {
    const value = Number(raw);
    if (raw.trim() === "" || Number.isNaN(value) || (integer && !Number.isInteger(value))) {
      throw new InvalidArgumentError(`Expected ${integer ? "an integer" : "a number"}.`);
    }
    return value;
  };
}

function optionFor(flag: FlagDefinition): Option {
  const spec = flag.type === "boolean" ? `--${flag.flag}` : `--${flag.flag} <${flag.type}>`;
  const option = new Option(spec, flag.description);
  if (flag.choices !== undefined) option.choices(flag.choices);
  if (flag.type === "integer" || flag.type === "number")
    option.argParser(parseNumber(flag.type === "integer"));
  return option;
}

function argumentFor(definition: BodyArgumentDefinition): Argument {
  const argument = new Argument(
    `<${definition.name}${definition.variadic ? "..." : ""}>`,
    definition.description
  );
  return definition.choices === undefined ? argument : argument.choices(definition.choices);
}

function toPositional(value: unknown): Positional {
  return Array.isArray(value) ? value.map(String) : String(value);
}

function usageLine(resource: ResourceDefinition, operation: OperationDefinition): string {
  const args = [
    ...operation.pathParams.map(({ name }) => `<${name}>`),
    ...operation.bodyArguments.map(({ name, variadic }) => `<${name}${variadic ? "..." : ""}>`),
  ];
  return ["frame", resource.command, operation.verb, ...args].join(" ");
}

function registerOperation(
  parent: Command,
  resource: ResourceDefinition,
  operation: OperationDefinition
): void {
  const command = parent
    .command(operation.verb)
    .description(operation.summary)
    .addHelpText(
      "after",
      `\nExamples:\n  ${usageLine(resource, operation)}\n  ${usageLine(resource, operation)} --json\n`
    );

  for (const param of operation.pathParams) command.argument(`<${param.name}>`, param.description);
  for (const definition of operation.bodyArguments) command.addArgument(argumentFor(definition));
  for (const flag of operation.flags) command.addOption(optionFor(flag));
  if (operation.acceptsBody) {
    command.option(
      "--body <json-or-@file>",
      "Raw JSON request body, or @path to a JSON file; flags override its fields"
    );
  }
  if (sendsIdempotencyKey(operation)) {
    command.option(
      "--idempotency-key <key>",
      "Idempotency-Key header to send instead of a fresh UUID v4; reuse one to replay a request"
    );
  }
  command
    .option("--json", "Print the raw API response body instead of a table")
    .option(
      "--base-url <url>",
      "Override the API base URL (falls back to $FRAME_API_BASE_URL, then the stored credential)"
    )
    .action(async (...args: unknown[]) => {
      const positionals = args
        .slice(0, operation.pathParams.length + operation.bodyArguments.length)
        .map(toPositional);
      const options = command.opts<Record<string, unknown>>();
      const { executeOperation } = await import("./execute.js");
      await executeOperation(resource, operation, positionals, options);
    });
}

function registerDeprecated(program: Command, { command, canonical }: DeprecatedResource): void {
  program
    .command(command, { hidden: true })
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments()
    .argument("[args...]")
    .action(() => {
      throw new UsageError(
        `\`frame ${command}\` is a deprecated resource and has no CLI commands. Use \`frame ${canonical}\` instead.`
      );
    });
}

export function registerResources(
  program: Command,
  resources: ResourceDefinition[],
  deprecated: DeprecatedResource[]
): void {
  for (const resource of resources) {
    const parent = program.command(resource.command).description(resource.description);
    for (const operation of resource.operations) registerOperation(parent, resource, operation);
  }
  for (const entry of deprecated) registerDeprecated(program, entry);
}
