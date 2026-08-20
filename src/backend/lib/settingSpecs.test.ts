import { describe, it, expect } from 'vitest'
import { SETTING_SPECS, resolveIntSetting } from './settingSpecs.js'

// Precedence is `stored > env > schema default`, and the reason this module
// exists is that it used to be hand-wired per field: `cache_ttl_seconds` had a
// bespoke reader that honoured the stored value, while `daily_snapshot_hour`
// and `snapshot_retention_days` were validated, written, and then read straight
// off the env config — so saving them in Settings did nothing at all.
describe('resolveIntSetting', () => {
  it('prefers a stored value over the env fallback', () => {
    expect(resolveIntSetting('daily_snapshot_hour', '5', 2)).toBe(5)
  })

  it('falls back to env when nothing is stored', () => {
    expect(resolveIntSetting('daily_snapshot_hour', null, 2)).toBe(2)
    expect(resolveIntSetting('daily_snapshot_hour', undefined, 2)).toBe(2)
  })

  it('falls back to env when the stored value is not a number', () => {
    expect(resolveIntSetting('daily_snapshot_hour', 'midnight', 2)).toBe(2)
    expect(resolveIntSetting('daily_snapshot_hour', '', 2)).toBe(2)
  })

  // A stored row can outlive the bounds that admitted it — the spec may tighten
  // in a later release. Clamping would silently invent a value the user never
  // chose; falling back to env keeps the instance on a value someone did.
  it('falls back to env when the stored value is out of bounds', () => {
    expect(resolveIntSetting('daily_snapshot_hour', '-1', 2)).toBe(2)
    expect(resolveIntSetting('daily_snapshot_hour', '24', 2)).toBe(2)
    expect(resolveIntSetting('cache_ttl_seconds', '9', 900)).toBe(900)
    expect(resolveIntSetting('cache_ttl_seconds', '86401', 900)).toBe(900)
  })

  it('accepts values sitting exactly on the bounds', () => {
    expect(resolveIntSetting('daily_snapshot_hour', '0', 2)).toBe(0)
    expect(resolveIntSetting('daily_snapshot_hour', '23', 2)).toBe(23)
    expect(resolveIntSetting('cache_ttl_seconds', '10', 900)).toBe(10)
    expect(resolveIntSetting('cache_ttl_seconds', '86400', 900)).toBe(86400)
  })

  // '2.5' parsed with Number() is 2.5, and parseInt() would silently truncate
  // it to 2. Neither is a value the user asked for.
  it('falls back to env for a non-integer stored value', () => {
    expect(resolveIntSetting('daily_snapshot_hour', '2.5', 2)).toBe(2)
    expect(resolveIntSetting('snapshot_retention_days', '30.1', 365)).toBe(365)
  })

  it('keeps 0 as a real stored value rather than treating it as absent', () => {
    expect(resolveIntSetting('daily_snapshot_hour', '0', 2)).toBe(0)
  })
})

describe('SETTING_SPECS', () => {
  // The bounds used to be written twice — once in the PatchSchema that admits
  // a value and once in the reader that trusts it — and the two disagreed.
  // Whatever consumes this registry, there must only be one copy of them.
  it('carries coherent bounds for every int setting', () => {
    for (const [key, spec] of Object.entries(SETTING_SPECS)) {
      if (spec.kind !== 'int') continue
      expect(spec.min, `${key}.min`).toBeLessThan(spec.max)
      expect(Number.isInteger(spec.min), `${key}.min is an integer`).toBe(true)
      expect(Number.isInteger(spec.max), `${key}.max is an integer`).toBe(true)
    }
  })

  it('gives every enum setting at least two choices', () => {
    for (const [key, spec] of Object.entries(SETTING_SPECS)) {
      if (spec.kind !== 'enum') continue
      expect(spec.values.length, `${key}.values`).toBeGreaterThan(1)
    }
  })

  // The three keys dropped here — node_density, show_active_only_default and
  // show_my_issues_default — had no reader anywhere on either side of the wire
  // and no UI control that wrote them. Re-adding one means giving it a consumer
  // in the same change, not just a row in the registry.
  it('does not carry settings that nothing reads', () => {
    expect(Object.keys(SETTING_SPECS).sort()).toEqual([
      'cache_ttl_seconds',
      'daily_snapshot_hour',
      'default_theme',
      'default_view',
      'snapshot_retention_days',
      'stale_days_threshold',
    ])
  })
})
