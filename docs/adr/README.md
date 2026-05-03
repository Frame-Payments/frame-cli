# Architectural Decisions

The Frame CLI is governed by ADRs that live in the Rails repo (`frame/docs/adr/`), because they are joint Rails + CLI decisions and the underlying infrastructure (event emission, ActionCable channels, request-log table, OpenAPI spec) lives there. Duplicating them here would create drift.

This file is a pointer index. CLI-internal ADRs — decisions that affect only the CLI codebase — will be added to this directory as `0001-*.md`, `0002-*.md`, etc. as they're made.

## CLI-internal decisions

- **[ADR-0001](./0001-bundled-agent-skill.md)** — The Frame CLI bundles an agentskills.io-compliant `skills/frame-cli/SKILL.md` inside the npm tarball, installable via `npx skills add Frame-Payments/frame-cli`. The skill's `description` and documented surface are public contract.

- **[ADR-0002](./0002-api-response-types-mirror-wire-format.md)** — API response types mirror the wire format (snake_case). Internal/domain types stay camelCase. Translation happens explicitly at the call site, never in a hidden helper or codegen transform.

## Inherited decisions (live in `frame/docs/adr/`)

- **[ADR-0006](../../../frame/docs/adr/0006-cli-canonical-public-surface.md)** — The Frame CLI exposes only the canonical public surface (Transfer, Account, Capability, Refund, Webhook, Product, Invoice). Deprecated public terms (Customer, ChargeIntent, Payout) do not get CLI commands.

- **[ADR-0007](../../../frame/docs/adr/0007-cli-sandbox-only-v1.md)** — The Frame CLI is sandbox-only in v1. Live mode is deferred until a separate threat model is done.

- **[ADR-0008](../../../frame/docs/adr/0008-actioncable-cli-streaming-transport.md)** — ActionCable is the streaming transport for `logs tail` and `listen`. SSE, raw WebSocket, gRPC, and AnyCable were considered.

## When to add a CLI-internal ADR

Same bar as the Rails repo (see `frame/.pi/skills/grill-with-docs/ADR-FORMAT.md`): only when **all three** are true.

1. Hard to reverse.
2. Surprising without context — a future contributor will read the code and wonder why.
3. The result of a real trade-off — there were genuine alternatives.

Decisions made during the v1 design (Commander over oclif, esbuild over Bun-compile, OS keyring via `keytar`, lazy dynamic-import per command) are documented in the v1 plan but are *not* recorded as ADRs — they're either reversible or unsurprising. They graduate to ADRs only if a future contributor genuinely re-litigates them.
