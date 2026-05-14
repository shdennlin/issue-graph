// Candidate types for the quick switcher.
// Discriminated by `kind` so activation handlers can route deterministically.

export interface IssueCandidate {
  kind: 'issue'
  /** Stable id used for dedup + recents. `${tabId}:${identifier}`. */
  id: string
  /** e.g. "ONE-123 Fix login crash". */
  label: string
  /** "ONE-123" — used for ID-prefix bonus in fuzzy match. */
  identifier: string
  /** Tab the issue lives in. */
  tabId: string
  /** Workspace/project display name, shown as the scope tag. */
  scopeLabel: string
  /** Secondary muted text (labels joined). */
  hint: string
  /** Workflow state (name + type). Omitted when restored from recents. */
  state?: { name: string; type: string }
}

export interface NoteCandidate {
  kind: 'note'
  /** `${tabId}:${noteId}`. */
  id: string
  noteId: number
  label: string
  tabId: string
  scopeLabel: string
  /** Body snippet (first ~80 chars after title). */
  hint: string
}

export interface TabCandidate {
  kind: 'tab'
  /** `tab:${tabId}`. */
  id: string
  label: string
  tabId: string
  /** Empty for tab kind — the tab IS the scope. */
  scopeLabel: ''
  hint: string
}

export type Candidate = IssueCandidate | NoteCandidate | TabCandidate

export interface RecentItem {
  /** Mirrors `Candidate.id`. */
  id: string
  kind: Candidate['kind']
  label: string
  tabId: string
  /** For issues: identifier; for notes: noteId; for tabs: undefined. */
  ref?: string | number
  scopeLabel: string
}
