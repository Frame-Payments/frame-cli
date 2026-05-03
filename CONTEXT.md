# frame-cli — Domain Language

The Frame CLI is a thin merchant-facing surface over the Frame public API. Every command is a public commitment, so the vocabulary the CLI uses is held to the same canonical-vs-deprecated standard as the rest of the public surface.

The authoritative domain glossary lives in `frame/CONTEXT.md` (the Rails repo). This file captures only the subset a CLI contributor needs in order to name commands, choose flag wording, and review PRs without having to load the full domain.

## Canonical surface (gets CLI commands)

**Account**: the canonical model for any party a merchant transacts with. Capability-driven. `frame accounts create | list | retrieve | update | restrict | unrestrict`.

**Capability**: a discrete permission an Account requests (`card_receive`, `card_send`, `kyc`, `bank_account_receive`, etc.). `frame capabilities request | list | retrieve | disable`.

**Transfer**: the canonical public handle for any money movement, in either direction. `frame transfers create | list | retrieve | update | cancel`.

**Refund**: the reversal of a completed inbound Transfer. `frame refunds create | list | retrieve`.

**Webhook**: a merchant-registered endpoint that receives events. `frame webhooks create | list | retrieve | update | delete`.

**Product**, **Invoice**: standard billing primitives. `frame products *`, `frame invoices *`.

## Deprecated surface (no CLI commands)

**Customer**, **ChargeIntent**, **Payout** are deprecated on the public surface (see `frame/CONTEXT.md` and `frame/docs/adr/0005-account-as-canonical-party-model.md`). They remain wire-compatible on the HTTP API for existing merchants and integrations, but they do **not** get CLI commands.

A merchant who runs `frame customers create` should hit a clear error pointing them at `frame accounts create`. This is a feature, not an oversight — see `frame/docs/adr/0006-cli-canonical-public-surface.md`.

## CLI-specific terms

**sandbox** / **dev mode**: requests made with a `sk_sandbox_*` / `pk_sandbox_*` key, marked `dev_mode: true` on the server. The CLI v1 operates exclusively in this mode (see `frame/docs/adr/0007-cli-sandbox-only-v1.md`). Every command prints `mode: sandbox` and the active merchant as a safety banner.

**live mode**: production traffic with `sk_live_*` keys. Out of scope for the CLI in v1. `frame login` rejects live keys with a clear error.

**CLI session**: a running `frame listen` (or future `frame logs tail`) connection, modeled server-side as a transient `Webhook::Endpoint` with `status: :cli_session`. Auto-deleted by the server when the WebSocket disconnects or the session goes idle for ~5 minutes. CLI contributors should think of a session as ephemeral state — never write code that assumes the session outlives the WebSocket.

**session secret** / **`whsec_cli_*`**: a per-session HMAC secret printed on `frame listen` startup, used to sign forwarded webhooks so the merchant's local server can verify them with normal signature-verification code. Distinct from the merchant's real endpoint secrets.

**trigger event**: a curated event code that `frame trigger <event_code>` can produce. The v1 list is bounded (16 events, all canonical) and is part of the public CLI contract. Adding a trigger event is an intentional act, not an automatic side effect of the OpenAPI spec growing.

**canonical event**: an event code on the `transfer.*`, `account.*`, `capability.*`, `refund.*`, or `invoice.*` namespace. The CLI emits and documents these. Legacy `charge_intent.*`, `payout.*`, `customer.*`, and `charge.*` events still fire in the underlying system (and existing webhook subscribers still receive them), but the CLI does not expose ways to trigger them.

## Reading guide

When in doubt about a domain term: `frame/CONTEXT.md` is the source of truth. When in doubt about whether a CLI command should exist: ADR-0006. When in doubt about whether a feature is in scope: ADR-0007 (sandbox-only). When in doubt about how the streaming transports work: ADR-0008.
