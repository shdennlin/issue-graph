// Locale store. Tiny Zustand slice that persists the active locale to
// localStorage and keeps `<html lang>` in sync. The initial value is read
// once at module-load: explicit user choice in localStorage wins, otherwise
// English. The browser's navigator.language is intentionally NOT consulted —
// English is the canonical default and the user opts into other locales via
// Settings.

import { create } from 'zustand'

export type Locale = 'en' | 'zh-TW'

const STORAGE_KEY = 'ig-locale-v1'
const DEFAULT_LOCALE: Locale = 'en'

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-TW', label: '繁體中文' },
]

function readStored(): Locale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    if (raw === 'en' || raw === 'zh-TW') return raw
  } catch {
    /* private mode — fall through to default */
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

const initial: Locale = readStored() ?? DEFAULT_LOCALE

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

// Test-only helpers: pure read so we can unit-test the storage logic
// without touching the live Zustand store.
export const __testing__ = { readStored, STORAGE_KEY, DEFAULT_LOCALE }
