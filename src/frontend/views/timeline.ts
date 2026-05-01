// Phase 3 — placeholder timeline view that consumes /api/timeline data fetched separately.

import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'

export const timelineView: ViewDefinition = {
  id: 'timeline',
  label: 'Timeline',
  description: 'Historical state counts per snapshot. Phase 3.',
  build() {
    // Empty by default; the TimelineCanvas component (loaded when activeView='timeline')
    // fetches its own data from /api/timeline. We return an empty graph so the React Flow
    // canvas shows a blank slate until the component overlays itself.
    const nodes: Node[] = []
    const edges: Edge[] = []
    return { nodes, edges }
  },
}
