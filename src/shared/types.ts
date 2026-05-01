// Shared types — the contract every other module depends on.
// PRD §3.3 (canonical state enum), §5.3 (NormalizedIssue/edge normalization), §5.4 (DesignDocChange).

export type IssueStateType =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled'
  | 'triage'

export type Priority = 0 | 1 | 2 | 3 | 4

export type RelationType = 'blocks' | 'duplicate' | 'related'

export interface NormalizedLabelGroup {
  id: string
  name: string
  exclusive: boolean
}

export interface NormalizedLabel {
  id: string
  name: string
  color: string
  group: NormalizedLabelGroup | null
}

export interface NormalizedAssignee {
  id?: string
  displayName: string
  email?: string | null
}

export interface NormalizedRelation {
  type: RelationType
  targetIdentifier: string
}

export interface NormalizedIssue {
  id: string
  identifier: string
  title: string
  url: string
  priority: Priority
  state: { name: string; type: IssueStateType }
  assignee: NormalizedAssignee | null
  labels: NormalizedLabel[]
  cycle?: { number: number; startsAt: string; endsAt: string } | null
  project?: { id: string; name: string } | null
  parent: string | null
  children: string[]
  relations: NormalizedRelation[]
  createdAt: string
  updatedAt: string
  completedAt: string | null
  /** Optional, backend-specific extras stashed for views that opt in. */
  raw?: unknown
  /** Set when Phase 3 comment-count fetch is enabled. */
  commentsCount?: number
}

export interface Viewer {
  id: string
  displayName: string
  email?: string | null
}

export type DesignDocStatus = 'active' | 'parked' | 'archived'

export interface DesignDocChange {
  name: string
  issueIdentifiers: string[]
  status: DesignDocStatus
  totalTasks: number
  doneTasks: number
  progress: number
  filePath: string
}

export interface AnnotationDTO {
  id: number
  targetType: 'issue' | 'edge' | 'bucket'
  targetId: string
  body: string
  createdAt: number
  updatedAt: number
}

export interface GraphData {
  issues: NormalizedIssue[]
  labels: NormalizedLabel[]
  designdocs?: DesignDocChange[]
  annotations?: AnnotationDTO[]
  viewer?: Viewer | null
  fetchedAt: number
}

export interface GraphResponse {
  data: GraphData
  stale: boolean
  fetchedAt: number
  instanceLabel: string
  hasDesigndoc: boolean
  cacheEmpty: boolean
  authError?: boolean
}

export interface SyncLogEntry {
  id: number
  startedAt: number
  finishedAt: number | null
  status: 'success' | 'rate_limited' | 'api_error' | 'partial' | 'started'
  backend: string
  issuesCount: number | null
  errorMessage: string | null
}

export interface DetectedSchema {
  primaryGroup: string | null
  typeGroup: string | null
  prefixes: Array<{ token: string; labels: NormalizedLabel[] }>
  orphans: NormalizedLabel[]
  otherGroups: Array<{ name: string; labels: NormalizedLabel[]; exclusive: boolean }>
}
