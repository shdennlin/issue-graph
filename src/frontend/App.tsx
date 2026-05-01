import { useEffect } from 'react'
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
import { DetailPanel } from './components/DetailPanel'
import { SyncHistoryModal } from './components/SyncHistoryModal'
import { CoverageModal } from './components/CoverageModal'
import { SettingsPage } from './components/SettingsPage'
import { ContextMenu } from './components/ContextMenu'
import { toPng } from 'html-to-image'

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

  useEffect(() => {
    loadGraph().then(() => loadSchema())
  }, [loadGraph, loadSchema])

  const openInlineSearch = useViewStore((s) => s.openInlineSearch)

  // Hybrid Cmd+F:
  //   - When the canvas is focused (or the user is hovering it after clicking
  //     into it) → intercept Cmd+F and open the inline finder.
  //   - When focus is elsewhere (toolbar input, sidebar, modal) → don't
  //     intercept, let the browser's native page search run.
  // Cmd+Shift+S still always screenshots.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const el = document.querySelector('.react-flow') as HTMLElement | null
        if (!el) return
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
  }, [openInlineSearch])

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
        {focusedId && <DetailPanel />}
      </div>
      {status === 'error' && error && (
        <div className="banner" style={{ background: 'var(--danger)', color: '#fff' }}>
          {error}
        </div>
      )}
      <SyncHistoryModal />
      <CoverageModal />
      <SettingsPage />
      <ContextMenu />
    </div>
  )
}
