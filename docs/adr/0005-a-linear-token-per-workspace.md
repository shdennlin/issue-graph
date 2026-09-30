# 5. A Linear token per workspace

Status: Accepted — 2026-09-30

## Context

ADR 0004 left the browser holding one Linear OAuth token under one key,
`ig-linear-auth-v1`, and named the consequence in its "Revisit when":

> A Linear OAuth token belongs to one workspace installation, and the storage
> key does not record which.

Linear's developer docs say the same thing from the other side: store the
installation id alongside the token "to reliably identify the app across
different workspaces". This app's workspaces each carry their own Linear API
key, so two of them can be two different Linear organisations. With one slot,
connecting in A and writing in B sent A's token for B's issue. After 0004 it
was worse: the app renewed A's token while you were looking at B, so the wrong
credential stayed alive for as long as the tab did.

## Decision

Store the token per issue-graph workspace, under
`ig-linear-auth-v2:<workspaceId>`. That is the same `prefix:<workspaceId>`
shape `ig-notify-log` already uses.

- Every `linearAuth` export that touches the slot takes the workspace as a
  **required** parameter. The module still imports no store, because
  `api.ts` imports it and the dependency has to run one way. The required
  parameter did the enforcement: making it required produced ten `tsc`
  errors, one per call site, and each was fixed from that list. None was
  found by searching.
- `PendingAuth` carries the workspace through the OAuth redirect, so the
  token is stored where Connect was pressed, not wherever `?w=` points when
  the redirect returns. A stash without a workspace predates this change and
  is refused.
- A write records its workspace before its first `await`, so a 401 clears
  the token that write was actually sent with, even if the user switched
  tabs while it was in flight.
- Refresh locks are per workspace (`ig-linear-refresh:<workspaceId>`). Each
  slot rotates its own refresh token, so nothing needs to serialise across
  workspaces.

### Rejected alternative

**Key by Linear's organisation id.** Two workspaces on the same Linear
organisation would then share one Connect. But the organisation is only known
after authorising, from a viewer query made with the new token, and the
frontend has no mapping from workspace to organisation to pick the slot before
a write. That would mean new plumbing to save a click in a case nobody has
yet.

## Consequences

- The unscoped v1 slot cannot say whose token it was, and guessing is what
  this change exists to stop. So it is removed on load, and revoked first if
  it holds a refresh token. Everyone connects once per workspace.
- Two workspaces on the same Linear organisation need a Connect each.
- Settings describes the current workspace's connection, and the Connect
  button is disabled when there is no workspace.

## Revisit when

- **People routinely run several workspaces on one Linear organisation**, and
  the repeated Connect becomes the complaint. At that point, keying by
  organisation id is worth its plumbing.
