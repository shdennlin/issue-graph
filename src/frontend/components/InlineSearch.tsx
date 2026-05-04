import { useEffect, useMemo, useRef } from 'react'
import { useReactFlow } from 'reactflow'
import type { NormalizedIssue } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'

// Stable empty-array reference. Used as fallback when graph isn't loaded yet
// — must NOT be `[]` inline because each call creates a new ref → infinite loop.
const EMPTY_ISSUES: NormalizedIssue[] = []

// Cmd/Ctrl+F triggers an in-canvas finder. Type → matching issues highlight
// (CSS class on issue-node). Enter / Shift+Enter → jump to next/prev match.
// Esc → close. Doesn't filter — everything stays visible, just gets ringed.
//
// Must live inside <ReactFlowProvider> because it uses useReactFlow().
export function InlineSearch() {
  // Select primitives separately — selecting the inlineSearch object directly
  // would cause useSyncExternalStore to see a "new" snapshot on every render
  // (the object reference appears unstable to React), triggering the
  // "getSnapshot should be cached" warning and an infinite loop.
  const open = useViewStore((s) => s.inlineSearch.open)
  const query = useViewStore((s) => s.inlineSearch.query)
  const activeIdx = useViewStore((s) => s.inlineSearch.activeIdx)
  const close = useViewStore((s) => s.closeInlineSearch)
  const setQuery = useViewStore((s) => s.setInlineSearchQuery)
  const setIdx = useViewStore((s) => s.setInlineSearchActiveIdx)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  // CRITICAL: never create a new array/object inline in the selector — `?? []`
  // produces a fresh `[]` reference each call when graph is null, which zustand
  // sees as a "new snapshot" and re-renders forever. Select the raw value, then
  // resolve the fallback below.
  const rawIssues = useGraphStore((s) => s.graph?.data.issues)
  const issues = rawIssues ?? EMPTY_ISSUES
  const inputRef = useRef<HTMLInputElement>(null)
  const rf = useReactFlow()

  // Compute matches over all issues (regardless of filters — inline search is
  // a discovery aid, not a refinement).
  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return []
    return issues
      .filter((i) => {
        const hay = `${i.identifier} ${i.title} ${i.assignee?.displayName ?? ''}`.toLowerCase()
        return hay.includes(q)
      })
      .map((i) => i.identifier)
  }, [issues, query])

  // Focus input on open AND select all text. Pairs with closeInlineSearch
  // preserving the query: re-opening (Cmd+F again) lands you on the previous
  // query already highlighted, so typing immediately replaces it without a
  // second clear-step. Arrow keys / mouse drag still work for editing.
  useEffect(() => {
    if (!open) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [open])

  // Toggle a body-level class so IssueNode can read match state via DOM
  // attributes — simpler than threading match list through props.
  useEffect(() => {
    const root = document.documentElement
    matchIds.forEach((id) => root.style.setProperty(`--no-op-${id}`, '0')) // no-op: keeps deps lint happy
    // Set a data attr on each issue node DOM after RF renders. Use a small
    // delay so RF has placed nodes.
    const apply = () => {
      const all = document.querySelectorAll<HTMLElement>('.issue-node')
      all.forEach((el) => {
        el.classList.remove('search-hit', 'search-active')
      })
      if (matchIds.length === 0) return
      // Match by .pid text (issue identifier shown in node)
      all.forEach((el) => {
        const pid = el.querySelector<HTMLElement>('.pid')?.textContent?.trim()
        if (pid && matchIds.includes(pid)) {
          el.classList.add('search-hit')
          if (matchIds[activeIdx] === pid) el.classList.add('search-active')
        }
      })
    }
    const id = window.setTimeout(apply, 30)
    return () => {
      window.clearTimeout(id)
      document
        .querySelectorAll<HTMLElement>('.issue-node')
        .forEach((el) => el.classList.remove('search-hit', 'search-active'))
    }
  }, [matchIds, activeIdx])

  // Center camera on active match.
  useEffect(() => {
    if (!open || matchIds.length === 0) return
    const target = matchIds[activeIdx]
    if (!target) return
    const node = rf.getNode(target)
    if (!node) return
    rf.setCenter(
      node.position.x + (node.width ?? 280) / 2,
      node.position.y + (node.height ?? 100) / 2,
      { zoom: 1.0, duration: 350 },
    )
  }, [activeIdx, matchIds, open, rf])

  const openSearch = useViewStore((s) => s.openInlineSearch)

  if (!open) {
    // Collapsed: small button in the canvas top-right corner. Click → expands
    // into the full search bar. Esc still closes once open.
    return (
      <button
        className="inline-search-btn"
        onClick={openSearch}
        title="Find on canvas"
        aria-label="Find on canvas"
      >
        🔍
      </button>
    )
  }

  const total = matchIds.length
  const goto = (delta: number) => {
    if (total === 0) return
    setIdx((activeIdx + delta + total) % total)
  }

  return (
    <div className="inline-search">
      <input
        id="inline-search"
        ref={inputRef}
        type="search"
        placeholder="Find on canvas…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            // Advance to next/prev match AND commit it as focusedId, then
            // blur the input. This hands keyboard control back to the
            // canvas so a subsequent shortcut (c, r, ⇧C, ⇧R) targets the
            // match the user just searched for. To keep cycling matches
            // afterwards, click the ↑/↓ buttons or refocus the input.
            const delta = e.shiftKey ? -1 : 1
            if (total === 0) return
            const nextIdx = (activeIdx + delta + total) % total
            setIdx(nextIdx)
            const target = matchIds[nextIdx]
            if (target) setFocusedId(target)
            inputRef.current?.blur()
          }
        }}
        style={{ width: 220 }}
      />
      <span className="counter">
        {total === 0 && query ? '0 / 0' : total > 0 ? `${activeIdx + 1} / ${total}` : ''}
      </span>
      <button onClick={() => goto(-1)} disabled={total === 0} title="Previous match">↑</button>
      <button onClick={() => goto(1)} disabled={total === 0} title="Next match">↓</button>
      <button onClick={close} title="Close (Esc)">×</button>
    </div>
  )
}
