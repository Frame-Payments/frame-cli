# Sandcastle Setup

## Environment File

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

Fill in the variables listed in [.env.example](./.env.example).

> The agents authenticate with a Claude Code OAuth token so runs bill against
> your Claude subscription. Do **not** also set `ANTHROPIC_API_KEY` — if it is
> present, Claude Code prefers it and bills the API instead.

### Getting the Keys

**Linear API Key**
https://linear.app/framepayments/settings/account/security

**Claude Code OAuth Token**
Run `claude setup-token` and paste the result. It must be a line in
`.sandcastle/.env` (a shell export is ignored — sandcastle only injects keys it
finds in that file).

**GH Token**
- Must be scoped to the `Frame` organization
- After creating, reach out in #devs to have someone approve it

Required permissions (scoped to `Frame-Payments/frame-cli`):

| Permission | Access |
|---|---|
| Contents | Read and write |
| Issues | Read and write |
| Metadata | Read-only (required) |
| Pull requests | Read and write |

## Docker Image

Build once, and **rebuild whenever `.sandcastle/Dockerfile` changes** — the
image bakes in the `claude` CLI the agents run:

```bash
npx sandcastle docker build-image
```

## Hands-off AI Workflow

```bash
brew install schpet/tap/linear
linear auth login

claude
  /grill-with-docs
  /to-prd
  /to-issues FRA-XXXX

npm run sandcastle -- FRA-XXXX            # parent with sub-issues: each ready-for-cli-agent
                                          # sub-issue is a slice; slices are merged into
                                          # sandcastle/fra-xxxx and one draft PR opens
npm run sandcastle -- FRA-YYYY            # leaf issue: implement, review, publish alone
npm run sandcastle -- FRA-XXXX --resume   # continue a run that stopped mid-implementer
```

A parent run loops: plan the unblocked sub-issues, implement and review each
on its own branch in parallel, merge them into the integration branch, push
and open or refresh the parent's draft PR, then plan again so newly unblocked
sub-issues pick up the merged work. It stops when nothing is plannable or an
iteration lands nothing. See [decisions/0002](./decisions/0002-one-pr-per-parent-issue.md).

Run one parent at a time. Two runs share one `.git` and one Docker VM, and
together they starve each other's sandboxes.

## Checks

```bash
npm run sandcastle:test        # unit tests for the orchestrator helpers
npm run sandcastle:typecheck   # tsc over .sandcastle/*.mts
```
