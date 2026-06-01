# Frame CLI

**Sandbox developer tooling for the [Frame](https://framepayments.com) API** — sandbox only

Simulate payments and forward webhook events to a local server — all against the Frame sandbox, without touching live keys.

---

## Install

```bash
brew install Frame-Payments/tap/frame
```

Or tap first, then install:

```bash
brew tap Frame-Payments/tap
brew install frame
```

**Requirements:** Homebrew (npm distribution coming — tracked in FRA-4028).

---

## Quickstart

```bash
# 1. Authenticate (stores credentials at ~/.config/frame/credentials.json, mode 0600)
frame login

# 2. Forward sandbox webhook events to your local server
#    Run in the background so your terminal stays free
frame listen --forward-to http://localhost:3000/webhooks &

# 3. Drive sandbox traffic via your normal API/SDK calls or the dashboard
#    — events flow to your local server through the listener above.
```

Your local server receives webhook payloads within seconds of the events being produced in sandbox.

---

## Commands

| Command | Description |
|---|---|
| [`frame login`](https://github.com/Frame-Payments/frame-cli#readme) | Authenticate with your Frame sandbox API key |
| [`frame logout`](https://github.com/Frame-Payments/frame-cli#readme) | Remove the stored Frame credential |
| [`frame whoami`](https://github.com/Frame-Payments/frame-cli#readme) | Show the currently authenticated merchant |
| [`frame listen`](https://github.com/Frame-Payments/frame-cli#readme) | Forward sandbox webhook events to a local URL |
| [`frame events resend <evt_id>`](https://github.com/Frame-Payments/frame-cli#readme) | Re-deliver a previously emitted event verbatim |
| [`frame open [page]`](https://github.com/Frame-Payments/frame-cli#readme) | Open a dashboard page in the default browser |

Run `frame <command> --help` for options and examples on any command.

---

## For AI agents

A machine-readable skill for AI coding agents (Cursor, Claude, Copilot, etc.) ships inside this package:

```bash
npx skills add Frame-Payments/frame-cli
```

Or browse the skill directly at:
[skills.sh/Frame-Payments/frame-cli/frame-cli](https://skills.sh/Frame-Payments/frame-cli/frame-cli)

The skill documents all 7 commands, end-to-end workflows, and common gotchas (blocking commands, deprecated vocabulary redirects).

---

## Sandbox only

The Frame CLI operates exclusively in sandbox mode. **Live API keys are rejected.** Every command prints a `mode: sandbox` banner alongside the active merchant — a deliberate safety signal, not a bug.

Live-mode support is out of scope for v1. See [ADR-0007](docs/adr/../../../frame/docs/adr/0007-cli-sandbox-only-v1.md) for the rationale.

---

## Contributing

Start with [`CONTEXT.md`](./CONTEXT.md) for the canonical-vs-deprecated vocabulary rules, then browse [`docs/adr/`](./docs/adr/) for architectural decisions.

**Adding a new subcommand?** Ship all three surfaces:

1. **Implementation** — `src/commands/<name>.ts` registered in `src/cli.ts`
2. **`--help` example** — at least one `Examples:` block via `.addHelpText("after", …)`
3. **`skills/frame-cli/SKILL.md` entry** — document the command in the Per-command details section

A CI test validates the skill frontmatter.

---

## License

MIT
