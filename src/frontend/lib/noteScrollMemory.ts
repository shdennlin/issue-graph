// Per-session scroll memory for the note editor & preview surfaces.
// Keyed by (noteId, mode) so toggling Edit ↔ Preview keeps each view's
// position independently, and reopening a note via `n` lands where the
// user left off without a smooth-scroll animation.
//
// Memory only — not persisted to localStorage. Note bodies can change
// between reloads, so a remembered offset may not be meaningful after
// a refresh; in-session restoration is the right scope.

type Mode = 'edit' | 'preview'

const positions = new Map<string, number>()

function key(noteId: number, mode: Mode): string {
  return `${noteId}:${mode}`
}

export function getNoteScroll(noteId: number, mode: Mode): number {
  return positions.get(key(noteId, mode)) ?? 0
}

export function setNoteScroll(noteId: number, mode: Mode, top: number): void {
  positions.set(key(noteId, mode), top)
}
