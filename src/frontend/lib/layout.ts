import dagre from '@dagrejs/dagre'
import { Position, type Edge, type Node } from 'reactflow'

export interface LayoutOpts {
  direction?: 'LR' | 'TB'
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
}

export function runDagre(nodes: Node[], edges: Edge[], opts: LayoutOpts = {}): Node[] {
  const direction = opts.direction ?? 'LR'
  const nodeWidth = opts.nodeWidth ?? 300
  const nodeHeight = opts.nodeHeight ?? 90

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, ranksep: opts.rankSep ?? 60, nodesep: opts.nodeSep ?? 30 })

  for (const n of nodes) g.setNode(n.id, { width: n.width ?? nodeWidth, height: n.height ?? nodeHeight })
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  return nodes.map((n) => {
    const pos = g.node(n.id)
    if (!pos) return n
    return {
      ...n,
      position: { x: pos.x - (n.width ?? nodeWidth) / 2, y: pos.y - (n.height ?? nodeHeight) / 2 },
      sourcePosition: direction === 'LR' ? Position.Right : Position.Bottom,
      targetPosition: direction === 'LR' ? Position.Left : Position.Top,
    }
  })
}

export function packGrid(items: Array<{ id: string; size: number }>, width = 5): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>()
  const cellW = 200
  const cellH = 100
  items.forEach((item, i) => {
    const col = i % width
    const row = Math.floor(i / width)
    out.set(item.id, { x: col * (cellW + 24), y: row * (cellH + 24), w: cellW, h: cellH })
  })
  return out
}
