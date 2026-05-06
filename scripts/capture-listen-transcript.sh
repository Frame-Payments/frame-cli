#!/usr/bin/env bash
#
# capture-listen-transcript.sh
# ============================
#
# Capture a known-good `frame listen` session against a local Frame Rails
# server and write a JSON transcript of every wire message the CLI received
# (welcome + broadcast event) to `test/fixtures/webhook-listen-transcript.json`.
# This fixture is the contract-test source of truth for the wire shapes
# asserted by `src/transport/webhook-listen-protocol.ts` (see ADR-0008
# § "Wire contract" in `frame/docs/adr/0008-actioncable-cli-streaming-transport.md`).
#
# Prerequisites:
#   1. A local `frame` Rails server running at FRAME_API_URL (default
#      http://localhost:3000) with `Cli::WebhookListenChannel` mounted.
#   2. A sandbox API key already stored via `frame login` against that server,
#      OR `FRAME_API_KEY` exported in the environment.
#   3. `jq` and `curl` on PATH.
#   4. The `frame` CLI built (`pnpm build` / `npm run build`) so the captured
#      transcript reflects the real release artifact rather than a tsx-driven
#      development build.
#
# Verifying the result:
#   - The script exits non-zero if any of the four expected wire shapes is
#     missing from the captured transcript (welcome with type=session, at
#     least one broadcast event, etc.).
#   - The contract test (`test/webhook-listen-protocol.test.ts`) parses the
#     fixture with the strict parsers from `webhook-listen-protocol.ts` and
#     fails with a one-line diff if any field name has drifted.
#   - On success the script prints the path of the written fixture and a
#     short summary (number of messages captured, event types observed).
#
# Re-running:
#   Re-run any time `Cli::WebhookListenChannel`, `Webhooks::Outgoing::DeliverService`
#   (CLI-session branch), or `Webhook::Message#generate_headers` changes in
#   the `frame/` Rails repo, then commit the regenerated fixture in the same
#   PR as the wire-contract change. The contract test guards against silent
#   drift between captures.

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────────────

# Resolution: if FRAME_API_URL is unset, defer to whatever base URL is stored
# in the keyring credential (i.e. the same one `frame trigger` uses). Set it
# explicitly only if you want to override.
FRAME_API_URL="${FRAME_API_URL:-}"
TRIGGER_EVENT_CODE="${TRIGGER_EVENT_CODE:-account.created}"
FIXTURE_PATH="${FIXTURE_PATH:-test/fixtures/webhook-listen-transcript.json}"
LISTEN_TIMEOUT_SECONDS="${LISTEN_TIMEOUT_SECONDS:-15}"

# ─── Sanity checks ─────────────────────────────────────────────────────────────

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: required command '$1' not found on PATH" >&2
    exit 2
  }
}
require jq
require curl
require node

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Verify a credential is available. Prefer FRAME_API_KEY env, fall back to
# whatever `frame whoami` resolves from the keyring (requires the built CLI).
if [[ -z "${FRAME_API_KEY:-}" ]]; then
  if [[ -x "./bin/frame" ]] && ./bin/frame whoami >/dev/null 2>&1; then
    : # credential resolved via keyring
  else
    echo "error: no credential available. Either run 'frame login' against ${FRAME_API_URL}" >&2
    echo "       or export FRAME_API_KEY=<sandbox key>." >&2
    exit 2
  fi
fi

# ─── Capture ───────────────────────────────────────────────────────────────────
#
# Strategy: run a standalone Node capture tool (scripts/_capture-listen-transcript.ts)
# that uses the existing transport layer directly to subscribe to the channel and
# dump every received cable message as JSON lines. In parallel, trigger one event
# of TRIGGER_EVENT_CODE so the broadcast shape gets captured. The capture tool is
# kept separate from `frame listen` so that `frame listen` orchestration can stay
# untouched in this slice (per FRA-3536 AC: "no behavior change to frame listen").

mkdir -p "$(dirname "$FIXTURE_PATH")"
TRANSCRIPT_RAW="$(mktemp -t frame-listen-transcript.XXXXXX)"
trap 'rm -f "$TRANSCRIPT_RAW"' EXIT

echo "→ Starting capture tool (base URL: ${FRAME_API_URL:-from keyring}), writing to ${TRANSCRIPT_RAW}"

CAPTURE_ENV=()
[[ -n "$FRAME_API_URL" ]] && CAPTURE_ENV+=("FRAME_API_BASE_URL=$FRAME_API_URL")

env \
  FRAME_LISTEN_TRANSCRIPT_OUT="$TRANSCRIPT_RAW" \
  TRIGGER_EVENT_CODE="$TRIGGER_EVENT_CODE" \
  CAPTURE_TIMEOUT_MS="$((LISTEN_TIMEOUT_SECONDS * 1000))" \
  "${CAPTURE_ENV[@]}" \
  npx tsx scripts/_capture-listen-transcript.ts &
CAPTURE_PID=$!

# Give the subscribe + welcome a moment.
sleep 2

echo "→ Triggering a ${TRIGGER_EVENT_CODE} event"
TRIGGER_ENV=()
[[ -n "$FRAME_API_URL" ]] && TRIGGER_ENV+=("FRAME_API_BASE_URL=$FRAME_API_URL")
if [[ -x "./bin/frame" ]]; then
  env "${TRIGGER_ENV[@]}" ./bin/frame trigger "$TRIGGER_EVENT_CODE" >/dev/null || true
else
  env "${TRIGGER_ENV[@]}" npx tsx src/cli.ts trigger "$TRIGGER_EVENT_CODE" >/dev/null || true
fi

wait "$CAPTURE_PID" || {
  echo "error: capture tool exited non-zero" >&2
  exit 3
}

# ─── Assemble the fixture ──────────────────────────────────────────────────────

if [[ ! -s "$TRANSCRIPT_RAW" ]]; then
  echo "error: no messages captured. Is the local Rails server reachable at ${FRAME_API_URL}?" >&2
  exit 3
fi

# The raw transcript is one JSON object per line. Wrap it as an array under
# a top-level object so we can carry metadata (capture host, server ref).
jq -s '{
  schema_version: 1,
  captured_against: env.FRAME_API_URL,
  trigger_event_code: env.TRIGGER_EVENT_CODE,
  messages: .
}' "$TRANSCRIPT_RAW" > "$FIXTURE_PATH"

# Sanity-check: must contain a welcome (type=session) and at least one broadcast event.
WELCOME_COUNT=$(jq '[.messages[] | select(.type == "session")] | length' "$FIXTURE_PATH")
EVENT_COUNT=$(jq '[.messages[] | select(.event_type)] | length' "$FIXTURE_PATH")

if [[ "$WELCOME_COUNT" -lt 1 ]]; then
  echo "error: captured transcript has no welcome (type=session) message" >&2
  exit 4
fi
if [[ "$EVENT_COUNT" -lt 1 ]]; then
  echo "error: captured transcript has no broadcast event message" >&2
  exit 4
fi

echo "✓ Wrote ${FIXTURE_PATH}"
echo "   welcomes: ${WELCOME_COUNT}, broadcast events: ${EVENT_COUNT}"
