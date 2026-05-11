// Public surface of the i18n module.
//
// Usage:
//   const t = useT()
//   t('settings.title')                       // string lookup
//   t('toolbar.themeLabel', { mode: 'dark' }) // {param} interpolation
//
// Lookup falls back to English if the active locale is missing the key, then
// to the literal key path if both dictionaries lack it. Missing keys log a
// `console.warn` once per key in dev builds only.

import { useCallback } from 'react'
import { en } from './locales/en'
import { zhTW } from './locales/zh-TW'
import type { Dict } from './dict'
import { LOCALES, useLocaleStore, type Locale } from './store'

export { LOCALES }
export type { Locale }

const DICTS: Record<Locale, Dict> = {
  en,
  'zh-TW': zhTW,
}

// Recursive nested-key generator. `Dict` is a deeply-nested object of string
// leaves; this builds the union `'a' | 'a.b' | 'a.b.c' | …` so `t('x.y')`
// autocompletes and typos are caught at compile time.
type Join<K, P> = K extends string
  ? P extends string
    ? `${K}.${P}`
    : never
  : never

export type NestedKeyOf<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? K | Join<K, NestedKeyOf<T[K]>>
      : never
}[keyof T & string]

export type DictKey = NestedKeyOf<Dict>

const warnedKeys = new Set<string>()

function warnMissingOnce(key: string): void {
  if (typeof import.meta === 'undefined') return
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV
  if (!dev) return
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  console.warn(`[i18n] missing translation key: ${key}`)
}

function resolveKey(dict: unknown, key: string): string | undefined {
  const parts = key.split('.')
  let cur: unknown = dict
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return typeof cur === 'string' ? cur : undefined
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const v = params[name as string]
    return v === undefined ? match : String(v)
  })
}

export function translate(
  locale: Locale,
  key: DictKey | string,
  params?: Record<string, string | number>,
): string {
  const primary = resolveKey(DICTS[locale], key)
  if (primary !== undefined) return interpolate(primary, params)
  const fallback = resolveKey(DICTS.en, key)
  if (fallback !== undefined) return interpolate(fallback, params)
  warnMissingOnce(key)
  return key
}

export function useT(): (key: DictKey, params?: Record<string, string | number>) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback(
    (key: DictKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )
}

export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale)
}

export function useSetLocale(): (l: Locale) => void {
  return useLocaleStore((s) => s.setLocale)
}
