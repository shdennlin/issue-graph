/**
 * Toggle the Nth GFM task-list checkbox in a markdown body.
 *
 * Matches `[ ]`, `[x]`, `[X]` (the canonical GFM forms). Indexes are 0-based
 * and ordered by file position — same order in which `marked` emits checkboxes
 * into the rendered HTML. Caller is responsible for pairing a clicked DOM
 * checkbox with its index using e.g. `Array.from(checkboxes).indexOf(target)`.
 *
 * Returns the original body untouched if `index` is out of range.
 */
const TASK_BOX = /\[[ xX]\]/g

export function toggleChecklistAt(body: string, index: number): string {
  const matches = Array.from(body.matchAll(TASK_BOX))
  const match = matches[index]
  if (!match || match.index === undefined) return body
  const checked = match[0] !== '[ ]'
  const replacement = checked ? '[ ]' : '[x]'
  return body.slice(0, match.index) + replacement + body.slice(match.index + 3)
}

export function countChecklistBoxes(body: string): number {
  let n = 0
  for (const _m of body.matchAll(TASK_BOX)) {
    void _m
    n++
  }
  return n
}
