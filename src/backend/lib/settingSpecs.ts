// The single registry of user-overridable settings, and the one place the
// `stored > env > schema default` precedence is implemented.
//
// This used to be hand-wired per field, and most of it was never wired at all:
// `cache_ttl_seconds` had a bespoke reader in cache.ts that consulted the
// `setting` table, while `daily_snapshot_hour` and `snapshot_retention_days`
// were validated by the PATCH schema, written to the table, and then read
// straight off the env config by sync.ts — so changing them in Settings
// silently did nothing. Three further keys had no reader on either side.
//
// Pure by construction: no `bun:sqlite` import, no db.js, no cache.js. Callers
// pass the stored string in. That keeps this module testable under vitest,
// which runs on Node and cannot resolve `bun:sqlite` (see CLAUDE.md).

export type SettingSpec =
  | { kind: 'int'; min: number; max: number }
  | { kind: 'enum'; values: readonly string[] }

/**
 * Bounds live here and nowhere else. They previously existed twice — once in
 * the PatchSchema that admits a value and once in the reader that trusts it —
 * and the two copies had already drifted apart.
 */
export const SETTING_SPECS = {
  default_view: { kind: 'enum', values: ['dependency', 'bucket', 'mix'] },
  default_theme: { kind: 'enum', values: ['light', 'dark', 'auto'] },
  stale_days_threshold: { kind: 'int', min: 1, max: 365 },
  snapshot_retention_days: { kind: 'int', min: 1, max: 3650 },
  daily_snapshot_hour: { kind: 'int', min: 0, max: 23 },
  cache_ttl_seconds: { kind: 'int', min: 10, max: 24 * 3600 },
} as const satisfies Record<string, SettingSpec>

export type SettingKey = keyof typeof SETTING_SPECS

export type IntSettingKey = {
  [K in SettingKey]: (typeof SETTING_SPECS)[K]['kind'] extends 'int' ? K : never
}[SettingKey]

/**
 * Resolve one integer setting: the stored value if it parses and satisfies the
 * spec, otherwise the env fallback.
 *
 * Out-of-bounds stored values fall back rather than clamp. A row can outlive
 * the bounds that admitted it if a later release tightens the spec, and
 * clamping would hand the instance a number nobody chose; the env value is at
 * least one someone configured.
 */
export function resolveIntSetting(
  key: IntSettingKey,
  storedRaw: string | null | undefined,
  envFallback: number,
): number {
  if (storedRaw === null || storedRaw === undefined || storedRaw === '') return envFallback
  const spec = SETTING_SPECS[key]
  const n = Number(storedRaw)
  // Number.isInteger also rejects NaN and Infinity, so '2.5' and 'midnight'
  // both land on the fallback instead of being silently truncated by parseInt.
  if (!Number.isInteger(n)) return envFallback
  if (n < spec.min || n > spec.max) return envFallback
  return n
}
