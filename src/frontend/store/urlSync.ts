// Bidirectional URL ↔ store sync. PRD §6.7 codec.
//
// Two-mode history strategy:
// - Significant state changes (view, filter, focus, chain, search,
//   workspace) push a new history entry so Cmd+[ / Cmd+] navigate
//   them like a regular browser back/forward.
// - Preference changes (theme, density, expanded buckets) only
//   replace the current entry — they aren't a user "step" worth
//   stacking up.
//
// Each entry carries a monotonic seq in history.state plus an optional
// viewport so back/forward also restores pan/zoom. seq lets the UI
// figure out whether a popstate went back or forward (and how far
// to/from the freshest entry) for enabling/disabling the
// back/forward buttons.

import { useEffect, useSyncExternalStore } from 'react'
import type { Viewport } from 'reactflow'
import { useViewStore, type ViewId, type ThemeMode, type Density } from './viewStore'
import { useWorkspaceStore } from './workspaceStore'
import type { IssueStateType } from '@shared/types.js'

const STATE_TYPES: IssueStateType[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled', 'triage']

interface HistoryEntryState {
  seq: number
  viewport?: Viewport
}

let nextSeq = 1
let currentSeq = 0
let maxSeq = 0
const pendingRedirectListeners = new Set<() => void>()

function notifyListeners() {
  for (const fn of pendingRedirectListeners) fn()
}

export function canGoBack(): boolean {
  return currentSeq > 0
}
export function canGoForward(): boolean {
  return currentSeq < maxSeq
}

export function subscribeHistoryAvailability(fn: () => void): () => void {
  pendingRedirectListeners.add(fn)
  return () => pendingRedirectListeners.delete(fn)
}

/** React-friendly hook surfacing {canBack, canForward} for nav buttons. */
export function useHistoryAvailability(): { canBack: boolean; canForward: boolean } {
  const stamp = useSyncExternalStore(
    (fn) => subscribeHistoryAvailability(fn),
    () => `${currentSeq}/${maxSeq}`,
    () => `${currentSeq}/${maxSeq}`,
  )
  // stamp triggers re-render; compute fresh values.
  void stamp
  return { canBack: canGoBack(), canForward: canGoForward() }
}

/** Read the viewport stashed in the current history entry, if any. */
export function getHistoryViewport(): Viewport | null {
  const st = window.history.state as HistoryEntryState | null
  return st?.viewport ?? null
}

/** Write the current viewport into the current history entry (debounced
 *  by the caller). Uses replaceState so it doesn't create a new entry. */
export function storeViewportInHistory(vp: Viewport): void {
  const prev = (window.history.state as HistoryEntryState | null) ?? { seq: currentSeq }
  const next: HistoryEntryState = { ...prev, viewport: vp }
  window.history.replaceState(next, '', window.location.href)
}

function csv(arr: string[] | number[]): string | null {
  if (!arr || arr.length === 0) return null
  return arr.join(',')
}

function buildUrl(): string {
  const s = useViewStore.getState()
  const ws = useWorkspaceStore.getState()
  const params = new URLSearchParams()
  // `?w=<id>` is *first* so the most operationally-relevant context (which
  // workspace this tab is viewing) is visible at the front of the URL bar.
  if (ws.currentWorkspaceId) params.set('w', ws.currentWorkspaceId)
  if (s.activeView !== 'dependency') params.set('view', s.activeView)
  if (s.focusedId) params.set('focus', s.focusedId)
  // `detail=1` reflects (and, when arriving via a deep link, drives) the
  // open detail panel. Only meaningful alongside a focused issue.
  if (s.focusedId && s.detailPanelOpen) params.set('detail', '1')
  if (s.chainRootIds.length) params.set('chain', s.chainRootIds.join(','))
  if (s.chainDepthUp !== null) params.set('cdu', String(s.chainDepthUp))
  if (s.chainDepthDown !== null) params.set('cdd', String(s.chainDepthDown))
  if (s.showRelated) params.set('related', '1')
  if (s.theme !== 'auto') params.set('theme', s.theme)
  if (s.density !== 'default') params.set('density', s.density)

  if (!s.filters.activeOnly) params.set('active', '0')
  if (s.filters.myIssuesOnly) params.set('mine', '1')
  if (s.filters.staleOnly) params.set('stale', '1')
  const states = csv(s.filters.stateTypes)
  if (states) params.set('state', states)
  const primaries = csv(s.filters.primaryValues)
  if (primaries) params.set('bucket', primaries)
  const types = csv(s.filters.typeValues)
  if (types) params.set('type', types)
  const prios = csv(s.filters.priorities)
  if (prios) params.set('priority', prios)
  const asg = csv(s.filters.assignees)
  if (asg) params.set('assignee', asg)
  for (const [token, ids] of Object.entries(s.filters.prefixSelections)) {
    if (ids.length) params.set(`pfx_${token}`, ids.join(','))
  }
  if (s.filters.tagIds.length) params.set('tag', s.filters.tagIds.join(','))
  if (s.filters.designdocFilter !== 'all') params.set('designdoc', s.filters.designdocFilter)
  if (s.filters.dueFilter !== 'any') params.set('due', s.filters.dueFilter)
  if (s.expandedBuckets.length) params.set('expand', s.expandedBuckets.join(','))
  if (s.notesOpen) params.set('notes', '1')
  if (s.focusedNoteId !== null) params.set('note', String(s.focusedNoteId))

  const qs = params.toString()
  return qs ? `?${qs}` : window.location.pathname
}

let pending: number | undefined
let lastPushedUrl: string | null = null
let lastSnapshot: { url: string; signature: string } | null = null
// The `location.search` last applied to the stores — by parseUrl (inbound) or
// schedulePush (our own writes). Used to detect an external navigation that
// changed the URL without firing popstate (e.g. a PWA `navigate-existing`
// launch from the Raycast extension), so we can re-apply it on window focus.
let lastAppliedSearch = ''

// "Significant" parts of the URL — when these change, push a new history
// entry so Cmd+[ navigates back to the prior step. Preferences (theme,
// density, expanded) only replace the current entry. Workspace `w` is
// treated as significant because switching workspaces is a major step.
function significantSignature(): string {
  const s = useViewStore.getState()
  const ws = useWorkspaceStore.getState()
  const f = s.filters
  return [
    ws.currentWorkspaceId ?? '',
    s.activeView,
    s.focusedId ?? '',
    s.chainRootIds.join(','),
    s.chainDepthUp === null ? '' : String(s.chainDepthUp),
    s.chainDepthDown === null ? '' : String(s.chainDepthDown),
    s.showRelated ? '1' : '0',
    s.search,
    f.activeOnly ? '1' : '0',
    f.myIssuesOnly ? '1' : '0',
    f.staleOnly ? '1' : '0',
    f.stateTypes.slice().sort().join(','),
    f.stateNames.slice().sort().join(','),
    f.primaryValues.slice().sort().join(','),
    f.typeValues.slice().sort().join(','),
    f.priorities.slice().sort().join(','),
    f.assignees.slice().sort().join(','),
    f.projectIds.slice().sort().join(','),
    f.designdocFilter,
    f.dueFilter,
    Object.entries(f.prefixSelections).map(([k, v]) => `${k}:${v.slice().sort().join(',')}`).sort().join('|'),
    s.notesOpen ? '1' : '0',
    s.focusedNoteId === null ? '' : String(s.focusedNoteId),
  ].join('|')
}

function schedulePush(): void {
  if (pending) window.clearTimeout(pending)
  pending = window.setTimeout(() => {
    const url = buildUrl()
    if (url === lastPushedUrl) return
    const sig = significantSignature()
    const significantChanged = lastSnapshot?.signature !== sig
    lastPushedUrl = url
    if (significantChanged) {
      // New "step" — push a fresh entry. Wipes any forward stack.
      nextSeq++
      currentSeq = nextSeq
      maxSeq = nextSeq
      window.history.pushState({ seq: nextSeq }, '', url)
      lastSnapshot = { url, signature: sig }
      lastAppliedSearch = window.location.search
      notifyListeners()
    } else {
      // Same step, preferences-only change — patch the URL in place.
      const prev = (window.history.state as HistoryEntryState | null) ?? { seq: currentSeq }
      window.history.replaceState({ ...prev, seq: prev.seq }, '', url)
      lastSnapshot = { url, signature: sig }
      lastAppliedSearch = window.location.search
    }
  }, 200)
}

// Translate a `web+issuegraph://<workspace>/<identifier>[?mode=chain]`
// protocol-handler payload into the equivalent query params. Returns null when
// the payload isn't a recognizable protocol URL. `mode=chain` opens the issue's
// dependency chain; otherwise it focuses the issue + opens its detail panel. The
// `active=0` + full state list mirror focusUrl so any issue (incl.
// completed/canceled) is reachable.
export function translateProtocol(raw: string): URLSearchParams | null {
  const m = raw.match(/^web\+issuegraph:(?:\/\/)?(.*)$/i)
  if (!m) return null
  let body = m[1] ?? ''
  let query = ''
  const qi = body.indexOf('?')
  if (qi >= 0) {
    query = body.slice(qi + 1)
    body = body.slice(0, qi)
  }
  const segs = body
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  const identifier = segs[segs.length - 1]
  if (!identifier) return null
  const workspace = segs.length > 1 ? segs[segs.length - 2] : null
  const mode = new URLSearchParams(query).get('mode')

  const p = new URLSearchParams()
  if (workspace) p.set('w', workspace.toLowerCase())
  if (mode === 'chain') {
    p.set('chain', identifier)
  } else {
    p.set('focus', identifier)
    p.set('detail', '1')
  }
  p.set('active', '0')
  p.set('state', 'backlog,unstarted,started,triage,completed,canceled')
  return p
}

function parseUrl(): void {
  lastAppliedSearch = window.location.search
  let params = new URLSearchParams(window.location.search)

  // Protocol-handler entry point: `/?proto=web+issuegraph://...`. Translate it
  // into canonical focus params and rewrite the address bar so buildUrl and the
  // rest of parseUrl operate on the normal query (the `proto` param never sticks).
  const proto = params.get('proto')
  if (proto) {
    const translated = translateProtocol(proto)
    if (translated) {
      window.history.replaceState(window.history.state, '', `?${translated.toString()}`)
      lastAppliedSearch = window.location.search
      params = translated
    }
  }

  const set = useViewStore.setState

  // Apply the URL fully — including resetting fields back to defaults
  // when their param is absent. Without this, popstate-driven back/
  // forward navigation only ever ADDS state, never clears it
  // (e.g. switching Dep → Project then Back leaves activeView=Project
  // because the prior URL had no `?view=` param).
  const w = params.get('w')
  if (w) useWorkspaceStore.getState().setCurrentWorkspaceId(w.toLowerCase())

  const view = params.get('view') as ViewId | null
  set({ activeView: view ?? 'dependency' })

  const focus = params.get('focus')
  // `detail=1` (only honored with a focus) opens the detail panel on arrival —
  // e.g. a deep link from the Raycast extension. parseUrl sets focusedId
  // directly (bypassing setFocusedId's auto-open heuristic), so the panel is
  // driven explicitly here.
  set({ focusedId: focus, detailPanelOpen: focus !== null && params.get('detail') === '1' })
  const chain = params.get('chain')
  set({ chainRootIds: chain ? chain.split(',').filter(Boolean) : [] })
  const parseDepth = (raw: string | null): number | null => {
    if (raw === null) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  set({ chainDepthUp: parseDepth(params.get('cdu')), chainDepthDown: parseDepth(params.get('cdd')) })
  set({ showRelated: params.get('related') === '1' })

  const theme = params.get('theme') as ThemeMode | null
  if (theme === 'light' || theme === 'dark' || theme === 'auto') set({ theme })

  const density = params.get('density') as Density | null
  if (density === 'compact' || density === 'default' || density === 'verbose') {
    set({ density })
  }

  // Filters: build a fresh object from URL — fall back to defaults
  // for any field whose param is absent.
  const filters = {
    activeOnly: params.get('active') !== '0',
    myIssuesOnly: params.get('mine') === '1',
    staleOnly: params.get('stale') === '1',
    stateTypes: (() => {
      const s = params.get('state')
      if (!s) return ['backlog', 'unstarted', 'started', 'triage'] as IssueStateType[]
      return s.split(',').filter((x): x is IssueStateType => STATE_TYPES.includes(x as IssueStateType))
    })(),
    stateNames: [] as string[],
    primaryValues: (params.get('bucket')?.split(',') ?? []),
    typeValues: (params.get('type')?.split(',') ?? []),
    priorities: (params.get('priority')?.split(',').map(Number).filter((n) => !isNaN(n)) ?? []),
    assignees: (params.get('assignee')?.split(',') ?? []),
    projectIds: [] as string[],
    milestoneIds: [] as string[],
    prefixSelections: {} as Record<string, string[]>,
    tagIds: (params.get('tag')?.split(',') ?? []),
    designdocFilter: ((): 'all' | 'has' | 'missing' => {
      const dd = params.get('designdoc')
      return dd === 'has' || dd === 'missing' ? dd : 'all'
    })(),
    dueFilter: ((): 'any' | 'has' | 'overdue' | 'soon7' | 'soon30' => {
      const d = params.get('due')
      return d === 'has' || d === 'overdue' || d === 'soon7' || d === 'soon30' ? d : 'any'
    })(),
  }
  for (const [k, v] of params.entries()) {
    if (k.startsWith('pfx_')) {
      const token = k.slice(4)
      filters.prefixSelections[token] = v.split(',')
    }
  }
  set({ filters })

  set({ expandedBuckets: (params.get('expand')?.split(',') ?? []) })

  const notesOpen = params.get('notes') === '1'
  const noteParam = params.get('note')
  const focusedNoteId = noteParam && /^\d+$/.test(noteParam) ? Number(noteParam) : null
  set({ notesOpen, focusedNoteId })
}

// Module-scope callback bridge for popstate → viewport restore. Set by
// the GraphCanvas bridge so urlSync can hand the viewport stashed in
// history.state to the same restore-after-layout-settles pipeline that
// tab-switch viewport restore uses.
let viewportRestoreSink: ((vp: Viewport) => void) | null = null
export function registerHistoryViewportSink(sink: (vp: Viewport) => void): () => void {
  viewportRestoreSink = sink
  return () => {
    if (viewportRestoreSink === sink) viewportRestoreSink = null
  }
}

export function useUrlSync(): void {
  useEffect(() => {
    parseUrl()
    // Seed the first history entry with seq=0 so we have a sentinel for
    // "no app step yet" — Cmd+[ from here goes to whatever was loaded
    // before our SPA (or no-op at the start of session history).
    if (window.history.state == null || (window.history.state as HistoryEntryState).seq == null) {
      window.history.replaceState({ seq: 0 }, '', window.location.href)
    }
    currentSeq = (window.history.state as HistoryEntryState).seq
    maxSeq = currentSeq
    lastPushedUrl = window.location.search + window.location.pathname
    lastSnapshot = { url: lastPushedUrl, signature: significantSignature() }
    notifyListeners()

    const unsubView = useViewStore.subscribe(() => schedulePush())
    const unsubWorkspace = useWorkspaceStore.subscribe(() => schedulePush())

    const onPopState = (e: PopStateEvent) => {
      // Replay URL into the stores. parseUrl mutates view/workspace
      // stores, which would normally call schedulePush via the
      // subscribers above — guard against that pushing yet another
      // history entry by snapshotting the resulting signature first.
      const incomingState = (e.state as HistoryEntryState | null) ?? { seq: 0 }
      currentSeq = incomingState.seq
      if (currentSeq > maxSeq) maxSeq = currentSeq
      parseUrl()
      // Mark this as the "last seen" so the upcoming subscriber-driven
      // schedulePush doesn't think this is a new step.
      lastPushedUrl = buildUrl()
      lastSnapshot = { url: lastPushedUrl, signature: significantSignature() }
      notifyListeners()
      // Restore viewport (pan/zoom) from history.state if one was
      // stashed when this entry was first pushed/replaced.
      if (incomingState.viewport && viewportRestoreSink) {
        viewportRestoreSink(incomingState.viewport)
      }
    }
    window.addEventListener('popstate', onPopState)

    // External-navigation catch-up. A PWA `navigate-existing` launch (and some
    // other OS-driven navigations) can change location.search WITHOUT a full
    // reload or a popstate — so parseUrl never runs and the focus/detail in the
    // launch URL is ignored. When the window regains focus/visibility, re-apply
    // the URL if it changed out from under us.
    const onExternalNav = () => {
      // Re-apply whenever the URL changed out from under us, regardless of
      // visibility — re-parsing is idempotent and the search-equality guard
      // already makes this a no-op for ordinary focus/visibility flips.
      if (window.location.search === lastAppliedSearch) return
      parseUrl()
      lastPushedUrl = buildUrl()
      lastSnapshot = { url: lastPushedUrl, signature: significantSignature() }
      notifyListeners()
    }
    window.addEventListener('focus', onExternalNav)
    document.addEventListener('visibilitychange', onExternalNav)

    return () => {
      unsubView()
      unsubWorkspace()
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('focus', onExternalNav)
      document.removeEventListener('visibilitychange', onExternalNav)
    }
  }, [])
}
