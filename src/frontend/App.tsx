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
        // Chain isolation is the lowest-priority Esc target: only clear it
        // when nothing else (modal, inline search, context menu) wants Esc.
        const s = useViewStore.getState()
        const modalOpen = s.settingsOpen || s.syncHistoryOpen || s.coverageOpen
        const inlineSearchOpen = s.inlineSearch.open
        const contextMenuOpen = !!s.contextMenu
        if (s.chainRootId && !modalOpen && !inlineSearchOpen && !contextMenuOpen) {
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        const canvas = document.querySelector('.canvas') as HTMLElement | null
        if (!canvas) return
        const active = document.activeElement
        const focusInCanvas = active === canvas || (active && canvas.contains(active)) || active === document.body
        if (focusInCanvas) {
          e.preventDefault()
          openInlineSearch()
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
      </Suspense>
      <ContextMenu />
    </div>
  )
}
