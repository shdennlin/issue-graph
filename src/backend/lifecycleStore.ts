// Pure lifecycle logic: raw input in, validated row data out, plus the
// stage-vs-state compatibility verdict.
//
// No `bun:sqlite` import, and none allowed — vitest runs on Node and cannot
// resolve that specifier, so any module reaching it becomes untestable. The
// SQLite half lives in routes/lifecycle.ts and stays thin
// enough not to need tests. Same split as savedViewStore.ts / savedViews.ts.
//
// What a lifecycle IS: a playbook mapping "this stage" to "the command that
// moves it on". What it is NOT: a copy of Linear's workflow states. Linear
// already owns which states exist, their order, and which one an issue is in.
// The reason a stage is stored rather than derived is that stages are FINER
// than states — one Linear state routinely covers several steps — so there is
// not enough information in the state to recover the stage. See ADR-0002.
//
// The stage belongs to a WORKSTREAM, not to an issue: a pipeline describes one
// feature moving through it, while an issue carries only its Linear state.

import type { LifecycleStageDTO, StageVerdict } from '../shared/types.js'

/**
 * Every column `LifecycleStageRow` needs, in one place.
 *
 * It lives here rather than beside either query because there were two
 * hand-written SELECTs for this table — one in routes/lifecycle.ts and one in
 * cache.ts — and the second silently stopped listing `shows` and
 * `stale_after_days` when those columns were added. The rows are cast
 * `as LifecycleStageRow`, so the compiler typed the missing columns as
 * present; the stages reached the graph payload with an empty `shows` and no
 * staleness threshold, and every test still passed. Nothing that touches
 * `bun:sqlite` can be tested here, so one string is the only defence.
 */
export const LIFECYCLE_COLUMNS =
  'id, key, name, sort_order, states, next_command, fields, stale_after_days, created_at, updated_at'

export interface LifecycleStageRow {
  id: number
  key: string
  name: string
  sort_order: number
  /** JSON array of Linear state names. Stored as text; may be malformed if
   *  hand-edited in the DB, so every read goes through parseStates. */
  states: string
  next_command: string | null
  /** JSON array of show tokens, read tolerantly like `states`. */
  /** JSON array of attachment kinds this stage expects. Advisory — see
   *  migration 15. */
  fields: string
  stale_after_days: number | null
  created_at: number
  updated_at: number
}

export const KEY_MAX = 64
export const NAME_MAX = 80
/** A command line, not a script. Long enough for a slash command with a couple
 *  of arguments; short enough that the column cannot become a dumping ground. */
export const NEXT_COMMAND_MAX = 200
/** Linear state names are short. The cap bounds the JSON column without ever
 *  being reachable by a real workspace. */
export const STATES_MAX = 40

/**
 * Normalize a stage key.
 *
 * The key is what a workstream's `stage_key` points at, and it outlives
 * renames, so it is
 * restricted to a slug rather than accepting whatever the name happens to be.
 * Returns null when unusable.
 */
export function normalizeStageKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  if (key.length === 0 || key.length > KEY_MAX) return null
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) return null
  return key
}

/**
 * A key for a stage whose name yields no slug.
 *
 * Needed because slugifyStageName strips everything outside [a-z0-9], so a name
 * written entirely in Chinese — or emoji, or any non-Latin script — produces an
 * empty slug and could not be saved at all. This app ships a zh-TW locale, so
 * that is an ordinary case, not an edge one.
 *
 * The key is an internal join target, never shown, so an opaque one costs the
 * user nothing. `taken` is consulted rather than trusting a counter, because
 * stages get deleted and a plain length+1 would collide after the first one.
 */
export function fallbackStageKey(taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const k of taken) used.add(k)
  for (let n = 1; n < 10_000; n++) {
    const key = `stage-${n}`
    if (!used.has(key)) return key
  }
  // Unreachable in practice; a workspace with 10k stages has other problems.
  return `stage-${Date.now()}`
}

/** Derive a key from a display name, for the editor's "add stage" path. */
export function slugifyStageName(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, KEY_MAX)
    // A trailing hyphen can survive the slice above.
    .replace(/-+$/, '')
  return slug.length > 0 ? slug : null
}

export function normalizeStageName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name.length === 0 || name.length > NAME_MAX) return null
  return name
}

/**
 * Normalize the compatible-state list.
 *
 * Linear state names are compared case-insensitively but stored as the user
 * typed them, because the editor shows them back and "in review" instead of
 * "In Review" reads as a typo. Duplicates are dropped; order is preserved.
 *
 * An EMPTY list is meaningful and is not an error: it means the stage declines
 * to constrain the Linear state, so it can never report a conflict.
 */
export function normalizeStates(raw: unknown): string[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  if (raw.length > STATES_MAX) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const name = item.trim()
    if (name.length === 0) continue
    if (name.length > NAME_MAX) return null
    const fold = name.toLowerCase()
    if (seen.has(fold)) continue
    seen.add(fold)
    out.push(name)
  }
  return out
}

/** Absent and empty both mean "no next step", so both collapse to null. */
export function normalizeNextCommand(raw: unknown): string | null | undefined {
  if (raw == null) return null
  if (typeof raw !== 'string') return undefined
  const cmd = raw.trim()
  if (cmd.length === 0) return null
  if (cmd.length > NEXT_COMMAND_MAX) return undefined
  return cmd
}

/** Tolerant read of the `states` text column. A malformed value degrades to
 *  "constrains nothing" rather than throwing — a bad row must not be able to
 *  take down the whole graph response. */
export function parseStates(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function lifecycleRowToDTO(row: LifecycleStageRow): LifecycleStageDTO {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.sort_order,
    states: parseStates(row.states),
    nextCommand: row.next_command,
    fields: parseStates(row.fields),
    staleAfterDays: row.stale_after_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Next sort_order for an appended stage. Stages read top-to-bottom in the
 *  order the pipeline runs, so new ones land at the end. */
export function nextSortOrder(rows: Pick<LifecycleStageRow, 'sort_order'>[]): number {
  let max = -1
  for (const r of rows) if (r.sort_order > max) max = r.sort_order
  return max + 1
}

/** `exceptId` lets a PATCH keep its own key without colliding with itself. */
export function isKeyTaken(
  rows: Pick<LifecycleStageRow, 'id' | 'key'>[],
  key: string,
  exceptId?: number,
): boolean {
  return rows.some((r) => r.key === key && r.id !== exceptId)
}

/**
 * Is this display name already used?
 *
 * Names are unique as well as keys, and not only for tidiness. A name that
 * slugifies to nothing — any non-Latin script — gets an opaque fallback key, so
 * key uniqueness alone cannot recognise the same stage being added twice: the
 * second attempt simply gets the next free fallback. Creating a stage is
 * idempotent on the NAME, which is the thing the user actually typed.
 *
 * Compared case-insensitively: "Implementing" and "implementing" are the same
 * stage to a reader, and two of them on a card would be indistinguishable.
 */
export function isNameTaken(
  rows: Pick<LifecycleStageRow, 'id' | 'name'>[],
  name: string,
  exceptId?: number,
): boolean {
  const fold = name.trim().toLowerCase()
  return rows.some((r) => r.name.trim().toLowerCase() === fold && r.id !== exceptId)
}

/**
 * Does the stored stage agree with the issue's current Linear state?
 *
 * Three outcomes, and the distinction between the last two carries the whole
 * design:
 *
 * - `ok`       — the state is in the stage's compatible list, or the stage
 *                declines to constrain it (empty list).
 * - `conflict` — the stage names states and this is not one of them. SHOW IT;
 *                never resolve it. Linear's GitHub automation and the person
 *                setting the stage are both legitimate writers, so picking a
 *                winner would make the app lie about one of them.
 * - `unknown`  — no stage set, or the stage key no longer resolves. Not a
 *                disagreement, and must not draw a warning: on a freshly
 *                configured lifecycle that would be every issue at once.
 *
 * Comparison is case-insensitive because the list is stored as typed.
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
 * Reorder stages to a caller-supplied key order.
 *
 * Returns the new `(key, sort_order)` pairs, or null if the request does not
 * name exactly the existing keys once each. A partial reorder is rejected
 * rather than best-effort applied: the editor always sends the full list, so a
 * mismatch means the client is out of date, and silently interleaving a stale
 * order with the current one produces a pipeline nobody asked for.
 */
export function reorderStages(
  rows: Pick<LifecycleStageRow, 'key'>[],
  desiredKeys: unknown,
): { key: string; sort_order: number }[] | null {
  if (!Array.isArray(desiredKeys)) return null
  if (desiredKeys.length !== rows.length) return null
  const existing = new Set(rows.map((r) => r.key))
  const seen = new Set<string>()
  const out: { key: string; sort_order: number }[] = []
  for (const [i, k] of desiredKeys.entries()) {
    if (typeof k !== 'string') return null
    if (!existing.has(k) || seen.has(k)) return null
    seen.add(k)
    out.push({ key: k, sort_order: i })
  }
  return out
}

