import { lazy, Suspense, useEffect, useRef } from 'react'
import { useGraphStore } from './store/graphStore'
import { useNotesStore } from './store/notesStore'
import { useSchemaStore } from './store/schemaStore'
import { useViewStore } from './store/viewStore'
import { makeTabId, useWorkspaceStore } from './store/workspaceStore'
import { loadTab, restoreViewportOnly, snapshotTab } from './store/tabStateStore'
import { useUrlSync } from './store/urlSync'
import { useTheme } from './hooks/useTheme'
import { useFontSize } from './hooks/useFontSize'
import { api } from './lib/api'
import { GraphCanvas } from './components/GraphCanvas'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { FilterPanel } from './components/FilterPanel'
import { SyncBanner } from './components/SyncBanner'
import { Onboarding } from './components/Onboarding'
import { ContextMenu } from './components/ContextMenu'

// Code-split conditional surfaces. DetailPanel pulls in `marked`; the three
// modals are heavy and only open on user action — splitting them keeps the
// initial bundle lean.
const DetailPanel = lazy(() => import('./components/DetailPanel').then((m) => ({ default: m.DetailPanel })))
const SyncHistoryModal = lazy(() =>
  import('./components/SyncHistoryModal').then((m) => ({ default: m.SyncHistoryModal })),
)
const CoverageModal = lazy(() => import('./components/CoverageModal').then((m) => ({ default: m.CoverageModal })))
const SettingsPage = lazy(() => import('./components/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ShortcutsModal = lazy(() => import('./components/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal })))
const NotesModal = lazy(() => import('./components/notes/NotesModal').then((m) => ({ default: m.NotesModal })))

export function App() {
  useTheme()
  useFontSize()
  useUrlSync()
  const graph = useGraphStore((s) => s.graph)
  const status = useGraphStore((s) => s.status)
  const error = useGraphStore((s) => s.error)
  const loadGraph = useGraphStore((s) => s.load)
  const loadSchema = useSchemaStore((s) => s.load)
  const loadNotes = useNotesStore((s) => s.load)
  const focusedId = useViewStore((s) => s.focusedId)
  const filterPanelOpen = useViewStore((s) => s.filterPanelOpen)
  const detailPanelOpen = useViewStore((s) => s.detailPanelOpen)
  const syncHistoryOpen = useViewStore((s) => s.syncHistoryOpen)
  const coverageOpen = useViewStore((s) => s.coverageOpen)
  const settingsOpen = useViewStore((s) => s.settingsOpen)
  const shortcutsOpen = useViewStore((s) => s.shortcutsOpen)
  const notesOpen = useViewStore((s) => s.notesOpen)

  // Bootstrap step 1 — resolve this tab's workspace + tab list BEFORE any
  // graph/schema calls. The fetch helpers in lib/api.ts inject `?w=` from
  // the workspace store, so we have to settle which workspace this tab is
  // on first.
  //
  // Tab list reconciliation:
  //   - If sessionStorage already has tabs (mid-session refresh), keep
  //     them — but prune any whose workspaceId no longer matches a defined
  //     profile (someone edited `.env` and removed one).
  //   - If no tabs yet (cold start) and the URL has `?w=X`, create a single
  //     tab on X.
  //   - Otherwise create one tab per profile (matches the screenshot
  //     reference; users can close extras with × or add more with +).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const ws = await api.fetchWorkspaces()
        if (cancelled) return
        const store = useWorkspaceStore.getState()
        store.setProfiles(ws.profiles)
        store.setLegacyMode(ws.legacyMode)
        store.setDefaultWorkspaceId(ws.active?.id ?? null)

        if (ws.legacyMode || ws.profiles.length === 0) {
          store.setTabs([], null)
        } else {
          const fromUrl = store.currentWorkspaceId
          const validIds = new Set(ws.profiles.map((p) => p.id))
          const existingTabs = store.tabs.filter((t) => validIds.has(t.workspaceId))
          let nextTabs = existingTabs
          let nextActive = existingTabs.some((t) => t.id === store.activeTabId)
            ? store.activeTabId
            : (existingTabs[0]?.id ?? null)

          if (existingTabs.length === 0) {
            // Cold start. Either the URL pinned a workspace, or we
            // pre-populate one tab per profile so the user can ⌘N straight
            // away without having to + each one.
            const seedIds =
              fromUrl && validIds.has(fromUrl)
                ? [fromUrl]
                : ws.profiles.map((p) => p.id)
            nextTabs = seedIds.map((id) => ({ id: makeTabId(), workspaceId: id }))
            const preferred =
              fromUrl && validIds.has(fromUrl)
                ? nextTabs.find((t) => t.workspaceId === fromUrl)
                : nextTabs.find((t) => t.workspaceId === ws.active?.id) ?? nextTabs[0]
            nextActive = preferred?.id ?? nextTabs[0]?.id ?? null
          } else if (fromUrl && validIds.has(fromUrl)) {
            // Persisted tabs survived. Only override the active tab when
            // the *saved* active doesn't already match the URL's workspace
            // — otherwise we'd jump from the user's actual last tab to
            // whichever matching tab happens to be first in the list (a
            // problem when multiple tabs share a workspace).
            const activeTab = existingTabs.find((t) => t.id === nextActive)
            const activeMatchesUrl = activeTab?.workspaceId === fromUrl
            if (!activeMatchesUrl) {
              const match = existingTabs.find((t) => t.workspaceId === fromUrl)
              if (match) {
                nextActive = match.id
              } else {
                const id = makeTabId()
                nextTabs = [...existingTabs, { id, workspaceId: fromUrl }]
                nextActive = id
              }
            }
          }

          store.setTabs(nextTabs, nextActive)
        }
      } catch {
        // Backend unreachable — proceed unscoped. Step 2 will surface the
        // real error via loadGraph's normal error path.
      } finally {
        if (!cancelled) useWorkspaceStore.getState().setInitialized(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Bootstrap step 2 — once the active tab is settled, load (or re-load)
  // graph + schema. Re-runs whenever the user switches tabs (activeTabId
  // changes) — including when a close-tab action shifts focus to a sibling.
  //
  // Tab snapshot lifecycle:
  //   - The action that switches tabs (TabBar click, Cmd+N, etc.) is
  //     responsible for `snapshotTab(prevTabId)` so this effect doesn't
  //     have to. Snapshot before switch keeps the current viewStore +
  //     graphStore as-is.
  //   - This effect calls `loadTab(activeTabId)` to either restore the
  //     target's snapshot (filters, focus, chain return) or reset to
  //     defaults (first visit to that tab).
  //   - Restored snapshots already have a graph in store, so we do a
  //     silent background refresh; cold starts run a normal `loadGraph()`.
  //
  // The previous-tab ref is critical: on initial mount, prev is null and
  // we intentionally skip restore so URL-encoded view state (filters,
  // focus from the URL bar) survives the first render.
  const initialized = useWorkspaceStore((s) => s.initialized)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const refetchSilent = useGraphStore((s) => s.refetchSilent)
  const prevTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialized) return
    const prev = prevTabIdRef.current
    let restored = false
    if (prev !== null && prev !== activeTabId && activeTabId) {
      // Tab switched: snapshot/restore the new tab's view state.
      restored = loadTab(activeTabId)
    }
    prevTabIdRef.current = activeTabId
    // Re-fetch on tab switch OR same-tab workspace change (the SyncBanner
    // picker repoints the active tab at a different workspace without
    // switching tabs — `currentWorkspaceId` is the dep that catches that).
    if (restored) {
      refetchSilent()
      loadSchema()
    } else {
      loadGraph().then(() => loadSchema())
    }
    // Notes are workspace-scoped and stored independently from graph — load
    // them on every workspace/tab switch so the modal shows the right set.
    loadNotes()
  }, [initialized, activeTabId, currentWorkspaceId, loadGraph, loadSchema, loadNotes, refetchSilent])

  // Background sync poller. After the first load, periodically check whether
  // the backend's TTL-driven bg sync produced fresher data, and if so swap
  // it in silently (no loading-state flash). Cheap call (~12ms cached read);
  // 30s feels responsive without hammering. Skips polling while the page is
  // hidden (battery-friendly + avoids racing the user's tab returning).
  const refetchIfNewer = useGraphStore((s) => s.refetchIfNewer)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      refetchIfNewer()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [refetchIfNewer])

  // Persist the active tab's view + viewport on page unload. Without this,
  // a user who pans / zooms / changes a filter and then refreshes (without
  // first switching tabs) would lose those changes — the regular snapshot
  // path only fires from TabBar clicks and Cmd+1..9. beforeunload runs
  // synchronously, so the localStorage write completes before the page
  // actually goes away.
  useEffect(() => {
    const onBeforeUnload = (): void => {
      const active = useWorkspaceStore.getState().activeTabId
      if (active) snapshotTab(active)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Restore the active tab's viewport on initial page load. View state
  // (filters, focus, view, etc.) comes from URL parsing — that's the
  // share-able source of truth and must win. Viewport isn't in the URL,
  // so this is the one piece that needs separate restoration. Runs once
  // after mount; the bridge has already registered by the time this
  // effect fires (GraphCanvas is a child, its effects run first).
  useEffect(() => {
    const active = useWorkspaceStore.getState().activeTabId
    if (active) restoreViewportOnly(active)
  }, [])

  // Real-time push from the server. Two event types:
  //
  //   - 'designdoc-changed' — the file watcher detected edits in the
  //     **default** workspace's REPO_PATH/openspec/. The watcher only ever
  //     follows the default workspace, so events are tagged with their
  //     `workspaceId` and tabs viewing a different workspace ignore them.
  //   - 'default-workspace-changed' — another tab (or this one) used the
  //     ⭐ "set as default" affordance. Update our local copy of the
  //     server-default so the selector ⭐ glyph stays consistent.
  //
  // EventSource auto-reconnects on network blips; one connection per tab.
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('designdoc-changed', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { workspaceId?: string }
        const cur = useWorkspaceStore.getState().currentWorkspaceId
        if (data.workspaceId && cur && data.workspaceId !== cur) return
      } catch {
        // Malformed payload — fall through and refetch anyway. Better to
        // do an extra silent fetch than miss a real update.
      }
      refetchSilent()
    })
    es.addEventListener('default-workspace-changed', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { activeId?: string }
        if (typeof data.activeId === 'string') {
          useWorkspaceStore.getState().setDefaultWorkspaceId(data.activeId)
        }
      } catch {
        // Ignore — the next /api/workspaces fetch will resync.
      }
    })
    // hello/ping events are no-ops; just keep the stream alive.
    return () => es.close()
  }, [refetchSilent])

  const openInlineSearch = useViewStore((s) => s.openInlineSearch)
  const setChainRootId = useViewStore((s) => s.setChainRootId)
  const bumpLayout = useViewStore((s) => s.bumpLayout)

  // Hybrid Cmd+F:
  //   - When the canvas is focused (or the user is hovering it after clicking
  //     into it) → intercept Cmd+F and open the inline finder.
  //   - When focus is elsewhere (toolbar input, sidebar, modal) → don't
  //     intercept, let the browser's native page search run.
  // Cmd+Shift+S still always screenshots.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc peels one layer at a time, in priority order — top-most
        // dismissable surface first. Modals (Settings / SyncHistory /
        // Coverage / Shortcuts) own Esc fully and handle their own
        // dismissal; we don't peel under them.
        //
        //   1. Find on canvas        — closes Find
        //   2. Context menu          — closes the menu
        //   3. DetailPanel open      — closes the panel (focus retained,
        //                               chain mode / find / connectivity
        //                               highlights still work on the
        //                               focused issue)
        //   4. focusedId             — clears the focus
        //   5. Chain isolation       — clears chain
        //
        // Two-step Esc for DetailPanel: first Esc closes the panel
        // without losing the focused issue (graph-first workflow), second
        // Esc unfocuses. Most apps with a side detail panel work this way.
        const s = useViewStore.getState()
        const modalOpen = s.settingsOpen || s.syncHistoryOpen || s.coverageOpen || s.shortcutsOpen || s.notesOpen
        if (modalOpen) return
        if (s.inlineSearch.open) {
          s.closeInlineSearch()
          return
        }
        if (s.contextMenu) {
          s.setContextMenu(null)
          return
        }
        if (s.detailPanelOpen) {
          s.setDetailPanelOpen(false)
          return
        }
        if (s.focusedId) {
          s.setFocusedId(null)
          return
        }
        if (s.chainRootId) {
          setChainRootId(null)
          return
        }
      }
      // Cmd/Ctrl+1..9 — switch to the Nth in-app tab (1-based, by position
      // in the tab bar). Only fires outside text inputs; doesn't intercept
      // when the user is typing into a filter, annotation textarea, etc.
      // Snapshots the previous tab's state before the switch so coming back
      // via Cmd+N feels instant.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        const ws = useWorkspaceStore.getState()
        if (ws.legacyMode || ws.tabs.length === 0) return
        const idx = parseInt(e.key, 10) - 1
        const targetTab = ws.tabs[idx]
        if (!targetTab) return
        e.preventDefault()
        if (targetTab.id === ws.activeTabId) return
        if (ws.activeTabId) snapshotTab(ws.activeTabId)
        ws.setActiveTab(targetTab.id)
        return
      }
      // Space / Enter — open the DetailPanel for the currently-focused
      // issue. Ad-hoc one-shot: doesn't change the auto-open preference.
      // Useful when auto-open is OFF (graph-first workflow) and the user
      // occasionally wants to peek at an issue's details. No-op if panel
      // is already open, or if no issue is focused.
      if ((e.key === ' ' || e.key === 'Enter') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        const s = useViewStore.getState()
        if (!s.focusedId) return
        if (s.detailPanelOpen) return
        e.preventDefault()
        s.setDetailPanelOpen(true)
        return
      }
      // 'c' / 'C' — isolate chain on the currently focused issue. 'C' (shift)
      // additionally bumps layout, matching the "auto-layout" context-menu
      // entry. Only fires when no modifier is held, no input is focused,
      // and an issue is actually focused. Works in all views: chain
      // isolation re-filters the visible set to the connected blocks
      // component regardless of view.
      if (e.key === 'c' || e.key === 'C') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        const s = useViewStore.getState()
        if (!s.focusedId) return
        e.preventDefault()
        setChainRootId(s.focusedId)
        if (e.key === 'C') bumpLayout()
        return
      }
      // '?' — open the keyboard shortcut cheat sheet. Works anywhere except
      // inside an input. On most layouts '?' is Shift+/ — we accept the
      // resolved character regardless of which physical keys produced it.
      if (e.key === '?') {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        e.preventDefault()
        useViewStore.getState().setShortcutsOpen(true)
        return
      }
      // 'n' — toggle the workspace notes modal. Same input-focus guards as
      // other letter shortcuts. When the modal is closed, pressing n reopens
      // it on whatever the user was last viewing (grid OR a specific note's
      // editor). Use the in-modal Back / Esc to peel editor → grid.
      if (e.key === 'n') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        e.preventDefault()
        const s = useViewStore.getState()
        s.setNotesOpen(!s.notesOpen)
        return
      }
      // 'r' — toggle the Related-edges overlay (dependency view only). The
      // case-shifted variant 'R' (Shift+R) is reserved for re-layout below.
      // Same input-focus guards as the other letter shortcuts.
      if (e.key === 'r') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        const s = useViewStore.getState()
        if (s.activeView !== 'dependency') return
        e.preventDefault()
        s.setShowRelated(!s.showRelated)
        return
      }
      // 'R' (Shift+R) — re-layout. Bumps layoutBump → dagre re-runs from
      // scratch (discards user-dragged positions) → camera follows. Works
      // in any view, doesn't require a focused issue.
      if (e.key === 'R') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        e.preventDefault()
        bumpLayout()
        return
      }
      // Cmd/Ctrl+Shift+F → focus the toolbar's filter search box. Distinct
      // from Cmd+F (which opens the inline find-on-canvas). Pre-selects any
      // existing query for fast replace, mirroring InlineSearch's reopen
      // behavior. Always intercepts — there's no useful native browser
      // action for this combo.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        const el = document.getElementById('toolbar-search') as HTMLInputElement | null
        if (el) {
          el.focus()
          el.select()
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const el = document.querySelector('.react-flow') as HTMLElement | null
        if (!el) return
        // Lazy-load html-to-image (~50kB) only when the user actually screenshots.
        const { toPng } = await import('html-to-image')
        const dataUrl = await toPng(el, { cacheBust: true })
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `issue-graph-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        // Plain Cmd+F (no Shift) — inline canvas finder. The Cmd+Shift+F
        // case is handled above and returns early; this guard keeps that
        // branch from also firing here when shift is held.
        const canvas = document.querySelector('.canvas') as HTMLElement | null
        if (!canvas) return
        const active = document.activeElement
        const focusInCanvas = active === canvas || (active && canvas.contains(active)) || active === document.body
        if (focusInCanvas) {
          e.preventDefault()
          const s = useViewStore.getState()
          if (s.inlineSearch.open) {
            // Bar is already mounted (e.g. user pressed Enter which blurs
            // the input but keeps the bar visible). Calling
            // openInlineSearch() here would be a no-op — `open` is already
            // true, so the focus-on-open useEffect inside InlineSearch
            // doesn't re-fire. Refocus the input directly so the user can
            // type again.
            const el = document.getElementById('inline-search') as HTMLInputElement | null
            if (el) {
              el.focus()
              el.select()
            }
          } else {
            openInlineSearch()
          }
        }
        // else: focus is in toolbar/sidebar/modal — let the browser handle Cmd+F.
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openInlineSearch, setChainRootId, bumpLayout])

  // Onboarding when backend unconfigured AND no cached data.
  if (graph?.authError && (graph?.data.issues.length ?? 0) === 0) {
    return (
      <div className="app-shell">
        <SyncBanner />
        <TabBar />
        <Onboarding />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <SyncBanner />
      <TabBar />
      <Toolbar />
      <div className="app-main">
        {filterPanelOpen && <FilterPanel />}
        <GraphCanvas />
        {focusedId && detailPanelOpen && (
          <Suspense fallback={null}>
            <DetailPanel />
          </Suspense>
        )}
      </div>
      {status === 'error' && error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <Suspense fallback={null}>
        {syncHistoryOpen && <SyncHistoryModal />}
        {coverageOpen && <CoverageModal />}
        {settingsOpen && <SettingsPage />}
        {shortcutsOpen && <ShortcutsModal />}
        {notesOpen && <NotesModal />}
      </Suspense>
      <ContextMenu />
    </div>
  )
}
