import type { Edge, Node } from 'reactflow'
import type { GraphData, DetectedSchema } from '@shared/types.js'
import type { Density, Filters } from '../store/viewStore'

export interface ViewContext {
  data: GraphData
  schema: DetectedSchema
  filters: Filters
  staleDays: number
  myUserId: string | null
  myUserName: string | null
  selection: string[]
  focusedId: string | null
  /** Chain-isolation roots — empty means chain mode is off. The view shows the
   *  union of each root's transitive `blocks` component. */
  chainRootIds: string[]
  showRelated: boolean
  density: Density
  /** Max issues per row inside a container. Pulled from viewStore; views
   *  pass this to chooseColumnCount so it stays user-tunable. */
  maxColsPerRow: number
  search: string
  // Measured heights from React Flow after first paint, keyed by node id.
  // When present, views should prefer these over their density-based estimate
  // so dagre lays out around the *real* card height (no overlap from long
  // titles / many chip rows). Empty on first render; populated on re-layout.
  measuredHeights?: Map<string, number>
}

// Approximate IssueNode rendered height per density. Views use this to size
// layouts so cards don't overlap when the user toggles density.
// Numbers tuned to actual rendered heights from styles in globals.css —
// adjust if IssueNode markup changes.
export function issueNodeHeight(density: Density): number {
  switch (density) {
    case 'compact': return 36
    case 'verbose': return 138
    case 'default':
    default: return 110
  }
}

export interface ViewDefinition {
  id: string
  label: string
  shortcut?: string
  description: string
  build: (ctx: ViewContext) => { nodes: Node[]; edges: Edge[] }
}
