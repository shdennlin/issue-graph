import { useEffect } from 'react'
import { useGraphStore } from './store/graphStore'
import { useSchemaStore } from './store/schemaStore'
import { useViewStore } from './store/viewStore'
import { useUrlSync } from './store/urlSync'
import { useTheme } from './hooks/useTheme'
import { GraphCanvas } from './components/GraphCanvas'
import { Toolbar } from './components/Toolbar'
import { FilterPanel } from './components/FilterPanel'
import { SyncBanner } from './components/SyncBanner'
import { Onboarding } from './components/Onboarding'
import { DetailPanel } from './components/DetailPanel'
import { SyncHistoryModal } from './components/SyncHistoryModal'
import { SettingsPage } from './components/SettingsPage'
import { ContextMenu } from './components/ContextMenu'
import { toPng } from 'html-to-image'

export function App() {
  useTheme()
  useUrlSync()
  const graph = useGraphStore((s) => s.graph)
  const status = useGraphStore((s) => s.status)
  const error = useGraphStore((s) => s.error)
  const loadGraph = useGraphStore((s) => s.load)
  const loadSchema = useSchemaStore((s) => s.load)
  const focusedId = useViewStore((s) => s.focusedId)

  useEffect(() => {
    loadGraph().then(() => loadSchema())
  }, [loadGraph, loadSchema])

  // Cmd+Shift+S → screenshot.
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        <FilterPanel />
        <GraphCanvas />
        {focusedId && <DetailPanel />}
      </div>
      {status === 'error' && error && (
        <div className="banner" style={{ background: 'var(--danger)', color: '#fff' }}>
          {error}
        </div>
      )}
      <SyncHistoryModal />
      <SettingsPage />
      <ContextMenu />
    </div>
  )
}
