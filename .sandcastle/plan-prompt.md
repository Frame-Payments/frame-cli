# ISSUES

Here are the open Linear issues tagged `ready-for-cli-agent` in this team. This label is scoped to work that lives in the `frame-cli` repo, regardless of which Linear project the issue belongs to.

<issues-json>

!`linear issue query --team FRA --label ready-for-cli-agent --state backlog --state unstarted --json --limit 0 | jq '[.nodes[] | {id: .identifier, title, body: .description, labels: [.labels.nodes[]?.name], state: .state.name}]'`

</issues-json>

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

The `Blocked by` section in each issue body lists explicit blockers. Trust it as the primary signal; use the rest of the body to spot implicit blockers it missed.

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `sandcastle/{id-lowercase}` (e.g. `sandcastle/fra-3462`).

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "FRA-3462", "title": "Fix auth bug", "branch": "sandcastle/fra-3462"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
