// Linear-ish color → CSS. Linear ships hex strings already in `color` fields, so we mostly
// pass through, with a fallback when a color is missing.

import { translate, type Locale } from '../i18n'

export function labelColor(hex: string | null | undefined): string {
  if (!hex) return 'var(--chip-bg)'
  if (/^#[0-9a-fA-F]{3,8}$/.test(hex)) return hex
  return 'var(--chip-bg)'
}

export function priorityClass(p: number | null | undefined): string {
  return `priority-dot priority-${p ?? 0}`
}

// English defaults — kept for non-translated callsites and as the source of
// truth for the English locale (the i18n keys for these were derived from
// these strings). Prefer `priorityLabelFor` / `stateLabelFor` when a locale
// is in scope (i.e. inside a React component that calls `useLocale()`).
export function priorityLabel(p: number | null | undefined): string {
  switch (p) {
    case 1: return 'Urgent'
    case 2: return 'High'
    case 3: return 'Medium'
    case 4: return 'Low'
    default: return 'No priority'
  }
}

export function stateLabel(stateType: string): string {
  switch (stateType) {
    case 'started': return 'In Progress'
    case 'unstarted': return 'Todo'
    case 'backlog': return 'Backlog'
    case 'completed': return 'Done'
    case 'canceled': return 'Canceled'
    case 'triage': return 'Triage'
    default: return stateType
  }
}

// Locale-aware variants. Pure functions taking the active locale as an arg
// — fine to call from view-builders, hooks, or any non-React code path.
const PRIORITY_KEY_BY_NUM: Record<number, string> = {
  0: 'filterPanel.priorityNoPriority',
  1: 'filterPanel.priorityUrgent',
  2: 'filterPanel.priorityHigh',
  3: 'filterPanel.priorityMedium',
  4: 'filterPanel.priorityLow',
}

export function priorityLabelFor(p: number | null | undefined, locale: Locale): string {
  const key = PRIORITY_KEY_BY_NUM[p ?? 0] ?? PRIORITY_KEY_BY_NUM[0]!
  return translate(locale, key)
}

// Linear `state.type` → translated label. Names that come back as Linear
// `state.name` (free-form) aren't translated — those are workspace data.
const STATE_KEYS: Record<string, string> = {
  started: 'states.started',
  unstarted: 'states.unstarted',
  backlog: 'states.backlog',
  completed: 'states.completed',
  canceled: 'states.canceled',
  triage: 'states.triage',
}

export function stateLabelFor(stateType: string, locale: Locale): string {
  const key = STATE_KEYS[stateType]
  if (!key) return stateType
  // The dict has `states.*` keys defined in en/zh-TW; fall back to English
  // hard-coded label when missing (e.g. typo-protection during refactors).
  const translated = translate(locale, key)
  if (translated !== key) return translated
  return stateLabel(stateType)
}

// Linear-style state glyph — shape encodes status independently of color
// (color-blind friendly).
export function stateIcon(stateType: string): string {
  switch (stateType) {
    case 'started': return '◐'   // half-filled — in progress
    case 'unstarted': return '○'  // empty circle — todo
    case 'backlog': return '◦'    // small dot — not yet ready
    case 'completed': return '●'  // filled — done (paired with green)
    case 'canceled': return '✕'   // X — cancelled
    case 'triage': return '◑'     // half (right) — needs decision
    default: return '·'
  }
}

// CSS-variable token name for the state's accent color. Defined in tokens.css.
export function stateColorVar(stateType: string): string {
  switch (stateType) {
    case 'started': return 'var(--state-started)'
    case 'unstarted': return 'var(--state-unstarted)'
    case 'backlog': return 'var(--state-backlog)'
    case 'completed': return 'var(--state-completed)'
    case 'canceled': return 'var(--state-canceled)'
    case 'triage': return 'var(--state-triage)'
    default: return 'var(--fg-muted)'
  }
}
