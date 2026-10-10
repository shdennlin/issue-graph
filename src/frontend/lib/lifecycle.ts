// Pure lifecycle derivation for the card and the settings editor.
//
// Lives here rather than inside a component because vitest's include glob is
// `src/**/*.{test,spec}.ts` — `.tsx` is not in it, no React testing library is
// installed, and so no JSX in this repo is testable. Anything that decides
// something has to be a plain function the component calls. Same split as
// views/connectivity.ts and lib/workspaceSlug.ts.
//
// The stage belongs to a WORKSTREAM, not to an issue — a pipeline describes one
// feature moving through it. The one rule worth restating, because it is easy to
// "fix" by accident: a stage is never computed from the Linear state. A
// workspace's stages are finer than its states — one state routinely spans several steps — so the
// state does not contain the answer. When the two disagree the card shows both
// and changes neither. See docs/adr/0002-lifecycle-stage-is-stored-not-derived.md.

import type { LifecycleStageDTO, StageVerdict } from '@shared/types'

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
