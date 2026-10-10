#!/usr/bin/env bash
#
# Seed the OneLegion lifecycle into a running issue-graph.
#
#   ./scripts/seed-onelegion-lifecycle.sh [base-url] [workspace-id]
#
# Nine steps over eight Linear states — which is the point. Two pairs share a
# state ("審查結果" and "實作中" are both In Progress; "等待合併" and "等待 CI"
# are both In Review), so a stage cannot be derived from the state and has to be
# stored. See docs/adr/0002-lifecycle-stage-is-stored-not-derived.md.
#
# Safe to re-run: an existing key returns 409 and is reported, not overwritten.
set -uo pipefail

# Trailing slash stripped: a base of ".../" would produce "//api/lifecycle".
BASE="${1:-http://localhost:31415}"
BASE="${BASE%/}"
WS="${2:-}"
Q=""
[ -n "$WS" ] && Q="?w=$WS"

add() { # name | states (comma-separated) | next command
  local name="$1" states="$2" cmd="$3"
  local states_json cmd_json
  states_json=$(printf '%s' "$states" | jq -R 'split(",") | map(select(length > 0))')
  if [ -z "$cmd" ]; then cmd_json=null; else cmd_json=$(printf '%s' "$cmd" | jq -R .); fi
  local body
  body=$(jq -n --arg name "$name" --argjson states "$states_json" --argjson nextCommand "$cmd_json" \
    '{name: $name, states: $states, nextCommand: $nextCommand}')
  local out code
  out=$(curl -sS -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
        -d "$body" "${BASE}/api/lifecycle${Q}")
  code=$(printf '%s' "$out" | tail -1)
  # `sed '$d'` rather than `head -n -1`: the latter is a GNU extension and
  # macOS head rejects a negative count, which silently broke this error path.
  local payload
  payload=$(printf '%s' "$out" | sed '$d')
  case "$code" in
    201) printf '  ✓ %s\n' "$name" ;;
    409) printf '  = %s (already exists, left alone)\n' "$name" ;;
    *)   printf '  ✗ %s → HTTP %s  %s\n' "$name" "$code" "$payload" ;;
  esac
}

command -v jq >/dev/null || { echo "jq is required"; exit 1; }
# Check the base is really an issue-graph before firing eight writes at it.
# The default backend port is 31415; Vite is 31414 and proxies /api to it.
# curl writes its own code AND the fallback on failure, so keep the tail.
health=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "${BASE}/api/health" 2>/dev/null || echo 000)
health="${health: -3}"
if [ "$health" != "200" ]; then
  echo "No issue-graph at ${BASE} (GET /api/health returned ${health})." >&2
  echo "The backend listens on 31415 by default; Vite is 31414." >&2
  echo "Usage: $0 [base-url] [workspace-id]" >&2
  exit 1
fi

echo "Seeding lifecycle into ${BASE}${Q:+ (workspace ${WS})}"

# English names, deliberately: the key is derived from the name, so an English
# name yields a readable key ("review-spec") that is greppable and stable across
# renames. Display names can be edited in Settings afterwards.
#
# Note steps 4/5 share In Progress and 6/7 share In Review — nine steps over
# eight states, which is exactly why a stage is stored rather than derived.
add "Backlog"        "Backlog"                  ""
add "Planned"        "Todo"                     "/spectra-propose"
add "Spec review"    "Review Spec"              "/spectra-apply"
add "Implementing"   "In Progress"              "/spectra-verify"
add "Result review"  "In Progress"              "gh pr create"
add "Waiting CI"     "In Review"                ""
add "Waiting merge"  "In Review"                "gh pr merge"
add "Done"           "Done,Canceled,Duplicate"  "/spectra-archive"

echo
echo "Current lifecycle:"
curl -sS "${BASE}/api/lifecycle${Q}" | jq -r '.entries[] | "  \(.sortOrder + 1). \(.name)  [\(.states | join(", "))]  \(.nextCommand // "—")"'
