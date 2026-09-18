// How long a workstream has sat where it is, and whether that is too long.
//
// In `shared/` because both sides ask: the Workstreams view draws it on the
// stage bar, and the notification bell turns it into a nudge. Pure arithmetic
// over two DTO fields, so there is nothing here worth having two copies of.

/**
 * Has this workstream sat on its stage longer than that stage allows?
 *
 * A null threshold means the stage never goes stale — the honest setting for a
 * Discuss stage, which can legitimately run for weeks. A null
 * `stageEnteredAt` means nothing has set a stage yet, which is not stale either.
 *
 * Stalling is not by itself wrong: this work runs days to a month. What is
 * wrong is stalling FOR THAT STAGE, which is why the threshold is per stage
 * rather than one number for the pipeline.
 */
export function isStale(
  stageEnteredAt: number | null,
  staleAfterDays: number | null,
  now: number,
): boolean {
  if (stageEnteredAt === null || staleAfterDays === null) return false
  return now - stageEnteredAt > staleAfterDays * 86_400_000
}

/** Whole days a workstream has sat where it is, for the nudge's wording. */
export function daysOnStage(stageEnteredAt: number | null, now: number): number | null {
  if (stageEnteredAt === null) return null
  return Math.max(0, Math.floor((now - stageEnteredAt) / 86_400_000))
}
