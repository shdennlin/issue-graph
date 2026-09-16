/**
 * Is this event target something the user is typing into, or otherwise driving
 * with the keyboard? Global single-key shortcuts must not fire when it is.
 *
 * This used to be an inline three-way check repeated at five call sites, all
 * testing `input`, `textarea` and `isContentEditable`. That list was complete
 * until the write-back controls added `<select>` to the panel: a native select
 * has letter type-ahead, so picking "Merged" from the status dropdown typed an
 * `m` at the window and toggled wide mode. `<button>` is deliberately NOT here —
 * buttons do not consume letters, and excluding them would disable every
 * shortcut while a button holds focus, which is most of the time.
 *
 * Pure and DOM-free at the type level (it reads `tagName` and
 * `isContentEditable`, both present on the minimal shape below), so it is
 * testable under vitest's node environment — which is the only reason it can be
 * tested at all in this repo.
 */
export interface TypingTargetLike {
  tagName?: string
  isContentEditable?: boolean
}

const TYPING_TAGS = new Set(['input', 'textarea', 'select'])

export function isTypingTarget(target: TypingTargetLike | null | undefined): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  return TYPING_TAGS.has((target.tagName ?? '').toLowerCase())
}
