// Standing reasons to go and look at a stage.
//
// NOT part of the change log. `notificationHistory.ts` records EVENTS — "ONE-245
// moved to In Review" happened at a time and stays true forever. A nudge is a
// CONDITION: it is true right now and stops being true the moment someone acts
// on it. Storing one would mean it lingered after being resolved, and it would
// need a fake issue identifier and a fake changed-field to fit that row shape.
// So nudges are re-derived on every read and never persisted.
//
// Two signals, deliberately kept apart because they carry different weight:
//
//   stale     a SUSPICION. Nobody has moved this workstream for longer than
//             the stage itself allows. It may be fine; long stages exist.
//   evidence  a PROOF that the stage is lying. Every member is finished in
//             Linear and the stage does not expect finished members.
//
// Nothing here advances anything. A hand-maintained stage is the part of this
// design most likely to rot, and the answer to rot is to say so, not to guess.

import type { GraphData, LifecycleStageDTO, NormalizedIssue, WorkstreamSummaryDTO } from '@shared/types.js'
import { daysOnStage, isStale } from '@shared/staleness.js'

export type NudgeKind = 'evidence' | 'stale'

export interface Nudge {
  /** `(workstreamId, stageKey, kind)` — see `nudgeKey`. */
  key: string
  workstreamId: number
  workstreamName: string
  stageKey: string
  stageName: string
  kind: NudgeKind
  /** Days on the stage, or null when nothing ever set `stageEnteredAt`. */
  days: number | null
}

/**
 * The identity a dismissal is remembered under.
 *
 * A tuple rather than a workstream id, so that dismissing "featB is stale on
 * Spec review" says nothing about featB next week on Implementing. A dismiss
 * has to mean "I know, not now" and never "stop telling me about this
 * workstream" — the second is how a nudge system gets switched off entirely by
 * a user who only meant to quiet one row.
 */
export function nudgeKey(workstreamId: number, stageKey: string, kind: NudgeKind): string {
  return `${workstreamId}:${stageKey}:${kind}`
}

/**
 * Is every member finished while the stage does not expect that?
 *
 * The second half is what keeps this from crying wolf. An earlier version
 * excluded only the LAST stage, on the theory that "everyone done" is the
 * expected end state there. That is too narrow: any stage whose `states` names
 * a finished state — a "Waiting merge" that expects Done while the PR is still
 * open — would have fired on every workstream that reached it. Instead the
 * members' own states answer it: if they are finished AND none of them matches
 * what the stage expects, the stage is behind. A stage with an empty `states`
 * has opted out of the comparison and never fires.
 */
export function stageAdvanceEvidence(members: NormalizedIssue[], stage: LifecycleStageDTO): boolean {
  if (members.length === 0 || stage.states.length === 0) return false
  const expected = new Set(stage.states.map((s) => s.trim().toLowerCase()))
  for (const m of members) {
    const type = m.state.type
    if (type !== 'completed' && type !== 'canceled') return false
    // Finished AND expected here: this stage is where finished members belong,
    // so their being finished proves nothing.
    if (expected.has(m.state.name.trim().toLowerCase())) return false
  }
  return true
}

/**
 * Every nudge the current graph justifies, strongest first.
 *
 * A workstream contributes at most one: evidence outranks staleness, because
 * "the stage is provably behind" is a better reason to look than "it has been
 * a while" and saying both about one row is just saying it twice.
 */
export function computeNudges(data: GraphData, now: number, dismissed: ReadonlySet<string> = new Set()): Nudge[] {
  const stages = data.lifecycle ?? []
  if (stages.length === 0) return []
  const byKey = new Map(stages.map((s) => [s.key, s]))
  const byId = new Map(data.issues.map((i) => [i.identifier, i]))

  const out: Nudge[] = []
  for (const w of data.workstreams ?? []) {
    // Archiving is how you say "stop showing me this". Nudging about an
    // archived workstream would take that back.
    if (w.status === 'archived' || w.stage === null) continue
    const stage = byKey.get(w.stage)
    if (!stage) continue

    const members = w.members
      .map((id) => byId.get(id))
      .filter((i): i is NormalizedIssue => i !== undefined)
    // A member outside the sync window proves nothing either way — it may be
    // finished or may be untouched — so the evidence signal stays silent
    // rather than guessing.
    const allCached = members.length === w.members.length

    const kind: NudgeKind | null =
      allCached && stageAdvanceEvidence(members, stage)
        ? 'evidence'
        : isStale(w.stageEnteredAt, stage.staleAfterDays, now)
          ? 'stale'
          : null
    if (kind === null) continue

    const key = nudgeKey(w.id, stage.key, kind)
    if (dismissed.has(key)) continue
    out.push({
      key,
      workstreamId: w.id,
      workstreamName: w.name,
      stageKey: stage.key,
      stageName: stage.name,
      kind,
      days: daysOnStage(w.stageEnteredAt, now),
    })
  }

  // Evidence first, then the longest-stalled — the top of the list should be
  // the thing most worth doing something about.
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'evidence' ? -1 : 1
    return (b.days ?? -1) - (a.days ?? -1)
  })
}

/**
 * Dismissals worth keeping.
 *
 * A key whose workstream is gone can never match again, so it would sit in
 * localStorage forever. Pruned on read rather than on delete: a workstream can
 * also disappear by being archived elsewhere, and there is no event here to
 * hang a cleanup on.
 */
export function pruneDismissals(
  dismissed: ReadonlySet<string>,
  workstreams: WorkstreamSummaryDTO[],
): string[] {
  const live = new Set(workstreams.map((w) => String(w.id)))
  return [...dismissed].filter((k) => live.has(k.slice(0, k.indexOf(':'))))
}

// ── Dismissal persistence ───────────────────────────────────────────────────
//
// Keyed per workspace, like notificationHistory.ts: without that, dismissing a
// nudge in one workspace would quiet a same-numbered workstream in another.
// Every access is wrapped, because localStorage throws in a private window and
// comes back empty when site data is cleared — a nudge list that cannot be
// dismissed is worse than one that forgets.

const DISMISS_VERSION = 1

function dismissKey(workspaceId: string): string {
  return `ig-stage-nudge-dismissed:${workspaceId}`
}

export function readDismissals(workspaceId: string | null): Set<string> {
  if (!workspaceId || typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(dismissKey(workspaceId))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Set()
    const shape = parsed as { version?: unknown; keys?: unknown }
    if (shape.version !== DISMISS_VERSION || !Array.isArray(shape.keys)) return new Set()
    return new Set(shape.keys.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

export function writeDismissals(workspaceId: string | null, keys: Iterable<string>): void {
  if (!workspaceId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      dismissKey(workspaceId),
      JSON.stringify({ version: DISMISS_VERSION, keys: [...keys] }),
    )
  } catch {
    // A dismissal that fails to persist still holds for this session, which is
    // the part the user actually asked for.
  }
}
