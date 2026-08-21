// Per-browser display preferences.
//
// These used to be server settings, written to the `setting` table by
// PATCH /api/settings. That was wrong twice over: they are personal choices, so
// two people sharing an instance overwrote each other's — and nothing ever
// applied them at boot anyway, so saving one appeared to work and then silently
// reverted on reload.
//
// They now live in localStorage beside the other per-browser preferences
// (`ig-font-size`, `ig-max-cols`, `ig-show-related`, …), read at store init and
// written by the store's setters.
//
// Deliberate split of responsibility: **setters persist, URL parsing does not.**
// urlSync's parseUrl assigns straight through `set({ ... })`, bypassing the
// setters, so opening someone's shared `?theme=dark` link overrides the view for
// that visit without rewriting the reader's own preference. Keep it that way —
// persisting from the URL path would let any shared link silently reconfigure
// whoever opens it.

import type { ThemeMode, ViewId } from '../store/viewStore'

const KEY_VIEW = 'ig-default-view'
const KEY_THEME = 'ig-theme'
const KEY_STALE_DAYS = 'ig-stale-days'

export const DEFAULT_VIEW: ViewId = 'dependency'
export const DEFAULT_THEME: ThemeMode = 'auto'
export const DEFAULT_STALE_DAYS = 14

const VIEW_IDS: readonly ViewId[] = ['dependency', 'mix', 'project', 'milestone', 'designdoc']
const THEMES: readonly ThemeMode[] = ['light', 'dark', 'auto']

const STALE_DAYS_MIN = 1
const STALE_DAYS_MAX = 365

// Every coercion returns null for anything unrecognised rather than guessing.
// A stored value can outlive the build that wrote it — `bucket` was a real view
// id once — so "reject and fall back to the default" is the only safe reading.

export function coerceView(raw: string | null | undefined): ViewId | null {
  if (!raw) return null
  return VIEW_IDS.includes(raw as ViewId) ? (raw as ViewId) : null
}

export function coerceTheme(raw: string | null | undefined): ThemeMode | null {
  if (!raw) return null
  return THEMES.includes(raw as ThemeMode) ? (raw as ThemeMode) : null
}

export function coerceStaleDays(raw: string | null | undefined): number | null {
  if (!raw) return null
  const n = Number(raw)
  // Number.isInteger also rejects NaN and Infinity, so '2.5' and 'fourteen'
  // both fall through instead of being truncated by parseInt.
  if (!Number.isInteger(n)) return null
  return n >= STALE_DAYS_MIN && n <= STALE_DAYS_MAX ? n : null
}

/** localStorage is absent under SSR and in the node test environment, and can
 *  throw outright in a Safari private window. Reads degrade to the default;
 *  writes are dropped. */
function readRaw(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(key, value)
  } catch {
    /* quota or private-mode; the in-memory store value still applies this session */
  }
}

export function readDefaultView(): ViewId {
  return coerceView(readRaw(KEY_VIEW)) ?? DEFAULT_VIEW
}

export function writeDefaultView(v: ViewId): void {
  writeRaw(KEY_VIEW, v)
}

export function readTheme(): ThemeMode {
  return coerceTheme(readRaw(KEY_THEME)) ?? DEFAULT_THEME
}

export function writeTheme(t: ThemeMode): void {
  writeRaw(KEY_THEME, t)
}

export function readStaleDays(): number {
  return coerceStaleDays(readRaw(KEY_STALE_DAYS)) ?? DEFAULT_STALE_DAYS
}

export function writeStaleDays(n: number): void {
  writeRaw(KEY_STALE_DAYS, String(n))
}
