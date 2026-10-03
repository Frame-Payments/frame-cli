import { execSync } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import type { CreateSandboxOptions, Sandbox } from "@ai-hero/sandcastle";
import { settleWithLimit } from "./concurrency.mts";
import {
  commitsAhead,
  ensureIntegrationBranch,
  integrationBranchFor,
  isMergedInto,
  issueIdFor,
  listMergedSlices,
  lockWorktree,
  renderSlices,
  unlockWorktree,
} from "./integration-branch.mts";
import { listMergedStack } from "./pr-stacks.mts";
import { resolveClaudeToken } from "./require-claude-token.mts";
import {
  allPhasesComplete,
  clearResumeState,
  loadResumeState,
  runPhase,
} from "./resume.mts";
import {
  copyToWorktree,
  lightweightHooks,
  nodeHooks,
  sandcastleDocker,
} from "./sandbox-config.mts";
import { heading, mark, warnLine } from "./terminal.mts";

resolveClaudeToken({ envPath: ".sandcastle/.env", processEnv: process.env });

const MAX_ITERATIONS = 10;
const MAX_PARALLEL_SLICES = 4;
const IMPLEMENTER_MAX_ITERATIONS = 100;
const MERGER_MAX_ITERATIONS = 10;

const PLANNER_MODEL = "claude-sonnet-5";
const IMPLEMENTER_MODEL = "claude-opus-5-5";
const REVIEWER_MODEL = "claude-opus-5-5";
const MERGER_MODEL = "claude-opus-5-5";
const PUBLISHER_MODEL = "claude-haiku-4-5";

const argv = process.argv.slice(2);
const RESUME = argv.includes("--resume");
const rawArgs = argv.filter((a) => a !== "--resume");

const CLI_ISSUE = (rawArgs[0] ?? "").trim().toUpperCase();
if (!CLI_ISSUE) {
  throw new Error(
    "Usage: npm run sandcastle -- <ISSUE_ID> [--resume]\n\n" +
      "Pass a parent issue to work its ready-for-cli-agent sub-issues as slices of one " +
      "integration branch, or a leaf issue to work it alone. See .sandcastle/setup.md.",
  );
}
if (!/^[A-Z]+-\d+$/.test(CLI_ISSUE)) {
  throw new Error(`Invalid issue id: "${rawArgs[0]}". Expected format like FRA-3533.`);
}

type Issue = { id: string; title: string };
type Slice = Issue & { branch: string };
type MergedSlice = Slice & { announced: boolean };

const info = JSON.parse(
  execSync(`linear issue view ${CLI_ISSUE} --json`, { encoding: "utf8" }),
) as {
  identifier: string;
  title: string;
  children?: { nodes?: { identifier: string }[] };
};
const rootIssue: Issue = { id: info.identifier, title: info.title };
const childCount = info.children?.nodes?.length ?? 0;
const parentMode = childCount > 0;

const INTEGRATION_BRANCH = integrationBranchFor(rootIssue.id);
const CWD = process.cwd();

if (parentMode) {
  ensureIntegrationBranch(CWD, INTEGRATION_BRANCH);
  console.log(
    `Parent mode: ${childCount} sub-issue(s) of ${rootIssue.id} land on ${INTEGRATION_BRANCH}.`,
  );
} else {
  console.log(
    `Single-issue mode: ${rootIssue.id} — ${rootIssue.title}. Skipping planner and merger.`,
  );
}

const REPO_SLUG = parentMode
  ? execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
      encoding: "utf8",
    }).trim()
  : "";

const UNANNOUNCED_STATE_TYPES = new Set(["triage", "backlog", "unstarted"]);

function describeMergedSlices(): MergedSlice[] {
  return listMergedSlices(CWD, INTEGRATION_BRANCH).map((branch) => {
    const id = issueIdFor(branch);
    const raw = execSync(
      `linear api '{ issue(id: "${id}") { title state { type } } }'`,
      { encoding: "utf8" },
    );
    const issue = (JSON.parse(raw) as { data: { issue: { title: string; state: { type: string } } } })
      .data.issue;
    return { id, title: issue.title, branch, announced: !UNANNOUNCED_STATE_TYPES.has(issue.state.type) };
  });
}

async function withSandbox<T>(
  options: CreateSandboxOptions,
  work: (sandbox: Sandbox) => Promise<T>,
): Promise<T> {
  const sandbox = await sandcastle.createSandbox(options);
  lockWorktree(CWD, sandbox.worktreePath);
  try {
    return await work(sandbox);
  } finally {
    unlockWorktree(CWD, sandbox.worktreePath);
    await sandbox.close();
  }
}

async function implementAndReview(sandbox: Sandbox, slice: Slice, baseBranch: string) {
  const state = loadResumeState(CWD, slice.branch, slice.id);

  if (RESUME && allPhasesComplete(state)) {
    console.log(`  ${slice.id}: implementer and reviewer already complete (per resume state).`);
    return;
  }

  await runPhase({
    sandbox,
    cwd: CWD,
    resume: RESUME,
    state,
    phase: "implementer",
    maxIterations: IMPLEMENTER_MAX_ITERATIONS,
    name: "implementer",
    agent: sandcastle.claudeCode(IMPLEMENTER_MODEL),
    promptFile: "./.sandcastle/implement-prompt.md",
    promptArgs: {
      TASK_ID: slice.id,
      ISSUE_TITLE: slice.title,
      BRANCH: slice.branch,
      BASE_BRANCH: baseBranch,
    },
  });

  await runPhase({
    sandbox,
    cwd: CWD,
    resume: RESUME,
    state,
    phase: "reviewer",
    maxIterations: 1,
    name: "reviewer",
    agent: sandcastle.claudeCode(REVIEWER_MODEL),
    promptFile: "./.sandcastle/review-prompt.md",
    promptArgs: {
      TASK_ID: slice.id,
      BRANCH: slice.branch,
      BASE_BRANCH: baseBranch,
    },
  });
}

async function publish(
  sandbox: Sandbox,
  issue: Issue,
  branch: string,
  mergedSlices: Slice[],
  landedSlices: Slice[],
) {
  await sandbox.run({
    name: "publisher",
    maxIterations: 1,
    agent: sandcastle.claudeCode(PUBLISHER_MODEL),
    promptFile: "./.sandcastle/publish-prompt.md",
    promptArgs: {
      TASK_ID: issue.id,
      ISSUE_TITLE: issue.title,
      BRANCH: branch,
      MERGED_SLICES: renderSlices(mergedSlices, "(none)"),
      LANDED_SLICES: renderSlices(landedSlices, "(none)"),
    },
  });
}

async function publishIntegrationBranch(sandbox: Sandbox, merged: MergedSlice[]) {
  const unannounced = merged.filter((s) => !s.announced);
  if (unannounced.length === 0) return;
  await publish(sandbox, rootIssue, INTEGRATION_BRANCH, merged, unannounced);
}

async function runSingleIssue() {
  const slice: Slice = { ...rootIssue, branch: INTEGRATION_BRANCH };
  await withSandbox(
    {
      branch: slice.branch,
      baseBranch: "main",
      sandbox: sandcastleDocker(),
      hooks: nodeHooks,
      copyToWorktree,
    },
    async (sandbox) => {
      await implementAndReview(sandbox, slice, "main");
      await publish(sandbox, rootIssue, slice.branch, [], []);
      clearResumeState(CWD, slice.branch);
    },
  );
}

async function catchUpPublish() {
  const merged = describeMergedSlices();
  if (merged.every((s) => s.announced)) return;
  console.log(heading(`\nPublishing slices merged by an earlier run\n`));
  await withSandbox(
    {
      branch: INTEGRATION_BRANCH,
      baseBranch: "main",
      sandbox: sandcastleDocker(),
      hooks: lightweightHooks,
    },
    (sandbox) => publishIntegrationBranch(sandbox, merged),
  );
}

async function plan(): Promise<Slice[]> {
  const mergedSlices = listMergedSlices(CWD, INTEGRATION_BRANCH);
  console.log(
    `Slices already on ${INTEGRATION_BRANCH}:\n${mergedSlices.map((b) => `  ${b}`).join("\n") || "  (none)"}\n`,
  );

  let mergedStack: string;
  try {
    mergedStack = listMergedStack(REPO_SLUG).display;
  } catch (err) {
    throw new Error(
      "Could not list merged sandcastle PRs via `gh pr list`. Refusing to " +
        "plan: an empty merged list would make the planner treat already-" +
        "merged blockers as unresolved and halt every dependent issue. " +
        "Check `gh auth status` and network connectivity.\n\n" + String(err),
    );
  }

  const result = await sandcastle.run({
    hooks: lightweightHooks,
    sandbox: sandcastleDocker(),
    name: "planner",
    maxIterations: 1,
    agent: sandcastle.claudeCode(PLANNER_MODEL),
    promptFile: "./.sandcastle/plan-prompt.md",
    promptArgs: {
      PARENT_ISSUE: rootIssue.id,
      INTEGRATION_BRANCH,
      MERGED_SLICES: mergedSlices.map((b) => `- ${b}`).join("\n") || "(none yet)",
      MERGED_STACK: mergedStack,
    },
  });

  const planMatches = [...result.stdout.matchAll(/<plan>([\s\S]*?)<\/plan>/g)];
  const finalPlan = planMatches.at(-1);
  if (!finalPlan) {
    throw new Error("Planning agent did not produce a <plan> tag.\n\n" + result.stdout);
  }
  const { issues } = JSON.parse(finalPlan[1]!) as { issues: Slice[] };

  const merged = new Set(mergedSlices);
  for (const slice of issues) {
    const expected = integrationBranchFor(slice.id);
    if (slice.branch !== expected) {
      throw new Error(
        `Plan names branch ${slice.branch} for ${slice.id}; slices must use ${expected}.`,
      );
    }
    if (slice.branch === INTEGRATION_BRANCH) {
      throw new Error(`Plan includes the parent ${slice.id} itself as a slice.`);
    }
    if (merged.has(slice.branch)) {
      throw new Error(
        `Plan re-plans ${slice.id}, but ${slice.branch} is already merged into ${INTEGRATION_BRANCH}.`,
      );
    }
  }
  return issues;
}

async function implementSlices(slices: Slice[]): Promise<Slice[]> {
  const settled = await settleWithLimit(slices, MAX_PARALLEL_SLICES, (slice) =>
    withSandbox(
      {
        branch: slice.branch,
        baseBranch: INTEGRATION_BRANCH,
        sandbox: sandcastleDocker(),
        hooks: nodeHooks,
        copyToWorktree,
      },
      (sandbox) => implementAndReview(sandbox, slice, INTEGRATION_BRANCH),
    ),
  );

  const ready: Slice[] = [];
  for (const [i, outcome] of settled.entries()) {
    const slice = slices[i]!;
    if (outcome.status === "rejected") {
      console.error(`  ${mark("failed")} ${slice.id} (${slice.branch}) failed: ${outcome.reason}`);
      console.error(
        `    Progress was checkpointed — rerun with \`npm run sandcastle -- ${rootIssue.id} --resume\` to continue from here.`,
      );
      continue;
    }
    if (commitsAhead(CWD, slice.branch, INTEGRATION_BRANCH) === 0) {
      console.log(`  ${mark("skipped")} ${slice.id}: no commits ahead of ${INTEGRATION_BRANCH}.`);
      continue;
    }
    ready.push(slice);
  }
  return ready;
}

async function mergeAndPublish(slices: Slice[]): Promise<{ landed: Slice[]; mergerFailed: boolean }> {
  return withSandbox(
    {
      branch: INTEGRATION_BRANCH,
      baseBranch: "main",
      sandbox: sandcastleDocker(),
      hooks: nodeHooks,
      copyToWorktree,
    },
    async (sandbox) => {
      let mergerFailed = false;
      try {
        await sandbox.run({
          name: "merger",
          maxIterations: MERGER_MAX_ITERATIONS,
          agent: sandcastle.claudeCode(MERGER_MODEL),
          promptFile: "./.sandcastle/merge-prompt.md",
          promptArgs: {
            PARENT_ISSUE: rootIssue.id,
            PARENT_TITLE: rootIssue.title,
            INTEGRATION_BRANCH,
            SLICES: renderSlices(slices, "(none)"),
          },
        });
      } catch (err) {
        mergerFailed = true;
        console.error(`  ${mark("failed")} merger failed: ${err}`);
      }

      const landed = slices.filter((s) => isMergedInto(CWD, s.branch, INTEGRATION_BRANCH));
      for (const slice of landed) {
        console.log(`  ${mark("ok")} ${slice.id} merged into ${INTEGRATION_BRANCH}`);
        clearResumeState(CWD, slice.branch);
      }
      for (const slice of slices.filter((s) => !landed.includes(s))) {
        console.log(warnLine(`  ⚠ ${slice.id} not merged — see the merger log; a human may need to reconcile ${slice.branch}.`));
      }

      await publishIntegrationBranch(sandbox, describeMergedSlices());
      return { landed, mergerFailed };
    },
  );
}

if (!parentMode) {
  await runSingleIssue();
} else {
  await catchUpPublish();

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(heading(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`));

    const slices = await plan();
    if (slices.length === 0) {
      console.log("No plannable sub-issues. Exiting.");
      break;
    }

    console.log(`Planning complete. ${slices.length} slice(s), up to ${MAX_PARALLEL_SLICES} at a time, off ${INTEGRATION_BRANCH}:`);
    for (const slice of slices) {
      console.log(`  ${slice.id}: ${slice.title} → ${slice.branch}`);
    }

    const ready = await implementSlices(slices);
    if (ready.length === 0) {
      console.log("No slice produced commits this iteration. Exiting.");
      break;
    }

    console.log(heading(`\nMerging ${ready.length} slice(s) into ${INTEGRATION_BRANCH}\n`));
    const { landed, mergerFailed } = await mergeAndPublish(ready);
    if (mergerFailed) {
      console.log(`The merger stopped early. Rerun with \`npm run sandcastle -- ${rootIssue.id} --resume\` to finish the merge.`);
      break;
    }
    if (landed.length === 0) {
      console.log("The merger landed nothing this iteration. Exiting so a human can look.");
      break;
    }
  }
}

console.log("\nAll done.");
