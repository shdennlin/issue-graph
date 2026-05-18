import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuickSwitcherStore } from '../store/quickSwitcherStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useGraphStore } from '../store/graphStore'
import { useNotesStore } from '../store/notesStore'
import { getTabGraph } from '../store/tabStateStore'
import { buildCandidates } from './quickSwitcher/buildCandidates'
import { fuzzyMatch } from './quickSwitcher/fuzzyMatch'
import type { Candidate, RecentItem } from './quickSwitcher/types'
import { stateColorVar, stateIcon } from '../lib/colors'

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

  const flat = useMemo<Candidate[]>(() => {
    if (query.trim() === '') {
      return recents.map<Candidate>((r) => recentToCandidate(r))
    }
    return GROUP_ORDER.flatMap((k) => grouped[k])
  }, [query, grouped, recents])

  // react-hooks/set-state-in-effect: reset selection cursor whenever the
  // candidate list materially changes so the highlight doesn't point past
  // the end of `flat`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIdx(0)
  }, [query, candidates, recents.length])

  // react-hooks/set-state-in-effect: clear the query each time the palette
  // is (re)opened so the user starts from a blank slate.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

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
      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) close() }}
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
  const issueState = c.kind === 'issue' ? c.state : null
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
        {issueState && (
          <span
            title={issueState.name}
            style={{
              fontSize: 11, padding: '1px 6px', borderRadius: 4,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              color: stateColorVar(issueState.type),
              border: `1px solid ${stateColorVar(issueState.type)}`,
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden>{stateIcon(issueState.type)}</span>
            <span>{issueState.name}</span>
          </span>
        )}
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
