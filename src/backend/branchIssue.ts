// Resolve a git branch name to the Linear issue it is working on.
//
// This lives on the SERVER, not in the hook script, on purpose: the hook only
// reports the branch string it read from git. Parsing rules will need fixing —
// the traps below were all found by measuring real branches, and more will turn
// up — and a rule that lives here can be fixed by restarting the server, while
// one baked into an installed plugin needs every install updated. It also means
// the rules are testable under vitest instead of in bash.
//
// Three traps, each measured against real branches rather than imagined:
//
// 1. CASE. Real branches are lowercase — `fix/one-393-task-failed-status` —
//    because that is the shape Linear's own "copy branch name" produces. The
//    existing ISSUE_ID_RE (frontend/lib/issueLinks.ts, designdoc/scanner.ts) is
//    uppercase-only and matches none of them. It is deliberately NOT reused
//    here: it scans prose, where requiring uppercase is what stops it matching
//    ordinary hyphenated words.
//
// 2. FALSE POSITIVES, which already exist in the repos this will run against.
//    `feat/gemma-4-mtp` yields GEMMA-4 and `feat/nemotron-35-lightning-eval`
//    yields NEMOTRON-35 — both satisfy any `<letters>-<digits>` pattern. The
//    only thing separating a real id from a model name is whether the prefix is
//    a team key the workspace actually has, so resolution REQUIRES that list
//    and returns nothing without it. A wrong attribution is worse than none: it
//    would park a live session on an unrelated issue.
//
// 3. MULTI-ISSUE BRANCHES. `fix/one-371-372-374-l1-tool-calls` carries three
//    issues but yields only ONE-371 — `372` has no letter prefix, so nothing
//    can tell it from a version number or a line count. This is not worked
//    around: the first id is the answer, and the rest are the PR description's
//    job. Linear's own matcher behaves the same way.
//
// A branch with no id is a NORMAL outcome, not an error: plenty of real work
// (`feat/skill-system`, `chore/bump-exploit-tools`) has no ticket, and such a
// session simply does not appear on any card.

/** `<prefix>-<number>` anywhere in the string, case-insensitive. The prefix
 *  must be at least two characters, matching Linear's own team-key rule. */
const CANDIDATE_RE = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]+)-(\d+)(?![A-Za-z0-9])/g

export interface BranchIssueOptions {
  /** Team keys this workspace actually has, e.g. ['ONE', 'VDKR']. Matching is
   *  case-insensitive. An empty list resolves nothing — see trap 2. */
  teamKeys: Iterable<string>
}

/**
 * The issue identifier a branch is working on, uppercased, or null.
 *
 * Returns the FIRST candidate whose prefix is a known team key — not the first
 * candidate overall, so `feat/gemma-4-one-393-fix` still resolves to ONE-393
 * rather than giving up on GEMMA-4.
 */
export function issueFromBranch(
  branch: string | null | undefined,
  { teamKeys }: BranchIssueOptions,
): string | null {
  if (typeof branch !== 'string' || branch.length === 0) return null
  const known = new Set<string>()
  for (const k of teamKeys) {
    if (typeof k === 'string' && k.length > 0) known.add(k.toUpperCase())
  }
  if (known.size === 0) return null

  for (const m of branch.matchAll(CANDIDATE_RE)) {
    const prefix = (m[1] ?? '').toUpperCase()
    const number = m[2] ?? ''
    if (known.has(prefix)) return `${prefix}-${number}`
  }
  return null
}

/**
 * Every known-team candidate in the branch, in order.
 *
 * Only the first is used for attribution (a session works on one issue at a
 * time), but a multi-issue branch is worth being able to report as such rather
 * than silently narrowing.
 */
export function allIssuesFromBranch(
  branch: string | null | undefined,
  { teamKeys }: BranchIssueOptions,
): string[] {
  if (typeof branch !== 'string' || branch.length === 0) return []
  const known = new Set<string>()
  for (const k of teamKeys) {
    if (typeof k === 'string' && k.length > 0) known.add(k.toUpperCase())
  }
  if (known.size === 0) return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const m of branch.matchAll(CANDIDATE_RE)) {
    const prefix = (m[1] ?? '').toUpperCase()
    if (!known.has(prefix)) continue
    const id = `${prefix}-${m[2] ?? ''}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Collect the team keys a workspace has.
 *
 * Workflow states are the better source and are tried first: the cached list
 * covers every team in the workspace, while cached ISSUES only cover whatever
 * the current scope window happens to hold. Deriving keys from issues alone
 * means a team with nothing recent is invisible, and a session on one of its
 * branches silently resolves to nothing.
 *
 * Issues are still folded in as a fallback, for a cache populated before
 * workflow states were stored, or a backend adapter that does not expose them.
 *
 * An empty result resolves nothing downstream, by design — see trap 2 above.
 */
export function teamKeysFrom(
  issues: { team?: { key: string } | null }[],
  workflowStates: { teamKey?: string | null }[] = [],
): string[] {
  const keys = new Set<string>()
  for (const w of workflowStates) {
    const k = w.teamKey
    if (typeof k === 'string' && k.length > 0) keys.add(k.toUpperCase())
  }
  for (const i of issues) {
    const k = i.team?.key
    if (typeof k === 'string' && k.length > 0) keys.add(k.toUpperCase())
  }
  return [...keys]
}
