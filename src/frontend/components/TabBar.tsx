// In-app tab bar — a list of "view sessions" along the top of the app.
// Each tab is pinned to a workspace; multiple tabs may share a workspace
// so the user can keep different filters / focused issues / chain
// isolations open side-by-side.
//
// Layout mirrors Slack's workspace switcher (the screenshot reference): a
// strip of pills along the top, each showing `⌘N name ×`. Cmd/Ctrl+1..9
// jumps to the Nth tab. Drag a tab left/right to reorder — the leftmost
// tab's workspace becomes the **server default** (the workspace the
// design-doc file watcher follows). `+` at the end opens a menu of
// available workspaces; `×` on a tab closes it (last tab can't be closed).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useClickOutside } from '../hooks/useClickOutside'
import { useWorkspaceStore, type Tab } from '../store/workspaceStore'
import { forgetTab, snapshotTab } from '../store/tabStateStore'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD_GLYPH = isMac ? '⌘' : 'Ctrl+'

export function TabBar() {
  const profiles = useWorkspaceStore((s) => s.profiles)
  const legacyMode = useWorkspaceStore((s) => s.legacyMode)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const defaultWorkspaceId = useWorkspaceStore((s) => s.defaultWorkspaceId)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const addTab = useWorkspaceStore((s) => s.addTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const reorderTabs = useWorkspaceStore((s) => s.reorderTabs)
  const setDefaultWorkspaceIdInStore = useWorkspaceStore((s) => s.setDefaultWorkspaceId)
  const initialized = useWorkspaceStore((s) => s.initialized)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const addMenuRef = useRef<HTMLDivElement | null>(null)
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
    if (!initialized || legacyMode) return
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
  }, [firstTabWorkspaceId, defaultWorkspaceId, initialized, legacyMode, setDefaultWorkspaceIdInStore])

  if (!initialized || legacyMode || profiles.length === 0) return null

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

  const profileById = new Map(profiles.map((p) => [p.id, p]))
  const canClose = tabs.length > 1

  return (
    <div className="tabbar" role="tablist" aria-label="Workspace tabs">
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
    </div>
  )
}
