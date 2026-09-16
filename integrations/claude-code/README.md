# issue-graph — Claude Code plugin

Reports each Claude Code session's presence to an issue-graph server, so the graph
shows which issue is being worked on **right now**, and whether that session is
moving or waiting for you.

This is the one fact an issue tracker structurally cannot hold. Linear knows the
issue's state; it has no field for "a session is live on this, on that machine,
and it last did something two minutes ago" — and it should not grow one, because
that is runtime state, not a work item.

## Why hooks rather than the agent announcing itself

A hook fires whether or not the model cooperates. A session that crashes, or
simply never thinks to mention what it is doing, is still visible — and the
**absence** of heartbeats is what reveals that it died. A marker the agent sets
for itself could only ever show the sessions well-behaved enough not to need
watching.

## Install

```bash
/plugin marketplace add shdennlin/issue-graph
/plugin install issue-graph@issue-graph
```

Then set both variables in your shell profile:

```bash
export ISSUE_GRAPH_URL=http://localhost:31415
export ISSUE_GRAPH_TOKEN=<the server's AGENT_SESSION_TOKEN>
```

**With either variable unset the plugin does nothing at all, silently.** That is
deliberate: it ships enabled to anyone who installs it, and a hook that
complained on every prompt in every repo without an issue-graph would be worse
than useless.

On the server, set the matching secret:

```bash
AGENT_SESSION_TOKEN=<a long random string>
```

**Unset means the endpoint is closed, not open.** This route is meant to be
reachable from outside — the hook runs on your laptop, the server may not be
local — so a deployment without the variable must not quietly accept writes from
anywhere. Expose it the same way you expose the Linear webhook: a path-scoped
tunnel, not the whole app.

## What it sends

| Event | Reports |
|---|---|
| `SessionStart` | session id, branch, cwd, host — the session is alive |
| `UserPromptSubmit` | heartbeat; a leading `/slash-command` is recorded as the phase |
| `PostToolUse` (file edits) | heartbeat |
| `Stop` | the turn ended — it is waiting on you |
| `SessionEnd` | remove the row |

Nothing else. No prompt text, no file contents, no transcript.

## Attributing a session to an issue

The plugin sends the **branch name**; the server extracts the issue id from it
(`src/backend/branchIssue.ts`). Parsing lives there rather than here because the
rules need fixing over time, and a rule in the server can be fixed by restarting
it, while one baked into an installed plugin needs every install updated.

So a session appears on a card when its branch carries an issue id —
`fix/one-393-task-failed-status`, lowercase is fine. **A branch with no id is a
normal outcome**, not an error: plenty of real work has no ticket, and such a
session is simply recorded without appearing anywhere.

Two things the server deliberately will not do:

- **Guess.** A prefix is only accepted if it is a team key the workspace
  actually has. `feat/gemma-4-mtp` looks exactly like an id and is not one;
  parking a live session on an unrelated issue is worse than not showing it.
- **Split a multi-issue branch.** `fix/one-371-372-374-…` resolves to ONE-371
  only — `372` has no prefix and nothing distinguishes it from a version number.
  Linear's own matcher behaves the same way.

## Liveness

A card stops showing a session **15 minutes after its last heartbeat**, not when
`SessionEnd` arrives. A session killed with `SIGKILL`, a closed terminal or a
slept laptop never sends `SessionEnd`; treating its silence as "still running"
would have cards claiming work is in progress days later. `SessionEnd` just
removes the row early.

## It cannot break your session

Every path in `hooks/session.sh` exits 0, output goes nowhere, and the request is
backgrounded with a 3-second timeout. If the server is down, or `curl`/`jq` are
missing, the hook does nothing and your turn proceeds. A monitoring hook that can
block a prompt has its priorities backwards.
