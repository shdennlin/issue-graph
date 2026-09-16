// Pinned filter values — the handful a person reaches for constantly, kept
// visible in the facet bar as one-click chips even while inactive.
//
// localStorage, not the backend, and deliberately so: pinning is a personal
// working habit, the same class of thing as theme or density. This tool has no
// auth by design (localhost / Tailscale), so backend pins would be shared by
// everyone hitting the instance — one person's shortcuts rearranging another's
// bar. Saved views are the opposite case and DO belong on the server, because
// sharing them is the whole point.
//
// **Keyed per workspace, which is a correctness requirement rather than a
// nicety.** Pins store raw filter tokens — label ids, project ids, assignee
// display names — and none of those mean anything in a different workspace. A
// single global key would render another workspace's pins as chips that match
// nothing.

import type { PinnedFilter } from '../components/facets/facetModel'

const KEY_PREFIX = 'ig-pinned-filters-v1'

/** Cap so a stray loop or an enthusiastic afternoon cannot flood the bar. */
export const MAX_PINS = 12

function storageKey(workspaceId: string): string {
  return `${KEY_PREFIX}:${workspaceId}`
}

/** A stored entry can outlive the build that wrote it, so anything that isn't
 *  shaped exactly right is dropped rather than guessed at. */
function isPin(v: unknown): v is PinnedFilter {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.facetId === 'string' && typeof o.value === 'string'
}

export function readPins(workspaceId: string | null): PinnedFilter[] {
  if (!workspaceId || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPin).slice(0, MAX_PINS)
  } catch {
    return []
  }
}

export function writePins(workspaceId: string | null, pins: PinnedFilter[]): void {
  if (!workspaceId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(pins.slice(0, MAX_PINS)))
  } catch {
    // Silent — a full or disabled quota shouldn't block a UI toggle.
  }
}

export function isPinned(pins: PinnedFilter[], pin: PinnedFilter): boolean {
  return pins.some((p) => p.facetId === pin.facetId && p.value === pin.value)
}

/** Toggle a pin, newest last. Returns the list unchanged when adding would
 *  exceed MAX_PINS — silently dropping the oldest would lose a deliberate
 *  choice the user made earlier. */
export function togglePin(pins: PinnedFilter[], pin: PinnedFilter): PinnedFilter[] {
  if (isPinned(pins, pin)) {
    return pins.filter((p) => !(p.facetId === pin.facetId && p.value === pin.value))
  }
  if (pins.length >= MAX_PINS) return pins
  return [...pins, pin]
}
