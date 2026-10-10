# 2. The lifecycle stage is stored, not derived

Status: Accepted — 2026-09-16. Implemented 2026-09-21.
Superseded in part by [ADR-0003](0003-a-stage-has-one-field-list.md), which merges
what a stage DRAWS and what it EXPECTS ATTACHED into one list.

> Written before any code existed, and the body below is left as written. Two
> details did not survive implementation, both recorded where the code is: the
> stage belongs to the WORKSTREAM, not the issue (migration 9 in `db.ts` drops the
> `issue_stage` table this record implies, and says why), and the draws/expects
> split became one list (ADR-0003). The decision itself — the thing with no other
> record of its position stores one, the thing Linear already places is derived —
> is what made that first move possible, and every invariant below still holds.

## Context

The app is increasingly driven by Claude Code sessions dispatched by hand — one session
per issue, or per stack of issues. The workflow spans systems: discuss, open the issue,
write the spec change, implement, review, open a PR, wait for CI, merge, close. The
recurring complaint is not that any one step is hard, it is that the answer to *"where is
this issue right now"* is spread across Linear, a terminal tab, and a git branch.

Linear already owns most of it, and owns it well:

- The set of workflow states and their order (`WorkflowState.position`, per team — already
  fetched by `WORKFLOW_STATES_QUERY`).
- Automatic transitions driven by the GitHub integration: PR drafted / opened / review
  requested / ready for merge / merged, configurable per target branch.
- The list of pull requests linked to an issue, across every repository, as attachments.

Three things it cannot express, each measured against a live workspace rather than assumed:

1. **Stages are finer than states.** One team's lifecycle runs to nine steps over eight
   states; `In Progress` alone covers implementing, reviewing the result, opening the PR,
   and waiting for CI. A stage therefore cannot be recovered from the state — the
   information is not there to recover.
2. **Completion can span repositories.** A single issue routinely means several pull
   requests in several repositories (one observed issue carried three). Linear's
   automation fires per PR event and never aggregates, so the first merge moves the issue
   to Done while the rest are still open. There is no "when all linked PRs have merged"
   condition to configure, because the model is one PR to one transition.
3. **Nothing records that a session is alive.** Which agent is working on what, on which
   machine, and whether it is still moving or waiting for a human, is runtime state. It
   has no home in an issue tracker and should not be given one.

The tempting shortcut — derive a stage from the Linear state with a lookup table — was
tried on paper and fails on (1). The second tempting shortcut — hardcode the stage list —
fails the moment a second workspace with a different lifecycle connects, which is the
normal case for this app.

## Decision

**A stage is stored per issue and set explicitly**, by hand or by an agent. It is never
computed from the Linear state.

**Each workspace declares its own lifecycle as configuration**, not code: an ordered list
of stages, each naming the Linear states it is *compatible with* and the command that
advances it. The engine is generic; only the content differs per workspace. The editor is
an ordered list, not a node canvas — the data model is a chain.

Three boundaries hold this together, and each exists because the obvious alternative
produces two writers for one fact:

- **This app never writes a Linear state.** States move through Linear's own MCP or its
  GitHub automation. The MCP surface this app exposes writes only state this app owns.
- **The lifecycle configuration never triggers a write.** It renders and it suggests.
- **Disagreement is displayed, never resolved.** When the stored stage is incompatible
  with the current Linear state, both are shown along with the evidence — the PR
  attachment count — and nothing picks a winner.

That last boundary is what makes gap (2) survivable without weakening anything: Linear
keeps its `On PR merge → Done` automation, the card reads `state: Done · stage: waiting on
merges · 1/3 merged`, and the contradiction is the signal rather than a bug.

Delivery is three slices, in order, because each supplies the vocabulary the next needs:
the configuration and the stage badge; then a Claude Code hook reporting session liveness
to a new endpoint; then a thin MCP adapter over the existing HTTP API, whose only
irreducible job is handing an agent the next issue out of a batch.

## Consequences

The stage will drift from the Linear state. That is accepted: it is shown, not corrected.

The stage and the lifecycle configuration live in `graph.db` but are **not rebuildable** —
nobody can recompute what a person typed. Both must join `annotation`, `saved_view` and
`note` in what a cache reset preserves. Missing this loses them permanently, and silently.
Neither belongs in `workspaces.db`, which holds credentials and the roster.

Reading PR attachments means extending the Linear query, the normalizer, and
`NormalizedIssue` — the usual three layers. It yields cross-repository completion counts
with no GitHub credential. CI check status stays out of reach; Linear does not carry it.

Resolving an issue from a git branch is less reliable than it looks. Real branches are
lowercase, a minority carry no identifier at all, a branch naming several issues links
only the first, and the existing `ISSUE_ID_RE` matches `feat/gemma-4-mtp` as `GEMMA-4`.
Extracted prefixes must be checked against known team keys, and "no issue" must be an
ordinary outcome rather than an error.

Two endpoints will then be reachable from outside an app that has no authentication by
design. The session endpoint needs a shared secret or the same path-scoped exposure the
Linear webhook already uses.

## Revisit when

**A workspace's lifecycle genuinely branches** — parallel stages or conditional routing.
That is the trigger for a node-graph editor, and nothing else is.

**Three or more pull requests are routinely in flight at once.** Then CI status stops
being a passive wait and a GitHub source starts paying for itself.

**A workspace holds two teams whose pipelines genuinely differ.** There is one
lifecycle per workspace, while Linear's workflow states are per team — so today two
teams in one workspace can only share a lifecycle whose compatible-state lists are the
union of both, which loosens conflict detection for each. The additive fix is a nullable
`team_key` on `lifecycle_stage` (null meaning "applies to every team"), and the trigger
is the union becoming loose enough that a conflict stops meaning anything. Not before:
most workspaces are one team, and per-team configuration nobody needs is a second thing
to keep in sync.

**Stages and states converge to one per one.** If a workspace's lifecycle ever collapses
to exactly its Linear states, storing the stage buys nothing there and derivation becomes
the honest answer for that workspace.
