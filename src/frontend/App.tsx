import { lazy, Suspense, useEffect } from 'react'
import { useGraphStore } from './store/graphStore'
import { useSchemaStore } from './store/schemaStore'
import { useViewStore } from './store/viewStore'
import { useUrlSync } from './store/urlSync'
import { useTheme } from './hooks/useTheme'
import { useFontSize } from './hooks/useFontSize'
import { GraphCanvas } from './components/GraphCanvas'
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

export function App() {
  useTheme()
  useFontSize()
  useUrlSync()
  const graph = useGraphStore((s) => s.graph)
  const status = useGraphStore((s) => s.status)
  const error = useGraphStore((s) => s.error)
  const loadGraph = useGraphStore((s) => s.load)
  const loadSchema = useSchemaStore((s) => s.load)
  const focusedId = useViewStore((s) => s.focusedId)
  const filterPanelOpen = useViewStore((s) => s.filterPanelOpen)
  const syncHistoryOpen = useViewStore((s) => s.syncHistoryOpen)
  const coverageOpen = useViewStore((s) => s.coverageOpen)
  const settingsOpen = useViewStore((s) => s.settingsOpen)
  const shortcutsOpen = useViewStore((s) => s.shortcutsOpen)

  useEffect(() => {
    loadGraph().then(() => loadSchema())
  }, [loadGraph, loadSchema])

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
        //   1. Find on canvas       — closes Find
        //   2. Context menu         — closes the menu
        //   3. focusedId            — closes the DetailPanel (focusedId
        //                              drives DetailPanel visibility, so
        //                              clearing it is what the user feels)
        //   4. Chain isolation      — clears chain
        //
        // Inserting focusedId before chain matters because users routinely
        // have both at once: chain isolated, then click an issue to read
        // its details. Without this, Esc would jump straight to clearing
        // the chain — yanking them out of context just to close the panel.
        const s = useViewStore.getState()
        const modalOpen = s.settingsOpen || s.syncHistoryOpen || s.coverageOpen || s.shortcutsOpen
        if (modalOpen) return
        if (s.inlineSearch.open) {
          s.closeInlineSearch()
          return
        }
        if (s.contextMenu) {
          s.setContextMenu(null)
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
      // 'c' / 'C' — isolate chain on the currently focused issue. 'C' (shift)
      // additionally bumps layout, matching the "auto-layout" context-menu
      // entry. Only fires when no modifier is held, no input is focused,
      // we're in dependency view, and an issue is actually focused.
      if (e.key === 'c' || e.key === 'C') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        const s = useViewStore.getState()
        if (s.activeView !== 'dependency') return
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
        <Onboarding />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <SyncBanner />
      <Toolbar />
      <div className="app-main">
        {filterPanelOpen && <FilterPanel />}
        <GraphCanvas />
        {focusedId && (
          <Suspense fallback={null}>
            <DetailPanel />
          </Suspense>
        )}
      </div>
      {status === 'error' && error && (
        <div className="banner" style={{ background: 'var(--danger)', color: '#fff' }}>
          {error}
        </div>
      )}
      <Suspense fallback={null}>
        {syncHistoryOpen && <SyncHistoryModal />}
        {coverageOpen && <CoverageModal />}
        {settingsOpen && <SettingsPage />}
        {shortcutsOpen && <ShortcutsModal />}
      </Suspense>
      <ContextMenu />
    </div>
  )
}
