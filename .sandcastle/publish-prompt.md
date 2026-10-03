# TASK

Push branch `{{BRANCH}}` to origin and make sure Linear issue {{TASK_ID}} ({{ISSUE_TITLE}}) has one **draft** GitHub pull request for it, targeting `main`. When a draft PR for `{{BRANCH}}` is already open, update it instead of opening another.

`{{BRANCH}}` is either a single issue's branch or a parent issue's integration branch. On an integration branch, the merger has folded these slice branches (one per sub-issue) into it so far:

<merged-slices>
{{MERGED_SLICES}}
</merged-slices>

Of those, these landed in this run and still need their Linear issues updated (step 6):

<landed-slices>
{{LANDED_SLICES}}
</landed-slices>

An empty list means `{{BRANCH}}` is a single issue's branch with no slices.

# STEPS

1. Verify you're on `{{BRANCH}}` and there are commits ahead of `main`:

   ```bash
   CURRENT="$(git rev-parse --abbrev-ref HEAD)"
   echo "on: $CURRENT"
   git log main..{{BRANCH}} --oneline
   ```

   **Hard safety check:** if `$CURRENT` is `main`, `master`, or anything other than `{{BRANCH}}`, **abort immediately**: output `<promise>COMPLETE</promise>` and stop. Do not push, do not switch branches.

   If the branch has no commits ahead of `main`, output `<promise>COMPLETE</promise>` and stop. There is nothing to publish.

2. Push the branch. Only ever push `{{BRANCH}}`:

   ```bash
   git push -u origin {{BRANCH}}
   ```

   Do not use `--force`, `--force-with-lease`, `HEAD:main`, or any refspec that targets a protected branch. If the push fails, report the error and stop; do not work around it.

3. Look for an open PR on this branch:

   ```bash
   gh pr list --head {{BRANCH}} --state open --json number,url --jq '.[0]'
   ```

   Note the number and URL if one exists.

4. Build the PR body. Read the template at `.sandcastle/pr-body-template.md` and substitute the angle-bracketed placeholders:

   - `<SUMMARY>`: one paragraph, in your own words, from the Linear issue and the actual diff (`git diff main...{{BRANCH}} --stat` for the shape). Write only the summary text: it drops into the *italics* after the bold `**AI Generated, Developer to confirm:**` preface already in the template, so leave that preface and the surrounding `*` italics markers in place.
   - `<TASK_ID>`: `{{TASK_ID}}`
   - `<SLICES>`: the `<merged-slices>` list above, verbatim, one bullet per slice. When the list is empty, delete the whole `## Slices` section.
   - `<HOW_TO_TEST>`: numbered steps a reviewer can follow to verify the change; at minimum a step running the suite (`1. npm test`) and, for a command change, the exact `frame ...` invocation and the expected output.

   Leave the `## Walkthrough Demo` section as its literal `TBD/Developer to provide` default. A human fills it in before marking the draft ready.

   Write the rendered body to `/tmp/pr-body.md`. The angle-bracket syntax is used here intentionally so Sandcastle's prompt preprocessor doesn't try to resolve them as prompt arguments.

5. Open or update the draft PR.

   **A PR exists (step 3):** refresh its body and stop here, skipping the Linear comment on {{TASK_ID}}:

   ```bash
   gh pr edit <number> --body-file /tmp/pr-body.md
   ```

   **No PR yet:** compose the title, then open a draft against `main`. The title is conventional-commit style with the Linear id in brackets at the end:

   ```
   <type>(<optional scope>): <description> [{{TASK_ID}}]
   ```

   - `<type>`: one of `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `style`, `revert`; pick the one matching the primary change in the diff, or in the parent issue's whole scope on an integration branch.
   - `(<scope>)`: optional lowercase area (`logs`, `auth`, `ci`, …); omit it when it doesn't sharpen the title.
   - `<description>`: imperative, lowercase, no trailing period; say what the change *does*, derived from {{ISSUE_TITLE}} and the diff, not a copy of the ticket name. When `<merged-slices>` is non-empty, describe the parent issue's whole scope: read it with `linear issue view {{TASK_ID}}` and derive the description from that, not from the diff. The PR opens after the first slice lands and its title is never revisited, so a title drawn from the diff names only that first slice.
   - `[{{TASK_ID}}]`: the Linear identifier in square brackets, always last.

   Example: `feat(logs): tail webhook deliveries over actioncable [FRA-4026]`

   ```bash
   gh pr create \
     --draft \
     --base main \
     --head {{BRANCH}} \
     --title "<composed title>" \
     --body-file /tmp/pr-body.md
   ```

   Capture the PR URL, then comment on {{TASK_ID}} and move it out of the planner's queue:

   ```bash
   cat > /tmp/linear-comment.md <<'EOF'
   Draft PR opened: <PR_URL>

   Marked as draft. A human will review, mark ready, and merge.
   EOF
   linear issue comment add {{TASK_ID}} --body-file /tmp/linear-comment.md
   linear issue start {{TASK_ID}}
   ```

6. For each slice in `<landed-slices>`, tell its Linear issue where the work went and move it out of the planner's queue. Replace `<PR_URL>` with the PR's URL (existing or new):

   ```bash
   cat > /tmp/slice-comment.md <<'EOF'
   Merged into `{{BRANCH}}`, which ships in the parent's draft PR: <PR_URL>
   EOF
   linear issue comment add <SLICE_ID> --body-file /tmp/slice-comment.md
   linear issue start <SLICE_ID>
   ```

   If `linear issue start` fails for any issue, continue; do not retry repeatedly. Note it in that issue's comment so a human can transition it manually.

7. Output `<promise>COMPLETE</promise>`.

# RULES

- **Never push to `main`, `master`, or any other shared branch.** Only ever push `{{BRANCH}}`. No force pushes. No alternative refspecs.
- **Never modify the git remote.** Do not run `git remote set-url`, `git remote add`, or otherwise change `origin`. The sandbox bind-mounts the host repo's `.git`, so changing the remote would corrupt the human's local config. The container is already configured to reach origin over HTTPS + `GH_TOKEN` (ssh URLs are rewritten transparently). If `git push` fails with an auth/host-key error, **report it and stop**.
- Do **not** merge the PR. Do **not** mark it ready for review. Humans do that.
- Do **not** edit code in this step. If something looks wrong, leave it alone: publish as-is and let the human reviewer decide.
- Do **not** close any Linear issue. Humans close them after merging.
