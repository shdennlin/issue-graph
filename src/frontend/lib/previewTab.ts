// Where a jump from outside the app (the Raycast extension, the
// `web+issuegraph://` handler) lands among the in-app tabs.
//
// It used to land in whatever tab was active, which overwrote it: open the
// workstream view, jump to an issue from Raycast, and the workstream tab now
// shows that issue — view, focused workstream and all. The PWA's
// `launch_handler: navigate-existing` makes this the common case, since every
// launch re-navigates the one open window.
//
// A jump goes to a PREVIEW tab instead — the editor idea of a tab that the next
// jump reuses. Reusing it is the point: a jump creating a tab each time would
// leave one tab behind per lookup. A preview tab becomes an ordinary one when
// the user double-clicks it, after which the next jump opens a fresh preview.

export interface TabLike {
  id: string
  preview?: boolean
}

export type JumpRoute =
  /** Apply the link to the active tab, as before. */
  | { kind: 'stay' }
  /** Switch to this existing preview tab, then apply the link there. */
  | { kind: 'reuse'; tabId: string }
  /** Open a new preview tab and apply the link there. */
  | { kind: 'create' }

export function routeJump(tabs: readonly TabLike[], activeTabId: string | null): JumpRoute {
  // No tabs yet is the very first load: the bootstrap is about to create them,
  // and there is no layout to protect.
  if (tabs.length === 0) return { kind: 'stay' }
  const active = tabs.find((t) => t.id === activeTabId)
  if (active?.preview) return { kind: 'stay' }
  const preview = tabs.find((t) => t.preview)
  return preview ? { kind: 'reuse', tabId: preview.id } : { kind: 'create' }
}

/** The query param an external launcher adds to say "this is a jump". */
export const JUMP_PARAM = 'peek'

/**
 * Whether a URL is a jump from outside, as opposed to the app's own URL.
 *
 * It has to be marked, not inferred from `focus=`: the app writes `focus=`
 * itself, so a reload of a tab with an issue focused would otherwise be taken
 * for a jump and moved out of its own tab. The protocol handler needs no mark —
 * `proto=` only ever arrives from the OS.
 */
export function isJumpArrival(params: URLSearchParams): boolean {
  if (params.has('proto')) return true
  if (params.get(JUMP_PARAM) !== '1') return false
  return params.has('focus') || params.has('chain')
}
