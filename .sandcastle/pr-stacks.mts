import { execSync } from "node:child_process";

// Shared between main.mts (planner) and sentry-fix/main.mts (triage): both
// need to know which sandcastle branches are already in flight (open PR) or
// already merged, and both inherit the same scar tissue — a silently-empty
// list here caused the FRA-4147/4148/4149 duplicate-work incident and the
// FRA-4343 QA-parked-blocker stall. Failures must propagate to the caller,
// which treats them as HARD errors that abort the run.

export type PrRecord = {
  number: number;
  headRefName: string;
  baseRefName: string;
  title: string;
};

export type PrStack = {
  display: string;
  branches: Set<string>;
};

// Pure core: filter to sandcastle/* branches, sort, and render the display
// block the planner/triage prompts embed. `emptyNote` is caller-supplied so
// the open/merged variants keep their distinct human-readable messages.
export function sandcastleStack(prs: PrRecord[], emptyNote: string): PrStack {
  const filtered = prs
    .filter((pr) => pr.headRefName.startsWith("sandcastle/"))
    .sort((a, b) => a.headRefName.localeCompare(b.headRefName));

  const branches = new Set(filtered.map((pr) => pr.headRefName));
  const display =
    filtered.length === 0
      ? emptyNote
      : filtered
          .map(
            (pr) =>
              `- ${pr.headRefName} (base: ${pr.baseRefName}) — PR #${pr.number}: ${pr.title}`,
          )
          .join("\n");
  return { display, branches };
}

function fetchPrs(repo: string, state: "open" | "merged", limit: number): PrRecord[] {
  const raw = execSync(
    `gh pr list --repo ${repo} --state ${state} --limit ${limit} ` +
      `--json number,headRefName,baseRefName,title`,
    { encoding: "utf8" },
  );
  return JSON.parse(raw) as PrRecord[];
}

// Open sandcastle PRs = work already in flight. Computed on the HOST via
// `gh`, which authes with GH_TOKEN over HTTPS regardless of the checkout's
// origin URL form and works for the private repo.
export function listInFlightStack(repo: string): PrStack {
  return sandcastleStack(
    fetchPrs(repo, "open", 200),
    "(none — no open sandcastle PRs on origin)",
  );
}

// Merged sandcastle PRs = work that is "done" from Sandcastle's perspective
// (code is on main), deliberately NOT the issue's Linear state — a merged
// issue parks in QA long after its code lands. `--state merged` accumulates
// over the repo's lifetime; 400 comfortably covers any blocker merged in the
// weeks a dependent issue could still be sitting in the backlog.
export function listMergedStack(repo: string): PrStack {
  return sandcastleStack(
    fetchPrs(repo, "merged", 400),
    "(none — no merged sandcastle PRs on origin)",
  );
}
