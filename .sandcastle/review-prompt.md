# TASK

Review the code changes on branch `{{BRANCH}}` along three axes — spec, standards and simplicity — and leave the branch shippable: every acceptance criterion delivered, every standard met, nothing built beyond the issue.

# CONTEXT

## The issue

Pull the issue this branch implements with `linear issue view {{TASK_ID}}`. If it
lists a parent PRD in its `Parent` section, pull that in too. You need the
acceptance criteria in context before you can judge whether the diff below
actually delivers them.

## Branch diff (vs `{{BASE_BRANCH}}`)

!`BASE={{BASE_BRANCH}}; git rev-parse --verify --quiet "$BASE" >/dev/null || BASE="origin/{{BASE_BRANCH}}"; git diff "$BASE...{{BRANCH}}"`

## Commits on this branch (vs `{{BASE_BRANCH}}`)

!`BASE={{BASE_BRANCH}}; git rev-parse --verify --quiet "$BASE" >/dev/null || BASE="origin/{{BASE_BRANCH}}"; git log "$BASE..{{BRANCH}}" --oneline`

# REVIEW PROCESS

## 1. Understand the change

Read the issue, then the diff and commits above. The issue is the source of intent; the diff is only evidence of what was attempted.

## 2. Run the three reviewers

Write the diff to a file the reviewers can read — they have `Read`, `Grep` and `Glob` only:

```bash
BASE={{BASE_BRANCH}}; git rev-parse --verify --quiet "$BASE" >/dev/null || BASE="origin/{{BASE_BRANCH}}"; git diff "$BASE...{{BRANCH}}" > /tmp/sandcastle-review.diff
```

Then send **one message with three `Agent` calls**, so they run in parallel. Each agent carries its own axis and output contract; the prompt supplies only what it cannot fetch:

- **`standards-reviewer`** — the path `/tmp/sandcastle-review.diff` and the commit list.
- **`spec-reviewer`** — the diff path, the commit list, and the full text of the issue (and its parent PRD, when there is one).
- **`simplicity-reviewer`** — the diff path, the commit list, and the same issue text.

This step is done when all three reports are back.

## 3. Sort the findings

Leave the branch shippable: every finding is either fixed on the branch or named in your report with the reason it stands.

Which findings to act on, by axis:

**Spec.** Act on every criterion `spec-reviewer` reports missing, half-done or built differently than asked, so the branch delivers every acceptance criterion when you finish. Remove scope the issue never asked for.

**Standards.** Fix every `hard` finding. Open `CODING_STANDARDS.md` before fixing it. Where a standard and existing prior art disagree, the standard wins. Fix a `judgement` finding when the fix makes the code clearer. Remove every code comment the branch added or touched; a constraint worth keeping belongs in the commit body.

**Simplicity.** Apply the plain version of every `unjustified` finding. An abstraction with one implementation and no stated requirement comes out; one with two real uses stays. Leave a `question` finding in place and carry it into your report.

**Your own read.** With the reviewers' findings applied, read the diff once more for what no axis owns. An edge case or a security gap you find here is a behaviour change, and goes through step 4:

- names that say what the thing does, and nesting a guard clause would flatten;
- edge cases the tests leave uncovered;
- credential leaks (tokens in logs, argv or error output), unsafe shell interpolation, unchecked `any` or type assertions;
- commands that fail loudly with an actionable message instead of a stack trace.

Explicit code beats compact code. Outside the findings above, the branch's behaviour stays exactly as the implementer left it.

Sort each finding you will act on into one of two kinds before you touch any code:

- **Behaviour change** — the fix alters what the code does, or adds a test for behaviour no test pins yet. Every `spec-reviewer` finding that leads to an edit is one: a criterion missing, half-done or built differently than asked, and a test case the issue calls for. So is a bug or uncovered edge case from the other axes.
- **Refactor** — the fix keeps behaviour exactly as it is: a rename, a predicate in place of a literal, a removed comment, a simplicity cut.

## 4. Behaviour changes go red first

Read `.pi/skills/tdd/SKILL.md` before the first behaviour change. Its seams are already agreed here: test at the public interface the issue names, in the test file that already covers it.

Take one behaviour change at a time, as one red → green cycle:

1. **Red.** Write the one test that pins the behaviour. Run it against the code as the implementer left it, and read the failure: it fails on the assertion, for the reason the finding gives. A test that passes here pins nothing — pick the input that separates the right behaviour from what the branch does now.
2. **Green.** Change the code, minimally. Run the test again and see it pass.
3. **Commit** the pair on its own (see Execution).

When the finding is a missing test for behaviour that is already right, the test passes on its first run, so get red by breaking the code: remove or invert the line the test guards, see the test fail, and restore the line.

A behaviour change is done when its red failure message and its green run are both in your transcript. Carry both into the report.

## 5. Refactors stay green

Run the touched tests before the first refactor and after the last; both runs are green, and no test changes in between.

# EXECUTION

1. Make the changes directly on this branch.
2. Run `npm run typecheck`, `npm run lint` and `npx vitest run <touched tests>`; all three are part of the GREEN bar. Fix the code to satisfy a lint rule; `eslint-disable` stays out. Finish with `timeout 540 npm test`. **Bound every command you run:** the sandbox kills the run after 10 minutes with no output, so give anything slow a ceiling under that.
3. Commit with Conventional Commits subjects and a `Refs: {{TASK_ID}}` trailer:
   - refactors: `refactor(<scope>): ...` or `style(<scope>): ...`;
   - each behaviour change: its own `feat(<scope>): ...`, `fix(<scope>): ...` or `test(<scope>): ...` commit holding the test and the code together. The body opens with `Reviewer-completed:` followed by the criterion or finding it answers and what the implementer's diff had in its place.

When all three reports come back clean and your own read finds nothing, make no commit.

Put this report in your final message, above the completion tag, so a human can see what the review had to do:

```
<review-report>
behaviour changes: <criterion or finding> — red: <the failure message you saw> — <commit sha> | none
scope removed: <what> | none
simplicity cuts: <what left> | none
open questions: <simplicity `question` findings and anything left standing, with the reason> | none
</review-report>
```

This branch is merged and published by later steps — do not push, merge, or open a PR yourself.

Inspect other revisions in place with `git show <rev>:<path>`, `git diff <rev>`, or `git stash`. Never run `git worktree` in any form (`add`, `remove`, `prune`, `repair`, `lock`): `.git` is shared with the host and every sibling sandbox, and from inside this container their worktrees look deleted, so one `git worktree` call destroys their metadata.

Once complete, output `<promise>COMPLETE</promise>` as the **last thing in the run** — closing your final message, with no tool call after it. Only that final message is scanned for the tag.
