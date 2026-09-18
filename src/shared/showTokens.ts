// The closed vocabularies both sides dispatch on.
//
// Separate from `types.ts` because these are runtime values and that file is
// types only — everything imports it with `import type`, and a `const` there
// would force every one of those imports to change for nothing.
//
// The backend validates writes against these lists; the frontend renders and
// offers them in the lifecycle editor. One list, so the two cannot drift.

/**
 * What a pipeline stage may render.
 *
 * These are PROJECTIONS, not fields: `pullRequests` means "read the members'
 * PRs", never "this stage stores PRs". Which tokens a stage uses is entirely
 * the workspace's choice; the list is closed only because the app can draw
 * nothing it holds no data for. A new source — CI checks, once a GitHub source
 * exists — is a new token here plus one renderer.
 */
export const SHOW_TOKENS = [
  'issues',
  'sessions',
  'pullRequests',
  'designdocs',
  'note',
  'blockers',
  // CI has NO projection: Linear's `PullRequestCheck` type exists but no query
  // path reaches a PullRequest from an issue, and this app has no GitHub
  // source. So this token renders hand-attached runs only — which is honest
  // rather than empty, and becomes a real projection the day a source exists
  // without any stage having to be reconfigured.
  'ci',
] as const

export type ShowToken = (typeof SHOW_TOKENS)[number]

/**
 * What may be attached to a stage by hand, when the upstream link is missing.
 *
 * Each kind exists because it renders somewhere different: a `spec` is a path
 * the design-doc scanner can still read progress from, a `pr` sits beside the
 * projected pull requests, a `ci` is a check run, an `issue` is a ticket that
 * matters at this stage without being a member of the workstream, and a `url`
 * is just a link. Sending a PR as a `url` would put it under the note rather
 * than with the other PRs — and a CI stage need not even show notes.
 *
 * `issue` is the one that is NOT a broken projection. A workstream's members
 * are projected onto every stage already; this is for a ticket that is somebody
 * else's — a dependency in another team, an incident that blocked the merge —
 * which belongs to this stage and to nothing else.
 *
 * Deliberately NOT a CHECK constraint on the table: growing this list should
 * not need a migration. The cost is that a hand-edited row can hold anything,
 * which is why readers ignore an unknown kind rather than failing.
 */
export const STAGE_LINK_KINDS = ['spec', 'pr', 'ci', 'issue', 'url'] as const

export type StageLinkKind = (typeof STAGE_LINK_KINDS)[number]
