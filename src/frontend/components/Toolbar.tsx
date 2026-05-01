import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { views } from '../views'
import { api } from '../lib/api'
import { toPng } from 'html-to-image'

export function Toolbar() {
  const activeView = useViewStore((s) => s.activeView)
  const setActiveView = useViewStore((s) => s.setActiveView)
  const density = useViewStore((s) => s.density)
  const setDensity = useViewStore((s) => s.setDensity)
  const theme = useViewStore((s) => s.theme)
  const setTheme = useViewStore((s) => s.setTheme)
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen)
  const selection = useViewStore((s) => s.selection)
  const clearSelection = useViewStore((s) => s.clearSelection)
  const graph = useGraphStore((s) => s.graph)
  const { primaryGroupSingular } = useSchemaStore()

  const exportSelection = () => {
    if (selection.length === 0) return
    const issues = (graph?.data.issues ?? []).filter((i) => selection.includes(i.identifier))
    for (const i of issues) window.open(i.url, '_blank', 'noreferrer')
  }

  const screenshot = async () => {
    const el = document.querySelector('.react-flow') as HTMLElement | null
    if (!el) return
    const dataUrl = await toPng(el, { cacheBust: true })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `issue-graph-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
  }

  return (
    <div className="toolbar">
      <div className="group">
        {views.map((v) => (
          <button
            key={v.id}
            className={activeView === v.id ? 'active' : ''}
            onClick={() => setActiveView(v.id as any)}
            title={v.description}
          >
            {v.label === 'Bucket' && primaryGroupSingular ? primaryGroupSingular + 's' : v.label}
          </button>
        ))}
      </div>
      <div className="sep" />
      <div className="group">
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Density</span>
        <select value={density} onChange={(e) => setDensity(e.target.value as any)}>
          <option value="compact">Compact</option>
          <option value="default">Default</option>
          <option value="verbose">Verbose</option>
        </select>
      </div>
      <div className="sep" />
      <div className="group">
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Theme</span>
        <select value={theme} onChange={(e) => setTheme(e.target.value as any)}>
          <option value="auto">Auto</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div style={{ marginLeft: 'auto' }} className="group">
        {selection.length > 0 && (
          <>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{selection.length} selected</span>
            <button onClick={exportSelection}>Open all</button>
            <button onClick={clearSelection}>Clear</button>
            <div className="sep" />
          </>
        )}
        <a href={api.exportUrl('csv')} download>
          <button>Export CSV</button>
        </a>
        <a href={api.exportUrl('md')} download>
          <button>Export MD</button>
        </a>
        <button onClick={screenshot} title="Cmd+Shift+S">📷</button>
        <button onClick={() => setSettingsOpen(true)}>⚙️</button>
      </div>
    </div>
  )
}
