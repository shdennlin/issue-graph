import { useEffect, useMemo, useRef } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
} from 'reactflow'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { findView } from '../views'
import { IssueNode } from './nodes/IssueNode'
import { BucketNode } from './nodes/BucketNode'
import { MixedContainerNode } from './nodes/MixedContainerNode'

const nodeTypes = {
  issue: IssueNode,
  bucket: BucketNode,
  mixedContainer: MixedContainerNode,
}

function CanvasInner() {
  const graph = useGraphStore((s) => s.graph)
  const { schema } = useSchemaStore()
  const activeView = useViewStore((s) => s.activeView)
  const filters = useViewStore((s) => s.filters)
  const focusedId = useViewStore((s) => s.focusedId)
  const staleDays = useViewStore((s) => s.staleDays)
  const selection = useViewStore((s) => s.selection)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const toggleSelection = useViewStore((s) => s.toggleSelection)
  const setContextMenu = useViewStore((s) => s.setContextMenu)
  const rfRef = useRef<HTMLDivElement>(null)

  const myUserName = graph?.data.viewer?.displayName ?? null
  const myUserId = graph?.data.viewer?.id ?? null

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
    })
  }, [graph, schema, activeView, filters, staleDays, focusedId, selection, myUserId, myUserName])

  const rf = useReactFlow()
  useEffect(() => {
    // Slight delay so RF measures the new nodes before fitting.
    const id = window.setTimeout(() => {
      rf.fitView({ duration: 600, padding: 0.15 })
    }, 50)
    return () => window.clearTimeout(id)
  }, [activeView, rf])

  useEffect(() => {
    if (!focusedId) return
    const node = built.nodes.find((n) => n.id === focusedId)
    if (node) {
      rf.setCenter(node.position.x + (node.width ?? 300) / 2, node.position.y + (node.height ?? 100) / 2, { zoom: 1.2, duration: 400 })
    }
  }, [focusedId, built.nodes, rf])

  const onNodeClick: NodeMouseHandler = (event, node) => {
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(node.id)
      return
    }
    if (node.type === 'issue') setFocusedId(node.id)
  }

  const onNodeDoubleClick: NodeMouseHandler = (_event, node) => {
    if (node.type !== 'issue') return
    const issue = (node.data as any)?.issue
    if (issue?.url) window.open(issue.url, '_blank', 'noreferrer')
  }

  const onPaneClick = () => {
    setFocusedId(null)
    setContextMenu(null)
  }

  const onNodeContextMenu = (event: React.MouseEvent, node: any) => {
    if (node.type !== 'issue') return
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, targetIdentifier: node.id })
  }

  return (
    <div className="canvas" ref={rfRef}>
      <ReactFlow
        nodes={built.nodes}
        edges={built.edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        {built.nodes.length <= 200 && <MiniMap pannable zoomable />}
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
