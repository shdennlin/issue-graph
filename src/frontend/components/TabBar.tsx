// Unified app header — tab strip on the left, sync metadata on the right,
// in a single row. Replaces the old two-row TabBar + SyncBanner layout.
// `SyncBanner` is now scoped to just the workspace-change warning banner
// (shown above this header when active).
//
// Layout:
//   [tabs … ] [+]   …spacer…   [picker?] [last sync] [N issues · M docs] [↻]
//
// Modes:
//   - Multi-workspace (profiles.length >= 1, roster non-empty):
//       Tabs render on the left. The workspace-picker (repoint-this-tab)
//       only appears when profiles.length >= 2 — with a single profile it
//       would be a no-op duplicate of the tab label.
//   - Legacy (no `WORKSPACE_*` env profiles):
//       A single instance-label pill sits on the left in place of tabs.
//
// Layout mirrors Slack's workspace switcher (the screenshot reference): a
// strip of pills along the top, each showing `⌘N name ×`. Cmd/Ctrl+1..9
// jumps to the Nth tab. Drag a tab left/right to reorder — the leftmost
// tab's workspace becomes the **server default** (the workspace the
// design-doc file watcher follows). `+` at the end opens a menu of
// available workspaces; `×` on a tab closes it (last tab can't be closed).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { useClickOutside } from '../hooks/useClickOutside'
import { useWorkspaceStore, type Tab } from '../store/workspaceStore'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useHistoryAvailability } from '../store/urlSync'
import { forgetTab, snapshotTab } from '../store/tabStateStore'
import { MOD_GLYPH, formatShortcut } from '../lib/platform'

function colorClass(ageMinutes: number): string {
  if (ageMinutes < 5) return 'stale-ok'
  if (ageMinutes < 30) return 'stale-warn'
  return 'stale-bad'
}

function formatAge(age: number): string {
  if (age < 1) return 'just now'
  if (age < 60) return `${age}m ago`
  const h = Math.floor(age / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function TabBar() {
  // workspace store
  const profiles = useWorkspaceStore((s) => s.profiles)
  const unconfigured = useWorkspaceStore((s) => s.unconfigured)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const defaultWorkspaceId = useWorkspaceStore((s) => s.defaultWorkspaceId)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const addTab = useWorkspaceStore((s) => s.addTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const reorderTabs = useWorkspaceStore((s) => s.reorderTabs)
  const changeTabWorkspace = useWorkspaceStore((s) => s.changeTabWorkspace)
  const setDefaultWorkspaceIdInStore = useWorkspaceStore((s) => s.setDefaultWorkspaceId)
  const initialized = useWorkspaceStore((s) => s.initialized)

  // graph / view stores for the right-side sync metadata
  const graph = useGraphStore((s) => s.graph)
  const status = useGraphStore((s) => s.status)
  const syncing = useGraphStore((s) => s.syncing)
  const forceSync = useGraphStore((s) => s.forceSync)
  const setSyncHistoryOpen = useViewStore((s) => s.setSyncHistoryOpen)

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const addMenuRef = useRef<HTMLDivElement | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)

  // Tick `now` every 30s so the "Last sync: 5m ago" label refreshes on its
  // own as time passes. Read inside the render via state, not Date.now()
  // directly — react-hooks/purity forbids impure reads during render, and
  // ticking state is the canonical fix: stable across re-renders, refreshes
  // on a predictable cadence.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const { canBack, canForward } = useHistoryAvailability()
  const pickerRef = useRef<HTMLLabelElement | null>(null)

  // FLIP animation: capture each tab's offsetLeft just before a reorder
  // (in onDrop), then in useLayoutEffect calculate the delta from old to
  // new position, apply the inverse transform to make tabs *appear*
  // unchanged, then animate transform back to 0. Net effect: the visible
  // reorder slides smoothly instead of snapping.
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const oldOffsets = useRef<Map<string, number>>(new Map())
  const flipEndHandlers = useRef<Map<string, () => void>>(new Map())

  // FLIP step 2-4 (Last → Invert → Play). Runs after every render that
  // changed the `tabs` array.
  //
  // Crucial: while a tab is mid-animation we disable its `pointer-events`.
  // HTML5 DnD hit-tests against the *transformed* bounding box, so without
  // this guard the next dragover would fire on a just-swapped tab whose
  // translated position still sits under the cursor — causing
  // [B, A] → [A, B] → [B, A] oscillation. The 180ms pointer-block is the
  // minimum cooldown that lets the user meaningfully move the cursor
  // before another swap can fire.
  useLayoutEffect(() => {
    if (oldOffsets.current.size === 0) return
    for (const t of tabs) {
      const el = tabRefs.current.get(t.id)
      if (!el) continue
      const oldLeft = oldOffsets.current.get(t.id)
      if (oldLeft == null) continue
      const newLeft = el.offsetLeft
      const dx = oldLeft - newLeft
      if (dx === 0) continue
      // Detach any in-flight FLIP listener before we start a new one.
      // Rapid drags can interrupt the previous animation before its
      // `transitionend` fires; without explicit cleanup, the stale
      // listener leaks for the lifetime of the element.
      const prevEnd = flipEndHandlers.current.get(t.id)
      if (prevEnd) {
        el.removeEventListener('transitionend', prevEnd)
        el.removeEventListener('transitioncancel', prevEnd)
      }
      el.style.transition = 'none'
      el.style.transform = `translateX(${dx}px)`
      el.style.pointerEvents = 'none'
      void el.offsetWidth // flush inverted style
      el.style.transition = 'transform 180ms ease'
      el.style.transform = ''
      const onEnd = () => {
        el.style.pointerEvents = ''
        el.removeEventListener('transitionend', onEnd)
        el.removeEventListener('transitioncancel', onEnd)
        flipEndHandlers.current.delete(t.id)
      }
      flipEndHandlers.current.set(t.id, onEnd)
      el.addEventListener('transitionend', onEnd)
      el.addEventListener('transitioncancel', onEnd)
    }
    oldOffsets.current.clear()
  }, [tabs])

  const closeAddMenu = useCallback(() => setAddMenuOpen(false), [])
  useClickOutside(addMenuRef, addMenuOpen, closeAddMenu)

  const closePicker = useCallback(() => setPickerOpen(false), [])
  useClickOutside(pickerRef, pickerOpen, closePicker)

  useEffect(() => {
    const handlers = flipEndHandlers.current
    const els = tabRefs.current
    return () => {
      for (const [id, fn] of handlers) {
        const el = els.get(id)
        if (el) {
          el.removeEventListener('transitionend', fn)
          el.removeEventListener('transitioncancel', fn)
        }
      }
      handlers.clear()
    }
  }, [])

  // Keep server-default workspace in sync with the leftmost tab. Fires
  // whenever tabs[0]'s workspace changes (drag-reorder, tab close, add).
  // The backend persists this to active-workspace.json and restarts the
  // design-doc watcher on the new REPO_PATH; other open browser tabs see
  // it via the SSE 'default-workspace-changed' broadcast (App.tsx).
  const firstTabWorkspaceId = tabs[0]?.workspaceId ?? null
  useEffect(() => {
    if (!initialized || unconfigured) return
    if (!firstTabWorkspaceId) return
    if (firstTabWorkspaceId === defaultWorkspaceId) return
    let cancelled = false
    api.setDefaultWorkspace(firstTabWorkspaceId)
      .then((r) => {
        if (cancelled) return
        if (r.active?.id) setDefaultWorkspaceIdInStore(r.active.id)
      })
      .catch(() => {
        // Silent — selector still reflects whatever the SSE broadcast
        // says. If this fails persistently, the user will notice via
        // the watcher staying on the old workspace and can refresh.
      })
    return () => {
      cancelled = true
    }
  }, [firstTabWorkspaceId, defaultWorkspaceId, initialized, unconfigured, setDefaultWorkspaceIdInStore])

  if (!initialized) return null

  const switchTo = (tabId: string) => {
    if (tabId === activeTabId) return
    if (activeTabId) snapshotTab(activeTabId)
    setActiveTab(tabId)
  }

  const handleClose = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (tabs.length <= 1) return
    forgetTab(tabId)
    closeTab(tabId)
  }

  const handleAdd = (workspaceId: string) => {
    setAddMenuOpen(false)
    if (activeTabId) snapshotTab(activeTabId)
    addTab(workspaceId)
  }

  // ---- Drag-and-drop reorder --------------------------------------------
  // Modern "tabs slide while you drag" feel: each `dragover` decides
  // whether the cursor is past the target tab's midpoint, and if so
  // swaps the dragged tab with the target right away. The FLIP layout
  // effect then animates every other tab into its new position. By the
  // time the user releases, the order is already correct — `drop` is
  // pure cleanup.
  const onDragStart = (tab: Tab, e: React.DragEvent<HTMLButtonElement>) => {
    setDraggingId(tab.id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', tab.id)
    } catch {
      // Some browsers throw on setData with certain types — safe to ignore.
    }
  }

  const onDragOver = (tab: Tab, e: React.DragEvent<HTMLButtonElement>) => {
    if (!draggingId || draggingId === tab.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const fromIndex = tabs.findIndex((t) => t.id === draggingId)
    const overIndex = tabs.findIndex((t) => t.id === tab.id)
    if (fromIndex < 0 || overIndex < 0) return
    if (overIndex === fromIndex) return

    // As-soon-as-cursor-enters-target reorder. No midpoint deadband: the
    // moment dragover fires on a non-self tab, swap. After the swap the
    // dragged tab moves into the target's slot, so the cursor is now
    // over the *dragged* tab (skipped by the early return above) — no
    // oscillation. Matches Chrome / Slack / Linear's "tabs slide as you
    // drag past them" feel; a midpoint check made it feel like you had
    // to be surgical.
    oldOffsets.current.clear()
    for (const t of tabs) {
      const el = tabRefs.current.get(t.id)
      if (el) oldOffsets.current.set(t.id, el.offsetLeft)
    }
    reorderTabs(fromIndex, overIndex)
  }

  const onDragLeave = (_tab: Tab) => {
    // No-op — visual feedback comes from the live reorder itself, not
    // a static drop-target rail.
  }

  const onDrop = (_target: Tab, e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setDraggingId(null)
  }

  const onDragEnd = () => {
    setDraggingId(null)
    oldOffsets.current.clear()
  }

  // Repointing this tab at a different workspace, in place. Different
  // from clicking another tab — that switches active tab (which has its
  // own filters/focus). This swap KEEPS the current tab's filters /
  // focus / chain isolation but applies them to a different workspace's
  // data.
  const onPickWorkspace = (workspaceId: string) => {
    setPickerOpen(false)
    if (!activeTabId) return
    if (workspaceId === currentWorkspaceId) return
    changeTabWorkspace(activeTabId, workspaceId)
  }

  const profileById = new Map(profiles.map((p) => [p.id, p]))
  const canClose = tabs.length > 1
  const showTabs = !unconfigured && profiles.length > 0
  const showPicker = !unconfigured && profiles.length >= 2

  const last = graph?.fetchedAt ?? 0
  const ageMinutes = last ? Math.floor((now - last) / 60_000) : Infinity
  const ageText = `${graph === null ? 'loading…' : isFinite(ageMinutes) ? formatAge(ageMinutes) : 'never'}${
    graph?.stale ? ' (stale)' : ''
  }`
  const activeName = profiles.find((p) => p.id === currentWorkspaceId)?.name
    ?? graph?.instanceLabel
    ?? 'issue-graph'

  return (
    <div className="tabbar" role="tablist" aria-label="Workspace header">
      <div className="tabbar-history-nav" aria-label="History navigation">
        <button
          type="button"
          className="icon-only"
          onClick={() => window.history.back()}
          disabled={!canBack}
          title={`Back (${formatShortcut(['Cmd', '['])} / browser back)`}
          aria-label="Back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="icon-only"
          onClick={() => window.history.forward()}
          disabled={!canForward}
          title={`Forward (${formatShortcut(['Cmd', ']'])} / browser forward)`}
          aria-label="Forward"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      {showTabs ? (
        <>
          {tabs.map((tab, idx) => {
            const profile = profileById.get(tab.workspaceId)
            const name = profile?.name ?? tab.workspaceId
            const isActive = tab.id === activeTabId
            const shortcut = idx < 9 ? `${MOD_GLYPH}${idx + 1}` : null
            const isDragging = draggingId === tab.id
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.id, el)
                  else tabRefs.current.delete(tab.id)
                }}
                role="tab"
                aria-selected={isActive}
                className={[
                  'tabbar-tab',
                  isActive ? 'is-active' : '',
                  isDragging ? 'is-dragging' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => switchTo(tab.id)}
                title={`Switch to ${name}${shortcut ? ` (${shortcut})` : ''} — drag to reorder`}
                type="button"
                draggable
                onDragStart={(e) => onDragStart(tab, e)}
                onDragOver={(e) => onDragOver(tab, e)}
                onDragLeave={() => onDragLeave(tab)}
                onDrop={(e) => onDrop(tab, e)}
                onDragEnd={onDragEnd}
              >
                {shortcut && <span className="tabbar-shortcut">{shortcut}</span>}
                <span className="tabbar-label">{name}</span>
                {canClose && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label="Close tab"
                    className="tabbar-close"
                    onClick={(e) => handleClose(tab.id, e)}
                    title="Close tab"
                  >
                    ×
                  </span>
                )}
              </button>
            )
          })}
          <div className="tabbar-add" ref={addMenuRef}>
            <button
              type="button"
              className="tabbar-add-button"
              onClick={() => setAddMenuOpen(!addMenuOpen)}
              title="Open a new tab on a workspace"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
            >
              +
            </button>
            {addMenuOpen && (
              <div className="tabbar-add-menu" role="menu">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    role="menuitem"
                    type="button"
                    className="tabbar-add-item"
                    onClick={() => handleAdd(p.id)}
                    title={`New tab on ${p.name}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <span className="tabbar-legacy-pill" title="Workspace identity (set via INSTANCE_LABEL)">
          <span className="status-dot" aria-hidden /> {activeName}
        </span>
      )}

      <div className="tabbar-spacer" />

      <div className="tabbar-sync">
        {showPicker && (
          <label
            ref={pickerRef}
            className="workspace-picker"
            title="Change this tab's workspace (keeps filters/focus)"
          >
            <button
              type="button"
              className="pill workspace-picker-button"
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen(!pickerOpen)}
            >
              <span className="status-dot" aria-hidden /> {activeName}
              <span className="select-chevron" aria-hidden>▾</span>
            </button>
            {pickerOpen && (
              <div className="workspace-picker-menu" role="menu">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className={`workspace-picker-item${p.id === currentWorkspaceId ? ' is-current' : ''}`}
                    onClick={() => onPickWorkspace(p.id)}
                    title={p.id === currentWorkspaceId ? 'Already on this workspace' : `Switch this tab to ${p.name}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </label>
        )}
        <span
          className={`last-sync-link ${isFinite(ageMinutes) ? colorClass(ageMinutes) : 'stale-bad'}`}
          onClick={() => setSyncHistoryOpen(true)}
          title="Click for sync history"
        >
          Last sync: {ageText}
        </span>
        <span className="tabbar-counts">
          {graph?.data.issues.length ?? 0} issues · {graph?.data.designdocs?.length ?? 0} docs
        </span>
        <button
          className="tabbar-refresh icon-text"
          onClick={forceSync}
          disabled={status === 'loading'}
          title="Refresh (⌘⌥S) — re-pull from the backend"
        >
          {syncing ? (
            <><Loader2 size={14} className="lucide-spin" /> Syncing…</>
          ) : status === 'loading' ? (
            <><Loader2 size={14} className="lucide-spin" /> Loading…</>
          ) : (
            <><RefreshCw size={14} /> Refresh</>
          )}
        </button>
      </div>
    </div>
  )
}
