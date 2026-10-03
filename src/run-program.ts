import { CommanderError, type Command } from "commander";
import { formatError, UsageError, WaitTimeoutError } from "./fmt/error.js";

const USAGE_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
const WAIT_TIMEOUT_EXIT_CODE = 3;

function throwInsteadOfExiting(command: Command): void {
  command.exitOverride();
  command.commands.forEach(throwInsteadOfExiting);
}

function exitCodeFor(err: unknown): number {
  if (err instanceof CommanderError) return err.exitCode === 0 ? 0 : USAGE_EXIT_CODE;
  if (err instanceof UsageError) return USAGE_EXIT_CODE;
  if (err instanceof WaitTimeoutError) return WAIT_TIMEOUT_EXIT_CODE;
  return FAILURE_EXIT_CODE;
}

export async function runProgram(program: Command, argv: string[]): Promise<number> {
  throwInsteadOfExiting(program);
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err) {
    if (!(err instanceof CommanderError)) {
      process.stderr.write(`${formatError(err)}\n`);
    }
    if (process.env.FRAME_DEBUG === "1" && err instanceof Error && err.stack) {
      process.stderr.write(`\n${err.stack}\n`);
    }
    return exitCodeFor(err);
  }
}
