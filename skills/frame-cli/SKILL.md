---
name: frame-cli
description: >
  Drive the Frame sandbox CLI to test webhook integrations and debug
  server-side logic — without touching live mode. Use this skill when the user
  wants to listen for webhooks, resend past sandbox events, authenticate the
  CLI, or open the Frame dashboard. Also activates for legacy Frame vocabulary:
  customer, charge_intent, payout, charge — all map to canonical surfaces
  (accounts, transfers, refunds). Sandbox-only: live credentials are rejected at
  runtime. Core commands: frame login, frame logout, frame whoami, frame listen,
  frame events resend <evt_id>, frame open [page], and resource commands for
  transfers, payment-methods, accounts, capabilities, refunds, webhooks,
  products and invoices.
compatibility: >
  Requires `frame` on PATH (npm install -g @frame-payments/cli). Reads/writes OS
  keychain (keytar) for credential storage — may fail in headless containers
  without a keyring daemon. Requires outbound network access to the Frame sandbox
  API (api.framepayments.com).
allowed-tools: Bash(frame:*)
---

## What this is

The Frame CLI (`frame`) is a sandbox-only developer tool for driving the Frame
API. It lets you authenticate, forward webhook events to a local server, resend
past events, and open the Frame dashboard — all against the sandbox environment.

**v1 scope note.** The CLI does not currently include a command to provoke
Frame-initiated state transitions (account restriction, capability decisions,
processor-driven settlement), nor a command to stream sandbox request logs.
Drive sandbox traffic through your normal API/SDK calls or the dashboard; the
listener surfaces the resulting webhook events. A scenario-shaped sandbox
simulation API and a streaming-logs command are on the roadmap.

**Sandbox-only.** Live API keys are rejected. Every operation targets the Frame
sandbox.

---

## Prerequisites

```bash
# Install
npm install -g @frame-payments/cli   # or: npx @frame-payments/cli <cmd>

# Authenticate (first-run step — stores token in OS keychain)
frame login

# Verify
frame whoami
```

Credentials are stored in the OS keychain via `keytar`. In headless CI
containers you may need to provide a keyring daemon (e.g. `gnome-keyring-daemon`
or `dbus-launch`).

---

## Commands

| Command | What it does |
|---|---|
| `frame login` | Authenticate and store sandbox credentials |
| `frame logout` | Remove stored credentials |
| `frame whoami` | Print the authenticated identity |
| `frame listen` | Forward sandbox webhooks to a local server |
| `frame events resend <evt_id>` | Resend a past sandbox event by ID |
| `frame transfers list` | List Core Transfers |
| `frame transfers retrieve <id>` | Retrieve one Core Transfer |
| `frame transfers create` | Create a Core Transfer |
| `frame transfers confirm\|refund\|capture\|void <id>` | Member actions on a Core Transfer |
| `frame payment-methods create\|list\|retrieve` | Manage PaymentMethods |
| `frame payment-methods block\|unblock\|attach\|detach <id>` | Member actions on a PaymentMethod |
| `frame accounts create\|list\|retrieve` | Manage Accounts |
| `frame capabilities request <account_id> <capabilities...>` | Request Capabilities for an Account |
| `frame refunds create\|list\|retrieve` | Manage Refunds of completed inbound Core Transfers |
| `frame webhooks create <events...>` | Register a Webhook endpoint for the given event codes (`--url`) |
| `frame webhooks list\|retrieve\|update\|delete\|rotate-secret` | Manage Webhook endpoints; `rotate-secret` returns a new signing secret |
| `frame products create\|list\|retrieve\|update\|delete\|search` | Manage Products |
| `frame invoices create\|list\|retrieve\|update\|issue` | Manage Invoices |
| `frame invoices list-line-items <invoice_id>` | List an Invoice's line items |
| `frame invoices create-line-item\|retrieve-line-item\|update-line-item\|delete-line-item` | Manage the line items of a draft Invoice |
| `frame open [page]` | Open a Frame dashboard page in the browser |

---

## Per-command details

### `frame login`
Authenticates against the Frame sandbox. Stores the token in the OS keychain.
Always run this before any other command in a fresh environment.

### `frame logout`
Removes the stored credentials from the OS keychain.

### `frame whoami`
Prints the currently authenticated account. Useful to confirm credentials before
running a fixture sequence.

### `frame listen`
Starts a local webhook listener and forwards events to `--forward-to <url>`.
**This command blocks until Ctrl-C.** Background it when driving other commands
in the same session:

```bash
frame listen --forward-to http://localhost:3000/webhooks &
LISTEN_PID=$!
# ... run other commands ...
kill $LISTEN_PID
```

### `frame events resend <evt_id>`
Resends a past sandbox event to your registered webhook endpoints. Use this to
reproduce a flaky delivery without re-triggering the full fixture sequence.

```bash
frame events resend evt_abc123
```

### `frame transfers list` / `frame transfers retrieve <id>`
Read Core Transfers. Output is a table (id, status, payment status, failure
code, amounts) by default; `--json` prints the raw API body to stdout and
nothing else, so it pipes cleanly into `jq`. API errors print the API's `code`
and message and exit 1; usage errors exit 2. `--base-url` points at another
host (e.g. a local `api.framepayments.test`).

```bash
frame transfers list --limit 10 --type payment
frame transfers retrieve tr_abc123 --json | jq .status
```

### Mutating commands (`create`, member actions, `capabilities request`)
Request-body fields are flags named after the API field, nested fields dotted
(`--profile.individual.name.first_name`); `--body <json-or-@file>` supplies a
raw body that flags override. Every one sends an `Idempotency-Key` header: a
fresh UUID v4, printed on stderr with the banner, or `--idempotency-key <key>`
verbatim. Reuse a key with the same body to replay; the replay prints
`Idempotent-Replay: true` on stderr.

```bash
ACCT=$(frame accounts create --type individual \
  --profile.individual.name.first_name Ada --json | jq -r .id)
frame capabilities request "$ACCT" bank_account_receive
PM=$(frame payment-methods create --type ach --account "$ACCT" \
  --account_number 1234567890 --routing_number 011000015 --account_type checking \
  --json | jq -r .id)
frame transfers create --amount.value 2500 --amount.currency usd \
  --source.payment_method_id "$PM" --confirm --idempotency-key order-42
```

`--wait` on `transfers create` and `transfers confirm` polls the transfer every
`--interval` (default `1s`) until it is `completed`, `failed`, `reversed` or
`canceled`, then prints that final body; progress goes to stderr. Durations
read `500ms`, `5s` or `2m`. After `--timeout` (default `60s`) it exits 3 naming
the last observed status.

```bash
frame transfers create --amount.value 2500 --amount.currency usd \
  --source.payment_method_id "$PM" --confirm --wait --json | jq -r .status
```

### Refunds, webhooks, products and invoices
Same flags, `--json`, errors and `Idempotency-Key` behaviour as above; `update`
and `delete` send `PATCH`/`DELETE` without a key. `frame webhooks create` takes
the event codes as arguments. Invoice line items are verbs on `frame invoices`
taking the invoice id first, and print line item columns.

```bash
frame refunds create --transfer tr_abc123 --amount 500 --reason duplicate
frame webhooks create transfer.completed refund.created --url https://example.com/hooks
frame webhooks rotate-secret we_abc123 --json | jq -r .secret
PROD=$(frame products create --name Mug --default_price 900 --purchase_type one_time \
  --json | jq -r .id)
INV=$(frame invoices create --account "$ACCT" --collection_method request_payment \
  --json | jq -r .id)
frame invoices create-line-item "$INV" --product "$PROD" --quantity 2
frame invoices issue "$INV"
```

`frame customers`, `frame charge-intents` and `frame payouts` are deprecated
resources: they print the canonical command to use and exit non-zero.

### `frame open [page]`
Opens a Frame dashboard page in the default browser. Run without `[page]` to
open the dashboard home.

---

## Workflows

### 1. Verify a webhook integration locally

End-to-end: authenticate → listen in background → drive sandbox traffic via API/dashboard → kill listener.

```bash
# 1. Authenticate (once per environment)
frame login

# 2. Start forwarding webhooks to your local server (background it!)
frame listen --forward-to http://localhost:3000/webhooks &
LISTEN_PID=$!

# 3. Drive sandbox traffic through your normal API/SDK calls or the dashboard.
#    Webhooks flow to your local server through the listener above.

# 4. Stop the listener
kill $LISTEN_PID
```

Your local server should receive webhook payloads within a few seconds. If
nothing arrives, double-check the `--forward-to` URL and that your local server
is up.

### 2. Reproduce a flaky webhook delivery

Use `frame events resend` to replay a past event without re-running the full
fixture sequence:

```bash
# Find the event ID from logs or the dashboard
frame open events

# Resend by ID
frame events resend evt_abc123
```

This replays the exact same payload to all registered webhook endpoints.

---

## Discovering options

Every command has a `--help` flag:

```bash
frame --help
frame listen --help
frame open --help       # lists valid page arguments
```

---

## Gotchas

- **Live key rejection.** The CLI refuses live API keys at startup. If you see
  an authentication error mentioning "live mode", you are using a live key in
  a sandbox-only context. Rotate to a sandbox key.

- **OS keychain in headless containers.** `frame login` and all authenticated
  commands call `keytar`, which requires an OS keyring daemon. In Docker or CI
  containers without a display server, start `gnome-keyring-daemon` or use
  `dbus-launch frame login` to avoid a silent keyring failure.

- **`mode: sandbox` banner.** Every command prints a `mode: sandbox` banner to
  stdout. If you are parsing `frame` output programmatically, add `--json` where
  supported and filter out banner lines, or redirect stderr separately.

- **Blocking commands must be backgrounded.** `frame listen` blocks the
  terminal until Ctrl-C. If you invoke it without `&` and then try to run
  another command in the same shell, your session will hang. Always background
  it and capture the PID so you can kill it cleanly.
