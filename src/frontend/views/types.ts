import type { Edge, Node } from 'reactflow'
import type { GraphData, DetectedSchema } from '@shared/types.js'
import type { Filters } from '../store/viewStore'

export interface ViewContext {
  data: GraphData
  schema: DetectedSchema
  filters: Filters
  staleDays: number
  myUserId: string | null
  myUserName: string | null
  selection: string[]
  focusedId: string | null
}

export interface ViewDefinition {
  id: string
  label: string
  shortcut?: string
  description: string
  build: (ctx: ViewContext) => { nodes: Node[]; edges: Edge[] }
}
