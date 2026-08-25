// Shared types — the contract every other module depends on.
// PRD §3.3 (canonical state enum), §5.3 (NormalizedIssue/edge normalization), §5.4 (DesignDocChange).

export type IssueStateType =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled'
  | 'triage'

/**
 * Linear project state. Separate enum from IssueStateType: Linear's product
 * model distinguishes Project status from Issue workflow status (a project
 * can be 'planned' or 'paused' — states with no issue equivalent). We
 * normalize 'cancelled' (en-GB) → 'canceled' for the same reason as issues.
 */
export type ProjectStateType =
  | 'backlog'
  | 'planned'
  | 'started'
  | 'paused'
  | 'completed'
  | 'canceled'

export type Priority = 0 | 1 | 2 | 3 | 4

// One row from the backend's full workflow-states list. We fetch this
// alongside issues so the filter UI can show all possible states (including
// ones with 0 current matches) instead of inferring from cached issues.
export interface WorkflowState {
  id: string
  name: string                // literal Linear state name, e.g. "Review Spec"
  type: IssueStateType        // canonical type
  color?: string | null
  position?: number | null    // for ordering
  teamKey?: string | null     // multi-team workspaces — null = all/unknown
}

export type RelationType = 'blocks' | 'duplicate' | 'related'

export interface NormalizedLabelGroup {
  id: string
  name: string
}
// Exclusivity deliberately lives on DetectedSchema.otherGroups, not here.
// Linear's API does not expose it, so it can only be measured across the whole
// issue set (see schema/autodetect.ts) — a per-label copy could only ever be a
// hardcoded placeholder, which is what it used to be.

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
  /** Linear story-point / time estimate. Null when unset. */
  estimate?: number | null
  /** ISO date string ("YYYY-MM-DD") — user-set issue deadline. Null when unset. */
  dueDate?: string | null
  /** ISO datetime — auto-set when issue first transitioned to a "started"
   *  state. Not user-settable; null until the first transition. */
  startedAt?: string | null
  state: { name: string; type: IssueStateType }
  /** Owning Linear team. `key` is the identifier prefix (e.g. "ENG" in
   *  "ENG-123"), `color` is the team accent (hex). */
  team?: { id: string; key: string; name: string; color: string | null } | null
  assignee: NormalizedAssignee | null
  labels: NormalizedLabel[]
  cycle?: { number: number; startsAt: string; endsAt: string } | null
  project?: {
    id: string
    name: string
    /** Linear project color (hex, e.g. '#a44a3f'). Null when never set in Linear. */
    color?: string | null
  } | null
  /** Linear Project Milestone — present only when both project and milestone are assigned. */
  projectMilestone?: {
    id: string
    name: string
    targetDate: string | null
    sortOrder: number | null
  } | null
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

export interface ViewerOrganization {
  /** Linear organization display name (e.g. "OneLegion"). */
  name: string
  /** URL slug used in linear.app/<urlKey>/issue/... — stable workspace identifier. */
  urlKey: string
}

export interface Viewer {
  id: string
  displayName: string
  email?: string | null
  /** Workspace identity. Optional so legacy cached viewers (pre-1.2) still
   * deserialize cleanly until the next sync repopulates the field. */
  organization?: ViewerOrganization | null
}

export type DesignDocStatus = 'active' | 'parked' | 'archived'

export type DesignDocLinkStrategy = 'frontmatter' | 'folderName' | 'regexLine'

export interface DesignDocChange {
  name: string
  issueIdentifiers: string[]
  status: DesignDocStatus
  totalTasks: number
  doneTasks: number
  progress: number
  filePath: string
  // Per-strategy breakdown of which Linear IDs each linkage method found.
  // Used by the diagnostic page to surface why a change is/isn't linked.
  linkSources?: Record<DesignDocLinkStrategy, string[]>
  // Optional: identifies the git worktree this change came from. Absent on
  // single-checkout repos. When the same change name appears in multiple
  // worktrees (rare in practice — Spectra v2.3.0+ relocates rather than
  // duplicates), the linked-wins-by-mtime rule in factory.ts picks one
  // and discards the others, so consumers always see at most one record
  // per name.
  worktree?: { path: string; ref: string }
}

export interface DesignDocCoverage {
  totalChanges: number
  linkedChanges: number
  unlinkedChanges: number
  byStrategy: Record<DesignDocLinkStrategy, number>  // count of changes linked via this strategy (>=1 ID)
  perChange: Array<{
    name: string
    filePath: string
    status: DesignDocStatus
    ids: string[]
    sources: Record<DesignDocLinkStrategy, string[]>
  }>
  issuesMissingDoc: Array<{
    identifier: string
    title: string
    state: IssueStateType
    url: string
  }>
}

/**
 * Detail for a single Linear project, fetched lazily when the user opens the
 * ProjectPanel. Stored in graphStore.projectDetails keyed by project id.
 *
 * `progress` is what Linear reports (scope-weighted, 0..1). The panel also
 * displays a locally-computed issue-count breakdown derived from the cached
 * issue list, so both numbers may differ slightly.
 */
export interface ProjectDetail {
  id: string
  state: ProjectStateType
  progress: number
  lead: { displayName: string } | null
  startDate: string | null
  targetDate: string | null
  /** Short summary teaser (Linear's `description`, ~255 char limit). */
  description: string | null
  /** Full markdown body (Linear's `content`). When present, panels should
   *  render this instead of the short `description`. */
  content: string | null
  updates: Array<{
    id: string
    body: string
    createdAt: string
    userName: string | null
    /** Optional health enum from Linear updates: 'onTrack' | 'atRisk' | 'offTrack' | null. */
    health: string | null
  }>
  milestones: Array<{
    id: string
    name: string
    targetDate: string | null
    sortOrder: number | null
    /** Optional per-milestone markdown body. */
    description: string | null
    /** Linear's scope-weighted progress, 0..1. Same scale as Project.progress.
     *  Null when the backend doesn't expose it (e.g. older backends, or
     *  Linear hasn't populated it yet for a brand-new milestone). */
    progress: number | null
    /** Linear's milestone status enum: 'done' | 'next' | 'overdue' |
     *  'unstarted'. Null when not provided. Distinct from project status. */
    status: string | null
  }>
}

export interface IssueComment {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  user: { displayName: string } | null
}

export interface AnnotationDTO {
  id: number
  targetType: 'issue' | 'edge' | 'bucket'
  targetId: string
  body: string
  createdAt: number
  updatedAt: number
}

export interface NoteDTO {
  id: number
  /** Raw markdown. Title is derived from the first non-empty line at render time. */
  body: string
  /** Lower values sort first. Negative values allowed — new notes inserted at MIN-1. */
  sortOrder: number
  /** Archived notes are hidden from the default grid; recoverable via Restore. */
  archived: boolean
  createdAt: number
  updatedAt: number
}

/** A named snapshot of the URL's view + filter state, shared by everyone
 *  hitting the same server. `query` is a URL query string (no leading '?'),
 *  with `w` and record-pointer params already stripped — see
 *  backend/savedViewStore.ts. */
export interface SavedViewDTO {
  id: number
  name: string
  query: string
  /** Lower values sort first. Appended at max+1. */
  sortOrder: number
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

export interface WorkspaceChangeWarning {
  /** Previous workspace urlKey (e.g. "shdennlin-example"). */
  previous: string
  /** Current workspace urlKey (e.g. "onelegion"). */
  current: string
  /** Unix ms when the change was detected during sync. */
  detectedAt: number
}

export interface GraphResponse {
  data: GraphData
  stale: boolean
  fetchedAt: number
  instanceLabel: string
  hasDesigndoc: boolean
  cacheEmpty: boolean
  authError?: boolean
  /** Set when the LAST sync failed. Distinct from `authError`, which only means
   *  no key is configured — a *wrong* key IS configured, so it used to surface
   *  as a silently empty graph with nothing on screen to explain it. */
  syncFailure?: { kind: 'auth' | 'error'; message: string | null } | null
  /** Set when sync detected a workspace switch. UI surfaces a banner +
   *  Reset Cache button. Cleared after acknowledge or successful reset. */
  workspaceWarning?: WorkspaceChangeWarning | null
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
