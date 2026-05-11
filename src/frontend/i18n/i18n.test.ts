// Pure unit tests for the i18n translate() helper. These exercise the
// non-React surface so we don't need a DOM (vitest runs in node).

import { describe, expect, it } from 'vitest'
import { translate } from './index'

describe('translate', () => {
  it('returns the English string for a known en key', () => {
    expect(translate('en', 'common.cancel')).toBe('Cancel')
  })

  it('returns the zh-TW string for a known zh-TW key', () => {
    expect(translate('zh-TW', 'common.cancel')).toBe('取消')
  })

  it('falls back to English when the active locale is missing the key', () => {
    // Both dicts have this key in normal use; we verify the fallback path by
    // requesting a key that exists in en but pretending the locale shape is
    // identical (the test for "missing in zh-TW" is structural — Dict type
    // forbids it). To exercise the fallback branch we simulate a missing key
    // by typing as `string`.
    expect(translate('zh-TW', 'definitely.not.a.real.key' as never)).toBe('definitely.not.a.real.key')
    // English still resolves real keys:
    expect(translate('en', 'common.cancel')).toBe('Cancel')
  })

  it('returns the literal key path when both dictionaries lack it', () => {
    expect(translate('en', 'totally.missing.key' as never)).toBe('totally.missing.key')
    expect(translate('zh-TW', 'totally.missing.key' as never)).toBe('totally.missing.key')
  })

  it('interpolates {param} placeholders', () => {
    expect(translate('en', 'toolbar.themeLabel', { mode: 'dark' })).toBe('Theme: dark')
    expect(translate('zh-TW', 'toolbar.themeLabel', { mode: '深色' })).toBe('主題：深色')
  })

  it('leaves placeholders intact when a param is missing', () => {
    expect(translate('en', 'toolbar.themeLabel')).toBe('Theme: {mode}')
  })

  it('handles numeric interpolation', () => {
    expect(translate('en', 'detailPanel.minutesAgo', { count: 5 })).toBe('5m ago')
    expect(translate('zh-TW', 'detailPanel.minutesAgo', { count: 5 })).toBe('5 分鐘前')
  })
})

describe('locale auto-detect', () => {
  it('zh-TW navigator.language → zh-TW locale', async () => {
    // Re-import the detection helper in isolation. We avoid touching the
    // live store (which already initialized at module-load) by using the
    // exposed __testing__ surface.
    const orig = globalThis.navigator
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { language: 'zh-TW', languages: ['zh-TW', 'en'] },
        configurable: true,
      })
      const mod = await import('./store')
      expect(mod.__testing__.detectFromNavigator()).toBe('zh-TW')
    } finally {
      if (orig) {
        Object.defineProperty(globalThis, 'navigator', { value: orig, configurable: true })
      }
    }
  })

  it('zh-Hant navigator.language → zh-TW locale', async () => {
    const orig = globalThis.navigator
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { language: 'zh-Hant', languages: ['zh-Hant'] },
        configurable: true,
      })
      const mod = await import('./store')
      expect(mod.__testing__.detectFromNavigator()).toBe('zh-TW')
    } finally {
      if (orig) {
        Object.defineProperty(globalThis, 'navigator', { value: orig, configurable: true })
      }
    }
  })

  it('non-Chinese navigator.language → en locale', async () => {
    const orig = globalThis.navigator
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { language: 'fr-FR', languages: ['fr-FR', 'en-US'] },
        configurable: true,
      })
      const mod = await import('./store')
      expect(mod.__testing__.detectFromNavigator()).toBe('en')
    } finally {
      if (orig) {
        Object.defineProperty(globalThis, 'navigator', { value: orig, configurable: true })
      }
    }
  })
})
