import { execSync } from "node:child_process";

export function integrationBranchFor(issueId: string): string {
  return `sandcastle/${issueId.toLowerCase()}`;
}

export function issueIdFor(branch: string): string {
  return branch.replace(/^sandcastle\//, "").toUpperCase();
}

const MERGE_SUBJECT = /^Merge branch '(sandcastle\/[a-z]+-\d+)'/;

export function parseMergedSliceBranches(subjects: string, integrationBranch: string): string[] {
  const branches = subjects
    .split("\n")
    .map((line) => MERGE_SUBJECT.exec(line.trim())?.[1])
    .filter((branch): branch is string => branch !== undefined && branch !== integrationBranch);
  return [...new Set(branches)].sort();
}

export function renderSlices(slices: { id: string; title: string; branch: string }[], emptyNote: string): string {
  if (slices.length === 0) return emptyNote;
  return slices.map((s) => `- ${s.id}: ${s.title} (\`${s.branch}\`)`).join("\n");
}

function git(repoDir: string, args: string): string {
  return execSync(`git ${args}`, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function ensureIntegrationBranch(repoDir: string, branch: string, base = "main"): void {
  try {
    git(repoDir, `rev-parse --verify --quiet refs/heads/${branch}`);
  } catch {
    git(repoDir, `branch ${branch} ${base}`);
    console.log(`Created integration branch ${branch} from ${base}.`);
  }
}

export function listMergedSlices(repoDir: string, integrationBranch: string, base = "main"): string[] {
  const subjects = git(repoDir, `log --merges --format=%s ${base}..${integrationBranch}`);
  return parseMergedSliceBranches(subjects, integrationBranch);
}

export function isMergedInto(repoDir: string, branch: string, integrationBranch: string): boolean {
  try {
    git(repoDir, `merge-base --is-ancestor ${branch} ${integrationBranch}`);
    return true;
  } catch {
    return false;
  }
}

export function commitsAhead(repoDir: string, branch: string, base: string): number {
  return Number.parseInt(git(repoDir, `rev-list --count ${base}..${branch}`).trim(), 10);
}

export function lockWorktree(repoDir: string, worktreePath: string): void {
  try {
    git(repoDir, `worktree lock --reason sandcastle-sandbox ${JSON.stringify(worktreePath)}`);
  } catch (err) {
    if (!String(err).includes("already locked")) throw err;
  }
}

export function unlockWorktree(repoDir: string, worktreePath: string): void {
  try {
    git(repoDir, `worktree unlock ${JSON.stringify(worktreePath)}`);
  } catch (err) {
    if (!String(err).includes("not locked")) throw err;
  }
}
