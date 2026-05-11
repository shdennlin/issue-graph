// Verify the platform-mapping pure functions independently from the
// navigator-dependent module-load detection. We exercise each branch by
// pinning the platform via vi.stubGlobal before re-importing the module
// fresh.
import { describe, expect, it, vi, beforeEach } from 'vitest'

async function loadFor(platform: string): Promise<typeof import('./platform')> {
  vi.stubGlobal('navigator', { platform })
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
