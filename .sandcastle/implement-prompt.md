# TASK

Fix Linear issue {{TASK_ID}} ({{ISSUE_TITLE}}).

Pull in the issue using `linear issue view {{TASK_ID}}`. If it has a parent PRD listed in the `Parent` section, pull that in too with `linear issue view <PARENT_ID>`.

Only work on the issue specified.

Work on branch `{{BRANCH}}`, branched from `{{BASE_BRANCH}}`. Make commits and run tests.

If `{{BASE_BRANCH}}` is a `sandcastle/*` branch (not `main`), it is the parent issue's integration branch: this issue is one slice of the parent, and sibling slices already merged there are prerequisites. Treat anything reachable from `{{BASE_BRANCH}}` as existing work — do not re-implement it, do not revert it; build on top. When this slice lands, the merger folds `{{BRANCH}}` back into `{{BASE_BRANCH}}` and the parent's single draft PR carries it.

# PROJECT CONTEXT

This is the **Frame CLI** (`@frame-payments/cli`) — a TypeScript command-line tool for the Frame API, published to npm and Homebrew. Read `README.md` before exploring; it covers the commands, installation and authentication flow.

Stack you'll most often touch:

- **Runtime:** Node 22, ES modules, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **CLI framework:** `commander`; entry point `src/cli.ts`, built with esbuild via `scripts/build.mjs`
- **Networking:** `ws` and `@rails/actioncable` for streaming, `fetch` for HTTP
- **Tests:** Vitest (`npm test`, single file: `npx vitest run <path>`)
- **Lint / format:** ESLint (`npm run lint`), Prettier (`npm run format`)
- **Types:** `npm run typecheck`

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

Use the project's TDD discipline. Load and follow the **`tdd`** skill at `.pi/skills/tdd/SKILL.md` — it carries the red-green-refactor discipline and what makes a test implementation-coupled.

If the task is a hard bug or performance regression, also load the **`diagnose`** skill at `.pi/skills/diagnose/SKILL.md` and build a deterministic feedback loop (failing test, reproduction script, etc.) before patching.

## Standards

Read `CODING_STANDARDS.md` at the repo root **before you write code**. These standards bind the code you write, not just the code you review. Where a standard and existing prior art disagree, the standard wins — the repo carries older code that predates it.

**Ship comment-free code.** Say it with a name, a guard clause, or an extracted function; a constraint the code cannot hold goes in the commit body, not beside the line. This applies to every file you touch, tests included. Comments you find in code you are already changing leave with the edit.

Red-green-refactor loop:

1. **RED**: write one failing test that captures the desired behavior
2. **GREEN**: write the minimal implementation to pass that test
3. **REPEAT** until the issue's acceptance criteria are met
4. **REFACTOR** the code with tests passing

# FEEDBACK LOOPS

Before committing, run:

- `npm run typecheck` — must be clean
- `npm run lint` — must be clean (fix the code to satisfy a rule; `eslint-disable` stays out)
- `npx vitest run <touched tests>` — must pass

Then run the full suite once with `timeout 540 npm test` before your final commit; it is fast enough to run inside the sandbox.

# COMMIT

Make a git commit. The commit message must:

1. Use a **Conventional Commits** subject line:
   `<type>(<scope>): <subject>` where `<type>` is one of `feat`, `fix`,
   `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`, `style`,
   `revert`. Scope is optional but encouraged (e.g. `feat(logs):`).
   Keep the subject under ~72 chars, imperative mood, no trailing period.
2. In the body, cover:
   - What was done and key decisions made
   - Notable files / areas changed
   - Any blockers or notes for the next iteration
3. Reference the Linear issue as a trailer: `Refs: {{TASK_ID}}`.

Keep it concise.

# THE ISSUE

If the task is not complete, leave a comment on the issue describing what was done. Write the comment body to a file first and pass it via `--body-file` so markdown formatting is preserved:

```bash
cat > /tmp/comment.md <<'EOF'
... your progress notes ...
EOF
linear issue comment add {{TASK_ID}} --body-file /tmp/comment.md
```

Do not move the issue to Done — the human reviewer will close it after merging the PR.

Once complete, output `<promise>COMPLETE</promise>` as the **last thing in the run** — closing your final message, with no tool call after it. Only that final message is scanned for the tag, so a tag emitted mid-run and then followed by more work goes unseen and the implementer phase re-runs from scratch in a fresh session. Order it: finish every check, write the summary, then the tag.

# FINAL RULES

- ONLY WORK ON A SINGLE TASK.
- **Bound every command you run.** The sandbox kills the run after 10 minutes with no output, so give anything slow a ceiling under that: `timeout 540 npm test`. Wait loops need the ceiling too — and `pgrep -f <pattern>` matches the waiting loop's own command line, so a loop waiting for a process to disappear waits forever.
- **Inspect other revisions in place** with `git show <rev>:<path>`, `git diff <rev>`, or `git stash`. Never run `git worktree` in any form (`add`, `remove`, `prune`, `repair`, `lock`): `.git` is shared with the host and every sibling sandbox, and from inside this container their worktrees look deleted, so one `git worktree` call destroys their metadata.
- **Never push.** You should only ever be on `{{BRANCH}}` (a `sandcastle/*` worktree branch). Do not `git checkout {{BASE_BRANCH}}`, do not `git checkout main`, do not `git push`, do not force-push. Later steps merge and publish `{{BRANCH}}` for you. If you find yourself thinking about pushing during implementation, stop — leave the commits local.
