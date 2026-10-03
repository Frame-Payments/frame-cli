# One draft PR per parent issue, assembled by a merger step

A Sandcastle run scoped to a parent issue works each `ready-for-agent`
sub-issue as a **slice** on its own `sandcastle/{id}` branch, then a merger
agent folds the finished slices into one **integration branch**
(`sandcastle/{parent-id}`, off `main`) and a single draft PR for the parent
ships that branch. Slices never get their own PR.

## Considered Options

- **Stacked PRs (previous model).** Every slice opened its own draft PR; a
  blocked slice targeted its blocker's branch. Humans merged the stack bottom-
  up, and the planner could only stack one level (a slice with two in-flight
  blockers had to wait for both to reach `main`). Dropped: the review burden
  scaled with slice count, and multi-blocked slices stalled whole parents.
- **Shippable batches (reverted in #5039).** A large orchestrator partitioned
  the parent into batches with a dependency graph and adopted in-flight
  branches. Dropped for weight: ~10k lines of orchestration for a problem the
  merge step below solves with git.
- **Merger step (chosen).** After each iteration's slices are implemented and
  reviewed, one agent on the integration branch runs `git merge --no-ff` per
  slice, resolves conflicts, verifies with the touched specs, and a publisher
  pushes the integration branch and opens or refreshes the parent's draft PR.

## Consequences

- **Blocked slices wait one iteration, not one human merge.** A blocker is
  resolved once its branch is an ancestor of the integration branch, so the
  planner has no stacking rules and no multi-blocked case: an issue is
  plannable when every blocker is merged.
- **Every slice branches from the integration branch**, so it sees its
  siblings' landed work. `createSandbox` ignores `baseBranch` for a branch
  that already exists, so a slice re-planned after a failed iteration
  continues on its old branch.
- **The merger may skip a slice** it cannot merge without inventing behaviour.
  The orchestrator detects that with `git merge-base --is-ancestor`, reports
  it, and stops the run when an iteration lands nothing; the skipped slice
  needs a human.
- **A slice counts as landed only through its merge commit.** The planner's
  merged list comes from `Merge branch 'sandcastle/<id>'` subjects on the
  integration branch, never from branch ancestry: a slice branch with no
  commits yet is an ancestor of the integration branch too.
- **Every sandbox worktree is locked while it runs.** The containers share the
  host's `.git`, and from inside one every other worktree looks deleted, so a
  single `git worktree` call in a container prunes the metadata of every
  worktree on the machine. Sandcastle then deletes its own now-unregistered
  worktree directories on the next startup. The lock stops the prune; the
  prompts also forbid `git worktree` outright, since a lock only covers
  sandcastle's own worktrees.
- **At most four slices run at once.** Each slice boots Rails and runs specs;
  unbounded fan-out starved the Docker VM until spec runs outlasted the
  agent idle timeout.
- **`--resume` covers the implementer and reviewer only.** The merger and
  publisher are re-run wholesale: merging an already-merged slice is a no-op,
  and the publisher updates an existing PR instead of opening a second one.
- **A run needs an issue id.** The old "plan across every `ready-for-agent`
  issue" mode had no parent to integrate into and is gone.
