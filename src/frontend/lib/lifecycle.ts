// Pure lifecycle derivation for the card and the settings editor.
//
// Lives here rather than inside a component because vitest's include glob is
// `src/**/*.{test,spec}.ts` — `.tsx` is not in it, no React testing library is
// installed, and so no JSX in this repo is testable. Anything that decides
// something has to be a plain function the component calls. Same split as
// views/connectivity.ts and lib/workspaceSlug.ts.
//
// The one rule worth restating here, because it is easy to "fix" by accident:
// a stage is never computed from the Linear state. A workspace's stages are
// finer than its states — one state routinely spans several steps — so the
// state does not contain the answer. When the two disagree the card shows both
// and changes neither. See docs/adr/0002-lifecycle-stage-is-stored-not-derived.md.

import type {
  IssueStageDTO,
  LifecycleStageDTO,
  NormalizedIssue,
  StageVerdict,
} from '@shared/types'

export interface StageView {
  /** The resolved stage, or null when unset or unresolvable. */
  stage: LifecycleStageDTO | null
  verdict: StageVerdict
  /** What to run next while the issue sits here. Null when the stage has none,
   *  or when there is no stage. */
  nextCommand: string | null
  /** Position in the pipeline, 1-based, for a "3/5" style hint. Null when the
   *  stage does not resolve. */
  position: number | null
  total: number
}

export const EMPTY_STAGE_VIEW: StageView = {
  stage: null,
  verdict: 'unknown',
  nextCommand: null,
  position: null,
  total: 0,
}

/** Index assignments by identifier. Memoize this per graph payload rather than
 *  calling it per card — it is O(n) and the card list is re-rendered on hover. */
export function indexStages(stages: IssueStageDTO[] | undefined): Map<string, IssueStageDTO> {
  const map = new Map<string, IssueStageDTO>()
  for (const s of stages ?? []) map.set(s.identifier, s)
  return map
}

/** Index the lifecycle by key, preserving the caller's order for position. */
export function indexLifecycle(
  lifecycle: LifecycleStageDTO[] | undefined,
): Map<string, LifecycleStageDTO> {
  const map = new Map<string, LifecycleStageDTO>()
  for (const s of lifecycle ?? []) map.set(s.key, s)
  return map
}

/**
 * Does the stored stage agree with the issue's current Linear state?
 *
 * Mirrors backend/lifecycleStore.ts `stageVerdict` — deliberately duplicated
 * rather than shared, because the backend module imports from '../shared/...'
 * with a .js suffix for the server build while the frontend resolves '@shared'.
 * The pair is small, and both are pinned by tests on their own side.
 *
 * - `ok`       — the state is listed, or the stage constrains nothing.
 * - `conflict` — the stage names states and this is not one. Shown, never
 *                resolved: Linear's GitHub automation and the person setting
 *                the stage are both legitimate writers.
 * - `unknown`  — no stage, or a stage key that no longer resolves. Not a
 *                disagreement; on a freshly configured lifecycle this would
 *                otherwise fire on every issue at once and mean nothing.
 */
export function stageVerdict(
  stage: Pick<LifecycleStageDTO, 'states'> | null | undefined,
  linearStateName: string | null | undefined,
): StageVerdict {
  if (!stage) return 'unknown'
  if (stage.states.length === 0) return 'ok'
  if (typeof linearStateName !== 'string' || linearStateName.trim().length === 0) return 'unknown'
  const fold = linearStateName.trim().toLowerCase()
  return stage.states.some((s) => s.trim().toLowerCase() === fold) ? 'ok' : 'conflict'
}

/**
 * Everything the card needs about one issue's stage.
 *
 * Takes pre-built indexes so the per-card cost is two map lookups; building
 * them per card would make this O(n²) over the graph.
 */
export function stageViewFor(
  issue: Pick<NormalizedIssue, 'identifier' | 'state'>,
  stagesByIssue: Map<string, IssueStageDTO>,
  lifecycleByKey: Map<string, LifecycleStageDTO>,
  orderedLifecycle: LifecycleStageDTO[] | undefined,
): StageView {
  const total = orderedLifecycle?.length ?? 0
  const assignment = stagesByIssue.get(issue.identifier)
  if (!assignment) return { ...EMPTY_STAGE_VIEW, total }

  const stage = lifecycleByKey.get(assignment.stageKey) ?? null
  if (!stage) {
    // The stage was deleted or renamed. The assignment is kept rather than
    // cleaned up (see the migration note on why stage_key is not a foreign
    // key), so it reads as unclassified and comes back if the key returns.
    return { ...EMPTY_STAGE_VIEW, total }
  }

  const idx = orderedLifecycle?.findIndex((s) => s.key === stage.key) ?? -1
  return {
    stage,
    verdict: stageVerdict(stage, issue.state?.name),
    nextCommand: stage.nextCommand,
    position: idx >= 0 ? idx + 1 : null,
    total,
  }
}

/**
 * The stage after this one, for a "advance" affordance.
 *
 * Returns null at the end of the pipeline and when the current stage does not
 * resolve. Advancing is a suggestion the user acts on — it never writes to
 * Linear, and the lifecycle config never moves anything on its own.
 */
export function nextStage(
  current: LifecycleStageDTO | null,
  orderedLifecycle: LifecycleStageDTO[] | undefined,
): LifecycleStageDTO | null {
  if (!current || !orderedLifecycle) return null
  const idx = orderedLifecycle.findIndex((s) => s.key === current.key)
  if (idx === -1) return null
  return orderedLifecycle[idx + 1] ?? null
}

/** Count how many issues sit at each stage key, for the settings editor. */
export function stageUsage(stages: IssueStageDTO[] | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of stages ?? []) counts.set(s.stageKey, (counts.get(s.stageKey) ?? 0) + 1)
  return counts
}
