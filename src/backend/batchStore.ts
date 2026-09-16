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

import type { NormalizedIssue } from '../shared/types.js'

export interface BatchRow {
  id: number
  name: string
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
