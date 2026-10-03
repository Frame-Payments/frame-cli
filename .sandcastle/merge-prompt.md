# TASK

Merge every slice branch below into `{{INTEGRATION_BRANCH}}`, the integration branch for Linear issue {{PARENT_ISSUE}} ({{PARENT_TITLE}}). Each slice is one sub-issue's work; the branch name carries its Linear id.

<slices>
{{SLICES}}
</slices>

You are in a worktree checked out on `{{INTEGRATION_BRANCH}}`. Stay on it.

# STATE

A previous session may have left a merge in progress. Read this before acting:

<git-status>

!`git status --short | head -40`

</git-status>

<recent-commits>

!`git log --oneline -10`

</recent-commits>

If `git status` shows unmerged paths, you are mid-merge: finish that merge (step 2 below) before starting the next slice.

# STEPS

Work the slices in the order listed. For each slice branch:

1. **Merge.** `git merge --no-ff --no-edit <branch>`. A clean merge lands as one merge commit; move to step 3. Every merge commit keeps git's default subject, `Merge branch '<branch>' into {{INTEGRATION_BRANCH}}`: the orchestrator reads that subject to know which slices landed.

2. **Resolve conflicts.** Load the **`resolving-merge-conflicts`** skill at `.claude/skills/resolving-merge-conflicts/SKILL.md` and follow it. The intent behind each side is on record: the slice's commit messages (`git log {{INTEGRATION_BRANCH}}..<branch>`) and its Linear issue (`linear issue view <ID>`), and the same for the sibling slices already on `{{INTEGRATION_BRANCH}}`. Preserve both intents. Where the two are irreconcilable, keep the behaviour the parent issue asks for and say so in the merge commit body. Then `git add` the resolved files and `git commit --no-edit`.

3. **Verify.** A merge can be textually clean and semantically broken, so verify every merge, conflicted or not:

   ```bash
   timeout 540 npm run typecheck
   timeout 540 npm run lint
   timeout 540 npm test
   ```

   If anything is red, fix it on `{{INTEGRATION_BRANCH}}` and commit the fix as `fix(<scope>): reconcile <slice> with <sibling>` with a `Refs: {{PARENT_ISSUE}}` trailer. Fix forward; never `git reset` or amend the merge commit away.

4. **Skip only as a last resort.** If a slice cannot be merged without inventing behaviour neither side asked for, `git merge --abort` and continue with the next slice. The skip is reported to a human and costs the parent an iteration, so a conflict you can resolve by reading both sides is never a skip.

# DONE WHEN

- Every slice branch is an ancestor of `{{INTEGRATION_BRANCH}}` (`git merge-base --is-ancestor <branch> HEAD` succeeds), or is listed as skipped with the reason.
- `git status` is clean and no merge is in progress.
- Typecheck, lint and the test suite pass on the final tree.

Then write a short summary: one line per slice (merged or skipped, and why), followed by any fixes you committed. Output `<promise>COMPLETE</promise>` as the **last thing in the run**, closing your final message with no tool call after it. Only that final message is scanned for the tag.

# RULES

- **Never push.** The publisher pushes `{{INTEGRATION_BRANCH}}` after you. Do not `git push`, do not open a PR.
- **Only `{{INTEGRATION_BRANCH}}` changes.** Never check out, reset, rebase, or commit to a slice branch, `main`, or any other branch. `git checkout` is only ever for a conflicted file's side (`--ours` / `--theirs`), never for switching branches.
- **Inspect other revisions in place** with `git show <rev>:<path>` or `git diff <rev>`. Never run `git worktree` in any form (`add`, `remove`, `prune`, `repair`, `lock`): `.git` is shared with the host and every sibling sandbox, and from inside this container their worktrees look deleted, so one `git worktree` call destroys their metadata.
- **Bound every command you run.** The sandbox kills the run after 10 minutes with no output, so give anything slow a ceiling under that: `timeout 540 npm test`.
- Do not comment on or transition Linear issues. The publisher does that once the branch is pushed.
