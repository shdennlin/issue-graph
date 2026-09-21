// A workstream's note, reduced to one line.
//
// There is no separate `description` column and deliberately so: a note
// already answers "what is this feature and what should somebody know first",
// and a second free-text field beside it with the same job would be two
// places to write one thing and one of them always stale. The convention is
// the one a commit message uses — the first line is the subject, the rest is
// the body — and it costs no schema, no migration and nothing to keep in step.
//
// In `shared/` because both sides ask: the workstream list draws it under the
// name, and the server puts it on `/api/batches` so an agent listing twenty
// workstreams gets twenty sentences rather than twenty essays.

/** How much of the first line is a summary rather than a paragraph. */
export const NOTE_SUMMARY_MAX = 120

/**
 * The first line worth reading, or null when the note has none.
 *
 * Leading `#` and `>` are stripped, because a note written as markdown often
 * opens with a heading and "## Why this exists" is a worse summary than "Why
 * this exists". Blank lines are skipped rather than returned empty — a note
 * that starts with a newline still has a subject, it is just on line two.
 *
 * Truncation is soft: cut at the last space before the cap, so a summary ends
 * on a word rather than mid-syllable, and only when that leaves something
 * substantial (a single very long word is cut hard rather than reduced to
 * nothing).
 */
export function noteSummary(note: string | null | undefined, max = NOTE_SUMMARY_MAX): string | null {
  if (typeof note !== 'string') return null
  for (const raw of note.split('\n')) {
    const line = raw.replace(/^\s*[#>\s]+/, '').trim()
    if (line.length === 0) continue
    if (line.length <= max) return line
    const cut = line.slice(0, max)
    const space = cut.lastIndexOf(' ')
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
  }
  return null
}
