// Linear-ish color → CSS. Linear ships hex strings already in `color` fields, so we mostly
// pass through, with a fallback when a color is missing.

export function labelColor(hex: string | null | undefined): string {
  if (!hex) return 'var(--chip-bg)'
  if (/^#[0-9a-fA-F]{3,8}$/.test(hex)) return hex
  return 'var(--chip-bg)'
}

export function priorityClass(p: number | null | undefined): string {
  return `priority-dot priority-${p ?? 0}`
}

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
