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

/**
 * `true` when the app is running as an installed PWA (standalone display
 * mode) rather than a normal browser tab. We expose this because some
 * shortcuts behave differently in PWA windows — notably, macOS Chrome PWAs
 * keep the Edit→Find menu's "Use Selection for Find" item, which steals
 * Cmd+E at the OS level before keydown reaches the page. The note editor
 * advertises a PWA-friendly alternative (⌘/) when this is `true`.
 *
 * QA override (so dev/test can simulate PWA without installing): append
 * `?display=standalone` (or `browser`) to any URL, or
 * `localStorage.setItem('ig-display', 'standalone')`.
 */
function detectIsStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  let override = params.get('display')
  if (!override) {
    try {
      override = window.localStorage?.getItem('ig-display') ?? null
    } catch {
      /* localStorage may throw in private mode — ignore */
    }
  }
  if (override === 'standalone') return true
  if (override === 'browser') return false
  // W3C standard — Chromium / Firefox / Edge installed-app windows.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS Safari "Add to Home Screen" sets this non-standard flag.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return iosStandalone === true
}

export const isStandalone = detectIsStandalone()

/**
 * Shortcut for toggling Edit/Preview inside the note editor.
 *
 * In a regular browser tab we advertise the conventional `Cmd+E`. In a PWA
 * window on macOS, Cmd+E is intercepted by the inherited Edit menu's "Use
 * Selection for Find" item before the keydown reaches JS, so we advertise
 * `Cmd+/` instead — which collides with no menu accelerator. The handler
 * itself accepts both; only the *displayed* hint switches.
 */
export const NOTE_TOGGLE_KEYS: string[] = isStandalone ? ['Cmd', '/'] : ['Cmd', 'E']

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
