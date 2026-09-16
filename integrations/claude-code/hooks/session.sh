#!/usr/bin/env bash
#
# Report this Claude Code session's presence to an issue-graph server.
#
#   session.sh start | beat | idle | end
#
# Configuration, both required — with either missing the hook does nothing at
# all, silently. That is deliberate: this ships enabled to anyone who installs
# the plugin, and a hook that complained on every prompt in every repo that has
# no issue-graph would be worse than useless.
#
#   ISSUE_GRAPH_URL     e.g. http://localhost:31415
#   ISSUE_GRAPH_TOKEN   must equal the server's AGENT_SESSION_TOKEN
#
# THIS SCRIPT NEVER FAILS A TURN. Every path exits 0, output goes nowhere, and
# the network call is backgrounded with a short timeout. A monitoring hook that
# can block a prompt because a server is down has its priorities backwards.
#
# It deliberately does NOT parse the branch for an issue id. The server does
# that (src/backend/branchIssue.ts), because the rules need fixing over time —
# lowercase ids, model names that look like ids, multi-issue branches — and a
# rule in the server can be fixed by restarting it, while one baked into an
# installed plugin needs every install updated.
#
# Output protocol note: `start`, `beat` and `end` print nothing. `idle` runs on
# the Stop event, which has NO member in Claude Code's hookSpecificOutput union
# — emitting one there fails validation and leaks raw JSON to the model — so it
# stays silent too rather than reaching for a shape that does not apply.

set -uo pipefail

ACTION="${1:-beat}"

# Wire format version. Recorded from the first release: once installs exist in
# the wild this cannot be renegotiated, so the server has to be able to tell an
# old reporter from a new one.
PAYLOAD_VERSION=1

[ -n "${ISSUE_GRAPH_URL:-}" ] || exit 0
[ -n "${ISSUE_GRAPH_TOKEN:-}" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0

# Hook input arrives as JSON on stdin. Read it even when jq is missing, so the
# pipe is drained either way.
HOOK_INPUT=$(cat 2>/dev/null || true)

SESSION_ID=""
CWD=""
if command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
  CWD=$(printf '%s' "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
fi

# Without a session id there is nothing to key a row on.
[ -n "$SESSION_ID" ] || exit 0

# `cwd` may or may not be present in the payload depending on the event; fall
# back to the process's own directory, which is the session's anyway.
[ -n "$CWD" ] || CWD=$(pwd 2>/dev/null || true)

BASE="${ISSUE_GRAPH_URL%/}"

if [ "$ACTION" = "end" ]; then
  curl -fsS -m 3 -X DELETE \
    -H "Authorization: Bearer ${ISSUE_GRAPH_TOKEN}" \
    "${BASE}/api/agent-sessions/${SESSION_ID}" >/dev/null 2>&1 &
  exit 0
fi

BRANCH=""
if command -v git >/dev/null 2>&1 && [ -n "$CWD" ]; then
  BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  # A detached HEAD reports "HEAD", which names no branch.
  [ "$BRANCH" = "HEAD" ] && BRANCH=""
fi

HOST=$(hostname 2>/dev/null || true)

STATUS="active"
[ "$ACTION" = "idle" ] && STATUS="idle"

# Only SessionStart and an explicit slash command carry a phase. A heartbeat
# sends none, and the server keeps the last one rather than blanking it.
PHASE=""
if [ "$ACTION" = "beat" ] && command -v jq >/dev/null 2>&1; then
  PROMPT=$(printf '%s' "$HOOK_INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)
  case "$PROMPT" in
    /*) PHASE=$(printf '%s' "$PROMPT" | awk '{print $1}') ;;
  esac
fi

# Build the body with jq when available so quoting is correct for any path or
# branch name; fall back to a hand-rolled object with the two fields that
# cannot contain a quote.
if command -v jq >/dev/null 2>&1; then
  BODY=$(jq -n \
    --arg sessionId "$SESSION_ID" \
    --arg branch "$BRANCH" \
    --arg cwd "$CWD" \
    --arg host "$HOST" \
    --arg phase "$PHASE" \
    --arg status "$STATUS" \
    --argjson payloadVersion "$PAYLOAD_VERSION" \
    '{sessionId: $sessionId, branch: $branch, cwd: $cwd, host: $host, phase: $phase, status: $status, payloadVersion: $payloadVersion}
     | with_entries(select(.value != ""))' 2>/dev/null || true)
fi
if [ -z "${BODY:-}" ]; then
  BODY="{\"sessionId\":\"${SESSION_ID}\",\"status\":\"${STATUS}\",\"payloadVersion\":${PAYLOAD_VERSION}}"
fi

curl -fsS -m 3 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ISSUE_GRAPH_TOKEN}" \
  -d "$BODY" \
  "${BASE}/api/agent-sessions" >/dev/null 2>&1 &

exit 0
