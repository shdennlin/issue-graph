// Pure batch logic: ordering, claim eligibility, name validation.
//
// No `bun:sqlite` import, and none allowed — same rule as savedViewStore.ts and
// lifecycleStore.ts. The SQLite half lives in routes/batch.ts and stays thin.
//
// A batch is a set of issues handed to agent sessions one at a time. It stores
// MEMBERSHIP, never order: the order to work in is a topological sort over the
// `blocks` relations, which live on the issues and change whenever someone
// edits a relation in Linear. Storing the order would be a second copy of that
// fact, and it would go stale silently.

import type { NormalizedIssue, NormalizedPullRequest } from '../shared/types.js'
import { SHOW_TOKENS, STAGE_LINK_KINDS } from '../shared/showTokens.js'
import { daysOnStage, isStale } from '../shared/staleness.js'
import type { ShowToken, StageLinkKind } from '../shared/showTokens.js'

export interface BatchRow {
  id: number
  name: string
  created_at: number
  stage_key: string | null
  status: string
  stage_entered_at: number | null
  /** JSON array of agent names/ids. Text column, read tolerantly. */
  assignees: string
}

export type WorkstreamStatus = 'active' | 'archived'

// Re-exported so this module stays the one place the rest of the backend
// imports stage vocabulary from, while the list itself lives in `shared/` —
// the lifecycle editor and the stage renderer need the same one, and the web
// build cannot see `src/backend`.
export { SHOW_TOKENS, STAGE_LINK_KINDS, daysOnStage, isStale }
export type { ShowToken, StageLinkKind }

export interface StageNoteRow {
  batch_id: number
  stage_key: string
  body: string
  updated_at: number
}

export interface StageLinkRow {
  batch_id: number
  stage_key: string
  kind: string
  value: string
  label: string | null
  created_at: number
}

export interface BatchMemberRow {
  batch_id: number
  identifier: string
  claimed_by: string | null
  claimed_at: number | null
  done_at: number | null
}

export const BATCH_NAME_MAX = 80
export const BATCH_MEMBERS_MAX = 200

export function normalizeBatchName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name.length === 0 || name.length > BATCH_NAME_MAX) return null
  return name
}

/** Identifier shape, anchored — this is an identity, not a search over prose. */
const IDENTIFIER_RE = /^[A-Z][A-Z0-9]+-\d+$/

/**
 * Validate and de-duplicate a member list.
 *
 * Uppercased, because a member can arrive from a branch name (lowercase in
 * practice) or from the graph (uppercase), and the two must land on one row.
 */
export function normalizeMembers(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length === 0 || raw.length > BATCH_MEMBERS_MAX) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const id = item.trim().toUpperCase()
    if (!IDENTIFIER_RE.test(id)) return null
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Order the members of a batch so a blocker is always handed out before what it
 * blocks.
 *
 * Only edges BETWEEN members constrain the order — an outside blocker is a
 * reason the issue is not ready, not a reason to reorder the batch, and is
 * reported separately by `unfinishedBlockers`.
 *
 * Ties keep the caller's order, so a batch built from a hand-picked selection
 * comes back in the order it was picked rather than in an arbitrary one.
 *
 * A dependency CYCLE cannot be ordered. Rather than dropping the members
 * involved — which would make a batch quietly lose issues — the cycle's members
 * are appended in their original order. They still get worked; the ordering
 * simply cannot promise anything about them, which is the honest outcome.
 */
export function orderMembers(members: string[], issues: NormalizedIssue[]): string[] {
  const inBatch = new Set(members)
  const byId = new Map(issues.map((i) => [i.identifier, i]))

  // blockers.get(X) = members that must come before X.
  const blockers = new Map<string, Set<string>>()
  for (const id of members) blockers.set(id, new Set())
  for (const id of members) {
    const issue = byId.get(id)
    if (!issue) continue
    for (const rel of issue.relations) {
      // `blocks` reads "this issue blocks the target", so the target depends on
      // this one.
      if (rel.type !== 'blocks') continue
      if (!inBatch.has(rel.targetIdentifier)) continue
      blockers.get(rel.targetIdentifier)?.add(id)
    }
  }

  const out: string[] = []
  const placed = new Set<string>()
  let progress = true
  while (progress && out.length < members.length) {
    progress = false
    for (const id of members) {
      if (placed.has(id)) continue
      const deps = blockers.get(id)
      if (deps && [...deps].some((d) => !placed.has(d))) continue
      out.push(id)
      placed.add(id)
      progress = true
    }
  }
  // Whatever is left is in a cycle. Append rather than drop.
  for (const id of members) if (!placed.has(id)) out.push(id)
  return out
}

/** Members of the batch that block `identifier` and are not done yet. */
export function unfinishedBlockers(
  identifier: string,
  members: BatchMemberRow[],
  issues: NormalizedIssue[],
): string[] {
  const byId = new Map(issues.map((i) => [i.identifier, i]))
  const doneInBatch = new Set(members.filter((m) => m.done_at !== null).map((m) => m.identifier))
  const inBatch = new Set(members.map((m) => m.identifier))
  const out: string[] = []
  for (const m of members) {
    if (m.identifier === identifier) continue
    if (doneInBatch.has(m.identifier)) continue
    const issue = byId.get(m.identifier)
    if (!issue) continue
    const blocksTarget = issue.relations.some(
      (r) => r.type === 'blocks' && r.targetIdentifier === identifier,
    )
    if (blocksTarget && inBatch.has(m.identifier)) out.push(m.identifier)
  }
  return out
}

/**
 * The next member a session should be handed, or null when there is nothing
 * left to hand out.
 *
 * "Handable" means: not done, not already claimed by someone else, and every
 * in-batch blocker finished. A claimed-but-unfinished member is skipped rather
 * than waited for — another session has it, and blocking here would stall a
 * batch on one slow issue.
 *
 * Returns the identifier only; taking the claim is the caller's conditional
 * UPDATE, because deciding and claiming in two steps is exactly the race this
 * has to avoid.
 */
export function nextCandidate(
  members: BatchMemberRow[],
  issues: NormalizedIssue[],
  claimant: string,
): string | null {
  const order = orderMembers(
    members.map((m) => m.identifier),
    issues,
  )
  const byId = new Map(members.map((m) => [m.identifier, m]))
  for (const id of order) {
    const m = byId.get(id)
    if (!m) continue
    if (m.done_at !== null) continue
    // Its own claim is resumable — a session that reconnects should get its
    // issue back rather than a second one.
    if (m.claimed_by !== null && m.claimed_by !== claimant) continue
    if (unfinishedBlockers(id, members, issues).length > 0) continue
    return id
  }
  return null
}

export interface BatchProgress {
  total: number
  done: number
  claimed: number
}

export function batchProgress(members: BatchMemberRow[]): BatchProgress {
  let done = 0
  let claimed = 0
  for (const m of members) {
    if (m.done_at !== null) done++
    else if (m.claimed_by !== null) claimed++
  }
  return { total: members.length, done, claimed }
}


export const ASSIGNEES_MAX = 20
export const NOTE_MAX = 16 * 1024
export const LINK_VALUE_MAX = 1000

/** Two adjectives about the workstream itself. Anything else is refused rather
 *  than coerced, so a typo surfaces instead of silently filing something away. */
export function normalizeStatus(raw: unknown): WorkstreamStatus | null {
  if (raw === 'active' || raw === 'archived') return raw
  return null
}

/** Agent names or ids. Deduped case-sensitively — an agent id is opaque and
 *  two spellings may genuinely be two agents. */
export function normalizeAssignees(raw: unknown): string[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  if (raw.length > ASSIGNEES_MAX) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const v = item.trim()
    if (v.length === 0) continue
    if (v.length > 200) return null
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/**
 * Validate a stage's `shows` list.
 *
 * An unknown token is REJECTED rather than dropped. Dropping it would leave the
 * stage rendering nothing with no explanation — a typo would look exactly like
 * a deliberately empty stage, which is itself a valid configuration.
 */
export function normalizeShows(raw: unknown): ShowToken[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  if (raw.length > SHOW_TOKENS.length) return null
  const seen = new Set<string>()
  const out: ShowToken[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return null
    if (!(SHOW_TOKENS as readonly string[]).includes(item)) return null
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item as ShowToken)
  }
  return out
}

/** Tolerant read of a JSON text column, matching parseStates' contract: a
 *  hand-edited bad row degrades to empty rather than throwing inside a response. */
export function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function normalizeStaleAfterDays(raw: unknown): number | null | undefined {
  if (raw == null) return null
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 3650) return undefined
  return raw
}

export function normalizeNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length > NOTE_MAX) return null
  return raw
}

export function normalizeLinkKind(raw: unknown): StageLinkKind | null {
  return typeof raw === 'string' && (STAGE_LINK_KINDS as readonly string[]).includes(raw)
    ? (raw as StageLinkKind)
    : null
}

export function normalizeLinkValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v.length === 0 || v.length > LINK_VALUE_MAX) return null
  return v
}


export interface PullRequestTally {
  /** PRs whose linkKind says they finish the issue. */
  closesTotal: number
  closesMerged: number
  /** Every linked PR, including the ones that only contribute. */
  total: number
  merged: number
  open: number
  draft: number
  conflicts: number
}

/** Words Linear uses for a landed PR. Kept as a set rather than an enum
 *  because `status` is passed through as Linear reports it. */
const MERGED = new Set(['merged'])
const DRAFT = new Set(['draft'])

/**
 * Count the pull requests across a workstream's members.
 *
 * `closes` and `contributes` are counted SEPARATELY, and the separation is the
 * point. A stack's middle PRs are linked as "contributes"; folding them into
 * one total makes "2 of 5 merged" say nothing about whether the feature is
 * finished. The closes figure is the one that answers that.
 *
 * A PR appearing on two members is counted once — one PR can close several
 * issues, and counting it twice would overstate both the total and the work.
 */
export function tallyPullRequests(issues: { pullRequests?: NormalizedPullRequest[] }[]): PullRequestTally {
  const seen = new Set<string>()
  const t: PullRequestTally = {
    closesTotal: 0,
    closesMerged: 0,
    total: 0,
    merged: 0,
    open: 0,
    draft: 0,
    conflicts: 0,
  }
  for (const issue of issues) {
    for (const pr of issue.pullRequests ?? []) {
      if (seen.has(pr.url)) continue
      seen.add(pr.url)
      const status = (pr.status ?? '').toLowerCase()
      const isMerged = MERGED.has(status)
      t.total++
      if (isMerged) t.merged++
      else if (DRAFT.has(status)) t.draft++
      else t.open++
      if (pr.hasConflicts === true) t.conflicts++
      // Absent linkKind counts as closing: Linear's default magic words close,
      // and treating an unknown as "contributes" would understate completion.
      if ((pr.linkKind ?? 'closes') !== 'contributes') {
        t.closesTotal++
        if (isMerged) t.closesMerged++
      }
    }
  }
  return t
}
