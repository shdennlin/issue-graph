/**
 * Who should answer Cmd/Ctrl+F: the canvas finder, or the browser's own?
 *
 * The app used to claim the shortcut whenever `activeElement` was the canvas, a
 * descendant of it, or `document.body`. The last clause is the trap: clicking
 * text inside the detail panel focuses nothing (text is not focusable), so
 * `activeElement` stays `body` and the canvas finder opened — hidden behind the
 * very panel the reader was trying to search. The native find bar, which would
 * have searched the description and comments, never got the keystroke.
 *
 * Focus alone cannot say where the reader is looking, so the pointer counts
 * too: over the panel (or focus inside it) means they are reading it.
 *
 * Pure so it can be tested; App.tsx is not reachable from vitest.
 */
export interface FindContext {
  /** The detail panel is mounted. */
  panelOpen: boolean
  /** The pointer is currently over the detail panel. */
  pointerOverPanel: boolean
  /** Keyboard focus is on an element inside the detail panel. */
  focusInPanel: boolean
  /** Focus is on the canvas, inside it, or on body (nothing focused). */
  focusInCanvas: boolean
}

export function findTarget(ctx: FindContext): 'canvas' | 'native' {
  if (ctx.panelOpen && (ctx.pointerOverPanel || ctx.focusInPanel)) return 'native'
  return ctx.focusInCanvas ? 'canvas' : 'native'
}
