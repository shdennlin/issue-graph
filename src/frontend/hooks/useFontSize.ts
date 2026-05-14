import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'

// Maps a numeric base px to the four *-root font tokens. Tuned so the
// default 13 produces (13, 11, 10, 16) — matching the previous 'md' preset
// exactly. We set the *-root names so scoped overrides (e.g. detail panel
// per-instance text-size) can read the global value via calc() without a
// self-referential cycle.
function customVars(basePx: number): Record<string, string> {
  const clamp = Math.max(9, Math.min(24, Math.round(basePx)))
  return {
    '--fs-base-root': `${clamp}px`,
    '--fs-meta-root': `${Math.max(9, clamp - 2)}px`,
    '--fs-chip-root': `${Math.max(8, clamp - 3)}px`,
    '--fs-title-root': `${clamp + 3}px`,
  }
}

export function useFontSize(): void {
  const fs = useViewStore((s) => s.fontSize)
  useEffect(() => {
    const root = document.documentElement
    if (typeof fs === 'number') {
      root.dataset.fontsize = 'custom'
      const vars = customVars(fs)
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    } else {
      root.dataset.fontsize = fs
      // Clear any inline overrides from a previous custom selection so the
      // [data-fontsize='sm'|'md'|'lg'] block in tokens.css can take effect.
      for (const k of ['--fs-base-root', '--fs-meta-root', '--fs-chip-root', '--fs-title-root']) {
        root.style.removeProperty(k)
      }
    }
  }, [fs])
}
