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
| `Notification` | Claude is stopped on a permission prompt — **blocked** |
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

## Three states, not two

`waiting` and `blocked` look similar and are not. `Stop` fires when a turn ends
and it is your move — you can look whenever. `Notification` fires when Claude has
stopped on a permission prompt: nothing is running, and nothing will until you
answer. Only the second is worth walking over for, so the card shows them
differently and only `blocked` is loud.

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

---

# MCP server

The same plugin ships an MCP server, so a session can ask issue-graph things
rather than only being reported on.

It needs the same two variables as the hooks, plus an optional workspace:

```bash
export ISSUE_GRAPH_WORKSPACE=onelegion   # omit to use the default workspace
```

| Tool | Does |
|---|---|
| `list_stages` | The workspace's lifecycle, in pipeline order |
| `get_stage` | An issue's stage, its Linear state, whether they agree, and the next command |
| `set_stage` | Record which stage an issue is on |
| `list_batches` | Queued batches and their progress |
| `next_issue` | Claim the next issue from a batch |
| `report_done` | Mark a claimed issue finished |

## What it will not do

**It never changes a Linear state.** It writes issue-graph's own data only —
stage assignments and batch claims. State transitions belong to Linear's own MCP
or its GitHub automation; a second writer on that field is the failure this whole
design is shaped around.

So `set_stage` records what you assert, and if that disagrees with Linear,
`get_stage` reports the disagreement and changes neither side.

## Batches

A batch is a set of issues handed out one at a time. Create one by selecting
issues on the graph and choosing **Queue N as a batch**.

Only membership is stored. The **order is derived on every read** from the
`blocks` relations, so a blocker is always handed out before what it blocks, and
editing a relation in Linear changes the order without anyone re-queuing.

`next_issue` will not hand you an issue another session holds, and will not hand
you one whose in-batch blockers are unfinished. When it returns nothing it says
which: `done` means the batch is finished, `blocked` means come back shortly.
Only the session holding a claim may `report_done` it.

A session that reconnects and calls `next_issue` again gets **its own claim
back** rather than a second issue.
