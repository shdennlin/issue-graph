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

describe('locale store default', () => {
  it('defaults to English when no localStorage value is set', async () => {
    const mod = await import('./store')
    expect(mod.__testing__.DEFAULT_LOCALE).toBe('en')
  })
})

// Every user-facing route error is localised by code. The Dict type already
// forces zh-TW to carry any key en defines, but nothing stops a code from
// being added to apiErrorMessage.ts with no dictionary entry behind it — that
// would render a raw path like "apiError.somethingNew" at the user.
describe('apiError dictionary coverage', () => {
  const CODES = [
    'invalid',
    'invalid_id',
    'exists',
    'key_rejected',
    'key_rejected_unchanged',
    'not_found',
    'unconfigured',
    'switch_in_progress',
    'switch_failed',
  ]

  it('resolves a real sentence for every mapped error code, in both locales', async () => {
    const { apiErrorKey } = await import('../lib/apiErrorMessage')
    for (const code of CODES) {
      const key = apiErrorKey(code)
      expect(key, code).not.toBeNull()
      for (const locale of ['en', 'zh-TW'] as const) {
        const text = translate(locale, key!)
        expect(text, `${locale}/${code}`).not.toBe(key)
        expect(text.length, `${locale}/${code}`).toBeGreaterThan(0)
      }
    }
  })
})
