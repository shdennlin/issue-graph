import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  applyNodeChanges,
  Background,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  useReactFlow,
  type Node as RFNode,
  type NodeChange,
  type Edge as RFEdge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type Viewport,
} from 'reactflow'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { findView } from '../views'
import { IssueNode } from './nodes/IssueNode'
import { MixedContainerNode } from './nodes/MixedContainerNode'
import { InlineSearch } from './InlineSearch'

const nodeTypes = {
  issue: IssueNode,
  mixedContainer: MixedContainerNode,
}

function CanvasInner() {
  const graph = useGraphStore((s) => s.graph)
  const { schema } = useSchemaStore()
  const activeView = useViewStore((s) => s.activeView)
  const filters = useViewStore((s) => s.filters)
  const focusedId = useViewStore((s) => s.focusedId)
  const chainRootId = useViewStore((s) => s.chainRootId)
  const showRelated = useViewStore((s) => s.showRelated)
  const setChainRootId = useViewStore((s) => s.setChainRootId)
  const layoutBump = useViewStore((s) => s.layoutBump)
  const bumpLayout = useViewStore((s) => s.bumpLayout)
  const staleDays = useViewStore((s) => s.staleDays)
  const density = useViewStore((s) => s.density)
  const search = useViewStore((s) => s.search)
  const theme = useViewStore((s) => s.theme)
  const colorMode = theme === 'auto'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  const selection = useViewStore((s) => s.selection)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const toggleSelection = useViewStore((s) => s.toggleSelection)
  const setContextMenu = useViewStore((s) => s.setContextMenu)
  const highlightedEdgeId = useViewStore((s) => s.highlightedEdgeId)
  const setHighlightedEdgeId = useViewStore((s) => s.setHighlightedEdgeId)
  const highlightedNodeId = useViewStore((s) => s.highlightedNodeId)
  const setHighlightedNodeId = useViewStore((s) => s.setHighlightedNodeId)
  const rfRef = useRef<HTMLDivElement>(null)

  const myUserName = graph?.data.viewer?.displayName ?? null
  const myUserId = graph?.data.viewer?.id ?? null

  // Measured heights from React Flow's first paint pass. When populated, the
  // view's `build()` re-runs with real card heights and dagre relays out so
  // tall cards (long titles + many chips) don't crash into the next row.
  const [measuredHeights, setMeasuredHeights] = useState<Map<string, number> | null>(null)

  const built = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] }
    const view = findView(activeView) ?? findView('dependency')!
    return view.build({
      data: graph.data,
      schema,
      filters,
      staleDays,
      myUserId,
      myUserName,
      selection,
      focusedId,
      chainRootId,
      showRelated,
      density,
      search,
      measuredHeights: measuredHeights ?? undefined,
    })
  }, [graph, schema, activeView, filters, staleDays, focusedId, chainRootId, showRelated, selection, myUserId, myUserName, density, search, measuredHeights])

  // Local node state so user drags persist between renders within the same
  // layout-equivalent context. Anything that changes node sizes (density) or
  // node parentage (view) invalidates positions and forces a fresh layout —
  // otherwise stale positions cause overlaps when nodes grow.
  const [nodes, setNodes] = useState<RFNode[]>(built.nodes)
  // Include `measuredHeights ? 'm' : 'e'` so the post-measure re-layout pass is
  // treated as a sig change — that forces the freshly-laid-out positions in,
  // instead of preserving the pre-measure (overlapping) positions.
  const layoutSig = `${activeView}|${density}|${measuredHeights ? 'm' : 'e'}|${layoutBump}`
  const lastSigRef = useRef(layoutSig)
  useEffect(() => {
    const sigChanged = lastSigRef.current !== layoutSig
    lastSigRef.current = layoutSig
    setNodes((prev) => {
      if (sigChanged || prev.length === 0) {
        return built.nodes
      }
      // Same layout signature: preserve user-dragged positions for nodes that
      // survived the rebuild (filter add/remove). Brand new nodes get fresh
      // layout positions.
      const prevById = new Map(prev.map((n) => [n.id, n]))
      return built.nodes.map((n) => {
        const previous = prevById.get(n.id)
        if (previous && previous.position && previous.parentNode === n.parentNode) {
          return { ...n, position: previous.position }
        }
        return n
      })
    })
  }, [built.nodes, layoutSig])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((curr) => applyNodeChanges(changes, curr))
  }, [])

  const rf = useReactFlow()

  // Phase 2 layout: read each issue card's *real* rendered height from the DOM
  // after RF has painted, then feed those back into `build()` so dagre lays
  // out around them. We use getBoundingClientRect() rather than RF's
  // `useNodesInitialized` / `getNodes()` because in v11 those return the
  // pre-declared `node.height` we passed in, never the measured value —
  // declaring `height` short-circuits RF's measurement bookkeeping.
  // Guarded by `layoutSig` so we re-measure only on layout-context change
  // (view/density/node count), not on every drag tick.
  const measuredSigRef = useRef<string | null>(null)
  useEffect(() => {
    if (built.nodes.length === 0) return
    const sig = `${activeView}|${density}|${built.nodes.length}`
    if (measuredSigRef.current === sig) return
    // setTimeout, not RAF — during initial settle, effect deps churn fast
    // enough that RAF-cleanup races cancel the callback before the browser
    // gets a chance to paint. setTimeout's macrotask survives that race.
    // 150ms is long enough for RF to mount nodes and CSS to compute heights,
    // but short enough that the user perceives it as a single layout pass.
    const handle = window.setTimeout(() => {
      const map = new Map<string, number>()
      const els = document.querySelectorAll('.react-flow__node-issue')
      for (const el of els) {
        const id = (el as HTMLElement).dataset.id
        if (!id) continue
        // offsetHeight, NOT getBoundingClientRect: when the user zooms in/out,
        // RF applies a CSS transform (`scale(...)`) to the viewport, which
        // multiplies the BCR result. We want flow-coord height (the value
        // dagre lays out in), which is transform-immune. offsetHeight reads
        // the pre-transform layout height directly.
        const h = (el as HTMLElement).offsetHeight
        if (h > 0) map.set(id, h)
      }
      if (map.size === 0) return
      // Skip update if every height matches existing within 1px — avoids
      // unnecessary rerenders that would just produce identical output.
      let differs = true
      if (measuredHeights && measuredHeights.size === map.size) {
        differs = false
        for (const [k, v] of map) {
          const prev = measuredHeights.get(k)
          if (prev === undefined || Math.abs(prev - v) > 1) {
            differs = true
            break
          }
        }
      }
      measuredSigRef.current = sig
      if (differs) setMeasuredHeights(map)
    }, 150)
    return () => window.clearTimeout(handle)
  }, [built.nodes, activeView, density, measuredHeights])

  // Reset measured-heights cache when the layout context changes (view switch,
  // density change, or an explicit layout bump). Clearing forces the measure
  // effect above to re-run on the next paint, which in turn drives the
  // unified fitView consumer below to fire (when a fit was requested).
  useEffect(() => {
    measuredSigRef.current = null
    setMeasuredHeights(null)
  }, [activeView, density, layoutBump])
  // Save viewport snapshot whenever user clicks fit-view, so they can revert.
  // Stored in a ref (not store) — purely UI ephemeral, doesn't affect rendering.
  const lastViewportRef = useRef<Viewport | null>(null)
  const [hasSavedViewport, setHasSavedViewport] = useState(false)
  const fitViewWithSnapshot = useCallback(() => {
    lastViewportRef.current = rf.getViewport()
    setHasSavedViewport(true)
    rf.fitView({ duration: 600, padding: 0.1, minZoom: 0.8 })
  }, [rf])
  const revertViewport = useCallback(() => {
    if (!lastViewportRef.current) return
    rf.setViewport(lastViewportRef.current, { duration: 400 })
    setHasSavedViewport(false)
  }, [rf])
  // Unified fitView pipeline. A "fit request" is a flag set by the producers
  // below (first load / view switch / layout bump). The consumer fires
  // rf.fitView() only when measuredHeights actually settles — that's the
  // signal that dagre's second pass (using real card heights) is done and
  // positions are final. Replaces three separate setTimeout(80–120ms) hacks
  // that had to guess when layout finished; on slow machines the timer could
  // fire too early and frame the wrong region.
  //
  // Density / filter changes deliberately don't set the flag — they reset
  // measuredHeights for re-measurement, but no fitView fires.
  const pendingFitViewRef = useRef<{ padding: number; preserveFocus?: boolean } | null>(null)
  useEffect(() => {
    if (!pendingFitViewRef.current) return
    if (!measuredHeights) return  // wait until layout has settled
    const { padding, preserveFocus } = pendingFitViewRef.current
    pendingFitViewRef.current = null
    // Re-layout flow: if a node is focused, recenter on it instead of
    // framing the whole graph. After dagre re-runs, the focused issue may
    // have moved across the canvas — fitView would yank the camera to
    // wherever the new bounding box happens to be, losing the user's
    // visual anchor. setCenter on the focused node keeps "what I was
    // looking at" fixed while everything around it reflows.
    if (preserveFocus && focusedId) {
      const node = nodes.find((n) => n.id === focusedId)
      if (node?.position) {
        const w = (node.width ?? 320) as number
        const h = (node.height ?? 110) as number
        rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom: rf.getZoom(),
          duration: 600,
        })
        return
      }
    }
    rf.fitView({ duration: 600, padding, minZoom: 0.8 })
  }, [measuredHeights, rf, focusedId, nodes])

  // Producer 1: first non-empty load.
  const hasFitOnceRef = useRef(false)
  useEffect(() => {
    if (nodes.length === 0) return
    if (hasFitOnceRef.current) return
    hasFitOnceRef.current = true
    pendingFitViewRef.current = { padding: 0.1 }
  }, [nodes.length])

  // Producer 2: view switch (e.g. dependency → mix).
  useEffect(() => {
    if (nodes.length === 0) return
    pendingFitViewRef.current = { padding: 0.1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  // Producer 3: explicit layout bump (chain auto-layout, chain clear, manual
  // re-layout button, 'r' shortcut). Padding is slightly looser since chain
  // views are usually small graphs and look nicer with more breathing room.
  // preserveFocus: re-layout shouldn't make the user lose their place — if
  // a node was focused, the consumer recenters on it instead of fitView.
  const lastLayoutBumpRef = useRef(layoutBump)
  useEffect(() => {
    if (lastLayoutBumpRef.current === layoutBump) return
    lastLayoutBumpRef.current = layoutBump
    if (nodes.length === 0) return
    pendingFitViewRef.current = { padding: 0.15, preserveFocus: true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutBump])

  // Auto-bump layout when chain isolation is *cleared* (chainRootId goes
  // non-null → null). Without this, exiting chain mode keeps the chain
  // members' tightly-packed positions and the previously-hidden nodes get
  // fresh dagre positions inserted around them — they overlap. We don't bump
  // when entering chain mode: plain "Isolate chain" deliberately preserves
  // positions ("Isolate chain (auto-layout)" is the entry path that wants
  // a fresh layout, and it bumps explicitly in the context-menu handler).
  const prevChainRef = useRef<string | null>(chainRootId)
  useEffect(() => {
    const wasSet = prevChainRef.current !== null
    const isCleared = chainRootId === null
    prevChainRef.current = chainRootId
    if (wasSet && isCleared) {
      bumpLayout()
    }
  }, [chainRootId, bumpLayout])

  // Manual re-layout button handler. Bumps layoutBump → measured cache
  // clears → dagre re-runs from scratch (ignores user-dragged positions) →
  // pendingFitViewRef set → measured re-fires → camera follows.
  const manualRelayout = useCallback(() => {
    bumpLayout()
  }, [bumpLayout])

  // Intentionally no auto-center on focus — selecting a node should just open
  // the detail panel without yanking the viewport. Users can hit fit-view if
  // they want to recenter.

  // Highlight focus: either an edge or a node can drive a "spotlight" that
  // dims everything except the active set. Click the same item again, click
  // empty pane, or pick a new target to update / clear.
  //   - Edge clicked → active edge = that one, active nodes = its endpoints.
  //   - Node clicked → active node = that one + neighbors, active edges = all
  //     edges touching it.
  // Hover state lives in component memory (ephemeral, no persistence). It
  // takes priority over the click-pinned highlight and over focusedId so the
  // user gets instant feedback while moving the mouse without losing the
  // pinned/focused state when they leave.
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)

  // Effective highlight target — priority order:
  //   1. hovered edge / node (instant, ephemeral)
  //   2. click-pinned highlight (sticky until pane click or another click)
  //   3. focusedId (sticky from selection — auto-dim non-neighbors)
  // Resolves to a single node OR edge id; the same set-builder below handles
  // both cases.
  const effectiveEdgeId = hoveredEdgeId ?? highlightedEdgeId
  const effectiveNodeId = hoveredNodeId ?? highlightedNodeId ?? focusedId

  const highlight = useMemo(() => {
    if (effectiveEdgeId) {
      const e = built.edges.find((x) => x.id === effectiveEdgeId)
      if (!e) return null
      return { nodes: new Set<string>([e.source, e.target]), edges: new Set<string>([e.id]) }
    }
    if (effectiveNodeId) {
      // Node may not exist in the current view (e.g. focused issue filtered
      // out). Skip dimming in that case — better than fading the entire graph.
      const exists = built.edges.some((e) => e.source === effectiveNodeId || e.target === effectiveNodeId)
        || built.nodes.some((n) => n.id === effectiveNodeId)
      if (!exists) return null
      const ns = new Set<string>([effectiveNodeId])
      const es = new Set<string>()
      for (const e of built.edges) {
        if (e.source === effectiveNodeId || e.target === effectiveNodeId) {
          es.add(e.id)
          ns.add(e.source)
          ns.add(e.target)
        }
      }
      return { nodes: ns, edges: es }
    }
    return null
  }, [effectiveEdgeId, effectiveNodeId, built.edges, built.nodes])

  const displayNodes = useMemo(() => {
    if (!highlight) return nodes
    return nodes.map((n) => {
      // Container nodes (mix view) stay opaque so the layout chrome doesn't fade.
      if (n.type !== 'issue') return n
      const isOn = highlight.nodes.has(n.id)
      return { ...n, style: { ...(n.style ?? {}), opacity: isOn ? 1 : 0.25, transition: 'opacity 200ms' } }
    })
  }, [nodes, highlight])

  const displayEdges = useMemo<RFEdge[]>(() => {
    if (!highlight) return built.edges
    return built.edges.map((e) => {
      const isOn = highlight.edges.has(e.id)
      return {
        ...e,
        style: { ...(e.style ?? {}), opacity: isOn ? 1 : 0.15, strokeWidth: isOn ? 2.6 : (e.style?.strokeWidth ?? 1.8) },
        zIndex: isOn ? 10 : 0,
      }
    })
  }, [built.edges, highlight])

  const onNodeClick: NodeMouseHandler = (event, node) => {
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(node.id)
      return
    }
    if (node.type === 'issue') {
      setFocusedId(node.id)
      // Toggle node-spotlight: same node clears, different node replaces.
      if (highlightedEdgeId) setHighlightedEdgeId(null)
      setHighlightedNodeId(highlightedNodeId === node.id ? null : node.id)
    }
  }

  // Edge-click pin (sticky highlight) is only useful on touch devices —
  // there's no hover, so tap is the only way to highlight an edge. On
  // desktop with a real pointer, hovering already drives the highlight,
  // and a click here only creates accidental "I clicked somewhere and the
  // graph dimmed" surprises. Disable click-pin when hover is supported.
  const onEdgeClick: EdgeMouseHandler = (event, edge) => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) {
      // Desktop / mouse — hover-driven highlight is enough; ignore the click.
      return
    }
    event.stopPropagation()
    if (highlightedNodeId) setHighlightedNodeId(null)
    setHighlightedEdgeId(highlightedEdgeId === edge.id ? null : edge.id)
  }

  const onNodeDoubleClick: NodeMouseHandler = (_event, node) => {
    if (node.type !== 'issue') return
    const issue = (node.data as any)?.issue
    if (issue?.url) window.open(issue.url, '_blank', 'noreferrer')
  }

  // Hover handlers — drive the dim-others-fade-this effect for fast scanning.
  // We only set hover state for issue nodes (not bucket containers) since the
  // dimming logic special-cases container types to stay opaque anyway.
  //
  // Race-condition handling for fast cursor movement: browsers can drop
  // mouseleave/mouseenter events when the cursor flicks across many small
  // elements faster than the event sample rate. Two safeguards:
  //   1. mouseleave clears only if leaving the *currently* hovered node — a
  //      stale leave for an older node won't wipe a fresh hover.
  //   2. mousemove acts as a self-healing fallback — while the cursor is
  //      inside any node, mousemove fires reliably at ~60-120Hz and corrects
  //      hoveredNodeId to match the cursor's actual position even if the
  //      original mouseenter was dropped.
  const onNodeMouseEnter: NodeMouseHandler = (_e, node) => {
    if (node.type === 'issue') setHoveredNodeId(node.id)
  }
  const onNodeMouseMove: NodeMouseHandler = (_e, node) => {
    if (node.type !== 'issue') return
    setHoveredNodeId((prev) => (prev === node.id ? prev : node.id))
  }
  const onNodeMouseLeave: NodeMouseHandler = (_e, node) => {
    setHoveredNodeId((prev) => (prev === node.id ? null : prev))
  }
  // Same race-condition handling as nodes (see onNodeMouse* above). Edges
  // are even thinner targets than node blocks, so dropped mouseleave events
  // are more likely — and a stuck edge hover beats node hover in the
  // priority order (effectiveEdgeId ?? highlightedEdgeId), so a wrongly-
  // pinned edge hijacks the entire highlight even when the user has moved
  // on to hovering an unrelated node.
  const onEdgeMouseEnter: EdgeMouseHandler = (_e, edge) => {
    setHoveredEdgeId(edge.id)
  }
  const onEdgeMouseMove: EdgeMouseHandler = (_e, edge) => {
    setHoveredEdgeId((prev) => (prev === edge.id ? prev : edge.id))
  }
  const onEdgeMouseLeave: EdgeMouseHandler = (_e, edge) => {
    setHoveredEdgeId((prev) => (prev === edge.id ? null : prev))
  }

  // Final safety net: when the cursor is in the empty pane between nodes
  // and edges, neither onNodeMouseMove nor onEdgeMouseMove can self-heal a
  // stale hover. This handler clears any leftover hover state once the
  // cursor is provably not over any graph element.
  //
  // ReactFlow attaches `onPaneMouseMove` as `onMouseMove` on the pane DIV,
  // which means it ALSO fires for events bubbling up from nodes and edges
  // (since they're descendants of the pane). The `closest()` check filters
  // those bubbled events out so we only clear when the cursor is truly on
  // empty background. Functional setState makes the no-op case free.
  const onPaneMouseMove = (e: React.MouseEvent) => {
    const target = e.target as Element
    if (target.closest('.react-flow__node, .react-flow__edge')) return
    setHoveredNodeId((prev) => (prev === null ? prev : null))
    setHoveredEdgeId((prev) => (prev === null ? prev : null))
  }

  const onPaneClick = () => {
    setFocusedId(null)
    setContextMenu(null)
    if (highlightedEdgeId) setHighlightedEdgeId(null)
    if (highlightedNodeId) setHighlightedNodeId(null)
  }

  const onNodeContextMenu = (event: React.MouseEvent, node: any) => {
    if (node.type !== 'issue') return
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, targetIdentifier: node.id })
  }

  return (
    <div className="canvas" ref={rfRef} style={{ position: 'relative' }}>
      <InlineSearch />
      {chainRootId && activeView === 'dependency' && built.nodes.length === 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 5,
            padding: '14px 18px',
            background: 'var(--bg-elevated, #fff)',
            border: '1px solid var(--border, #d0d7de)',
            borderRadius: 8,
            fontSize: 'var(--fs-meta)',
            color: 'var(--fg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <div>Chain root <strong>{chainRootId}</strong> not found in current data.</div>
          <button onClick={() => setChainRootId(null)}>Clear chain</button>
        </div>
      )}
      <ReactFlow
        // Force a clean RF instance only on view change (different parentNode
        // tree). Density change doesn't change the tree, so we keep the same
        // RF instance and the user's viewport / zoom is preserved.
        key={activeView}
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseMove={onNodeMouseMove}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseMove={onEdgeMouseMove}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onPaneMouseMove={onPaneMouseMove}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        fitView
        nodesDraggable
        // Two-finger trackpad / mouse-wheel scroll = pan. Pinch-zoom on trackpad
        // and Ctrl/Cmd+scroll still zoom. Buttons in <Controls /> also zoom.
        panOnScroll
        panOnScrollSpeed={1.0}
        zoomOnScroll={false}
        zoomOnPinch
        // Drag with primary button + with middle/right; left-click empty pane also pans.
        panOnDrag={[0, 1, 2]}
        proOptions={{ hideAttribution: true }}
        // Default edge styling — visible arrowheads, theme-aware stroke, slight
        // thickness so dependency edges read at-a-glance.
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: 'var(--edge)', strokeWidth: 1.8 },
          markerEnd: {
            // Use ReactFlow's default 12.5×12.5 arrowhead so all views (mix,
            // dependency, designdoc) read consistently. Larger sizes make
            // arrowheads dominate the cards in mix/designdoc views, where
            // edges connect bigger composite blocks.
            type: 'arrowclosed' as any,
            color: 'var(--edge)',
          },
        }}
      >
        <Background color={colorMode === 'dark' ? '#3d4452' : '#cfd6df'} />
        {/* Custom Controls: hide default fit-view button, replace with snapshot version. */}
        <Controls showFitView={false} position="bottom-left">
          <ControlButton onClick={fitViewWithSnapshot} title="Fit view (saves current viewport)">
            ⊡
          </ControlButton>
          {hasSavedViewport && (
            <ControlButton onClick={revertViewport} title="Revert to viewport before fit">
              ↶
            </ControlButton>
          )}
          <ControlButton
            onClick={manualRelayout}
            disabled={nodes.length === 0}
            title={
              nodes.length === 0
                ? 'Re-layout — no nodes to lay out (waiting for graph data)'
                : 'Re-layout (shortcut: Shift+R) — re-run dagre from scratch and refit. Discards user-dragged positions.'
            }
          >
            ⤴
          </ControlButton>
        </Controls>
        <Panel position="bottom-left" style={{ marginLeft: 50, fontSize: 'var(--fs-meta)', color: 'var(--fg-muted)' }}>
          {hasSavedViewport && '↶ revert available'}
        </Panel>
        {built.nodes.length <= 200 && (
          <MiniMap
            pannable
            zoomable
            // Theme-aware: sample CSS vars at render time. Re-renders with theme
            // change because GraphCanvas reads `theme` from store.
            style={{
              background: colorMode === 'dark' ? '#262a33' : '#fafafa',
              border: `1px solid ${colorMode === 'dark' ? '#3d4452' : '#d0d7de'}`,
            }}
            maskColor={colorMode === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)'}
            // Color each minimap node by its issue state (when applicable). Falls
            // back to bucket color for container/bucket nodes. Strong borders so
            // nodes are visible at very small scale.
            nodeColor={(n) => {
              const issue = (n.data as any)?.issue
              if (issue?.state?.type) {
                const stateColors: Record<string, string> = {
                  started: '#2563eb',
                  unstarted: '#7c3aed',
                  backlog: '#64748b',
                  completed: '#16a34a',
                  canceled: '#9ca3af',
                  triage: '#ea580c',
                }
                return stateColors[issue.state.type] ?? '#64748b'
              }
              const bucket = (n.data as any)?.bucket
              if (bucket?.color) return bucket.color
              return colorMode === 'dark' ? '#94a3b8' : '#475569'
            }}
            nodeStrokeColor={colorMode === 'dark' ? '#1c1f26' : '#fff'}
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
          />
        )}
      </ReactFlow>
    </div>
  )
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
