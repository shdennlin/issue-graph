import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { useQuickSwitcherStore } from '../store/quickSwitcherStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useGraphStore } from '../store/graphStore'
import { useNotesStore } from '../store/notesStore'
import { getTabGraph } from '../store/tabStateStore'
import { buildCandidates } from './quickSwitcher/buildCandidates'
import { fuzzyIndices, fuzzyMatch } from './quickSwitcher/fuzzyMatch'
import { resolveRecents } from './quickSwitcher/resolveRecents'
import { rankCandidates } from './quickSwitcher/rankCandidates'
import type { Candidate, RecentItem } from './quickSwitcher/types'
import type { SearchHit } from '@shared/types.js'
import { api } from '../lib/api'
import { attachDescriptionHits, descriptionOnlyScore, type DescriptionMatch } from './quickSwitcher/descriptionHits'
import { priorityLabelFor, stateColorVar, stateIcon } from '../lib/colors'
import { formatRelative } from '../lib/relativeTime'
import { useLocale } from '../i18n'

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

  // Description search: titles are matched here, descriptions on the server
  // (they are not in the graph payload by design). Debounced, one request per
  // workspace that has an open tab, and keyed by the query it answered so a
  // slow reply can never decorate the results of a later query.
  const [descResult, setDescResult] = useState<{ query: string; byWorkspace: Record<string, SearchHit[]>; indexing: boolean } | null>(null)
  const workspaceIds = useMemo(() => [...new Set(tabs.map((t) => t.workspaceId))], [tabs])
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) return
    const ctl = new AbortController()
    const timer = window.setTimeout(() => {
      Promise.all(
        workspaceIds.map((wid) =>
          api.searchIssueText(q, wid, ctl.signal)
            .then((r) => [wid, r] as const)
            .catch(() => [wid, { hits: [] as SearchHit[], indexing: false }] as const),
        ),
      ).then((pairs) => {
        if (ctl.signal.aborted) return
        setDescResult({
          query: q,
          byWorkspace: Object.fromEntries(pairs.map(([w, r]) => [w, r.hits])),
          indexing: pairs.some(([, r]) => r.indexing),
        })
      })
    }, 180)
    return () => { window.clearTimeout(timer); ctl.abort() }
  }, [open, query, workspaceIds])

  const descMatches = useMemo<Map<string, DescriptionMatch>>(() => {
    if (!descResult || descResult.query !== query.trim()) return new Map()
    const wsOfTab = (tabId: string) => tabs.find((t) => t.id === tabId)?.workspaceId
    return attachDescriptionHits(candidates, wsOfTab, descResult.byWorkspace)
  }, [descResult, query, candidates, tabs])

  // Score + group.
  const grouped = useMemo(() => {
    const out: Record<Candidate['kind'], Candidate[]> = { issue: [], note: [], tab: [] }
    if (query.trim() === '') {
      return out
    }
    const ranked = rankCandidates(candidates, query, activeTabId, (c) => {
      const title = fuzzyMatch(query, { label: c.label, identifier: c.kind === 'issue' ? c.identifier : null })
      if (title !== null) return title
      const d = descMatches.get(c.id)
      return d ? descriptionOnlyScore(d.order) : null
    })
    let total = 0
    for (const c of ranked) {
      if (total >= TOTAL_CAP) break
      if (out[c.kind].length >= PER_GROUP_CAP) continue
      out[c.kind].push(c)
      total++
    }
    return out
  }, [candidates, query, activeTabId, descMatches])

  const flat = useMemo<Candidate[]>(() => {
    if (query.trim() === '') {
      // A recent is a label-only record; resolve it to the live candidate so the
      // row shows current state/assignee and the click lands in a tab that exists.
      return resolveRecents(recents, candidates, recentToCandidate)
    }
    return GROUP_ORDER.flatMap((k) => grouped[k])
  }, [query, grouped, recents, candidates])

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
  const indexingNote = !showingRecents && descResult?.query === query.trim() && descResult.indexing

  // The workspace tag only earns its space when it tells rows apart.
  const showScope = new Set(candidates.map((c) => c.scopeLabel).filter(Boolean)).size > 1

  return (
    <div
      className="qs-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Quick switcher"
      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="qs-panel">
        <input
          ref={inputRef}
          className="qs-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search issues, notes, tabs…"
        />
        <div ref={listRef} className="qs-list">
          {indexingNote && (
            <div className="qs-note">
              Indexing issue descriptions (first sync) — description matches will appear shortly. Retype to refresh.
            </div>
          )}
          {flat.length === 0 && (
            <div className="qs-empty">
              {showingRecents ? 'No recents yet — start typing.' : 'No matches.'}
            </div>
          )}
          {showingRecents
            ? flat.map((c, i) => (
                <Row key={c.id} idx={i} c={c} selected={i === selectedIdx} showScope={showScope}
                     onClick={() => activate(i, false)} groupHeader={i === 0 ? 'Recent' : null} query="" descHit={null} />
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
                    showScope={showScope}
                    onClick={() => activate(offset + i, false)}
                    groupHeader={i === 0 ? GROUP_LABEL[kind] : null}
                    query={query}
                    descHit={descMatches.get(c.id)?.hit ?? null}
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

/** Split `text` into runs, marking the characters the query matched on. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  const idx = q ? fuzzyIndices(q, text) : null
  if (!idx || idx.length === 0) return <>{text}</>
  const hit = new Set(idx)
  const out: React.ReactNode[] = []
  let i = 0
  while (i < text.length) {
    const on = hit.has(i)
    let j = i
    while (j < text.length && hit.has(j) === on) j++
    const run = text.slice(i, j)
    out.push(on ? <mark key={i}>{run}</mark> : <span key={i}>{run}</span>)
    i = j
  }
  return <>{out}</>
}

/** Paint explicit [start, end) ranges — the server already decided what matched. */
function Ranges({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const out: React.ReactNode[] = []
  let at = 0
  ranges.forEach(([s, e], k) => {
    if (s > at) out.push(<span key={`t${k}`}>{text.slice(at, s)}</span>)
    out.push(<mark key={`m${k}`}>{text.slice(s, e)}</mark>)
    at = e
  })
  if (at < text.length) out.push(<span key="tail">{text.slice(at)}</span>)
  return <>{out}</>
}

function Row({
  idx, c, selected, onClick, groupHeader, query, descHit, showScope,
}: {
  idx: number
  c: Candidate
  selected: boolean
  onClick: () => void
  groupHeader: string | null
  query: string
  descHit: SearchHit | null
  showScope: boolean
}) {
  const locale = useLocale()

  // One line of facts, always in the same order: state, who, where, how urgent,
  // how fresh. Labels are not here — a comma-joined run of them was the noisiest
  // thing on the row and is no help picking between two issues.
  const facts: React.ReactNode[] = []
  if (c.kind === 'issue') {
    if (c.state) {
      facts.push(
        <span key="state" className="qs-state" style={{ color: stateColorVar(c.state.type) }}>
          <span aria-hidden>{stateIcon(c.state.type)}</span>
          {c.state.name}
        </span>,
      )
    }
    if (c.assignee) facts.push(<span key="who">{c.assignee}</span>)
    if (c.project) facts.push(<span key="proj">{c.project}</span>)
    if (c.priority) facts.push(<span key="prio">{priorityLabelFor(c.priority, locale)}</span>)
    if (c.updatedAt && Number.isFinite(c.updatedAt)) facts.push(<span key="when">{formatRelative(c.updatedAt)}</span>)
  } else if (c.hint) {
    facts.push(<span key="hint">{c.hint}</span>)
  }

  return (
    <>
      {groupHeader && <div className="qs-group">{groupHeader}</div>}
      <div
        data-idx={idx}
        className={`qs-row${selected ? ' is-selected' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); onClick() }}
      >
        <div className="qs-main">
          <span className="qs-title">
            <Highlighted text={c.label} query={query} />
          </span>
          {descHit && (
            <div className="qs-snippet">
              <FileText size={13} aria-label="Description" />
              <span><Ranges text={descHit.snippet} ranges={descHit.ranges} /></span>
            </div>
          )}
          {facts.length > 0 && (
            <div className="qs-facts">
              {facts.flatMap((f, i) => (i === 0 ? [f] : [<span key={`sep${i}`} className="qs-sep" aria-hidden>·</span>, f]))}
            </div>
          )}
        </div>
        {showScope && c.scopeLabel && <span className="qs-scope">{c.scopeLabel}</span>}
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
