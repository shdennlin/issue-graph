import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { views } from '../views'
import { api } from '../lib/api'
// Density + theme + search live here; Size moved to Settings → Display.

export function Toolbar() {
  const activeView = useViewStore((s) => s.activeView)
  const setActiveView = useViewStore((s) => s.setActiveView)
  const density = useViewStore((s) => s.density)
  const setDensity = useViewStore((s) => s.setDensity)
  const search = useViewStore((s) => s.search)
  const setSearch = useViewStore((s) => s.setSearch)
  const theme = useViewStore((s) => s.theme)
  const setTheme = useViewStore((s) => s.setTheme)
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen)
  const setCoverageOpen = useViewStore((s) => s.setCoverageOpen)
  const filterPanelOpen = useViewStore((s) => s.filterPanelOpen)
  const toggleFilterPanel = useViewStore((s) => s.toggleFilterPanel)
  const selection = useViewStore((s) => s.selection)
  const clearSelection = useViewStore((s) => s.clearSelection)
  const chainRootId = useViewStore((s) => s.chainRootId)
  const setChainRootId = useViewStore((s) => s.setChainRootId)
  const graph = useGraphStore((s) => s.graph)

  const exportSelection = () => {
    if (selection.length === 0) return
    const issues = (graph?.data.issues ?? []).filter((i) => selection.includes(i.identifier))
    for (const i of issues) window.open(i.url, '_blank', 'noreferrer')
  }

  const screenshot = async () => {
    const el = document.querySelector('.react-flow') as HTMLElement | null
    if (!el) return
    // Lazy-load html-to-image (~50kB) only on actual screenshot.
    const { toPng } = await import('html-to-image')
    const dataUrl = await toPng(el, { cacheBust: true })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `issue-graph-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
  }

  return (
    <div className="toolbar">
      <div className="group">
        <button
          onClick={toggleFilterPanel}
          title={filterPanelOpen ? 'Hide filters' : 'Show filters'}
          aria-pressed={filterPanelOpen}
        >
          {filterPanelOpen ? '◀' : '▶'} Filters
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        {views.map((v) => (
          <button
            key={v.id}
            className={activeView === v.id ? 'active' : ''}
            onClick={() => setActiveView(v.id as any)}
            title={v.description}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="sep" />
      <div className="group">
        <input
          type="search"
          placeholder="🔍 Search id / title / assignee…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        {search && (
          <button onClick={() => setSearch('')} title="Clear search">×</button>
        )}
      </div>
      <div className="sep" />
      <div className="group">
        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>Density</span>
        <select value={density} onChange={(e) => setDensity(e.target.value as any)}>
          <option value="compact">Compact</option>
          <option value="default">Default</option>
          <option value="verbose">Verbose</option>
        </select>
      </div>
      {chainRootId && (
        <>
          <div className="sep" />
          <div className="group" title="Showing only the dependency chain rooted at this issue">
            <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>Chain:</span>
            <span style={{ fontSize: 'var(--fs-meta)', fontWeight: 600 }}>{chainRootId}</span>
            <button onClick={() => setChainRootId(null)} title="Clear chain isolation (Esc)">×</button>
          </div>
        </>
      )}
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
        <button onClick={() => setCoverageOpen(true)} title="Design-doc coverage report">📊</button>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')}
          title={`Theme: ${theme} (click to cycle)`}
        >
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
        </button>
        <button onClick={() => setSettingsOpen(true)}>⚙️</button>
      </div>
    </div>
  )
}
