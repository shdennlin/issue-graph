import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Camera,
  Eye,
  EyeOff,
  Keyboard,
  Loader2,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Sun,
} from 'lucide-react'
import { useClickOutside } from '../hooks/useClickOutside'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { views } from '../views'
import { api } from '../lib/api'
import { computeChain } from '../views/chain'
// Density + theme + search live here; Size moved to Settings → Display.

const ICON_SIZE = 16

const FULL_HISTORY_DAYS = 365

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
  const setShortcutsOpen = useViewStore((s) => s.setShortcutsOpen)
  const filterPanelOpen = useViewStore((s) => s.filterPanelOpen)
  const toggleFilterPanel = useViewStore((s) => s.toggleFilterPanel)
  const detailPanelAutoOpen = useViewStore((s) => s.detailPanelAutoOpen)
  const toggleDetailPanelAutoOpen = useViewStore((s) => s.toggleDetailPanelAutoOpen)
  const selection = useViewStore((s) => s.selection)
  const clearSelection = useViewStore((s) => s.clearSelection)
  const chainRootId = useViewStore((s) => s.chainRootId)
  const setChainRootId = useViewStore((s) => s.setChainRootId)
  const showRelated = useViewStore((s) => s.showRelated)
  const setShowRelated = useViewStore((s) => s.setShowRelated)
  const graph = useGraphStore((s) => s.graph)
  const extendScope = useGraphStore((s) => s.extendScope)
  const syncing = useGraphStore((s) => s.syncing)

  // Chain-mode dangling-ref check: when chain isolation is active, we
  // recompute the chain (cheap BFS) to find references pointing to issues
  // outside the current cache. If any are found AND the user hasn't already
  // extended the sync window, surface a "Load older history" button.
  const chainStats = useMemo(() => {
    if (!chainRootId || !graph) return null
    const { members, dangling } = computeChain(graph.data.issues, chainRootId, {
      includeRelatedNeighbors: showRelated,
    })
    return { memberCount: members.size, dangling: dangling.size }
  }, [chainRootId, graph, showRelated])
  const chainDangling = chainStats && chainStats.dangling > 0 ? chainStats.dangling : null

  // Backend's current extended-scope window (0 = default 30-day Done window).
  // Fetched lazily so we don't pull it for users who never use chain mode.
  const [scopeDays, setScopeDays] = useState<number | null>(null)
  // Low-frequency icons (screenshot / coverage / shortcuts / theme) live in
  // an overflow menu so the top toolbar stays scannable. Settings stays
  // visible because it's a hub the user reaches for more often.
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement | null>(null)
  const closeOverflow = useCallback(() => setOverflowOpen(false), [])
  useClickOutside(overflowRef, overflowOpen, closeOverflow)
  useEffect(() => {
    if (!chainRootId) return
    if (scopeDays !== null) return
    api.getSyncScope().then((r) => setScopeDays(r.days)).catch(() => setScopeDays(0))
  }, [chainRootId, scopeDays])

  const showLoadFullHistory = chainRootId && chainDangling && (scopeDays ?? 0) < FULL_HISTORY_DAYS

  const loadFullHistory = async () => {
    await extendScope(FULL_HISTORY_DAYS)
    setScopeDays(FULL_HISTORY_DAYS)
  }

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
          className="icon-text"
        >
          {filterPanelOpen ? <PanelLeftClose size={ICON_SIZE} /> : <PanelLeftOpen size={ICON_SIZE} />}
          Filters
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
          id="toolbar-search"
          type="search"
          placeholder="Search id / title / assignee…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        {search && (
          <button onClick={() => setSearch('')} title="Clear search">×</button>
        )}
      </div>
      {activeView === 'dependency' && (
        <>
          <div className="sep" />
          <div className="group">
            <button
              onClick={() => setShowRelated(!showRelated)}
              className={`icon-text ${showRelated ? 'active' : ''}`}
              title={
                showRelated
                  ? 'Hide related-issue edges (shortcut: r). Currently shown as dashed gray lines.'
                  : 'Show "related" issue links as dashed edges (shortcut: r).'
              }
              aria-pressed={showRelated}
            >
              {showRelated ? <Eye size={ICON_SIZE} /> : <EyeOff size={ICON_SIZE} />}
              Related
            </button>
          </div>
        </>
      )}
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
            {chainStats && (
              <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>
                ({chainStats.memberCount} {chainStats.memberCount === 1 ? 'issue' : 'issues'})
              </span>
            )}
            <button onClick={() => setChainRootId(null)} title="Clear chain isolation (Esc)">×</button>
            {showLoadFullHistory && (
              <button
                onClick={loadFullHistory}
                disabled={syncing}
                title={`This chain references ${chainDangling} issue(s) not in the current cache (likely older Done/Canceled). Click to extend sync window to ${FULL_HISTORY_DAYS} days.`}
                style={{
                  background: 'var(--warn, #f59e0b)',
                  color: '#000',
                  fontSize: 'var(--fs-meta)',
                  fontWeight: 500,
                }}
              >
                {syncing
                  ? <span className="icon-text"><Loader2 size={ICON_SIZE} className="lucide-spin" /> Loading…</span>
                  : `+ Load full history (${chainDangling} missing)`}
              </button>
            )}
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
        <div className="toolbar-overflow" ref={overflowRef}>
          <button
            type="button"
            className="icon-only"
            onClick={() => setOverflowOpen(!overflowOpen)}
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            aria-label="More actions"
          >
            <MoreHorizontal size={ICON_SIZE} />
          </button>
          {overflowOpen && (
            <div className="toolbar-overflow-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => { setOverflowOpen(false); screenshot() }}
              >
                <Camera size={14} /> Screenshot
                <span className="toolbar-overflow-hint">⌘⇧S</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => { setOverflowOpen(false); setCoverageOpen(true) }}
              >
                <BarChart3 size={14} /> Design-doc coverage
              </button>
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => { setOverflowOpen(false); setShortcutsOpen(true) }}
              >
                <Keyboard size={14} /> Keyboard shortcuts
                <span className="toolbar-overflow-hint">?</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')}
                title="Click to cycle dark / light / auto"
              >
                {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
                Theme: {theme}
              </button>
            </div>
          )}
        </div>
        <button
          className={`icon-text${detailPanelAutoOpen ? ' active' : ''}`}
          onClick={toggleDetailPanelAutoOpen}
          title={
            detailPanelAutoOpen
              ? 'Auto-open detail panel on click: ON (Space / Enter still opens ad-hoc when off)'
              : 'Auto-open detail panel on click: OFF — click an issue to focus only, Space / Enter to open detail'
          }
          aria-pressed={detailPanelAutoOpen}
        >
          {detailPanelAutoOpen ? <PanelRightClose size={ICON_SIZE} /> : <PanelRightOpen size={ICON_SIZE} />}
          Detail
        </button>
        <button className="icon-only" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
          <Settings size={ICON_SIZE} />
        </button>
      </div>
    </div>
  )
}
