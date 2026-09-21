// Turning a workstream's stage ENTRIES into per-stage durations.
//
// The table is append-only and records only arrivals, because an arrival is
// the one thing that actually happens — a departure is just the next arrival
// seen from the other side. Recording both would mean two writes per move and
// a way for them to disagree.
//
// In `shared/` because both sides ask: the pipeline draws a duration under
// every stage, and the nudge logic wants to know how long the current one has
// run. Pure arithmetic over rows, so there is nothing here worth two copies of.

/** One arrival, as stored. */
export interface StageEvent {
  stageKey: string
  at: number
}

export interface StageVisit {
  stageKey: string
  enteredAt: number
  /** When it moved on, or null while it is still here. */
  leftAt: number | null
  /** Whole days of the MOST RECENT visit. */
  days: number
  /** How many separate times this stage has been entered. A workstream that
   *  came back is worth showing as such — going round twice is the shape of a
   *  review that failed, and averaging it away would hide that. */
  visits: number
  /** True for the stage it is on now. */
  current: boolean
}

const DAY = 86_400_000

/**
 * Per-stage durations, keyed by stage, for the most recent visit to each.
 *
 * `now` is passed rather than read so this stays pure and testable.
 *
 * Events are sorted defensively: they arrive from SQLite ordered by `at`, but
 * two moves inside the same millisecond would tie, and an insertion order that
 * disagreed with the timestamp order would otherwise produce a negative
 * duration. The autoincrement id breaks the tie in the caller's ORDER BY; here
 * a stable sort on `at` preserves whatever order arrived.
 */
export function stageVisits(events: StageEvent[], now: number): Map<string, StageVisit> {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const counts = new Map<string, number>()
  for (const e of sorted) counts.set(e.stageKey, (counts.get(e.stageKey) ?? 0) + 1)

  const out = new Map<string, StageVisit>()
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!
    const next = sorted[i + 1]
    const leftAt = next ? next.at : null
    const end = leftAt ?? now
    // A later visit overwrites an earlier one: the question a pipeline answers
    // is "how long has this been here", present tense, and the last visit is
    // the one that is still true.
    out.set(e.stageKey, {
      stageKey: e.stageKey,
      enteredAt: e.at,
      leftAt,
      // Clamped at zero: a clock that moved backwards between two writes must
      // not render as a negative age.
      days: Math.max(0, Math.floor((end - e.at) / DAY)),
      visits: counts.get(e.stageKey) ?? 1,
      current: leftAt === null,
    })
  }
  return out
}

export interface StageLeg {
  stageKey: string
  enteredAt: number
  /** When it moved on, or null while it is still here. */
  leftAt: number | null
  /** How long this leg lasted, in ms. */
  ms: number
  /** True for the leg it is on now — the last one, and only when nothing
   *  followed it. */
  current: boolean
}

/**
 * The whole journey, oldest first — one entry per ARRIVAL, not per stage.
 *
 * Distinct from `stageVisits`, which keys by stage and keeps only the most
 * recent visit because a pipeline asks "how long has it been here", present
 * tense. A history asks a different question — how did this get here, and
 * where did it stall — and there the repeats are the point: a workstream that
 * went spec review, back to discuss, and forward again is telling you a review
 * failed. Collapsing those into one row per stage erases exactly that.
 */
export function stageTimeline(events: StageEvent[], now: number): StageLeg[] {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  return sorted.map((e, i) => {
    const next = sorted[i + 1]
    const leftAt = next ? next.at : null
    return {
      stageKey: e.stageKey,
      enteredAt: e.at,
      leftAt,
      // Clamped, for the same reason stageVisits clamps: a clock that moved
      // backwards between two writes must not render as a negative duration.
      ms: Math.max(0, (leftAt ?? now) - e.at),
      current: leftAt === null,
    }
  })
}
