import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Camera,
  Eye,
  EyeOff,
  FileText,
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
import { useSchemaStore } from '../store/schemaStore'
import { useViewStore } from '../store/viewStore'
import { views } from '../views'
import { api } from '../lib/api'
import { formatShortcut } from '../lib/platform'
import { computeChain } from '../views/chain'
import { useT, type DictKey } from '../i18n'
import { QuickSwitcherTrigger } from './quickSwitcher/QuickSwitcherTrigger'
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
  const setNotesOpen = useViewStore((s) => s.setNotesOpen)
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
  const primaryGroup = useSchemaStore((s) => s.schema.primaryGroup)
  const t = useT()

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

  // View labels/descriptions are translated at the consumption site rather
  // than mutating the ViewDefinition shape (the `label` / `description`
  // fields are still used by other code paths and would break shape if
  // optionalized). The dict path is `views.<id>.label` / `.description`.
  const viewLabelKey = (id: string): DictKey => `views.${id}.label` as DictKey
  const viewDescKey = (id: string): DictKey => `views.${id}.description` as DictKey
  // Mix view tooltip is augmented at runtime with the active label group so
  // the user can tell what the buckets are based on without opening the
  // filter panel. Source ("auto-detected" / "PRIMARY_GROUP" / yaml) lives
  // in Settings → Backend; we just name the group here to stay terse.
  const viewTooltip = (id: string): string => {
    const base = t(viewDescKey(id))
    if (id !== 'mix') return base
    const suffix = primaryGroup
      ? t('views.mix.groupedBy', { group: primaryGroup })
      : t('views.mix.groupedByUnknown')
    return `${base}\n\n${suffix}`
  }
  const themeName = theme === 'dark' ? t('toolbar.themeDark') : theme === 'light' ? t('toolbar.themeLight') : t('toolbar.themeAuto')

  return (
    <div className="toolbar">
      <div className="group">
        <button
          onClick={toggleFilterPanel}
          title={filterPanelOpen ? t('toolbar.filtersHide') : t('toolbar.filtersShow')}
          aria-pressed={filterPanelOpen}
          className="icon-text"
        >
          {filterPanelOpen ? <PanelLeftClose size={ICON_SIZE} /> : <PanelLeftOpen size={ICON_SIZE} />}
          {t('toolbar.filters')}
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        {views.map((v) => (
          <button
            key={v.id}
            className={activeView === v.id ? 'active' : ''}
            onClick={() => setActiveView(v.id as any)}
            title={viewTooltip(v.id)}
          >
            {t(viewLabelKey(v.id))}
          </button>
        ))}
      </div>
      <div className="sep" />
      <div className="group">
        <input
          id="toolbar-search"
          type="search"
          placeholder={t('toolbar.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        {search && (
          <button onClick={() => setSearch('')} title={t('toolbar.clearSearch')}>×</button>
        )}
      </div>
      {activeView === 'dependency' && (
        <>
          <div className="sep" />
          <div className="group">
            <button
              onClick={() => setShowRelated(!showRelated)}
              className={`icon-text ${showRelated ? 'active' : ''}`}
              title={showRelated ? t('toolbar.relatedHide') : t('toolbar.relatedShow')}
              aria-pressed={showRelated}
            >
              {showRelated ? <Eye size={ICON_SIZE} /> : <EyeOff size={ICON_SIZE} />}
              {t('toolbar.related')}
            </button>
          </div>
        </>
      )}
      <div className="sep" />
      <div className="group">
        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>{t('toolbar.density')}</span>
        <select value={density} onChange={(e) => setDensity(e.target.value as any)}>
          <option value="compact">{t('toolbar.densityCompact')}</option>
          <option value="default">{t('toolbar.densityDefault')}</option>
          <option value="verbose">{t('toolbar.densityVerbose')}</option>
        </select>
      </div>
      {chainRootId && (
        <>
          <div className="sep" />
          <div className="group" title={t('toolbar.chainTitle')}>
            <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>{t('toolbar.chainLabel')}</span>
            <span style={{ fontSize: 'var(--fs-meta)', fontWeight: 600 }}>{chainRootId}</span>
            {chainStats && (
              <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-meta)' }}>
                ({chainStats.memberCount} {chainStats.memberCount === 1 ? t('toolbar.chainIssue') : t('toolbar.chainIssues')})
              </span>
            )}
            <button onClick={() => setChainRootId(null)} title={t('toolbar.clearChain')}>×</button>
            {showLoadFullHistory && (
              <button
                onClick={loadFullHistory}
                disabled={syncing}
                title={t('toolbar.loadFullHistoryTitle', { count: chainDangling, days: FULL_HISTORY_DAYS })}
                style={{
                  background: 'var(--warn, #f59e0b)',
                  color: '#000',
                  fontSize: 'var(--fs-meta)',
                  fontWeight: 500,
                }}
              >
                {syncing
                  ? <span className="icon-text"><Loader2 size={ICON_SIZE} className="lucide-spin" /> {t('toolbar.loadingChain')}</span>
                  : t('toolbar.loadFullHistoryLabel', { count: chainDangling })}
              </button>
            )}
          </div>
        </>
      )}
      <div style={{ marginLeft: 'auto' }} className="group">
        <QuickSwitcherTrigger />
        {selection.length > 0 && (
          <>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{selection.length} {t('toolbar.selectedSuffix')}</span>
            <button onClick={exportSelection}>{t('toolbar.openAll')}</button>
            <button onClick={clearSelection}>{t('toolbar.clear')}</button>
            <div className="sep" />
          </>
        )}
        <a href={api.exportUrl('csv')} download>
          <button>{t('toolbar.exportCsv')}</button>
        </a>
        <a href={api.exportUrl('md')} download>
          <button>{t('toolbar.exportMd')}</button>
        </a>
        <div className="toolbar-overflow" ref={overflowRef}>
          <button
            type="button"
            className="icon-only"
            onClick={() => setOverflowOpen(!overflowOpen)}
            title={t('toolbar.moreActions')}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            aria-label={t('toolbar.moreActions')}
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
                <Camera size={14} /> {t('toolbar.screenshot')}
                <span className="toolbar-overflow-hint">{formatShortcut(['Cmd', 'Shift', 'S'])}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => { setOverflowOpen(false); setCoverageOpen(true) }}
              >
                <BarChart3 size={14} /> {t('toolbar.coverage')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => { setOverflowOpen(false); setShortcutsOpen(true) }}
              >
                <Keyboard size={14} /> {t('toolbar.shortcuts')}
                <span className="toolbar-overflow-hint">?</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')}
                title={t('toolbar.themeCycle')}
              >
                {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
                {t('toolbar.themeLabel', { mode: themeName })}
              </button>
            </div>
          )}
        </div>
        <button
          className="icon-only"
          onClick={() => setNotesOpen(true)}
          title={t('toolbar.notesTitle')}
          aria-label={t('toolbar.notesAria')}
        >
          <FileText size={ICON_SIZE} />
        </button>
        <button
          className={`icon-text${detailPanelAutoOpen ? ' active' : ''}`}
          onClick={toggleDetailPanelAutoOpen}
          title={detailPanelAutoOpen ? t('toolbar.detailAutoOn') : t('toolbar.detailAutoOff')}
          aria-pressed={detailPanelAutoOpen}
        >
          {detailPanelAutoOpen ? <PanelRightClose size={ICON_SIZE} /> : <PanelRightOpen size={ICON_SIZE} />}
          {t('toolbar.detail')}
        </button>
        <button className="icon-only" onClick={() => setSettingsOpen(true)} title={t('toolbar.settings')} aria-label={t('toolbar.settingsAria')}>
          <Settings size={ICON_SIZE} />
        </button>
      </div>
    </div>
  )
}
