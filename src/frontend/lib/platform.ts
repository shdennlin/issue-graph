/**
 * OS-aware keyboard shortcut helpers.
 *
 * Key handlers throughout the app accept BOTH `e.metaKey` and `e.ctrlKey`, so
 * the actual behavior is already cross-platform — this module only fixes the
 * display side: cheat sheet captions, tooltip hints, etc.
 *
 * `navigator.platform` is technically deprecated but still the most reliable
 * way to detect Mac across all current browsers (userAgentData isn't
 * universally implemented). Falls back to `false` in non-browser contexts.
 */
/**
 * Resolve once at module load. The runtime check is tiny, but keeping `isMac`
 * a module-scope constant lets the cheat sheet render synchronously and stays
 * friendly to dead-code elimination if a bundler ever needs it.
 *
 * QA override (for cross-platform-display testing): append `?platform=windows`
 * (or `mac` / `linux` / `pc`) to any URL, or persist via
 * `localStorage.setItem('ig-platform', 'windows')`. URL param wins over
 * localStorage; both override the navigator check. Anything else → fall back
 * to normal detection.
 */
function detectIsMac(): boolean {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    let override = params.get('platform')
    if (!override) {
      try {
        override = window.localStorage?.getItem('ig-platform') ?? null
      } catch {
        /* localStorage may throw in private mode — ignore */
      }
    }
    if (override === 'mac') return true
    if (override === 'windows' || override === 'linux' || override === 'pc') return false
  }
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/i.test(navigator.platform)
}

export const isMac = detectIsMac()

/** Spelled-out modifier name used as the key-cap label in the cheat sheet. */
export const MOD_KEY: 'Cmd' | 'Ctrl' = isMac ? 'Cmd' : 'Ctrl'

/** Compact modifier glyph for tight tooltips: "⌘" on Mac, "Ctrl+" on Windows/Linux. */
export const MOD_GLYPH = isMac ? '⌘' : 'Ctrl+'

/**
 * Translate a single "logical" key label to the platform-appropriate cap text.
 * Used by the cheat sheet, which stores keys in a Mac-y canonical form and
 * lets this helper rewrite at render time.
 */
export function localizeKey(key: string): string {
  if (key === 'Cmd') return MOD_KEY
  // The literal Backspace keypress is the same on every platform, but the
  // physical keycap is labelled "delete" on Macs and "Backspace" elsewhere.
  if (key === 'Delete') return isMac ? 'Delete' : 'Backspace'
  return key
}

/**
 * Format a key-combo for a compact tooltip / hint label.
 *   Mac:           ['Cmd','Shift','S'] → "⌘⇧S"
 *   Windows/Linux: ['Cmd','Shift','S'] → "Ctrl+Shift+S"
 *
 * Mac uses contiguous glyphs (matches platform convention); other platforms
 * use the spelled-out "+"-separated form.
 */
export function formatShortcut(keys: string[]): string {
  if (isMac) {
    return keys
      .map((k) => {
        if (k === 'Cmd') return '⌘'
        if (k === 'Shift') return '⇧'
        if (k === 'Alt') return '⌥'
        if (k === 'Ctrl') return '⌃'
        return k
      })
      .join('')
  }
  return keys.map(localizeKey).join('+')
}
