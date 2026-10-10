// The per-panel text size, shared by every docked panel.
//
// One key for all of them on purpose: a person who made the issue panel bigger
// did so because of their eyes and their screen, not because of issues. Four
// panels each remembering their own size would make them disagree, and the one
// they opened next would be the wrong size again.
//
// It existed twice already — DetailPanel and ProjectPanel held identical
// useState initialisers and identical cycle functions against the same
// localStorage key — and the stage and workstream panels, which are where the
// long prose actually lives, had neither. Extracted rather than copied a third
// and fourth time.
//
// Pure functions beside the hook so the cycle order and the parse can be
// tested: this file is `.ts` precisely because a `.tsx` one could not be.

import { useCallback, useEffect, useState } from 'react'

export const TEXT_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

/** Unchanged from when DetailPanel owned it — an existing preference survives. */
export const TEXT_SIZE_KEY = 'ig-detail-text-size-v1'

export const DEFAULT_TEXT_SIZE: TextSize = 'md'

export function isTextSize(raw: unknown): raw is TextSize {
  return typeof raw === 'string' && (TEXT_SIZES as readonly string[]).includes(raw)
}

/** Wraps, so the button is one control rather than a control plus a reset. */
export function nextTextSize(current: TextSize): TextSize {
  const i = TEXT_SIZES.indexOf(current)
  return TEXT_SIZES[(i + 1) % TEXT_SIZES.length] ?? DEFAULT_TEXT_SIZE
}

/** Anything unreadable reads as the default, including no localStorage at all. */
export function readTextSize(): TextSize {
  if (typeof localStorage === 'undefined') return DEFAULT_TEXT_SIZE
  try {
    const v = localStorage.getItem(TEXT_SIZE_KEY)
    return isTextSize(v) ? v : DEFAULT_TEXT_SIZE
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}

export function writeTextSize(size: TextSize): void {
  try {
    localStorage.setItem(TEXT_SIZE_KEY, size)
  } catch {
    /* Private mode, blocked storage — the size still applies to this panel. */
  }
}

// Every mounted panel, so cycling in one updates the others AS IT HAPPENS.
// ProjectPanel used to re-read on window focus instead, because `storage`
// events do not fire in the tab that wrote them — which meant two panels open
// side by side disagreed until you clicked away and back. With one owner of
// the value that workaround is not needed: same tab goes through this set,
// other tabs still arrive as a `storage` event.
const listeners = new Set<(size: TextSize) => void>()

/** `[size, cycle]`. The class is `detail-text-${size}` in every panel. */
export function useDetailTextSize(): [TextSize, () => void] {
  const [size, setSize] = useState<TextSize>(readTextSize)

  useEffect(() => {
    listeners.add(setSize)
    const fromAnotherTab = (e: StorageEvent) => {
      if (e.key !== null && e.key !== TEXT_SIZE_KEY) return
      setSize(readTextSize())
    }
    window.addEventListener('storage', fromAnotherTab)
    return () => {
      listeners.delete(setSize)
      window.removeEventListener('storage', fromAnotherTab)
    }
  }, [])

  const cycle = useCallback(() => {
    const next = nextTextSize(readTextSize())
    writeTextSize(next)
    for (const l of listeners) l(next)
  }, [])

  return [size, cycle]
}
