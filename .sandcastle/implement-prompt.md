# TASK

Fix Linear issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `linear issue view {{TASK_ID}}`. If it has a parent PRD listed in the `Parent` section, pull that in too with `linear issue view <PARENT_ID>`.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

Use the project's TDD discipline. Load and follow the **`tdd`** skill at `.pi/skills/tdd/SKILL.md` — it documents the Frame-specific RSpec conventions (FactoryBot, dry-monads `Success`/`Failure`, AASM, VCR, RuboCop as part of GREEN, no stubbing your own collaborators).

If the task is a hard bug or performance regression, also load the **`diagnose`** skill at `.pi/skills/diagnose/SKILL.md` and build a deterministic feedback loop (failing spec, curl script, etc.) before patching.

Red-green-refactor loop:

1. **RED**: write one failing test that captures the desired behavior
2. **GREEN**: write the minimal implementation to pass that test
3. **REPEAT** until the issue's acceptance criteria are met
4. **REFACTOR** the code with tests passing

# FEEDBACK LOOPS

Before committing, run `npm run typecheck` and `npm run test` to ensure the tests pass.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + Linear issue reference (e.g. `{{TASK_ID}}`)
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is not complete, leave a comment on the issue describing what was done. Write the comment body to a file first and pass it via `--body-file` so markdown formatting is preserved:

```bash
cat > /tmp/comment.md <<'EOF'
... your progress notes ...
EOF
linear issue comment add {{TASK_ID}} --body-file /tmp/comment.md
```

Do not move the issue to Done — that will be done later by the merger.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
