import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxRunOptions, SandboxRunResult } from "@ai-hero/sandcastle";

import {
  allPhasesComplete,
  clearResumeState,
  loadResumeState,
  runPhase,
  saveResumeState,
  type ResumeState,
} from "./resume.mts";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "sc-resume-test-"));
}

const BRANCH = "sandcastle/fra-4969";
const ISSUE_ID = "FRA-4969";

// A fake Sandbox exposing only the `run` method runPhase touches. Queue
// responses (results or thrown errors) and record every call's options so
// tests can assert on what was actually sent to sandcastle.
function fakeSandbox(responses: Array<{ error: Error } | { result: SandboxRunResult }>) {
  const calls: SandboxRunOptions[] = [];
  let i = 0;
  return {
    calls,
    run: async (opts: SandboxRunOptions) => {
      calls.push(opts);
      const next = responses[i++];
      if (!next) throw new Error("fakeSandbox: no more queued responses");
      if ("error" in next) throw next.error;
      return next.result;
    },
  };
}

function iterationResult(opts: {
  sessionId?: string;
  commits?: { sha: string }[];
  completionSignal?: string;
}): SandboxRunResult {
  return {
    iterations: [{ sessionId: opts.sessionId }],
    commits: opts.commits ?? [],
    stdout: "",
    completionSignal: opts.completionSignal,
  };
}

// ---------------------------------------------------------------------------
// State file I/O
// ---------------------------------------------------------------------------

test("loadResumeState returns fresh defaults when no file exists", () => {
  const cwd = tmpCwd();
  const state = loadResumeState(cwd, BRANCH, ISSUE_ID);
  assert.equal(state.issueId, ISSUE_ID);
  assert.equal(state.branch, BRANCH);
  assert.deepEqual(state.implementer, { status: "pending", iterationsRun: 0 });
  assert.deepEqual(state.reviewer, { status: "pending", iterationsRun: 0 });
});

test("saveResumeState then loadResumeState round-trips", () => {
  const cwd = tmpCwd();
  const state = loadResumeState(cwd, BRANCH, ISSUE_ID);
  state.implementer = { status: "in-progress", iterationsRun: 12, lastSessionId: "sess-1" };
  saveResumeState(cwd, state);

  const reloaded = loadResumeState(cwd, BRANCH, ISSUE_ID);
  assert.deepEqual(reloaded.implementer, {
    status: "in-progress",
    iterationsRun: 12,
    lastSessionId: "sess-1",
  });
});

test("loadResumeState falls back to fresh state on a corrupt file", () => {
  const cwd = tmpCwd();
  const state = loadResumeState(cwd, BRANCH, ISSUE_ID);
  saveResumeState(cwd, state);
  const filePath = path.join(cwd, ".sandcastle", "logs", "resume", "sandcastle-fra-4969.json");
  writeFileSync(filePath, "{ not json");

  const reloaded = loadResumeState(cwd, BRANCH, ISSUE_ID);
  assert.deepEqual(reloaded.implementer, { status: "pending", iterationsRun: 0 });
});

test("clearResumeState removes the checkpoint file", () => {
  const cwd = tmpCwd();
  const state = loadResumeState(cwd, BRANCH, ISSUE_ID);
  saveResumeState(cwd, state);
  const filePath = path.join(cwd, ".sandcastle", "logs", "resume", "sandcastle-fra-4969.json");
  assert.ok(existsSync(filePath));

  clearResumeState(cwd, BRANCH);
  assert.ok(!existsSync(filePath));
});

test("clearResumeState on a branch with no file is a no-op", () => {
  const cwd = tmpCwd();
  assert.doesNotThrow(() => clearResumeState(cwd, BRANCH));
});

test("allPhasesComplete is true only when every phase is complete", () => {
  const cwd = tmpCwd();
  const state = loadResumeState(cwd, BRANCH, ISSUE_ID);
  assert.equal(allPhasesComplete(state), false);

  state.implementer.status = "complete";
  assert.equal(allPhasesComplete(state), false);

  state.reviewer.status = "complete";
  assert.equal(allPhasesComplete(state), true);
});

// ---------------------------------------------------------------------------
// runPhase
// ---------------------------------------------------------------------------

const RUN_PHASE_DEFAULTS = {
  name: "implementer",
  agent: {} as never,
  promptFile: "./.sandcastle/implement-prompt.md",
  promptArgs: {},
};

test("runPhase skips a phase already complete under resume, without touching the sandbox", async () => {
  const cwd = tmpCwd();
  const state: ResumeState = loadResumeState(cwd, BRANCH, ISSUE_ID);
  state.implementer = { status: "complete", iterationsRun: 40, lastSessionId: "sess-done" };
  const sandbox = fakeSandbox([]);

  const result = await runPhase({
    ...RUN_PHASE_DEFAULTS,
    sandbox,
    cwd,
    resume: true,
    state,
    phase: "implementer",
    maxIterations: 100,
  });

  assert.deepEqual(result, { commits: [], stdout: "" });
  assert.equal(sandbox.calls.length, 0);
});

test("runPhase passes resumeSession only on the first loop iteration", async () => {
  const cwd = tmpCwd();
  const state: ResumeState = loadResumeState(cwd, BRANCH, ISSUE_ID);
  state.implementer = { status: "in-progress", iterationsRun: 5, lastSessionId: "sess-5" };
  const sandbox = fakeSandbox([
    { result: iterationResult({ sessionId: "sess-6" }) },
    { result: iterationResult({ sessionId: "sess-7", completionSignal: "<promise>COMPLETE</promise>" }) },
  ]);

  await runPhase({
    ...RUN_PHASE_DEFAULTS,
    sandbox,
    cwd,
    resume: true,
    state,
    phase: "implementer",
    maxIterations: 100,
  });

  assert.equal(sandbox.calls.length, 2);
  assert.equal(sandbox.calls[0]!.resumeSession, "sess-5");
  assert.equal(sandbox.calls[1]!.resumeSession, undefined);
  // continues numbering from iterationsRun + 1, not from 1
  assert.equal(state.implementer.iterationsRun, 7);
});

test("runPhase stops on a completion signal and marks the phase complete", async () => {
  const cwd = tmpCwd();
  const state: ResumeState = loadResumeState(cwd, BRANCH, ISSUE_ID);
  const sandbox = fakeSandbox([
    { result: iterationResult({ sessionId: "sess-1", commits: [{ sha: "a" }] }) },
    { result: iterationResult({ sessionId: "sess-2", commits: [{ sha: "b" }], completionSignal: "<promise>COMPLETE</promise>" }) },
  ]);

  const result = await runPhase({
    ...RUN_PHASE_DEFAULTS,
    sandbox,
    cwd,
    resume: false,
    state,
    phase: "implementer",
    maxIterations: 100,
  });

  assert.equal(sandbox.calls.length, 2);
  assert.deepEqual(result.commits, [{ sha: "a" }, { sha: "b" }]);
  assert.equal(state.implementer.status, "complete");
  assert.equal(state.implementer.iterationsRun, 2);
});

test("runPhase marks the phase complete after exhausting maxIterations without a signal", async () => {
  const cwd = tmpCwd();
  const state: ResumeState = loadResumeState(cwd, BRANCH, ISSUE_ID);
  const sandbox = fakeSandbox([{ result: iterationResult({ sessionId: "sess-1" }) }]);

  await runPhase({
    ...RUN_PHASE_DEFAULTS,
    sandbox,
    cwd,
    resume: false,
    state,
    phase: "reviewer",
    maxIterations: 1,
  });

  assert.equal(state.reviewer.status, "complete");
  assert.equal(state.reviewer.iterationsRun, 1);
});

test("runPhase checkpoints the last-good iteration and rethrows on failure", async () => {
  const cwd = tmpCwd();
  const state: ResumeState = loadResumeState(cwd, BRANCH, ISSUE_ID);
  const crash = new Error("claude exited with code 1: out of credits");
  const sandbox = fakeSandbox([
    { result: iterationResult({ sessionId: "sess-1" }) },
    { result: iterationResult({ sessionId: "sess-2" }) },
    { error: crash },
  ]);

  await assert.rejects(
    runPhase({
      ...RUN_PHASE_DEFAULTS,
      sandbox,
      cwd,
      resume: false,
      state,
      phase: "implementer",
      maxIterations: 100,
    }),
    crash,
  );

  assert.equal(state.implementer.status, "in-progress");
  assert.equal(state.implementer.iterationsRun, 2);
  assert.equal(state.implementer.lastSessionId, "sess-2");

  // and the checkpoint was persisted to disk, not just held in memory
  const reloaded = loadResumeState(cwd, BRANCH, ISSUE_ID);
  assert.equal(reloaded.implementer.iterationsRun, 2);
  assert.equal(reloaded.implementer.lastSessionId, "sess-2");
});

test("a subsequent resumed runPhase call continues from the checkpointed iteration", async () => {
  const cwd = tmpCwd();
  let state: ResumeState = loadResumeState(cwd, BRANCH, ISSUE_ID);
  const crashSandbox = fakeSandbox([
    { result: iterationResult({ sessionId: "sess-1" }) },
    { error: new Error("out of credits") },
  ]);

  await assert.rejects(
    runPhase({
      ...RUN_PHASE_DEFAULTS,
      sandbox: crashSandbox,
      cwd,
      resume: false,
      state,
      phase: "implementer",
      maxIterations: 100,
    }),
  );

  // fresh process: reload state from disk, as main.mts would on --resume
  state = loadResumeState(cwd, BRANCH, ISSUE_ID);
  const resumeSandbox = fakeSandbox([
    { result: iterationResult({ sessionId: "sess-2", completionSignal: "<promise>COMPLETE</promise>" }) },
  ]);

  await runPhase({
    ...RUN_PHASE_DEFAULTS,
    sandbox: resumeSandbox,
    cwd,
    resume: true,
    state,
    phase: "implementer",
    maxIterations: 100,
  });

  assert.equal(resumeSandbox.calls.length, 1);
  assert.equal(resumeSandbox.calls[0]!.resumeSession, "sess-1");
  assert.equal(state.implementer.iterationsRun, 2);
});
