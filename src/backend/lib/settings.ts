// Impure half of the settings resolver: the one place the `setting` table is
// read for resolution. The precedence rules and bounds live in the pure
// settingSpecs.ts next door, which is what the tests exercise.
//
// Split deliberately: this file reaches db.js -> `bun:sqlite`, a specifier
// vitest (Node) cannot resolve, so anything importing it is untestable. Keeping
// it to two thin functions means there is nothing here worth testing.

import { getDb } from '../db.js'
import { resolveIntSetting, type IntSettingKey, type SettingKey } from './settingSpecs.js'

/** Raw stored value for one setting, or null when the user never set it. */
export function readStoredSetting(key: SettingKey): string | null {
  const row = getDb()
    .prepare('SELECT value FROM setting WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

/**
 * Resolve an integer setting against the `stored > env > default` chain.
 * `envFallback` is the already-parsed value off the workspace Config, so the
 * schema default is folded in by the time it arrives here.
 */
export function settingInt(key: IntSettingKey, envFallback: number): number {
  return resolveIntSetting(key, readStoredSetting(key), envFallback)
}
