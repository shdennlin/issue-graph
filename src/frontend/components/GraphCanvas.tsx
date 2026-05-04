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
  const setChainRootId = useViewStore((s) => s.setChainRootId)
  const layoutBump = useViewStore((s) => s.layoutBump)
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
      density,
      search,
      measuredHeights: measuredHeights ?? undefined,
    })
  }, [graph, schema, activeView, filters, staleDays, focusedId, chainRootId, selection, myUserId, myUserName, density, search, measuredHeights])

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
  // density change). The next paint will re-measure under the new conditions.
  useEffect(() => {
    measuredSigRef.current = null
    setMeasuredHeights(null)
  }, [activeView, density])
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
  // Re-fit only on view switch or first non-empty load. Density / filter changes
  // intentionally do NOT refit — that would yank the user's viewport away from
  // wherever they were looking. They can hit the "fit view" button in <Controls />
  // if they want to recenter manually.
  const hasFitOnceRef = useRef(false)
  useEffect(() => {
    if (nodes.length === 0) return
    const isFirstLoad = !hasFitOnceRef.current
    hasFitOnceRef.current = true
    if (!isFirstLoad) return  // fitView only on first non-empty load
    const id = window.setTimeout(() => {
      // minZoom caps how far fitView is allowed to zoom out, so cards stay
      // readable even with many nodes. User can still zoom out via pinch /
      // <Controls /> after the initial fit.
      rf.fitView({ duration: 600, padding: 0.1, minZoom: 0.8 })
    }, 80)
    return () => window.clearTimeout(id)
  }, [nodes.length, rf])
  // Separate effect for view-switch refits — bypasses the "first load" gate.
  useEffect(() => {
    if (nodes.length === 0) return
    const id = window.setTimeout(() => {
      rf.fitView({ duration: 600, padding: 0.1, minZoom: 0.8 })
    }, 80)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  // Intentionally no auto-center on focus — selecting a node should just open
  // the detail panel without yanking the viewport. Users can hit fit-view if
  // they want to recenter.

  // Highlight focus: either an edge or a node can drive a "spotlight" that
  // dims everything except the active set. Click the same item again, click
  // empty pane, or pick a new target to update / clear.
  //   - Edge clicked → active edge = that one, active nodes = its endpoints.
  //   - Node clicked → active node = that one + neighbors, active edges = all
  //     edges touching it.
  const highlight = useMemo(() => {
    if (highlightedEdgeId) {
      const e = built.edges.find((x) => x.id === highlightedEdgeId)
      if (!e) return null
      return { nodes: new Set<string>([e.source, e.target]), edges: new Set<string>([e.id]) }
    }
    if (highlightedNodeId) {
      const ns = new Set<string>([highlightedNodeId])
      const es = new Set<string>()
      for (const e of built.edges) {
        if (e.source === highlightedNodeId || e.target === highlightedNodeId) {
          es.add(e.id)
          ns.add(e.source)
          ns.add(e.target)
        }
      }
      return { nodes: ns, edges: es }
    }
    return null
  }, [highlightedEdgeId, highlightedNodeId, built.edges])

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

  const onEdgeClick: EdgeMouseHandler = (event, edge) => {
    event.stopPropagation()
    if (highlightedNodeId) setHighlightedNodeId(null)
    setHighlightedEdgeId(highlightedEdgeId === edge.id ? null : edge.id)
  }

  const onNodeDoubleClick: NodeMouseHandler = (_event, node) => {
    if (node.type !== 'issue') return
    const issue = (node.data as any)?.issue
    if (issue?.url) window.open(issue.url, '_blank', 'noreferrer')
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
            type: 'arrowclosed' as any,
            color: 'var(--edge)',
            width: 22,
            height: 22,
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
