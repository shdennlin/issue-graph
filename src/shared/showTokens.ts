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
 * Attachment kinds the app RENDERS RICHLY — it knows where each belongs, so a
 * `pr` sits beside the pull requests Linear linked itself and a `spec` beside
 * the scanned ones.
 *
 * This list is NOT a whitelist. A kind is a free label, and any other name is
 * accepted and drawn as a row carrying that name. That polarity matters: the
 * known kinds are an ENHANCEMENT, not a gate.
 *
 * An earlier version rejected everything outside this list, on the reasoning
 * that a kind with no renderer behind it is only a synonym for `url`. That
 * described the rendering correctly and drew the wrong conclusion from it. The
 * value of a kind is not what it draws — it is what it NAMES. A field called
 * `runbook` or `incident` tells the person reading the board, and the agent
 * writing it, something that a generic link does not, and it does so whether
 * or not the app has special handling for it.
 *
 * The one thing the list still owes is honesty about which are which: an agent
 * is told these render richly and that anything else renders as a label, so it
 * can reach for the right one when it exists and invent a name when it does
 * not.
 */
export const RICH_LINK_KINDS = ['spec', 'pr', 'ci', 'issue', 'url'] as const

export type RichLinkKind = (typeof RICH_LINK_KINDS)[number]

/** How long a kind name may be, and the shape it must take. Lowercase slug so
 *  two agents writing "Pull Request" and "pull-request" do not create two
 *  kinds that read the same. */
export const LINK_KIND_MAX = 24
export const LINK_KIND_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
