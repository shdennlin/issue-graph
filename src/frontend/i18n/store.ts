// Locale store. Tiny Zustand slice that persists the active locale to
// localStorage and keeps `<html lang>` in sync. The initial value is read
// once at module-load: explicit user choice in localStorage wins, otherwise
// we sniff `navigator.language` and persist whatever we picked so future
// loads (and SSR-style cold starts) don't re-detect.

import { create } from 'zustand'

export type Locale = 'en' | 'zh-TW'

const STORAGE_KEY = 'ig-locale-v1'

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-TW', label: '繁體中文' },
]

function detectFromNavigator(): Locale {
  if (typeof navigator === 'undefined') return 'en'
  const langs = [navigator.language, ...(navigator.languages ?? [])]
  for (const raw of langs) {
    if (!raw) continue
    const lower = raw.toLowerCase()
    if (lower === 'zh-tw' || lower === 'zh-hant' || lower === 'zh-hk' || lower.startsWith('zh-tw') || lower.startsWith('zh-hant') || lower.startsWith('zh-hk')) {
      return 'zh-TW'
    }
  }
  return 'en'
}

function readStored(): Locale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    if (raw === 'en' || raw === 'zh-TW') return raw
  } catch {
    /* private mode — fall through to detection */
  }
  return null
}

function persist(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(STORAGE_KEY, locale)
  } catch {
    /* full quota / disabled storage shouldn't break the UI */
  }
}

function applyHtmlLang(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
}

const initial: Locale = (() => {
  const stored = readStored()
  if (stored) return stored
  const detected = detectFromNavigator()
  // Persist the auto-detected default on first run so the choice is
  // observable + stable across reloads (no surprise re-detection if the user
  // later changes browser language but already saw the app in their original
  // locale).
  persist(detected)
  return detected
})()

interface LocaleState {
  locale: Locale
  setLocale: (l: Locale) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initial,
  setLocale: (l) => {
    persist(l)
    applyHtmlLang(l)
    set({ locale: l })
  },
}))

// Apply the initial value to <html lang> on module load. Idempotent — safe
// to call multiple times if the module is hot-reloaded.
applyHtmlLang(initial)

// Test-only helpers: pure detection / read so we can unit-test the
// auto-detect logic without touching the live Zustand store.
export const __testing__ = { detectFromNavigator, readStored, STORAGE_KEY }
