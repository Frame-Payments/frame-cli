# Sandcastle agents run on Claude Code, authenticated by a subscription OAuth token

We replaced Codex with Claude Code across all four sandcastle roles (planner,
implementer, reviewer, publisher) and authenticate the agents with a
`CLAUDE_CODE_OAUTH_TOKEN` rather than an `ANTHROPIC_API_KEY`, so runs bill
against a Claude subscription instead of metered API credits.

## Considered Options

- **Codex (status quo).** Required staging `~/.codex/auth.json` into a tmp dir,
  bind-mounting it read-only, and copying it into `$CODEX_HOME` via an
  `onSandboxReady` hook. Dropped — the OAuth path needs none of that machinery.
- **Claude Code + `ANTHROPIC_API_KEY`.** Simpler than the OAuth token in one
  sense (no subscription), but bills per token. Rejected for cost: the
  implementer runs up to 100 iterations per issue, concurrently across every
  unblocked issue.
- **Claude Code + `CLAUDE_CODE_OAUTH_TOKEN` (chosen).** Subscription billing,
  and auth is a single env var that sandcastle injects from `.sandcastle/.env`.

## Consequences

- **The two credentials are mutually exclusive in practice.** If both
  `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` are present, Claude Code
  prefers the API key and silently bills the API — defeating the point. We keep
  only the OAuth token in `.sandcastle/.env`. A startup guard
  (`require-claude-token.mts`) fails loud if the token is missing/empty, because
  sandcastle's `resolveEnv` only injects keys that appear as lines in that file
  (a shell export is ignored), and a bad token would otherwise surface only when
  `claude` fails to authenticate deep inside a parallel sandbox mid-run.
- **The image must carry the `claude` CLI.** `.sandcastle/Dockerfile` installs
  `@anthropic-ai/claude-code`; the image must be rebuilt after this change.
- **Subscription rate/usage limits are the new ceiling.** The implementer runs
  on Opus 5.5. If a multi-issue run hits caps, the first lever is dropping the
  implementer to `claude-sonnet-5` (keeping Opus on the reviewer). Model
  mapping: planner → Sonnet 5, implementer + reviewer + merger → Opus 5.5,
  publisher → Haiku 4.5.
