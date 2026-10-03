import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProvider, PromptArgs, Sandbox } from "@ai-hero/sandcastle";

// Checkpointing for `--resume`. sandcastle's own session capture only fires
// after an iteration *succeeds* (see dist/index.js — capture runs inside the
// same Effect as invokeAgent's result, so a thrown AgentError from a
// non-zero Claude Code exit, e.g. running out of credits, skips it
// entirely). A crashed sandbox.run() call also carries no sessionId,
// iteration count, or commits back to the caller — just a bare rejection.
// So to resume a crashed multi-iteration phase we drive its iteration budget
// ourselves, one `maxIterations: 1` call at a time, and persist the
// captured sessionId + iteration count to disk after every single success.

export type PhaseName = "implementer" | "reviewer";

export type PhaseState = {
  status: "pending" | "in-progress" | "complete";
  iterationsRun: number;
  lastSessionId?: string;
};

export type ResumeState = {
  issueId: string;
  branch: string;
  implementer: PhaseState;
  reviewer: PhaseState;
};

function freshPhaseState(): PhaseState {
  return { status: "pending", iterationsRun: 0 };
}

function freshState(branch: string, issueId: string): ResumeState {
  return {
    issueId,
    branch,
    implementer: freshPhaseState(),
    reviewer: freshPhaseState(),
  };
}

// Mirrors sandcastle's own sanitizeBranchForFilename (dist/index.js) so the
// naming scheme reads the same way as its log files.
function sanitizeBranchForFilename(branch: string): string {
  return branch.replace(/[/\\:*?"<>|]/g, "-");
}

// .sandcastle/logs/resume/ — logs/ is already gitignored (.sandcastle/.gitignore),
// so checkpoints never end up in a commit.
function statePath(cwd: string, branch: string): string {
  return join(cwd, ".sandcastle", "logs", "resume", `${sanitizeBranchForFilename(branch)}.json`);
}

// Never let a missing or corrupt checkpoint file abort the run — resume is
// best-effort. A parse failure just means "start this phase from scratch."
export function loadResumeState(cwd: string, branch: string, issueId: string): ResumeState {
  const filePath = statePath(cwd, branch);
  if (!existsSync(filePath)) return freshState(branch, issueId);
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as ResumeState;
  } catch {
    console.warn(`Could not parse resume state at ${filePath} — starting fresh.`);
    return freshState(branch, issueId);
  }
}

export function saveResumeState(cwd: string, state: ResumeState): void {
  const filePath = statePath(cwd, state.branch);
  mkdirSync(join(cwd, ".sandcastle", "logs", "resume"), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function clearResumeState(cwd: string, branch: string): void {
  const filePath = statePath(cwd, branch);
  if (existsSync(filePath)) rmSync(filePath);
}

export function allPhasesComplete(state: ResumeState): boolean {
  return (
    state.implementer.status === "complete" &&
    state.reviewer.status === "complete"
  );
}

export type RunPhaseOptions = {
  sandbox: Pick<Sandbox, "run">;
  cwd: string;
  resume: boolean;
  state: ResumeState;
  phase: PhaseName;
  maxIterations: number;
  name: string;
  agent: AgentProvider;
  promptFile: string;
  promptArgs: PromptArgs;
};

export type RunPhaseResult = {
  commits: { sha: string }[];
  stdout: string;
  completionSignal?: string;
};

// Runs one phase to completion or failure. For a maxIterations: 1 phase
// (reviewer) this is just "run once, checkpoint the result" — the
// loop below degenerates to a single pass, so callers don't need to special-
// case single-iteration phases.
//
// On success, checkpoints after EVERY iteration (not just at the end) so a
// crash on iteration N+1 still leaves iteration N's session id and count on
// disk. On failure, checkpoints the last-good state and rethrows — the
// caller (main.mts) already treats a thrown phase as a failed issue pipeline.
export async function runPhase(opts: RunPhaseOptions): Promise<RunPhaseResult> {
  const { phase, state } = opts;
  const phaseState = state[phase];

  if (opts.resume && phaseState.status === "complete") {
    console.log(`  [${opts.name}] already complete — skipping (--resume).`);
    return { commits: [], stdout: "" };
  }

  const startIteration = opts.resume ? phaseState.iterationsRun + 1 : 1;
  const resumeSessionId = opts.resume ? phaseState.lastSessionId : undefined;

  const commits: { sha: string }[] = [];
  let stdout = "";
  let completionSignal: string | undefined;

  for (let i = startIteration; i <= opts.maxIterations; i++) {
    let result;
    try {
      result = await opts.sandbox.run({
        name: opts.name,
        maxIterations: 1,
        agent: opts.agent,
        promptFile: opts.promptFile,
        promptArgs: opts.promptArgs,
        resumeSession: i === startIteration ? resumeSessionId : undefined,
      });
    } catch (err) {
      // Use the CURRENT checkpoint, not `phaseState` captured before the loop
      // started — a prior iteration in this same call may have already
      // advanced it.
      state[phase] = {
        status: "in-progress",
        iterationsRun: i - 1,
        lastSessionId: state[phase].lastSessionId,
      };
      saveResumeState(opts.cwd, state);
      throw err;
    }

    commits.push(...result.commits);
    stdout += result.stdout;
    completionSignal = result.completionSignal;
    const lastSessionId = result.iterations.at(-1)?.sessionId ?? state[phase].lastSessionId;

    state[phase] = {
      status: completionSignal !== undefined || i === opts.maxIterations ? "complete" : "in-progress",
      iterationsRun: i,
      lastSessionId,
    };
    saveResumeState(opts.cwd, state);

    if (completionSignal !== undefined) break;
  }

  return { commits, stdout, completionSignal };
}
