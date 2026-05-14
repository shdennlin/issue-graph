// @vitest-environment happy-dom
// Verify the platform-mapping pure functions independently from the
// navigator-dependent module-load detection. We exercise each branch by
// pinning the platform via vi.stubGlobal before re-importing the module
// fresh. happy-dom provides a real `window` so the QA-override path
// (URL param / localStorage) can be exercised too.
import { describe, expect, it, vi, beforeEach } from 'vitest'

async function loadFor(
  platform: string,
  opts: {
    search?: string
    localStorage?: Record<string, string>
    standalone?: boolean
    iosStandalone?: boolean
  } = {},
): Promise<typeof import('./platform')> {
  vi.stubGlobal('navigator', { platform, standalone: opts.iosStandalone === true })
  // The module reads `window.matchMedia(...)`. Stub it so display-mode
  // detection is deterministic per test.
  ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (q) =>
    ({
      matches: q === '(display-mode: standalone)' ? opts.standalone === true : false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
  // Reset URL + localStorage before each load so prior tests don't bleed in.
  window.history.replaceState(null, '', `/${opts.search ?? ''}`)
  window.localStorage.clear()
  for (const [k, v] of Object.entries(opts.localStorage ?? {})) {
    window.localStorage.setItem(k, v)
  }
  vi.resetModules()
  return await import('./platform')
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('platform.localizeKey', () => {
  it('keeps Cmd → Cmd on Mac', async () => {
    const m = await loadFor('MacIntel')
    expect(m.localizeKey('Cmd')).toBe('Cmd')
  })
  it('translates Cmd → Ctrl on Windows', async () => {
    const m = await loadFor('Win32')
    expect(m.localizeKey('Cmd')).toBe('Ctrl')
  })
  it('translates Cmd → Ctrl on Linux', async () => {
    const m = await loadFor('Linux x86_64')
    expect(m.localizeKey('Cmd')).toBe('Ctrl')
  })
  it('keeps Delete → Delete on Mac (matches the Mac keycap label)', async () => {
    const m = await loadFor('MacIntel')
    expect(m.localizeKey('Delete')).toBe('Delete')
  })
  it('translates Delete → Backspace on Windows (the actual key name)', async () => {
    const m = await loadFor('Win32')
    expect(m.localizeKey('Delete')).toBe('Backspace')
  })
  it('passes other keys through untouched', async () => {
    const m = await loadFor('Win32')
    expect(m.localizeKey('Enter')).toBe('Enter')
    expect(m.localizeKey('?')).toBe('?')
    expect(m.localizeKey('Shift')).toBe('Shift')
  })
})

describe('platform.formatShortcut', () => {
  it('uses contiguous glyphs on Mac', async () => {
    const m = await loadFor('MacIntel')
    expect(m.formatShortcut(['Cmd', 'Shift', 'S'])).toBe('⌘⇧S')
    expect(m.formatShortcut(['Cmd', 'E'])).toBe('⌘E')
    expect(m.formatShortcut(['Cmd', '['])).toBe('⌘[')
  })
  it('uses + separator on Windows', async () => {
    const m = await loadFor('Win32')
    expect(m.formatShortcut(['Cmd', 'Shift', 'S'])).toBe('Ctrl+Shift+S')
    expect(m.formatShortcut(['Cmd', 'E'])).toBe('Ctrl+E')
    expect(m.formatShortcut(['Cmd', '['])).toBe('Ctrl+[')
  })
})

describe('platform.MOD_GLYPH', () => {
  it('is "⌘" on Mac', async () => {
    const m = await loadFor('MacIntel')
    expect(m.MOD_GLYPH).toBe('⌘')
  })
  it('is "Ctrl+" on non-Mac', async () => {
    const m = await loadFor('Win32')
    expect(m.MOD_GLYPH).toBe('Ctrl+')
  })
})

describe('platform override (?platform= / localStorage)', () => {
  it('?platform=windows forces non-Mac on a Mac browser', async () => {
    const m = await loadFor('MacIntel', { search: '?platform=windows' })
    expect(m.isMac).toBe(false)
    expect(m.MOD_KEY).toBe('Ctrl')
    expect(m.formatShortcut(['Cmd', 'E'])).toBe('Ctrl+E')
  })
  it('?platform=mac forces Mac on a Windows browser', async () => {
    const m = await loadFor('Win32', { search: '?platform=mac' })
    expect(m.isMac).toBe(true)
    expect(m.MOD_KEY).toBe('Cmd')
    expect(m.formatShortcut(['Cmd', 'E'])).toBe('⌘E')
  })
  it('?platform=linux is treated as non-Mac', async () => {
    const m = await loadFor('MacIntel', { search: '?platform=linux' })
    expect(m.isMac).toBe(false)
  })
  it('ig-platform localStorage value applies when no URL param is set', async () => {
    const m = await loadFor('MacIntel', { localStorage: { 'ig-platform': 'windows' } })
    expect(m.isMac).toBe(false)
  })
  it('URL param wins over localStorage', async () => {
    const m = await loadFor('MacIntel', {
      search: '?platform=mac',
      localStorage: { 'ig-platform': 'windows' },
    })
    expect(m.isMac).toBe(true)
  })
  it('unknown override value falls back to navigator detection', async () => {
    const m = await loadFor('MacIntel', { search: '?platform=bogus' })
    expect(m.isMac).toBe(true)
  })
})

describe('platform.isStandalone / NOTE_TOGGLE_KEYS', () => {
  it('detects standalone via display-mode: standalone media query', async () => {
    const m = await loadFor('MacIntel', { standalone: true })
    expect(m.isStandalone).toBe(true)
    // In a PWA window we advertise Cmd+/ instead of Cmd+E, since macOS
    // Edit→Find→"Use Selection for Find" steals plain Cmd+E.
    expect(m.NOTE_TOGGLE_KEYS).toEqual(['Cmd', '/'])
  })
  it('detects iOS Safari home-screen install via navigator.standalone', async () => {
    const m = await loadFor('iPhone', { iosStandalone: true })
    expect(m.isStandalone).toBe(true)
    expect(m.NOTE_TOGGLE_KEYS).toEqual(['Cmd', '/'])
  })
  it('treats regular browser tab as non-standalone', async () => {
    const m = await loadFor('MacIntel')
    expect(m.isStandalone).toBe(false)
    expect(m.NOTE_TOGGLE_KEYS).toEqual(['Cmd', 'E'])
  })
  it('?display=standalone forces standalone for testing', async () => {
    const m = await loadFor('MacIntel', { search: '?display=standalone' })
    expect(m.isStandalone).toBe(true)
    expect(m.NOTE_TOGGLE_KEYS).toEqual(['Cmd', '/'])
  })
  it('?display=browser overrides true standalone (useful in dev)', async () => {
    const m = await loadFor('MacIntel', { search: '?display=browser', standalone: true })
    expect(m.isStandalone).toBe(false)
    expect(m.NOTE_TOGGLE_KEYS).toEqual(['Cmd', 'E'])
  })
  it('ig-display localStorage applies when no URL param is set', async () => {
    const m = await loadFor('MacIntel', { localStorage: { 'ig-display': 'standalone' } })
    expect(m.isStandalone).toBe(true)
  })
})
