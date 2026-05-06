---
name: frame-cli
description: >
  Drive the Frame sandbox CLI to test webhook integrations and debug
  server-side logic — without touching live mode. Use this skill when the user
  wants to tail sandbox logs, listen for webhooks, resend past sandbox events,
  authenticate the CLI, or open the Frame dashboard. Also activates for legacy
  Frame vocabulary: customer, charge_intent, payout, charge — all map to
  canonical surfaces (accounts, transfers, refunds). Sandbox-only: live
  credentials are rejected at runtime. Core commands: frame login, frame logout,
  frame whoami, frame listen, frame logs tail, frame events resend <evt_id>,
  frame open [page].
compatibility: >
  Requires `frame` on PATH (npm install -g @framepayments/cli). Reads/writes OS
  keychain (keytar) for credential storage — may fail in headless containers
  without a keyring daemon. Requires outbound network access to the Frame sandbox
  API (api.framepayments.com).
allowed-tools: Bash(frame:*)
---

## What this is

The Frame CLI (`frame`) is a sandbox-only developer tool for driving the Frame
API. It lets you authenticate, forward webhook events to a local server, tail
structured logs, resend past events, and open the Frame dashboard — all against
the sandbox environment.

**v1 scope note.** The CLI does not currently include a command to provoke
Frame-initiated state transitions (account restriction, capability decisions,
processor-driven settlement). Drive sandbox traffic through your normal API/SDK
calls or the dashboard; the listener and log stream surface the resulting
events. A scenario-shaped sandbox simulation API is on the roadmap.

**Sandbox-only.** Live API keys are rejected. Every operation targets the Frame
sandbox.

---

## Prerequisites

```bash
# Install
npm install -g @framepayments/cli   # or: npx @framepayments/cli <cmd>

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
| `frame logs tail` | Stream sandbox log entries in real time |
| `frame events resend <evt_id>` | Resend a past sandbox event by ID |
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

### `frame logs tail`
Streams structured sandbox log entries in real time. Supports filtering:

```bash
frame logs tail --filter-status 4xx,5xx
frame logs tail --filter-path /webhooks
frame logs tail --json | jq '.url'
```

**This command blocks until Ctrl-C.** Background it the same way as
`frame listen` when combining with other commands.

### `frame events resend <evt_id>`
Resends a past sandbox event to your registered webhook endpoints. Use this to
reproduce a flaky delivery without re-triggering the full fixture sequence.

```bash
frame events resend evt_abc123
```

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

Your local server should receive webhook payloads within a few seconds.
Check `frame logs tail` if nothing arrives.

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

### 3. Tail logs filtered to a failing endpoint

Isolate failures without noise from other traffic:

```bash
# Filter by HTTP status (4xx and 5xx only)
frame logs tail --filter-status 4xx,5xx

# Filter by path
frame logs tail --filter-path /webhooks/frame

# Combine filters and pipe to jq for field extraction
frame logs tail --json | jq 'select(.status >= 400) | {url, status, event}'
```

Background `frame logs tail` the same way as `frame listen` when you also need
to trigger events in the same shell session.

---

## Discovering options

Every command has a `--help` flag:

```bash
frame --help
frame listen --help
frame logs tail --help
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

- **Blocking commands must be backgrounded.** `frame listen` and `frame logs tail`
  block the terminal until Ctrl-C. If you invoke them without `&` and then try
  to run another command in the same shell, your session will hang. Always
  background them and capture the PID so you can kill them cleanly.
