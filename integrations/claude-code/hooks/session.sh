#!/usr/bin/env bash
#
# Report this Claude Code session's presence to an issue-graph server.
#
#   session.sh start | beat | idle | blocked | end
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
# Output protocol note: `beat`, `idle` and `end` print nothing.
#
# `idle` runs on Stop, and an earlier version of this comment said Stop has no
# member in Claude Code's hookSpecificOutput union. That is wrong: Stop and
# SubagentStop both accept hookSpecificOutput.additionalContext. It stays
# silent for a different and stronger reason — that field does not annotate
# the turn, it CONTINUES it, under the 8-consecutive-continuation cap. Stop
# firing means the human's move; a presence reporter that decides on its own
# that you do not get your turn back has badly overstepped. Anything that
# should nudge at the end of a turn belongs in a skill the model chooses to
# reach for, not in the hook that reports the session is alive.
#
# `start` is the exception, and the only place this script blocks. SessionStart
# stdout goes into the session's context, so it asks the server for a briefing
# (?context=1) and prints it. That means waiting for the response instead of
# backgrounding the call — once per session, at the moment you are already
# waiting for CLAUDE.md and the skill scan, never mid-turn. A timeout still
# applies and a failure still prints NOTHING: an issue-graph that is down must
# not be able to stop a session from starting.
#
# PostCompact is deliberately not wired. It has no decision control at all in
# Claude Code — same category as SessionEnd — so it cannot inject anything.
# SessionStart covers compaction already: it fires again with source=compact,
# and with no matcher this hook runs for that as it does for resume and fork.

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

# The server's middleware reads the workspace from `?w=`; unset means its
# default. The MCP half has always honoured this variable and this half did
# not, so on a multi-workspace server the sessions landed in one workspace and
# the tools read another.
WS=""
[ -n "${ISSUE_GRAPH_WORKSPACE:-}" ] && WS="w=${ISSUE_GRAPH_WORKSPACE}"

if [ "$ACTION" = "end" ]; then
  curl -fsS -m 3 -X DELETE \
    -H "Authorization: Bearer ${ISSUE_GRAPH_TOKEN}" \
    "${BASE}/api/agent-sessions/${SESSION_ID}${WS:+?$WS}" >/dev/null 2>&1 &
  exit 0
fi

BRANCH=""
if command -v git >/dev/null 2>&1 && [ -n "$CWD" ]; then
  BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  # A detached HEAD reports "HEAD", which names no branch.
  [ "$BRANCH" = "HEAD" ] && BRANCH=""
fi

HOST=$(hostname 2>/dev/null || true)

# `blocked` is NOT the same as `idle`. Stop means the turn ended and it is the
# human's move; Notification means Claude is stopped on a permission prompt and
# nothing is running until someone answers. Only the second is worth
# interrupting anyone for, so the two are reported separately.
STATUS="active"
[ "$ACTION" = "idle" ] && STATUS="waiting"
[ "$ACTION" = "blocked" ] && STATUS="blocked"

# Only SessionStart and an explicit slash command carry a phase. A heartbeat
# sends none, and the server keeps the last one rather than blanking it.
PHASE=""
# A Notification carries the reason in `message` — "Claude needs your
# permission to use Bash", and so on. Verified against a hook already running
# on this machine; it is the field that handler reads too.
if [ "$ACTION" = "blocked" ] && command -v jq >/dev/null 2>&1; then
  PHASE=$(printf '%s' "$HOOK_INPUT" | jq -r '.message // empty' 2>/dev/null | cut -c1-100 || true)
fi
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

if [ "$ACTION" = "start" ]; then
  # Blocking, with a budget: 2s to connect, 5s in total. Anything slower is a
  # server worth fixing, and waiting longer than that to say where a workstream
  # is would cost more than the answer is worth.
  RESPONSE=$(curl -fsS --connect-timeout 2 -m 5 -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ISSUE_GRAPH_TOKEN}" \
    -d "$BODY" \
    "${BASE}/api/agent-sessions?context=1${WS:+&$WS}" 2>/dev/null || true)

  # Plain stdout IS the context for SessionStart, so there is no JSON envelope
  # to build. No jq, an unreachable server, a response without a briefing, or
  # an issue in no workstream all land in the same place: print nothing.
  if [ -n "$RESPONSE" ] && command -v jq >/dev/null 2>&1; then
    printf '%s' "$RESPONSE" | jq -r '.briefing // empty' 2>/dev/null || true
  fi
  exit 0
fi

curl -fsS -m 3 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ISSUE_GRAPH_TOKEN}" \
  -d "$BODY" \
  "${BASE}/api/agent-sessions${WS:+?$WS}" >/dev/null 2>&1 &

exit 0
