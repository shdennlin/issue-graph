import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  GitBranch,
  Link2,
  List,
  Maximize,
  Maximize2,
  MessageSquare,
  Minimize,
  Minimize2,
  Paperclip,
  StickyNote,
  Type,
  X,
} from 'lucide-react'
import type { AnnotationDTO, IssueComment, NormalizedAttachment, NormalizedIssue } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { api } from '../lib/api'
import { sortCommentsOldestFirst } from '../lib/comments'
import { priorityLabelFor, stateColorVar, stateIcon, stateLabelFor } from '../lib/colors'
import { getDesignDocsForIssue, groupIssueLabels, shortPrefixDisplay, type LabelSection } from '../lib/labelSchema'
import { isOverdueIssue } from '../lib/dueDate'
import { milestoneFilterKey } from '../views/filters'
import { resolveHierarchy } from '../views/hierarchy'
import { renderMarkdownHtml, renderMermaidIn } from '../lib/markdown'
import { MarkdownBody } from './MarkdownBody'
import { useDetailTextSize } from '../lib/detailTextSize'
import { translate, useLocale, useT } from '../i18n'
import { isTypingTarget } from '../lib/isTypingTarget'
import {
  AssigneeControl,
  CommentComposer,
  LabelAddControl,
  LabelRemoveButton,
  PriorityControl,
  StatusControl,
  useWriteGate,
  WriteLockedHint,
} from './detail/IssueWriteControls'

function timeAgo(iso: string, locale: ReturnType<typeof useLocale>): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return translate(locale, 'detailPanel.minutesAgo', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return translate(locale, 'detailPanel.hoursAgo', { count: h })
  return translate(locale, 'detailPanel.daysAgo', { count: Math.floor(h / 24) })
}

// Per-panel preferences — independent from the global theme/font-size settings
// so users who want a roomier read of a single issue without inflating the rest
// of the UI can opt in here.
const WIDE_MODE_KEY = 'ig-detail-wide-v1'
const FULLSCREEN_KEY = 'ig-detail-fullscreen-v1'
const ANNOTATIONS_OPEN_KEY = 'ig-detail-annotations-open-v1'
const OUTLINE_OPEN_KEY = 'ig-detail-outline-open-v1'
const OUTLINE_WIDTH_KEY = 'ig-detail-outline-width-v1'
const OUTLINE_DEFAULT_WIDTH = 150
const OUTLINE_MIN_WIDTH = 110
const OUTLINE_MAX_WIDTH = 340
const clampOutlineWidth = (w: number) => Math.min(OUTLINE_MAX_WIDTH, Math.max(OUTLINE_MIN_WIDTH, w))

/**
 * The quiet half of an editable row: "show only issues like this one".
 *
 * Deliberately not another pill. The row already carries one control with a
 * border; a second would read as two peers competing for the same job, which
 * is the confusion this replaced. Muted text that picks up the accent on hover
 * says "also available" without arguing with the dropdown beside it.
 *
 * The value it filters on lives in `title`, not in the label — the label is a
 * verb precisely so the row stops printing the same words twice.
 */
function FilterOnlyButton({ onClick, title }: { onClick: () => void; title: string }) {
  const t = useT()
  return (
    <button type="button" className="detail-filter-only" onClick={onClick} title={title}>
      {t('detailPanel.filterOnly')}
    </button>
  )
}

interface OutlineEntry {
  id: string
  level: number
  text: string
  icon?: keyof typeof OUTLINE_SECTION_ICONS
  isCommentMarker?: boolean
}

// One icon per panel section (Hierarchy/Blocks/Related/…), picked by the
// `data-outline-icon` each section's own <h3> carries — matching on that
// instead of the heading's (translated, so locale-dependent) text. Content
// headings inside Description/Comments don't get one: there's no fixed,
// known set of those to map, and a generic icon on every one of them would
// be noise rather than signal.
const OUTLINE_SECTION_ICONS = {
  designDocs: FileCode,
  hierarchy: GitBranch,
  blocks: Ban,
  related: Link2,
  annotations: StickyNote,
  description: FileText,
  resources: Paperclip,
  comments: MessageSquare,
}

export function DetailPanel() {
  const focusedId = useViewStore((s) => s.focusedId)
  const setDetailPanelOpen = useViewStore((s) => s.setDetailPanelOpen)
  const setFilter = useViewStore((s) => s.setFilter)
  const graph = useGraphStore((s) => s.graph)
  const reload = useGraphStore((s) => s.load)
  const { schema } = useSchemaStore()
  const t = useT()
  const locale = useLocale()
  // Decides the shape of the three editable rows, not whether they appear.
  // When the server has no OAuth application the write controls render
  // nothing, so the value has to stay on the filter chip — otherwise a
  // read-only deployment gets a row with a label and no value in it.
  const { show: writable } = useWriteGate()
  const [description, setDescription] = useState<string | null>(null)
  const [descLoading, setDescLoading] = useState(false)
  const [comments, setComments] = useState<IssueComment[] | null>(null)
  const [attachments, setAttachments] = useState<NormalizedAttachment[] | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingBody, setEditingBody] = useState('')
  // Description and Annotations render via dangerouslySetInnerHTML directly
  // (not <MarkdownBody>, which already does this itself) — these two refs
  // let the same ```mermaid post-render pass run here once the HTML is
  // actually attached to the document.
  const descRef = useRef<HTMLDivElement | null>(null)
  const annotationsRef = useRef<HTMLDivElement | null>(null)
  const commentsRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // The header's height varies with the title's own line count (1-3 lines
  // depending on length and panel width), so the outline zone below can't
  // start at a hardcoded offset — it would overlap a long title's wrapped
  // lines and the header's icon buttons (see the zone's own comment for
  // why it has to live outside .detail-body, which rules out just
  // anchoring to the normal document flow instead of measuring).
  const headAreaRef = useRef<HTMLDivElement | null>(null)
  // Written directly to the zone's own style, bypassing React state/render
  // for this one property. Each write re-measures headAreaRef fresh rather
  // than caching a value from whenever the ResizeObserver last fired — the
  // zone mounts and unmounts as wideMode and the outline's own conditions
  // toggle independently of the observer's own timing, and by the time
  // ANY ref callback fires the header's real DOM content (and therefore
  // its real height) is already laid out, so there's nothing stale to
  // race against by just reading it directly instead of relaying a
  // possibly-not-yet-fired measurement through another ref.
  const outlineZoneElRef = useRef<HTMLDivElement | null>(null)
  const measureHeadArea = () => headAreaRef.current?.getBoundingClientRect().height ?? 0
  const outlineZoneRefCallback = (node: HTMLDivElement | null) => {
    outlineZoneElRef.current = node
    if (node) node.style.top = `${measureHeadArea()}px`
  }
  useEffect(() => {
    const el = headAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (outlineZoneElRef.current) outlineZoneElRef.current.style.top = `${measureHeadArea()}px`
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [wideMode, setWideMode] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false
    try { return localStorage.getItem(WIDE_MODE_KEY) === '1' } catch { return false }
  })
  // Full screen is a size preset on top of modal mode, not a third
  // independent mode — it only has a visible effect while wideMode is on
  // (see .is-fullscreen's own CSS).
  const [fullScreen, setFullScreen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false
    try { return localStorage.getItem(FULLSCREEN_KEY) === '1' } catch { return false }
  })
  const toggleFullScreen = useCallback(() => {
    setFullScreen((prev) => {
      const next = !prev
      try { localStorage.setItem(FULLSCREEN_KEY, next ? '1' : '0') } catch { /* silent */ }
      return next
    })
  }, [])
  // The header button and Shift+M both go through this rather than calling
  // toggleFullScreen directly — from the docked side panel there's no
  // visible "full screen" to turn off, so the first press has to also
  // enter modal mode in the same action instead of silently flipping a
  // flag that only shows up once the user separately presses 'm' later.
  const toggleModalFullScreen = useCallback(() => {
    if (!wideMode) {
      setWideMode(true)
      try { localStorage.setItem(WIDE_MODE_KEY, '1') } catch { /* silent */ }
    }
    toggleFullScreen()
  }, [wideMode, toggleFullScreen])
  const [annotationsOpen, setAnnotationsOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true
    try { return localStorage.getItem(ANNOTATIONS_OPEN_KEY) !== '0' } catch { return true }
  })
  const toggleAnnotationsOpen = useCallback(() => {
    setAnnotationsOpen((prev) => {
      const next = !prev
      try { localStorage.setItem(ANNOTATIONS_OPEN_KEY, next ? '1' : '0') } catch { /* silent */ }
      return next
    })
  }, [])
  const [outlineOpen, setOutlineOpen] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true
    try { return localStorage.getItem(OUTLINE_OPEN_KEY) !== '0' } catch { return true }
  })
  const toggleOutlineOpen = useCallback(() => {
    setOutlineOpen((prev) => {
      const next = !prev
      try { localStorage.setItem(OUTLINE_OPEN_KEY, next ? '1' : '0') } catch { /* silent */ }
      return next
    })
  }, [])
  const [outlineWidth, setOutlineWidth] = useState<number>(() => {
    if (typeof localStorage === 'undefined') return OUTLINE_DEFAULT_WIDTH
    try {
      const stored = Number(localStorage.getItem(OUTLINE_WIDTH_KEY))
      return Number.isFinite(stored) && stored > 0 ? clampOutlineWidth(stored) : OUTLINE_DEFAULT_WIDTH
    } catch {
      return OUTLINE_DEFAULT_WIDTH
    }
  })
  const [outlineResizing, setOutlineResizing] = useState(false)
  // Drag start snapshot, not component state — read on every pointermove,
  // so it has to stay out of the render cycle or each move would be
  // computed against a stale `outlineWidth` from the render it started in.
  const outlineResizeStartRef = useRef<{ x: number; width: number } | null>(null)
  const handleOutlineResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    outlineResizeStartRef.current = { x: e.clientX, width: outlineWidth }
    setOutlineResizing(true)
  }
  const handleOutlineResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = outlineResizeStartRef.current
    if (!start) return
    // The panel is right-anchored (`right: 10px`), so its left edge is the
    // one that moves — dragging the handle further left (smaller clientX)
    // has to grow the width, hence start.x - e.clientX rather than the
    // other way round.
    setOutlineWidth(clampOutlineWidth(start.width + (start.x - e.clientX)))
  }
  const endOutlineResize = () => {
    if (!outlineResizeStartRef.current) return
    outlineResizeStartRef.current = null
    setOutlineResizing(false)
    setOutlineWidth((w) => {
      try { localStorage.setItem(OUTLINE_WIDTH_KEY, String(w)) } catch { /* silent */ }
      return w
    })
  }
  const [textSize, cycleTextSize] = useDetailTextSize()

  const toggleWide = useCallback(() => {
    setWideMode((prev) => {
      const next = !prev
      try { localStorage.setItem(WIDE_MODE_KEY, next ? '1' : '0') } catch { /* silent */ }
      return next
    })
  }, [])

  // 'm' (maximize) toggles wide mode while the panel is open. Same
  // input-focus guards as the other global letter shortcuts in App.tsx so
  // typing 'm' into the annotation textarea doesn't trigger it.
  useEffect(() => {
    if (!focusedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (isTypingTarget(e.target as HTMLElement | null)) return
      e.preventDefault()
      toggleWide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, toggleWide])

  // Shift+M — one step further than 'm'. From the side panel this both
  // enters modal mode and turns full screen on in one press (see
  // toggleModalFullScreen) rather than requiring 'm' first; from modal
  // mode it just flips full screen. Never turns wideMode back off — same
  // as the header's own full-screen button, collapsing out of it always
  // lands back on the (still open) regular modal, not the side panel.
  useEffect(() => {
    if (!focusedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return
      if (e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey) return
      if (isTypingTarget(e.target as HTMLElement | null)) return
      e.preventDefault()
      toggleModalFullScreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, toggleModalFullScreen])

  // "Copied!" feedback after the user copies the issue identifier. The
  // transient swap lasts ~1.2s — long enough to register, short enough to
  // not block re-copy. Reset whenever the focused issue changes so the
  // pill text matches the displayed identifier (see the issueId effect).
  // No useCallback: the project uses React Compiler, which auto-memoizes
  // and complains when manual memoization is added on top.
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  const copyIdentifier = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard API can fail on non-secure origins (http://) or when
      // permission is denied. Silently swallow — the ID stays visible
      // (selectable text inside the button) so the user has a fallback.
    }
  }
  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  // Separate from copyIdentifier above: that one copies just "ONE-456" (the
  // badge's own job), this copies "ONE-456 <title>" — for pasting into a
  // commit message, a Slack message, another issue, anywhere the id alone
  // doesn't tell the reader what it is without looking it up.
  const [copiedTitle, setCopiedTitle] = useState(false)
  const copyTitleTimerRef = useRef<number | null>(null)
  const copyIdentifierAndTitle = async (id: string, title: string) => {
    try {
      await navigator.clipboard.writeText(`${id} ${title}`)
      setCopiedTitle(true)
      if (copyTitleTimerRef.current !== null) window.clearTimeout(copyTitleTimerRef.current)
      copyTitleTimerRef.current = window.setTimeout(() => setCopiedTitle(false), 1200)
    } catch {
      // see copyIdentifier's comment
    }
  }
  useEffect(() => () => {
    if (copyTitleTimerRef.current !== null) window.clearTimeout(copyTitleTimerRef.current)
  }, [])

  const scrollToOutlineEntry = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Cmd/Ctrl+Shift+C → copy the focused issue's identifier. Mirrors the
  // existing right-click "Copy ID" action but as a keyboard shortcut.
  // Active only when the panel is open (gated on focusedId). Unlike the
  // letter-only `m` shortcut above we don't need to guard against typing
  // in inputs — Cmd/Ctrl+Shift+C is a chorded combo and doesn't collide
  // with text entry. Body inlined (instead of calling copyIdentifier) so
  // the effect doesn't re-bind on every render — copyIdentifier has an
  // unstable identity since we can't wrap it in useCallback (React
  // Compiler rejects manual memoization in this codebase).
  useEffect(() => {
    if (!focusedId) return
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (!e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== 'c') return
      e.preventDefault()
      try {
        await navigator.clipboard.writeText(focusedId)
        setCopied(true)
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
      } catch { /* see copyIdentifier comment */ }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId])

  // Mirror wide mode onto <body> so canvas-floating controls (inline search
  // button/bar) can hide themselves — they live inside GraphCanvas and would
  // otherwise sit on top of the wide panel via their higher z-index. Gated
  // on focusedId because wideMode persists in localStorage but the panel
  // only actually renders when an issue is focused.
  useEffect(() => {
    const body = document.body
    if (wideMode && focusedId) {
      body.dataset.detailWide = '1'
    } else {
      delete body.dataset.detailWide
    }
    return () => { delete body.dataset.detailWide }
  }, [wideMode, focusedId])

  const issue = focusedId ? graph?.data.issues.find((i) => i.identifier === focusedId) : null

  // Extract identifier to a top-level binding so the effect's dep array
  // references it directly. Avoids react-hooks/exhaustive-deps complaining
  // about deriving the dep from `issue?.identifier` inside the deps array.
  const issueId = issue?.identifier
  // Bumped after a comment posts, to re-run the fetch below for the same issue.
  // The effect keys on the identifier alone, so without this a new comment
  // would not appear until the panel was closed and reopened — the server's
  // detail cache is already busted by the write, so the refetch is cheap and
  // returns the real comment (author, timestamp) instead of a local guess.
  const [detailNonce, setDetailNonce] = useState(0)
  useEffect(() => {
    // react-hooks/set-state-in-effect: standard async-fetch pattern — clear
    // stale description, mark loading, then write the resolved value (or
    // null on error). Refactoring to avoid setState here would require a
    // fetching library that's out of scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDescription(null)
    setComments(null)
    setAttachments(null)
    setCopied(false)
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    if (!issueId) return
    let cancelled = false
    setDescLoading(true)
    api
      .fetchIssueDetail(issueId)
      .then((res) => {
        if (cancelled) return
        setDescription(res.data.description ?? '')
        setComments(res.data.comments ?? [])
        setAttachments(res.data.attachments ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setDescription(null)
        setComments(null)
        setAttachments(null)
      })
      .finally(() => { if (!cancelled) setDescLoading(false) })
    return () => { cancelled = true }
  }, [issueId, detailNonce])

  // Description's HTML is set via dangerouslySetInnerHTML above, which runs
  // during render — by the time this effect fires, descRef.current already
  // has the real nodes attached to the document, which is what a ```mermaid
  // block needs to render (see renderMermaidIn).
  useEffect(() => {
    if (!descRef.current) return
    void renderMermaidIn(descRef.current)
  }, [description, descLoading])

  // Outline (table of contents) spanning the panel's own section titles
  // (Hierarchy, Related, Description, Resources, Comments, …) AND the
  // headings inside Description's and Comments' own markdown content —
  // scanned together from .detail-body in one pass so they come out in
  // real document order (a content heading nested under the section it's
  // actually in, not two separately-ordered lists stitched together).
  // Built unconditionally since the scan is cheap; the render below
  // decides whether there's room to show it.
  //
  // Comments render via <MarkdownBody>, a child component that populates
  // its innerHTML from its OWN effect, not during render — a prop-keyed
  // effect here (depending on `comments`) raced that: clicking a Comments
  // entry scrolled nowhere, because by the time this effect ran and
  // stamped ids onto the headings it found, MarkdownBody could still
  // replace those same nodes with fresh ones (no id) afterwards, orphaning
  // the id this effect had just assigned. A MutationObserver watching the
  // actual DOM sidesteps the ordering question entirely — it reacts to
  // content landing, however many times that takes, instead of guessing
  // from props when it's "probably" landed.
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  useEffect(() => {
    const root = bodyRef.current
    if (!root) { setOutline([]); return }
    const SECTION_TITLE = '.section > h3, .section > .section-head-row > h3'
    const CONTENT_HEADING = ['.desc-body', '.detail-comment']
      .flatMap((scope) => [1, 2, 3, 4, 5, 6].map((n) => `${scope} h${n}`))
      .join(', ')
    const rescan = () => {
      const matches = Array.from(root.querySelectorAll<HTMLHeadingElement>(`${SECTION_TITLE}, ${CONTENT_HEADING}`))
      const entries: OutlineEntry[] = []
      // Flattening every comment's headings straight into "Comments" made
      // it unclear which heading belonged to which of several comments —
      // insert a "Comment N" marker the first time a heading from a new
      // one is seen, scoped to only the comments that actually have a
      // heading in them (most don't, and a marker with nothing under it
      // would be noise).
      let lastCommentEl: Element | null = null
      let commentIndex = 0
      matches.forEach((h, i) => {
        const isSectionTitle = h.matches(SECTION_TITLE)
        if (!isSectionTitle) {
          const commentEl = h.closest('.detail-comment')
          if (commentEl && commentEl !== lastCommentEl) {
            lastCommentEl = commentEl
            commentIndex += 1
            const markerId = `detail-outline-comment-marker-${commentIndex}`
            ;(commentEl as HTMLElement).id = markerId
            entries.push({
              id: markerId,
              level: 1,
              text: t('detailPanel.outlineCommentN', { n: commentIndex }),
              isCommentMarker: true,
            })
          }
        }
        // Stable per render, not per heading identity — this content is
        // read-only here, so a fresh id each time it changes is fine and
        // avoids tracking collisions with any id the markdown itself
        // might (not that it does) already carry.
        const id = `detail-outline-${i}`
        h.id = id
        entries.push({
          id,
          // Section titles are always <h3> regardless of which section,
          // so their *tag* can't tell them apart from an "### Foo" inside
          // Description — level 0 is reserved for them precisely so they
          // always render as the most prominent tier, whatever a content
          // heading nested under them happens to use.
          level: isSectionTitle ? 0 : Number(h.tagName[1]),
          text: h.textContent ?? '',
          icon: isSectionTitle ? (h.dataset.outlineIcon as OutlineEntry['icon']) : undefined,
        })
      })
      setOutline(entries)
    }
    rescan()
    const mo = new MutationObserver(rescan)
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [description, descLoading, comments, t])

  // Same idea for annotations — re-runs when the list changes, and when
  // closing an edit (editingId back to null) swaps a textarea back for the
  // rendered body. Depends on graph.data.annotations directly (the
  // per-issue filtered `annotations` array is computed further down, after
  // the early `if (!issue) return null` — can't reference it from a hook,
  // which has to run unconditionally above that point).
  useEffect(() => {
    if (!annotationsRef.current) return
    void renderMermaidIn(annotationsRef.current)
  }, [graph?.data.annotations, issueId, editingId, annotationsOpen])

  // Viewport-adaptive max: never wider than 75% of the window, never wider
  // than 1200px (long-form reading column ceiling). Re-derived on window
  // resize so the hook's clamp tracks the current viewport.
  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Side mode: capped at 75% viewport / 1200px (long-form reading column).
  const sideMax = Math.max(320, Math.min(1200, Math.floor(viewportW * 0.75)))
  // Wide mode: own resize range — wider lower bound, viewport-percentage cap.
  const wideMax = Math.max(600, Math.floor(viewportW * 0.95))

  const side = useResizable({
    storageKey: 'ig-detail-panel-w',
    defaultWidth: 380,
    min: 280,
    max: sideMax,
    side: 'right',
  })
  const wide = useResizable({
    storageKey: 'ig-detail-panel-wide-w',
    defaultWidth: Math.min(900, wideMax),
    min: 600,
    max: wideMax,
    side: 'right',
    // Modal mode is centered (translate(-50%, -50%)), not right-docked —
    // see the `symmetric` option's own comment in useResizable.
    symmetric: true,
  })
  const active = wideMode ? wide : side
  const activeMax = wideMode ? wideMax : sideMax
  // Stored width may exceed the current max after a viewport shrink — clamp
  // at render time so the panel never overflows before the next drag.
  const renderedWidth = Math.min(active.width, activeMax)
  const startResize = active.startResize
  const resizing = active.resizing
  const sortedComments = useMemo(
    () => comments === null ? null : sortCommentsOldestFirst(comments),
    [comments],
  )

  if (!issue) return null

  const annotations: AnnotationDTO[] = (graph?.data.annotations ?? []).filter(
    (a) => a.targetType === 'issue' && a.targetId === issue.identifier,
  )
  const docs = getDesignDocsForIssue(issue, graph?.data.designdocs)
  const labelSections = groupIssueLabels(issue, schema)

  // Each section maps to the filter dimension that section's labels live in.
  // Selecting *just* the clicked value mirrors the state / priority /
  // assignee chips above — a chip is "show me only this", not a toggle.
  const applyLabelFilter = (sec: LabelSection, id: string): void => {
    const f = useViewStore.getState().filters
    switch (sec.kind) {
      case 'primary': setFilter('primaryValues', [id]); break
      case 'type': setFilter('typeValues', [id]); break
      case 'prefix': setFilter('prefixSelections', { ...f.prefixSelections, [sec.key]: [id] }); break
      case 'group': setFilter('groupSelections', { ...f.groupSelections, [sec.key]: [id] }); break
      case 'orphan': setFilter('orphanValues', [id]); break
    }
  }

  const submitAnnotation = async () => {
    const body = annotationDraft.trim()
    if (!body) return
    await api.createAnnotation({ targetType: 'issue', targetId: issue.identifier, body })
    setAnnotationDraft('')
    reload()
  }

  const saveEdit = async () => {
    if (editingId === null) return
    await api.patchAnnotation(editingId, editingBody.trim())
    setEditingId(null)
    setEditingBody('')
    reload()
  }

  const remove = async (id: number) => {
    if (!confirm(t('detailPanel.confirmDeleteAnnotation'))) return
    await api.deleteAnnotation(id)
    reload()
  }

  const blocksOut = issue.relations.filter((r) => r.type === 'blocks').map((r) => r.targetIdentifier)
  const blocksIn: NormalizedIssue[] = (graph?.data.issues ?? []).filter((other) =>
    other.relations.some((r) => r.type === 'blocks' && r.targetIdentifier === issue.identifier),
  )

  // Related links — bidirectional in Linear, so collect from both
  // directions and dedupe per identifier. Filter to only those present in
  // cache so we don't show ghost links the user can't click into.
  const allIssues = graph?.data.issues ?? []
  const inCache = new Set(allIssues.map((i) => i.identifier))
  const relatedIds = new Set<string>()
  for (const r of issue.relations) {
    if (r.type === 'related' && inCache.has(r.targetIdentifier)) relatedIds.add(r.targetIdentifier)
  }
  for (const other of allIssues) {
    if (other.identifier === issue.identifier) continue
    for (const r of other.relations) {
      if (r.type === 'related' && r.targetIdentifier === issue.identifier) {
        relatedIds.add(other.identifier)
      }
    }
  }
  const relatedList: NormalizedIssue[] = Array.from(relatedIds)
    .map((id) => allIssues.find((i) => i.identifier === id))
    .filter((i): i is NormalizedIssue => i !== undefined)

  // Sub-issue hierarchy. Indexed rather than `.find`-per-child: a parent can
  // carry up to 20 children and each lookup would otherwise scan every issue.
  const byId = new Map(allIssues.map((i) => [i.identifier, i]))
  const hierarchy = resolveHierarchy(issue, byId)

  return (
    <>
      {/* Modal mode's backdrop — click it to collapse back to the docked
          side panel (same as pressing 'm' again). Not a close; focusedId
          and the rest of the panel's state are untouched. */}
      {wideMode && <div className="detail-modal-backdrop" onClick={toggleWide} />}
      <aside
        className={[
          'detail-panel',
          `detail-text-${textSize}`,
          wideMode ? 'is-wide' : '',
          wideMode && fullScreen ? 'is-fullscreen' : '',
          resizing ? 'is-resizing' : '',
        ].filter(Boolean).join(' ')}
        style={
          wideMode && fullScreen
            ? undefined
            : wideMode ? { width: renderedWidth } : { width: renderedWidth, flexShrink: 0 }
        }
      >
      <div className="resize-handle resize-handle-left" onMouseDown={startResize} title="Drag to resize" />
      <div ref={headAreaRef} className="detail-head-area">
      <div className="detail-header">
        <h2>
          <button
            type="button"
            className={`detail-identifier${copied ? ' is-copied' : ''}`}
            onClick={() => void copyIdentifier(issue.identifier)}
            title={copied ? t('detailPanel.copied') : t('detailPanel.copyId')}
            aria-label={t('detailPanel.copyIdAria', { id: issue.identifier })}
            style={{ '--identifier-state': stateColorVar(issue.state.type) } as CSSProperties}
          >
            <span className="detail-identifier-dot" aria-hidden />
            <span className="detail-identifier-text">{issue.identifier}</span>
            {copied && (
              <span className="detail-identifier-icon" aria-hidden>
                <Check size={11} />
              </span>
            )}
          </button>
          <span className="detail-title-text">{issue.title}</span>
          {/* Inline with the title's own text flow (not a separate row
              below it) — flows right behind wherever the title's last
              line ends instead of always starting its own new line. */}
          <a className="detail-source-link" href={issue.url} target="_blank" rel="noreferrer">
            {t('detailPanel.openInSource')} <ExternalLink size={12} />
          </a>
        </h2>
        {/* A fixed 3-col grid, not a flex row — six icons in one line read
            as a wide, busy strip even with plenty of room to spare; three
            per row reads as one compact block instead, at the cost of a
            bit more height, which this header has to spare more easily
            than it has width. Order is row-major (left to right, top to
            bottom): window controls (resize/close) on row one so Close
            still lands top-right where it's expected, secondary actions
            (text size/copy/outline) on row two. */}
        <div className="detail-header-actions">
        {/* Each button carries a detail-action-* class purely so CSS can
            give it a different `order` in the docked 3x2 grid vs. the
            wide/full-screen single row — the two requested sequences
            aren't a reordering of each other (e.g. Close is last in the
            row but mid first-row in the grid), so source order alone
            can't satisfy both; order is the one property that can be
            scoped per layout without duplicating the buttons themselves. */}
        <button
          className="icon-only detail-action-copy"
          onClick={() => void copyIdentifierAndTitle(issue.identifier, issue.title)}
          title={copiedTitle ? t('detailPanel.copied') : t('detailPanel.copyIdAndTitle')}
          aria-label={t('detailPanel.copyIdAndTitleAria', { id: issue.identifier })}
        >
          {copiedTitle ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          className="icon-only detail-action-maximize"
          onClick={toggleWide}
          title={wideMode ? t('detailPanel.collapse') : t('detailPanel.expand')}
          aria-label={wideMode ? t('detailPanel.collapse') : t('detailPanel.expand')}
        >
          {wideMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        {/* Shown from the docked side panel too, same as Shift+M — click it
            there and it enters modal mode and full screen together in one
            step (see toggleModalFullScreen), rather than only appearing
            once you're already in the modal. Separate icon family
            (Maximize/Minimize, no "2") so it doesn't read as the same
            control as the maximize/collapse button above. */}
        <button
          className="icon-only detail-action-fullscreen"
          onClick={toggleModalFullScreen}
          title={wideMode && fullScreen ? t('detailPanel.collapseFullScreen') : t('detailPanel.expandFullScreen')}
          aria-label={wideMode && fullScreen ? t('detailPanel.collapseFullScreen') : t('detailPanel.expandFullScreen')}
        >
          {wideMode && fullScreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <button
          className="icon-only detail-text-size-btn detail-action-textsize"
          onClick={cycleTextSize}
          title={t('detailPanel.cycleTextSize', { size: textSize })}
          aria-label={t('detailPanel.cycleTextSizeAria')}
        >
          <Type size={12} />
          <span className="detail-text-size-label">{textSize}</span>
        </button>
        {outline.length > 1 && (
          <button
            className="icon-only detail-action-outline"
            onClick={toggleOutlineOpen}
            title={outlineOpen ? t('detailPanel.hideOutline') : t('detailPanel.outline')}
            aria-label={outlineOpen ? t('detailPanel.hideOutline') : t('detailPanel.outline')}
          >
            <List size={16} />
          </button>
        )}
        <button
          className="icon-only detail-close detail-action-close"
          onClick={() => setDetailPanelOpen(false)}
          title={t('detailPanel.closeTitle')}
          aria-label={t('detailPanel.closeAria')}
        >
          <X size={16} />
        </button>
        </div>
      </div>
      </div>

      {/* Table of contents spanning Description's and the Comments' own
          headings — shown docked or wide, not gated on panel width: it's
          hover-reveal (see below), so it never costs any width it isn't
          actively being used. Positioned against the panel itself (not
          .detail-body), which stays put as the panel's content scrolls
          instead of scrolling away with it. Hidden until hovered (the
          hover target is the wider invisible .detail-outline-zone, not the
          bar itself, so there's something to find before anything is
          visible) or pinned open via the header's list-icon toggle. */}
      {outline.length > 1 && (
        <div
          ref={outlineZoneRefCallback}
          className={`detail-outline-zone${outlineOpen ? ' is-pinned' : ''}${outlineResizing ? ' is-resizing' : ''}`}
        >
          <nav className="detail-outline" aria-label={t('detailPanel.outline')} style={{ width: outlineWidth }}>
            <div
              className={`detail-outline-resize-handle${outlineResizing ? ' is-resizing' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('detailPanel.outlineResize')}
              onPointerDown={handleOutlineResizeStart}
              onPointerMove={handleOutlineResizeMove}
              onPointerUp={endOutlineResize}
              onPointerCancel={endOutlineResize}
            />
            <div className="detail-outline-title">{t('detailPanel.outline')}</div>
            {outline.map((o) => {
              const Icon = o.icon ? OUTLINE_SECTION_ICONS[o.icon] : o.isCommentMarker ? MessageSquare : null
              return (
                <button
                  key={o.id}
                  type="button"
                  className={[
                    'detail-outline-item',
                    `detail-outline-level-${o.level}`,
                    o.isCommentMarker ? 'detail-outline-comment-marker' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => scrollToOutlineEntry(o.id)}
                  title={o.text}
                >
                  {Icon && <Icon size={11} aria-hidden className="detail-outline-icon" />}
                  <span className="detail-outline-text">{o.text}</span>
                </button>
              )
            })}
          </nav>
        </div>
      )}

      <div className="detail-body" ref={bodyRef}>
      <div className="section">
        {/* Above the fields it explains, and only while the fix is in the
            user's hands — see WriteLockedHint. */}
        <WriteLockedHint />
        {/* Two verbs share each of these rows: change this issue, and show
            only issues like it. The editable control leads, because the row is
            labelled "State" and the first thing after that label should be the
            state itself — not an action that happens to be spelled the same.
            Filtering keeps its place but says what it does instead of
            repeating the value a second time, which is what made the old row
            read as two identical controls. */}
        <div className="detail-controls-row">
          <div className="row">
            <span className="k">{t('detailPanel.state')}</span>
            {writable ? (
              <>
                <StatusControl issue={issue} />
                <FilterOnlyButton
                  onClick={() => { setFilter('stateTypes', [issue.state.type]); setDetailPanelOpen(false) }}
                  title={t('detailPanel.filterByState', { value: stateLabelFor(issue.state.type, locale) })}
                />
              </>
            ) : (
              <button
                type="button"
                className={`state-pill detail-state-pill is-${issue.state.type}`}
                style={{ color: stateColorVar(issue.state.type) }}
                onClick={() => { setFilter('stateTypes', [issue.state.type]); setDetailPanelOpen(false) }}
                title={t('detailPanel.filterByState', { value: stateLabelFor(issue.state.type, locale) })}
              >
                <span className="glyph" aria-hidden>{stateIcon(issue.state.type)}</span>
                <span>{issue.state.name}</span>
              </button>
            )}
          </div>
          <div className="row">
            <span className="k">{t('detailPanel.priority')}</span>
            {writable ? (
              <>
                <PriorityControl issue={issue} />
                <FilterOnlyButton
                  onClick={() => { setFilter('priorities', [issue.priority]); setDetailPanelOpen(false) }}
                  title={t('detailPanel.filterByPriority', { value: priorityLabelFor(issue.priority, locale) })}
                />
              </>
            ) : (
              <button
                type="button"
                className="detail-filter-link"
                onClick={() => { setFilter('priorities', [issue.priority]); setDetailPanelOpen(false) }}
                title={t('detailPanel.filterByPriority', { value: priorityLabelFor(issue.priority, locale) })}
              >
                {priorityLabelFor(issue.priority, locale)}
              </button>
            )}
          </div>
          <div className="row">
            <span className="k">{t('detailPanel.assignee')}</span>
            {writable ? (
              <>
                <AssigneeControl issue={issue} />
                <FilterOnlyButton
                  onClick={() => { setFilter('assignees', [issue.assignee?.displayName ?? '(unassigned)']); setDetailPanelOpen(false) }}
                  title={t('detailPanel.filterByAssignee', { value: issue.assignee?.displayName ?? t('detailPanel.unassignedShort') })}
                />
              </>
            ) : (
              <button
                type="button"
                className="detail-filter-link"
                onClick={() => { setFilter('assignees', [issue.assignee?.displayName ?? '(unassigned)']); setDetailPanelOpen(false) }}
                title={t('detailPanel.filterByAssignee', { value: issue.assignee?.displayName ?? t('detailPanel.unassignedShort') })}
              >
                {issue.assignee?.displayName ?? t('detailPanel.unassignedShort')}
              </button>
            )}
          </div>
        </div>

        <div className="meta-grid">
          <span className="k">{t('detailPanel.project')}</span>
          {issue.project ? (
            <button
              type="button"
              className="detail-filter-link v"
              onClick={() => { setFilter('projectIds', [issue.project!.id]); setDetailPanelOpen(false) }}
              title={t('detailPanel.filterByProject', { value: issue.project.name })}
            >
              {issue.project.name}
            </button>
          ) : (
            <span className="v" style={{ color: 'var(--fg-faint)' }}>—</span>
          )}
          {/* Milestone only renders when the issue has a project — a
              milestone without a project isn't representable in Linear's
              data model and would have no filter key. Mirrors the milestone
              view's "skip projectless issues" rule. */}
          {issue.project && (
            <>
              <span className="k">{t('detailPanel.milestone')}</span>
              {issue.projectMilestone ? (
                <button
                  type="button"
                  className="detail-filter-link v"
                  onClick={() => {
                    setFilter('milestoneIds', [
                      milestoneFilterKey(issue.project!.id, issue.projectMilestone!.id),
                    ])
                    setDetailPanelOpen(false)
                  }}
                  title={t('detailPanel.filterByMilestone', { value: issue.projectMilestone.name })}
                >
                  {issue.projectMilestone.name}
                </button>
              ) : (
                <span className="v" style={{ color: 'var(--fg-faint)' }}>{t('detailPanel.noMilestone')}</span>
              )}
            </>
          )}
          {issue.team && (
            <>
              <span className="k">{t('detailPanel.team')}</span>
              <span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {issue.team.color && (
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: issue.team.color,
                    }}
                  />
                )}
                <span>
                  {issue.team.name}
                  {issue.team.key && (
                    <span style={{ color: 'var(--fg-faint)', marginLeft: 6 }}>
                      {issue.team.key}
                    </span>
                  )}
                </span>
              </span>
            </>
          )}
          {typeof issue.estimate === 'number' && (
            <>
              <span className="k">{t('detailPanel.estimate')}</span>
              <span className="v">{t('detailPanel.estimatePointsShort', { value: issue.estimate })}</span>
            </>
          )}
          {issue.dueDate && (
            <>
              <span className="k">{t('detailPanel.dueDate')}</span>
              <span
                className="v mono"
                title={issue.dueDate}
                style={
                  isOverdueIssue(issue)
                    ? { color: 'var(--danger, #ef4444)', fontWeight: 600 }
                    : undefined
                }
              >
                {issue.dueDate}
                {isOverdueIssue(issue) && (
                  <span style={{ marginLeft: 6, fontSize: 11 }}>
                    · {t('detailPanel.overdue')}
                  </span>
                )}
              </span>
            </>
          )}
          {issue.startedAt && (
            <>
              <span className="k">{t('detailPanel.startedAt')}</span>
              <span className="v mono" title={issue.startedAt}>{timeAgo(issue.startedAt, locale)}</span>
            </>
          )}
          <span className="k">{t('detailPanel.created')}</span>
          <span className="v mono">{timeAgo(issue.createdAt, locale)}</span>
          <span className="k">{t('detailPanel.updated')}</span>
          <span className="v mono">{timeAgo(issue.updatedAt, locale)}</span>
        </div>
        {/* Every label on the issue, one field per schema section. Driven by
            groupIssueLabels rather than by looking up the groups the schema
            named, so a label from a group autodetection has not classified
            (or has not seen yet) still surfaces under "Labels" instead of
            vanishing. Chips filter the dimension they belong to, matching
            the state/priority/assignee rows above.

            A flex-wrap row, not more rows in the meta-grid above: each field
            here is a short label + one or two chips, nothing like Project's
            or Milestone's long values, so forcing one per grid row wastes
            most of a wide panel's width. Wrapping packs 2-3 per line when
            there's room and falls back to one-per-line in the narrow docked
            panel — same content, no fixed column count to get wrong. */}
        <div className="detail-label-row">
          {labelSections.map((sec) => (
            <div className="detail-label-field" key={`${sec.kind}:${sec.key}`}>
              <span className="k">
                {sec.kind === 'prefix' ? `${sec.key}:` : sec.kind === 'orphan' ? t('detailPanel.labels') : sec.key}
              </span>
              <span className="v chips">
                {sec.labels.map((l) => (
                  <span key={l.id} className="detail-label-chip">
                  <button
                    type="button"
                    className="detail-filter-link"
                    onClick={() => { applyLabelFilter(sec, l.id); setDetailPanelOpen(false) }}
                    title={
                      sec.kind === 'orphan'
                        ? t('detailPanel.filterByLabel', { value: l.name })
                        : t('detailPanel.filterByGroup', {
                            group: sec.kind === 'prefix' ? `${sec.key}:` : sec.key,
                            value: l.name,
                          })
                    }
                  >
                    {sec.kind === 'prefix' ? shortPrefixDisplay(l.name, sec.key) : l.name}
                  </button>
                  <LabelRemoveButton issue={issue} label={l} />
                </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        <LabelAddControl issue={issue} />
      </div>

      {docs.length > 0 && (
        <div className="section">
          <h3 data-outline-icon="designDocs">{t('detailPanel.designDocs', { count: docs.length })}</h3>
          {docs.length > 1 && (
            <div className="detail-spec-warn">
              <AlertTriangle size={14} className="detail-spec-warn-icon" />
              <span>
                {t('detailPanel.designSpansWarn', { count: docs.length })}
              </span>
            </div>
          )}
          {docs.map((d) => (
            <details key={d.name} open={docs.length === 1}>
              <summary>
                {d.name} {d.status === 'parked' && t('detailPanel.parked')} — {d.doneTasks}/{d.totalTasks}
              </summary>
              <div className="progress" style={{ height: 6, background: 'var(--chip-bg)', borderRadius: 3, margin: '4px 0' }}>
                <div style={{ width: `${(d.progress * 100).toFixed(0)}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{d.filePath}</div>
            </details>
          ))}
        </div>
      )}

      {(hierarchy.parent || hierarchy.children.length > 0) && (
        // Hierarchy — Linear's parent/children, which live outside `relations`
        // and so never appear as edges. Section is omitted entirely when the
        // issue has neither: most issues don't use sub-issues, and an empty
        // heading would be noise on every card.
        <div className="section">
          <h3 data-outline-icon="hierarchy">{t('detailPanel.hierarchy')}</h3>
          {hierarchy.parent && (
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{t('detailPanel.parentIssue')}</div>
              <div>
                <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(hierarchy.parent!.identifier) }}>
                  ↑ {hierarchy.parent.identifier} {hierarchy.parent.issue?.title ?? ''}
                </a>
              </div>
            </div>
          )}
          {hierarchy.children.length > 0 && (
            <div style={{ marginTop: hierarchy.parent ? 6 : 0 }}>
              <div
                style={{ color: 'var(--fg-muted)', fontSize: 11 }}
                title={[
                  hierarchy.unresolved > 0
                    ? t('detailPanel.subIssuesUnresolved', { count: hierarchy.unresolved })
                    : '',
                  hierarchy.truncated ? t('detailPanel.subIssuesTruncated') : '',
                ].filter(Boolean).join('\n')}
              >
                {t('detailPanel.subIssues')} —{' '}
                {t('detailPanel.subIssuesProgress', {
                  done: hierarchy.done,
                  total: hierarchy.truncated ? `${hierarchy.total}+` : hierarchy.total,
                })}
              </div>
              {hierarchy.children.map((c) => (
                <div key={c.identifier}>
                  {c.issue ? (
                    <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(c.identifier) }}>
                      ↳ {c.identifier} {c.issue.title}
                    </a>
                  ) : (
                    // Unlike `related` (which hides uncached targets), an
                    // uncached child still represents outstanding work — it
                    // counts toward the progress denominator, so hiding the
                    // row would make the number unexplainable.
                    <span style={{ color: 'var(--fg-muted)' }} title={t('detailPanel.subIssueNotCached')}>
                      ↳ {c.identifier}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(blocksOut.length > 0 || blocksIn.length > 0) && (
        <div className="section">
          <h3 data-outline-icon="blocks">{t('detailPanel.blocks')}</h3>
          {blocksIn.length > 0 && (
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{t('detailPanel.blockedBy')}</div>
              {blocksIn.map((b) => (
                <div key={b.identifier}>
                  <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(b.identifier) }}>
                    ← {b.identifier} {b.title}
                  </a>
                </div>
              ))}
            </div>
          )}
          {blocksOut.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{t('detailPanel.blocksOut')}</div>
              {blocksOut.map((id) => (
                <div key={id}>
                  <a href="#" onClick={(e) => { e.preventDefault(); useViewStore.getState().setFocusedId(id) }}>→ {id}</a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {relatedList.length > 0 && (
        <div className="section">
          <h3 data-outline-icon="related">{t('detailPanel.related', { count: relatedList.length })}</h3>
          {/* `related` is bidirectional — no in/out split, just list. The
              ↔ icon mirrors the dashed-edge style on the canvas + the
              connectivity-badge ╍ glyph, keeping visual grammar consistent. */}
          {relatedList.map((r) => (
            <div key={r.identifier}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  useViewStore.getState().setFocusedId(r.identifier)
                }}
              >
                ↔ {r.identifier} {r.title}
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <div className="section-head-row">
          <h3 data-outline-icon="annotations">{t('detailPanel.annotations', { count: annotations.length })}</h3>
          <button
            type="button"
            className="icon-only"
            onClick={toggleAnnotationsOpen}
            title={annotationsOpen ? t('detailPanel.collapseAnnotations') : t('detailPanel.expandAnnotations')}
            aria-label={annotationsOpen ? t('detailPanel.collapseAnnotations') : t('detailPanel.expandAnnotations')}
          >
            {annotationsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        {annotationsOpen && (
          <>
            <div ref={annotationsRef}>
            {annotations.map((a) => (
              <div key={a.id} style={{ borderTop: '1px solid var(--node-border)', paddingTop: 6, marginTop: 6 }}>
                {editingId === a.id ? (
                  <>
                    <textarea value={editingBody} onChange={(e) => setEditingBody(e.target.value)} rows={3} style={{ width: '100%' }} />
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <button className="primary" onClick={saveEdit}>{t('common.save')}</button>
                      <button onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="desc-body" dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(a.body) }} />
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <button onClick={() => { setEditingId(a.id); setEditingBody(a.body) }}>{t('common.edit')}</button>
                      <button onClick={() => remove(a.id)}>{t('common.delete')}</button>
                      <span style={{ color: 'var(--fg-muted)', fontSize: 11, marginLeft: 'auto' }}>
                        {timeAgo(new Date(a.updatedAt).toISOString(), locale)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
            </div>
            <textarea
              rows={3}
              placeholder={t('detailPanel.addAnnotationPlaceholder')}
              value={annotationDraft}
              onChange={(e) => setAnnotationDraft(e.target.value)}
              style={{ width: '100%', marginTop: 6 }}
            />
            <button className="primary" onClick={submitAnnotation} style={{ marginTop: 4 }}>{t('detailPanel.addAnnotation')}</button>
          </>
        )}
      </div>

      <div className="section">
        <h3 data-outline-icon="description">{t('detailPanel.description')}</h3>
        {descLoading && (
          <div className="skeleton-stack" aria-busy="true" aria-label={t('detailPanel.descriptionLoadingAria')}>
            <div className="skeleton skeleton-line" style={{ width: '92%' }} />
            <div className="skeleton skeleton-line" style={{ width: '78%' }} />
            <div className="skeleton skeleton-line" style={{ width: '85%' }} />
            <div className="skeleton skeleton-line" style={{ width: '40%' }} />
          </div>
        )}
        {!descLoading && description !== null && (
          <div ref={descRef} className="desc-body" dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(description || '', t('detailPanel.noDescription')) }} />
        )}
        {!descLoading && description === null && <div style={{ color: 'var(--fg-muted)' }}>{t('detailPanel.descriptionLoadFail')}</div>}
      </div>

      {attachments !== null && attachments.length > 0 && (
        <div className="section">
          <h3 data-outline-icon="resources">{t('detailPanel.resources', { count: attachments.length })}</h3>
          {attachments.map((a) => (
            <a
              key={a.id}
              className="detail-resource-link"
              href={a.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={12} />
              <span>{a.title || a.url}</span>
              {a.subtitle && <span className="detail-resource-subtitle">{a.subtitle}</span>}
            </a>
          ))}
        </div>
      )}

      <div className="section">
        <h3 data-outline-icon="comments">{t('detailPanel.comments', { count: sortedComments?.length ?? 0 })}</h3>
        {descLoading && sortedComments === null && (
          <div style={{ color: 'var(--fg-muted)' }}>{t('detailPanel.commentsLoading')}</div>
        )}
        {sortedComments !== null && sortedComments.length === 0 && !descLoading && (
          <div style={{ color: 'var(--fg-muted)' }}>{t('detailPanel.noComments')}</div>
        )}
        <div ref={commentsRef}>
        {sortedComments !== null && sortedComments.map((cm) => (
          <div key={cm.id} className="detail-comment">
            <div className="detail-comment-head">
              <strong>{cm.user?.displayName ?? t('detailPanel.unknownAuthor')}</strong>
              <span className="detail-comment-time">{timeAgo(cm.createdAt, locale)}</span>
            </div>
            <MarkdownBody body={cm.body} />
          </div>
        ))}
        </div>
        <CommentComposer identifier={issue.identifier} onPosted={() => setDetailNonce((n) => n + 1)} />
      </div>
      </div>
      </aside>
    </>
  )
}
