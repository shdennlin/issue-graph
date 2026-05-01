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
    case 'canceled': return 'Cancelled'
    case 'triage': return 'Triage'
    default: return stateType
  }
}
