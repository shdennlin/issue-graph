# Quick Switcher (Cmd+K) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Linear-style global quick switcher (`Cmd+K`) that fuzzy-searches across issues, notes, and tabs in every open tab, with vim-style nav aliases (`Ctrl+J/K/N/P`), a toolbar trigger button, and persisted recents.

**Architecture:** A single `<QuickSwitcher/>` modal mounted at the App root. It pulls candidates on-open from the existing zustand stores (`workspaceStore`, `graphStore`, `tabStateStore` snapshots, `notesStore`), scores them with a small in-house fuzzy matcher, and dispatches activation to the existing tab-switch / focus / notes-modal handlers. A `quickSwitcherStore` owns `open` state + persisted `recents`. A new `getTabGraph(tabId)` helper in `tabStateStore` exposes per-tab graph snapshots so we can search graphs of non-active tabs.

**Tech Stack:** React 18, TypeScript, zustand, Vitest, ESLint. No new dependencies.

---

## File Structure

**New files:**
- `src/frontend/components/quickSwitcher/types.ts` — `Candidate` discriminated union + `RecentItem`
- `src/frontend/components/quickSwitcher/fuzzyMatch.ts` — pure scorer
- `src/frontend/components/quickSwitcher/fuzzyMatch.test.ts`
- `src/frontend/components/quickSwitcher/buildCandidates.ts` — pure candidate-list builder
- `src/frontend/components/quickSwitcher/buildCandidates.test.ts`
- `src/frontend/components/quickSwitcher/QuickSwitcherTrigger.tsx` — toolbar button
- `src/frontend/components/QuickSwitcher.tsx` — modal UI + keyboard handling
- `src/frontend/store/quickSwitcherStore.ts` — `{ open, recents, openPalette, closePalette, pushRecent }`
- `src/frontend/store/quickSwitcherStore.test.ts`

**Modified files:**
- `src/frontend/store/tabStateStore.ts` — export `getTabGraph(tabId)` reading the module-private `snapshots` map
- `src/frontend/App.tsx` — register `Cmd+K`/`Cmd+P` shortcut, mount `<QuickSwitcher/>`, implement activation dispatcher
- `src/frontend/components/Toolbar.tsx` — mount `<QuickSwitcherTrigger/>` opposite the filter search
- `src/frontend/components/ShortcutsModal.tsx` — document new shortcut + nav aliases

---

## Task 1: Candidate types

**Files:**
- Create: `src/frontend/components/quickSwitcher/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/quickSwitcher/types.ts
git commit -m "feat(quick-switcher): candidate types"
```

---

## Task 2: Fuzzy matcher — failing test

**Files:**
- Create: `src/frontend/components/quickSwitcher/fuzzyMatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { fuzzyScore, fuzzyMatch } from './fuzzyMatch'

describe('fuzzyScore', () => {
  it('returns null when query chars are not all present in order', () => {
    expect(fuzzyScore('xyz', 'abc')).toBeNull()
    expect(fuzzyScore('cba', 'abc')).toBeNull()
  })

  it('returns a positive score for a subsequence match', () => {
    expect(fuzzyScore('abc', 'aXbXc')).not.toBeNull()
  })

  it('scores prefix matches higher than mid-string matches', () => {
    const prefix = fuzzyScore('log', 'login crash')!
    const mid = fuzzyScore('log', 'fix login')!
    expect(prefix).toBeGreaterThan(mid)
  })

  it('scores word-boundary hits higher than mid-word hits', () => {
    const boundary = fuzzyScore('fc', 'fix crash')!
    const midword = fuzzyScore('fc', 'efficacious')!
    expect(boundary).toBeGreaterThan(midword)
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('ABC', 'abc')).toEqual(fuzzyScore('abc', 'abc'))
  })

  it('treats empty query as a match with zero score', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})

describe('fuzzyMatch (with id-prefix bonus)', () => {
  it('boosts items whose identifier starts with the query', () => {
    const withId = fuzzyMatch('one', { label: 'ONE-1 login', identifier: 'ONE-1' })!
    const without = fuzzyMatch('one', { label: 'phone is broken', identifier: null })!
    expect(withId).toBeGreaterThan(without)
  })

  it('returns null when the query matches neither label nor identifier', () => {
    expect(fuzzyMatch('zzz', { label: 'login crash', identifier: 'ONE-1' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/frontend/components/quickSwitcher/fuzzyMatch.test.ts`
Expected: FAIL with "Cannot find module './fuzzyMatch'"

---

## Task 3: Fuzzy matcher — implementation

**Files:**
- Create: `src/frontend/components/quickSwitcher/fuzzyMatch.ts`

- [ ] **Step 1: Write the implementation**

```ts
// Tiny subsequence-based fuzzy scorer. Higher score = better match.
// Bonuses: prefix match, word-boundary hits.
// No new dependency.

const WORD_BOUNDARY = /[\s_\-\/\.:]/

/** Score `text` against `query`. Returns null when query is not a subsequence of text. */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let matchedFirstAtZero = false
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi]
    let found = -1
    for (let i = ti; i < t.length; i++) {
      if (t[i] === qc) { found = i; break }
    }
    if (found === -1) return null
    if (qi === 0 && found === 0) matchedFirstAtZero = true
    if (found > 0 && WORD_BOUNDARY.test(t[found - 1])) score += 8
    score += Math.max(0, 10 - (found - ti)) // closer to previous match = better
    ti = found + 1
  }
  if (matchedFirstAtZero) score += 25 // prefix bonus
  return score
}

export interface FuzzyTarget {
  label: string
  /** Optional identifier (e.g. "ONE-123") for id-prefix bonus. */
  identifier: string | null
}

/** Score against label, with an extra bonus when identifier starts with the query. */
export function fuzzyMatch(query: string, target: FuzzyTarget): number | null {
  const labelScore = fuzzyScore(query, target.label)
  const idScore =
    target.identifier && target.identifier.toLowerCase().startsWith(query.toLowerCase())
      ? 50
      : 0
  if (labelScore === null && idScore === 0) return null
  return (labelScore ?? 0) + idScore
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bunx vitest run src/frontend/components/quickSwitcher/fuzzyMatch.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/quickSwitcher/fuzzyMatch.ts src/frontend/components/quickSwitcher/fuzzyMatch.test.ts
git commit -m "feat(quick-switcher): fuzzy matcher"
```

---

## Task 4: Expose per-tab graph snapshots

**Files:**
- Modify: `src/frontend/store/tabStateStore.ts`

Reason: `buildCandidates` needs read access to inactive tabs' graphs. The module-private `snapshots` map already holds them; we just need a getter. The active tab's graph still comes from `useGraphStore` (snapshots only update when leaving a tab).

- [ ] **Step 1: Add `getTabGraph` export at the bottom of `tabStateStore.ts`**

Insert after the existing `clearAllTabSnapshots` export:

```ts
/** Read a tab's snapshotted graph. Returns null for the active tab
 *  (its graph lives in useGraphStore) and for tabs the user hasn't
 *  visited yet in this session. Callers should fall back accordingly. */
export function getTabGraph(tabId: string): import('@shared/types.js').GraphResponse | null {
  return snapshots.get(tabId)?.graph ?? null
}
```

- [ ] **Step 2: Run lint + typecheck**

Run: `bun run lint && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/store/tabStateStore.ts
git commit -m "feat(tab-state): expose getTabGraph for cross-tab readers"
```

---

## Task 5: buildCandidates — failing test

**Files:**
- Create: `src/frontend/components/quickSwitcher/buildCandidates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildCandidates } from './buildCandidates'
import type { NormalizedIssue, NoteDTO, GraphResponse } from '@shared/types.js'

function issue(id: string, identifier: string, title: string): NormalizedIssue {
  return {
    id, identifier, title,
    url: '', priority: 0 as any,
    state: { name: 'Backlog', type: 'backlog' as any },
    assignee: null, labels: [], parent: null, children: [], relations: [],
    createdAt: '', updatedAt: '', completedAt: null,
  } as NormalizedIssue
}

function graph(issues: NormalizedIssue[]): GraphResponse {
  return { data: { issues, labels: [] } } as unknown as GraphResponse
}

describe('buildCandidates', () => {
  it('flattens issues across tabs with scope labels', () => {
    const candidates = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }, { id: 't2', workspaceId: 'w2' }],
      activeTabId: 't1',
      workspaceName: (id) => (id === 'w1' ? 'Alpha' : 'Beta'),
      activeGraph: graph([issue('a', 'ONE-1', 'Fix login')]),
      snapshotGraph: (tid) => (tid === 't2' ? graph([issue('b', 'TWO-1', 'Bug')]) : null),
      notesByTab: { t1: [], t2: [] },
    })
    const issues = candidates.filter((c) => c.kind === 'issue')
    expect(issues).toHaveLength(2)
    expect(issues.find((c) => c.label.includes('ONE-1'))?.scopeLabel).toBe('Alpha')
    expect(issues.find((c) => c.label.includes('TWO-1'))?.scopeLabel).toBe('Beta')
  })

  it('emits a tab candidate for each open tab', () => {
    const candidates = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }],
      activeTabId: 't1',
      workspaceName: () => 'Alpha',
      activeGraph: null,
      snapshotGraph: () => null,
      notesByTab: { t1: [] },
    })
    expect(candidates.filter((c) => c.kind === 'tab')).toHaveLength(1)
  })

  it('derives note titles from the first non-empty line of body', () => {
    const note: NoteDTO = {
      id: 5, body: '\n  Plan for Q3\nDetails here', sortOrder: 0,
      archived: false, createdAt: 0, updatedAt: 0,
    }
    const [n] = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }],
      activeTabId: 't1',
      workspaceName: () => 'Alpha',
      activeGraph: null,
      snapshotGraph: () => null,
      notesByTab: { t1: [note] },
    }).filter((c) => c.kind === 'note')
    expect(n.label).toBe('Plan for Q3')
  })

  it('skips archived notes', () => {
    const note: NoteDTO = {
      id: 5, body: 'Title', sortOrder: 0,
      archived: true, createdAt: 0, updatedAt: 0,
    }
    const cs = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }],
      activeTabId: 't1',
      workspaceName: () => 'Alpha',
      activeGraph: null,
      snapshotGraph: () => null,
      notesByTab: { t1: [note] },
    })
    expect(cs.filter((c) => c.kind === 'note')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/frontend/components/quickSwitcher/buildCandidates.test.ts`
Expected: FAIL with "Cannot find module './buildCandidates'"

---

## Task 6: buildCandidates — implementation

**Files:**
- Create: `src/frontend/components/quickSwitcher/buildCandidates.ts`

- [ ] **Step 1: Write the implementation**

```ts
import type { Tab } from '../../store/workspaceStore'
import type { GraphResponse, NoteDTO } from '@shared/types.js'
import type { Candidate, IssueCandidate, NoteCandidate, TabCandidate } from './types'

interface Args {
  tabs: Tab[]
  activeTabId: string | null
  workspaceName: (workspaceId: string) => string
  /** Graph for the active tab (lives in useGraphStore). */
  activeGraph: GraphResponse | null
  /** Graph snapshot for a non-active tab (from tabStateStore). null if absent. */
  snapshotGraph: (tabId: string) => GraphResponse | null
  /** Notes are workspace-scoped today. Caller groups by tab; archived filtered downstream. */
  notesByTab: Record<string, NoteDTO[]>
}

function deriveNoteTitle(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (t) return t.replace(/^#+\s*/, '').slice(0, 120)
  }
  return 'Untitled note'
}

function deriveNoteSnippet(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines[1] ?? '').slice(0, 80)
}

export function buildCandidates(args: Args): Candidate[] {
  const out: Candidate[] = []

  // Issues — one pass per tab.
  for (const tab of args.tabs) {
    const isActive = tab.id === args.activeTabId
    const graph = isActive ? args.activeGraph : args.snapshotGraph(tab.id)
    const issues = (graph as any)?.data?.issues as
      | { id: string; identifier: string; title: string; labels: { name: string }[] }[]
      | undefined
    if (!issues) continue
    const scopeLabel = args.workspaceName(tab.workspaceId)
    for (const i of issues) {
      const cand: IssueCandidate = {
        kind: 'issue',
        id: `${tab.id}:${i.identifier}`,
        label: `${i.identifier} ${i.title}`,
        identifier: i.identifier,
        tabId: tab.id,
        scopeLabel,
        hint: i.labels.map((l) => l.name).join(', '),
      }
      out.push(cand)
    }
  }

  // Notes — skip archived.
  for (const tab of args.tabs) {
    const notes = args.notesByTab[tab.id] ?? []
    const scopeLabel = args.workspaceName(tab.workspaceId)
    for (const n of notes) {
      if (n.archived) continue
      const cand: NoteCandidate = {
        kind: 'note',
        id: `${tab.id}:${n.id}`,
        noteId: n.id,
        label: deriveNoteTitle(n.body),
        tabId: tab.id,
        scopeLabel,
        hint: deriveNoteSnippet(n.body),
      }
      out.push(cand)
    }
  }

  // Tabs — one per open tab.
  for (const tab of args.tabs) {
    const cand: TabCandidate = {
      kind: 'tab',
      id: `tab:${tab.id}`,
      label: args.workspaceName(tab.workspaceId),
      tabId: tab.id,
      scopeLabel: '',
      hint: 'Open tab',
    }
    out.push(cand)
  }

  return out
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bunx vitest run src/frontend/components/quickSwitcher/buildCandidates.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/quickSwitcher/buildCandidates.ts src/frontend/components/quickSwitcher/buildCandidates.test.ts
git commit -m "feat(quick-switcher): cross-tab candidate builder"
```

---

## Task 7: quickSwitcherStore — failing test

**Files:**
- Create: `src/frontend/store/quickSwitcherStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useQuickSwitcherStore } from './quickSwitcherStore'
import type { RecentItem } from '../components/quickSwitcher/types'

const sample = (id: string, label = id): RecentItem => ({
  id, kind: 'issue', label, tabId: 't1', scopeLabel: 'Alpha', ref: label,
})

describe('quickSwitcherStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useQuickSwitcherStore.setState({ open: false, recents: [] })
  })

  it('opens and closes the palette', () => {
    useQuickSwitcherStore.getState().openPalette()
    expect(useQuickSwitcherStore.getState().open).toBe(true)
    useQuickSwitcherStore.getState().closePalette()
    expect(useQuickSwitcherStore.getState().open).toBe(false)
  })

  it('pushes recents most-recent-first, deduped, capped at 8', () => {
    const { pushRecent } = useQuickSwitcherStore.getState()
    for (let i = 0; i < 10; i++) pushRecent(sample(`a${i}`))
    const ids = useQuickSwitcherStore.getState().recents.map((r) => r.id)
    expect(ids).toHaveLength(8)
    expect(ids[0]).toBe('a9')
  })

  it('moves an existing recent to the front on re-push', () => {
    const { pushRecent } = useQuickSwitcherStore.getState()
    pushRecent(sample('a'))
    pushRecent(sample('b'))
    pushRecent(sample('a'))
    const ids = useQuickSwitcherStore.getState().recents.map((r) => r.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('persists recents to localStorage', () => {
    useQuickSwitcherStore.getState().pushRecent(sample('a'))
    const raw = localStorage.getItem('issue-graph-quick-switcher-recents')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).recents[0].id).toBe('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/frontend/store/quickSwitcherStore.test.ts`
Expected: FAIL with "Cannot find module './quickSwitcherStore'"

---

## Task 8: quickSwitcherStore — implementation

**Files:**
- Create: `src/frontend/store/quickSwitcherStore.ts`

- [ ] **Step 1: Write the implementation**

```ts
import { create } from 'zustand'
import type { RecentItem } from '../components/quickSwitcher/types'

const STORAGE_KEY = 'issue-graph-quick-switcher-recents'
const MAX_RECENTS = 8

interface PersistedShape {
  version: 1
  recents: RecentItem[]
}

function loadRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PersistedShape
    if (parsed?.version !== 1 || !Array.isArray(parsed.recents)) return []
    return parsed.recents.slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function persistRecents(recents: RecentItem[]): void {
  try {
    const shape: PersistedShape = { version: 1, recents }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  } catch {
    // Quota / private mode — degrade silently.
  }
}

interface QuickSwitcherState {
  open: boolean
  recents: RecentItem[]
  openPalette: () => void
  closePalette: () => void
  pushRecent: (item: RecentItem) => void
}

export const useQuickSwitcherStore = create<QuickSwitcherState>((set, get) => ({
  open: false,
  recents: loadRecents(),
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  pushRecent: (item) => {
    const filtered = get().recents.filter((r) => r.id !== item.id)
    const next = [item, ...filtered].slice(0, MAX_RECENTS)
    persistRecents(next)
    set({ recents: next })
  },
}))
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bunx vitest run src/frontend/store/quickSwitcherStore.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 3: Commit**

```bash
git add src/frontend/store/quickSwitcherStore.ts src/frontend/store/quickSwitcherStore.test.ts
git commit -m "feat(quick-switcher): store with persisted recents"
```

---

## Task 9: QuickSwitcher modal component

**Files:**
- Create: `src/frontend/components/QuickSwitcher.tsx`

This task has no isolated unit test — the component is integration-tested via the manual checklist at the end. Logic that can be tested in isolation already lives in `fuzzyMatch` and `buildCandidates`.

- [ ] **Step 1: Implement the modal**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuickSwitcherStore } from '../store/quickSwitcherStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useGraphStore } from '../store/graphStore'
import { useNotesStore } from '../store/notesStore'
import { getTabGraph } from '../store/tabStateStore'
import { buildCandidates } from './quickSwitcher/buildCandidates'
import { fuzzyMatch } from './quickSwitcher/fuzzyMatch'
import type { Candidate, RecentItem } from './quickSwitcher/types'

const GROUP_ORDER: Candidate['kind'][] = ['issue', 'note', 'tab']
const PER_GROUP_CAP = 20
const TOTAL_CAP = 50

interface Props {
  /** Activation callback owned by App.tsx; routes by kind. */
  onActivate: (cand: Candidate, openInNewTab: boolean) => void
}

export function QuickSwitcher({ onActivate }: Props) {
  const open = useQuickSwitcherStore((s) => s.open)
  const close = useQuickSwitcherStore((s) => s.closePalette)
  const recents = useQuickSwitcherStore((s) => s.recents)
  const pushRecent = useQuickSwitcherStore((s) => s.pushRecent)

  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const profiles = useWorkspaceStore((s) => s.profiles)
  const activeGraph = useGraphStore((s) => s.graph)
  const notes = useNotesStore((s) => s.notes)

  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Build candidates only when the palette is open.
  const candidates = useMemo<Candidate[]>(() => {
    if (!open) return []
    const workspaceName = (wid: string) =>
      profiles.find((p) => p.id === wid)?.name ?? 'Untitled'
    // Notes are workspace-scoped today; group them under the active tab only.
    // (When the app moves to per-tab notes, replace this map.)
    const notesByTab: Record<string, typeof notes> = {}
    if (activeTabId) notesByTab[activeTabId] = notes
    return buildCandidates({
      tabs, activeTabId, workspaceName,
      activeGraph,
      snapshotGraph: getTabGraph,
      notesByTab,
    })
  }, [open, tabs, activeTabId, profiles, activeGraph, notes])

  // Score + group.
  const grouped = useMemo(() => {
    const out: Record<Candidate['kind'], Candidate[]> = { issue: [], note: [], tab: [] }
    if (query.trim() === '') {
      // Show recents as a flat list when query is empty.
      return out
    }
    const scored: { c: Candidate; score: number }[] = []
    for (const c of candidates) {
      const identifier = c.kind === 'issue' ? c.identifier : null
      const score = fuzzyMatch(query, { label: c.label, identifier })
      if (score !== null) scored.push({ c, score })
    }
    scored.sort((a, b) => b.score - a.score)
    let total = 0
    for (const { c } of scored) {
      if (total >= TOTAL_CAP) break
      if (out[c.kind].length >= PER_GROUP_CAP) continue
      out[c.kind].push(c)
      total++
    }
    return out
  }, [candidates, query])

  // Flat ordered list — matches what the user sees, used for keyboard nav.
  const flat = useMemo<Candidate[]>(() => {
    if (query.trim() === '') {
      // Recents map back to Candidate shape for activation.
      return recents.map<Candidate>((r) => recentToCandidate(r))
    }
    return GROUP_ORDER.flatMap((k) => grouped[k])
  }, [query, grouped, recents])

  // Reset selection when results change.
  useEffect(() => { setSelectedIdx(0) }, [query, candidates, recents.length])

  // Autofocus input when opening; reset query on close.
  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep selected row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!open) return null

  const activate = (idx: number, newTab: boolean) => {
    const c = flat[idx]
    if (!c) return
    pushRecent(candidateToRecent(c))
    close()
    onActivate(c, newTab)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    // Plain Ctrl (no meta) aliases — don't fight mac Cmd+K open-shortcut.
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
    const downAlias = ctrlOnly && (e.key === 'j' || e.key === 'n')
    const upAlias = ctrlOnly && (e.key === 'k' || e.key === 'p')
    if (e.key === 'ArrowDown' || downAlias) {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(flat.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp' || upAlias) {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      activate(selectedIdx, e.metaKey || e.ctrlKey)
      return
    }
  }

  const showingRecents = query.trim() === ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick switcher"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        zIndex: 10000, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', paddingTop: '12vh',
      }}
    >
      <div
        className="quick-switcher-panel"
        style={{
          width: 640, maxWidth: '92vw', maxHeight: '70vh',
          background: 'var(--panel-bg, #1e1e1e)', color: 'var(--text, #eee)',
          borderRadius: 8, boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search issues, notes, tabs…"
          style={{
            border: 'none', outline: 'none', padding: '14px 18px',
            fontSize: 16, background: 'transparent', color: 'inherit',
          }}
        />
        <div
          ref={listRef}
          style={{ overflowY: 'auto', borderTop: '1px solid var(--border, #333)' }}
        >
          {flat.length === 0 && (
            <div style={{ padding: 16, opacity: 0.6 }}>
              {showingRecents ? 'No recents yet — start typing.' : 'No matches.'}
            </div>
          )}
          {showingRecents
            ? flat.map((c, i) => (
                <Row key={c.id} idx={i} c={c} selected={i === selectedIdx}
                     onClick={() => activate(i, false)} groupHeader={i === 0 ? 'Recent' : null} />
              ))
            : GROUP_ORDER.flatMap((kind) => {
                const list = grouped[kind]
                if (list.length === 0) return []
                const offset = GROUP_ORDER
                  .slice(0, GROUP_ORDER.indexOf(kind))
                  .reduce((n, k) => n + grouped[k].length, 0)
                return list.map((c, i) => (
                  <Row
                    key={c.id}
                    idx={offset + i}
                    c={c}
                    selected={offset + i === selectedIdx}
                    onClick={() => activate(offset + i, false)}
                    groupHeader={i === 0 ? GROUP_LABEL[kind] : null}
                  />
                ))
              })}
        </div>
      </div>
    </div>
  )
}

const GROUP_LABEL: Record<Candidate['kind'], string> = {
  issue: 'Issues',
  note: 'Notes',
  tab: 'Tabs',
}

function Row({
  idx, c, selected, onClick, groupHeader,
}: {
  idx: number
  c: Candidate
  selected: boolean
  onClick: () => void
  groupHeader: string | null
}) {
  return (
    <>
      {groupHeader && (
        <div style={{ padding: '6px 14px', fontSize: 11, opacity: 0.55, textTransform: 'uppercase' }}>
          {groupHeader}
        </div>
      )}
      <div
        data-idx={idx}
        onMouseDown={(e) => { e.preventDefault(); onClick() }}
        style={{
          padding: '8px 14px', cursor: 'pointer',
          background: selected ? 'var(--row-selected, #2a4a6a)' : 'transparent',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.label}
        </span>
        {c.hint && (
          <span style={{ fontSize: 11, opacity: 0.55, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.hint}
          </span>
        )}
        {c.scopeLabel && (
          <span style={{ fontSize: 11, opacity: 0.7, padding: '1px 6px', border: '1px solid var(--border, #444)', borderRadius: 4 }}>
            {c.scopeLabel}
          </span>
        )}
      </div>
    </>
  )
}

function candidateToRecent(c: Candidate): RecentItem {
  return {
    id: c.id,
    kind: c.kind,
    label: c.label,
    tabId: c.tabId,
    scopeLabel: c.scopeLabel,
    ref: c.kind === 'issue' ? c.identifier : c.kind === 'note' ? c.noteId : undefined,
  }
}

function recentToCandidate(r: RecentItem): Candidate {
  if (r.kind === 'issue') {
    return { kind: 'issue', id: r.id, label: r.label, identifier: String(r.ref ?? ''), tabId: r.tabId, scopeLabel: r.scopeLabel, hint: '' }
  }
  if (r.kind === 'note') {
    return { kind: 'note', id: r.id, noteId: Number(r.ref ?? 0), label: r.label, tabId: r.tabId, scopeLabel: r.scopeLabel, hint: '' }
  }
  return { kind: 'tab', id: r.id, label: r.label, tabId: r.tabId, scopeLabel: '', hint: 'Open tab' }
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/QuickSwitcher.tsx
git commit -m "feat(quick-switcher): modal UI + keyboard nav"
```

---

## Task 10: Toolbar trigger button

**Files:**
- Create: `src/frontend/components/quickSwitcher/QuickSwitcherTrigger.tsx`

- [ ] **Step 1: Implement the trigger**

```tsx
import { useQuickSwitcherStore } from '../../store/quickSwitcherStore'

export function QuickSwitcherTrigger() {
  const open = useQuickSwitcherStore((s) => s.openPalette)
  return (
    <button
      type="button"
      onClick={open}
      title="Quick switcher (⌘K)"
      aria-label="Open quick switcher"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', fontSize: 12, lineHeight: 1.2,
        background: 'transparent', color: 'inherit',
        border: '1px solid var(--border, #444)', borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      <span aria-hidden>🔎</span>
      <span style={{ opacity: 0.75 }}>⌘K</span>
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/quickSwitcher/QuickSwitcherTrigger.tsx
git commit -m "feat(quick-switcher): toolbar trigger button"
```

---

## Task 11: Wire shortcut + mount in App.tsx

**Files:**
- Modify: `src/frontend/App.tsx`

- [ ] **Step 1: Add the import block near the other component imports**

```tsx
import { QuickSwitcher } from './components/QuickSwitcher'
import { useQuickSwitcherStore } from './store/quickSwitcherStore'
import type { Candidate } from './components/quickSwitcher/types'
```

- [ ] **Step 2: Inside the existing keymap effect (around the `Cmd+Shift+F` block at lines 430-484), add the Cmd+K / Cmd+P open-shortcut**

Insert before the existing `Cmd+Shift+F` `if` block:

```tsx
// Cmd/Ctrl+K (and Cmd/Ctrl+P) — open the global quick switcher.
// Only fires when the palette is closed; once open, the modal handles its own keys.
if (
  (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey &&
  (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')
) {
  const qsOpen = useQuickSwitcherStore.getState().open
  if (!qsOpen) {
    e.preventDefault()
    useQuickSwitcherStore.getState().openPalette()
    return
  }
}
```

- [ ] **Step 3: Add the activation handler + render `<QuickSwitcher/>` in the App component's JSX (alongside other root-mounted modals like `ShortcutsModal`)**

```tsx
const onQuickSwitcherActivate = (c: Candidate, openInNewTab: boolean) => {
  if (c.kind === 'tab') {
    useWorkspaceStore.getState().setActiveTab(c.tabId)
    return
  }
  if (c.kind === 'issue') {
    if (openInNewTab) {
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === c.tabId)
      if (tab) {
        const newId = useWorkspaceStore.getState().addTab(tab.workspaceId)
        // After the new tab loads its graph, focus the issue.
        const tryFocus = () => {
          const g = useGraphStore.getState().graph as any
          if (g?.data?.issues?.some((i: any) => i.identifier === c.identifier)) {
            useViewStore.getState().setFocusedId(c.identifier)
          } else {
            setTimeout(tryFocus, 100)
          }
        }
        // small delay so addTab/setActiveTab triggers the workspace load
        setTimeout(tryFocus, 100)
        return
      }
    }
    useWorkspaceStore.getState().setActiveTab(c.tabId)
    useViewStore.getState().setFocusedId(c.identifier)
    return
  }
  if (c.kind === 'note') {
    useWorkspaceStore.getState().setActiveTab(c.tabId)
    useViewStore.getState().setNotesOpen(true)
    useViewStore.getState().setFocusedNoteId(c.noteId)
    return
  }
}
```

And in the JSX:

```tsx
<QuickSwitcher onActivate={onQuickSwitcherActivate} />
```

- [ ] **Step 4: Run lint + typecheck**

Run: `bun run lint && bunx tsc --noEmit`
Expected: no errors. If `setFocusedId` / `setNotesOpen` / `setFocusedNoteId` are named differently in `viewStore.ts`, swap to the actual names — do not invent new APIs.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/App.tsx
git commit -m "feat(quick-switcher): Cmd+K shortcut + activation routing"
```

---

## Task 12: Toolbar mount

**Files:**
- Modify: `src/frontend/components/Toolbar.tsx`

- [ ] **Step 1: Import and place the trigger opposite the existing filter-search input**

Add the import:

```tsx
import { QuickSwitcherTrigger } from './quickSwitcher/QuickSwitcherTrigger'
```

Place `<QuickSwitcherTrigger/>` in the toolbar's right-most/opposite group from the existing filter search. The exact position depends on the toolbar's current flex layout — the rule is: visually separated from the filter search. If the toolbar uses a left/center/right grouping, drop it in the right group.

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/Toolbar.tsx
git commit -m "feat(quick-switcher): toolbar trigger button mount"
```

---

## Task 13: Document the shortcut

**Files:**
- Modify: `src/frontend/components/ShortcutsModal.tsx`

- [ ] **Step 1: Add an entry**

In the same style as existing rows in `ShortcutsModal.tsx`, add:

| Shortcut | Description |
|---|---|
| `Cmd/Ctrl+K` (or `Cmd/Ctrl+P`) | Open quick switcher (search issues, notes, tabs across all open tabs) |
| Inside switcher: `Ctrl+J` / `Ctrl+N` | Move selection down |
| Inside switcher: `Ctrl+K` / `Ctrl+P` | Move selection up |
| Inside switcher: `Cmd+Enter` | Open selected issue in a new tab |

- [ ] **Step 2: Commit**

```bash
git add src/frontend/components/ShortcutsModal.tsx
git commit -m "docs(shortcuts): document quick switcher keys"
```

---

## Task 14: Manual verification

- [ ] **Step 1: Run the dev server**

```bash
bun run dev
```

- [ ] **Step 2: Walk the manual checklist**

In the browser:

1. With one tab open, press `Cmd+K` — palette opens, autofocused.
2. Type 2–3 chars of an issue identifier — issue appears with workspace tag.
3. `↓`, `Ctrl+J`, `Ctrl+N` all move selection down. `↑`, `Ctrl+K`, `Ctrl+P` all move up.
4. `Enter` on issue → tab switches if needed, node selected.
5. `Cmd+Enter` on issue → new tab opens on the same workspace, focuses the issue.
6. Open a second tab on a different workspace. Visit it once (to populate the snapshot), then return to tab 1. Press `Cmd+K`, search for an issue from tab 2 — appears with the other workspace's scope tag.
7. Activate it → switches to tab 2, focuses the node.
8. Empty query → "Recent" header with the items you've just selected.
9. `Esc` closes. Click outside the panel closes. Click on a row activates.
10. IME: switch to a Pinyin/Kana IME, type into the search, press Enter mid-composition — palette does NOT activate (waits for committed text).
11. Press `Cmd+Shift+F` — focuses the toolbar filter search, NOT the palette. (Regression check.)
12. Press `Cmd+F` — opens inline canvas finder, NOT the palette. (Regression check.)
13. Click the toolbar `⌘K` button — palette opens identically.
14. Narrow the window — toolbar trigger still functional (no overflow).

- [ ] **Step 3: Run full test suite**

```bash
bun test
```
Expected: PASS — including the 3 new test files (16+ tests).

- [ ] **Step 4: Final commit if anything tweaked during manual pass**

Only if you made adjustments:

```bash
git add -p
git commit -m "fix(quick-switcher): manual-pass tweaks"
```

---

## Out of scope (do NOT implement here)

- Command/action layer (run "Toggle filters", etc.) — separate feature.
- Indexing unloaded projects on disk — separate feature.
- Per-tab note partitioning — notes are workspace-scoped today; the `notesByTab` map is wired with active tab only, which matches current data shape. When notes become per-tab, update `QuickSwitcher.tsx`'s `notesByTab` build only.
