// The one vocabulary a stage is configured with.
//
// A stage has ONE list of fields. Each name is just a name; whether the app
// can fill it by itself is a property OF THE NAME, not a second category —
// `pr` is `pr` whether Linear linked it or somebody pasted it.
//
// This used to be two lists, `shows` (a closed set of projections) and
// `fields` (free names expected to be attached), and keeping them apart was a
// mistake with a long tail. The same concept ended up with two spellings
// depending on which list it was in — `pr` vs `pullRequests`, `spec` vs
// `designdocs` — and `stageRender.ts` carried a KIND_TOKEN translation table
// between them, which is the clearest possible admission that they were one
// thing. Worse, `ci` and `note` were legal in BOTH lists, so putting one in
// the wrong place was accepted in silence and produced a stage that expected
// an attachment it never drew.
//
// Separate from `types.ts` because these are runtime values and that file is
// types only — everything imports it with `import type`, and a `const` there
// would force every one of those imports to change for nothing.

/**
 * Field names the app can fill on its own, by reading somewhere else.
 *
 * Closed, and closed for a reason that is not a preference: the app can only
 * fetch what it has a renderer for. A name outside this list is a perfectly
 * good field — it simply has to be attached by hand, which is the ordinary
 * case, not a fallback.
 *
 * `ci` is in this list and today fetches nothing: Linear's `PullRequestCheck`
 * type exists but no query path reaches a PullRequest from an issue, and this
 * app has no GitHub source. It stays here because the renderer exists and
 * becomes a real projection the day a source does, with no stage needing to be
 * reconfigured.
 */
export const AUTO_FIELDS = ['issue', 'session', 'pr', 'spec', 'note', 'blocker', 'ci'] as const

export type AutoField = (typeof AUTO_FIELDS)[number]

export const isAutoField = (name: string): name is AutoField =>
  (AUTO_FIELDS as readonly string[]).includes(name)

/**
 * What each automatic name means, supplied by the app.
 *
 * These are facts about THIS APP, not about anybody's project: what `spec`
 * means here is decided by the design-doc scanner, not by a team convention.
 * So the app owns them, and the workspace's own `field` row overrides one only
 * if somebody writes it.
 *
 * English, like every other string an agent reads. The UI shows them as
 * placeholder text rather than translating them: a sentence defining `pr` sits
 * next to the literal name `pr`, and one translated half of that pair reads
 * worse than neither.
 */
export const AUTO_FIELD_DOC: Record<AutoField, string> = {
  issue: 'A member issue, drawn on the stage its Linear state maps to.',
  session: 'A Claude Code session running on a member issue, reported by the hook plugin.',
  pr: 'A pull request Linear has linked to a member issue, across repositories.',
  spec: 'A design doc the scanner linked to a member issue.',
  note: "This stage's own note — what this step is waiting on.",
  ci: 'A check run. Nothing fetches these yet, so today only attached ones appear.',
  blocker: 'An unfinished issue blocking a member, including ones outside the workstream.',
}

/**
 * What a brand-new stage has before anybody configures it.
 *
 * An empty list was the honest default for the data model and the wrong one
 * for a person: you added a stage, it rendered a blank box, and nothing on
 * screen said that a picker elsewhere was the reason.
 *
 * These two, because they are the only auto fields that place themselves per
 * stage — `issue` via each member's Linear state, `note` from this stage's own
 * note. The other five draw the same list on every stage that has them on, so
 * defaulting them in would make a seven-stage pipeline seven copies of one
 * card.
 */
export const DEFAULT_FIELDS: readonly string[] = ['issue', 'note']

/**
 * Names the app draws in a box of their own rather than as a labelled row.
 *
 * A DIFFERENT property from `AUTO_FIELDS`, and the two are easy to conflate:
 * this is about DRAWING, that is about FETCHING. `url` is drawn specially and
 * is never automatic; `session` and `blocker` are automatic and have no
 * special box for a hand attachment.
 *
 * NOT a whitelist. Any other name is accepted and drawn as a row carrying that
 * name, and that polarity is the whole design: a known name is an ENHANCEMENT,
 * never a gate. An earlier version rejected everything outside this list, on
 * the reasoning that a name with no renderer behind it is only a synonym for
 * `url`. That described the rendering correctly and drew the wrong conclusion:
 * the value of a name is not what it draws, it is what it NAMES.
 */
export const RICH_LINK_KINDS = ['spec', 'pr', 'ci', 'issue', 'url'] as const

export type RichLinkKind = (typeof RICH_LINK_KINDS)[number]

/** How long a name may be, and the shape it must take. Lowercase slug so two
 *  agents writing "Pull Request" and "pull-request" do not create two fields
 *  that read the same. */
export const LINK_KIND_MAX = 24
export const LINK_KIND_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A field name, normalised: lowercase, spaces and underscores folded to
 * hyphens. Null when the result is empty, too long, or not a slug.
 *
 * Lives here rather than in the backend because BOTH sides need it and they
 * have to agree exactly: the editor normalises what you type into a chip, the
 * server normalises what an agent sends, and a stage declaring "Pull Request"
 * must end up meaning the same field as `pull-request`. Two implementations is
 * how those two stop matching. `batchStore.ts` re-exports it so the server's
 * callers are unchanged.
 */
export function normalizeLinkKind(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (v.length === 0 || v.length > LINK_KIND_MAX) return null
  return LINK_KIND_RE.test(v) ? v : null
}
