# ISSUES

**Scope:** the sub-issues of parent PRD `{{PARENT_ISSUE}}` that carry the `ready-for-cli-agent` label. That label marks work that lives in the `frame-cli` repo, regardless of which Linear project the issue belongs to. Each sub-issue is one **slice** of the parent's work: it gets its own branch, and the merger folds finished slices into the parent's integration branch `{{INTEGRATION_BRANCH}}` at the end of every iteration. One draft PR, for the parent, ships the whole integration branch.

Here are the open sub-issues tagged `ready-for-cli-agent`:

<issues-json>

!`CHILD_IDS=$(linear issue view "{{PARENT_ISSUE}}" --json | jq -r '.children.nodes[].identifier' | paste -sd, -); linear api '{ issues(filter: {team:{key:{eq:"FRA"}}, labels:{some:{name:{eq:"ready-for-cli-agent"}}}, state:{type:{in:["backlog","unstarted"]}}}, first: 250) { nodes { identifier title description state { name } } } }' | jq --arg ids "$CHILD_IDS" '[.data.issues.nodes[] | select(.identifier as $i | (($ids | split(",")) | index($i)) != null) | {id: .identifier, title, body: .description, state: .state.name}]'`

</issues-json>

Here are the slice branches already merged into `{{INTEGRATION_BRANCH}}`. Their work is on the integration branch, so every slice planned this iteration builds on top of it:

<merged-slices>
{{MERGED_SLICES}}
</merged-slices>

And here are the sandcastle branches whose PR has already been **merged into `main`**, from earlier runs of any parent:

<merged-sandcastle-prs>
{{MERGED_STACK}}
</merged-sandcastle-prs>

**"Done" means merged, not the Linear state.** A merged issue stays in a non-completed Linear state (e.g. `Started`, `QA`) while humans run post-merge steps Sandcastle has no stake in. Never infer blocker status from an issue's Linear state. The only signal that a blocker is resolved is that its `sandcastle/{id-lowercase}` branch appears in `<merged-slices>` or `<merged-sandcastle-prs>` above.

# TASK

Analyze the open sub-issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

The `Blocked by` section in each issue body lists explicit blockers. Trust it as the primary signal; use the rest of the body to spot implicit blockers it missed.

A blocker is **resolved** if its `sandcastle/{id-lowercase}` branch appears in `<merged-slices>` or `<merged-sandcastle-prs>`. Drop resolved blockers from an issue's blocking set entirely. Only **unresolved** blockers count below.

An issue is **plannable** if it has zero unresolved blockers. The count of blockers does not matter, only that every one of them is merged: an issue blocked by three merged slices is plannable, because all three are already on `{{INTEGRATION_BRANCH}}`.

An issue with any unresolved blocker **waits**. If A blocks B and neither is merged, plan **only A** this iteration. All planned slices run concurrently off the same integration branch, so B would start without A's code and the merger would have to reconcile two versions of it. B becomes plannable next iteration, once the merger has folded A into `{{INTEGRATION_BRANCH}}`.

**Skip any issue whose branch appears in `<merged-slices>`.** Its work already landed; re-planning it would redo it.

An issue whose branch exists from an earlier iteration but is absent from `<merged-slices>` is still open work: plan it as usual, and the implementer continues on the existing branch.

For each plannable issue, assign the branch name `sandcastle/{id-lowercase}` (e.g. `sandcastle/fra-6394`).

# OUTPUT

Do all of your reasoning first, before the plan. Check every candidate against `<merged-slices>` while reasoning, so the plan you write is final. Then output the plan as a JSON object wrapped in `<plan>` tags. Emit exactly one `<plan>` block, as the last thing in your answer. Never write a second plan to correct the first; only the final plan block is read, so get it right before writing it.

<plan>
{"issues": [
  {"id": "FRA-6394", "title": "Add the logs tail command", "branch": "sandcastle/fra-6394"},
  {"id": "FRA-6395", "title": "Stream webhook events over ActionCable", "branch": "sandcastle/fra-6395"}
]}
</plan>

Include only plannable issues. If every remaining issue is blocked, or none remain, output an empty issue list:

<plan>
{"issues": []}
</plan>

An empty plan halts the run. It is the correct signal when every remaining sub-issue is waiting on a slice the merger could not land, which needs a human.
