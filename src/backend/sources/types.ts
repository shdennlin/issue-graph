import type { IssueComment, NormalizedIssue, NormalizedLabel, ProjectDetail, Viewer, WorkflowState } from '@shared/types.js'

export interface FetchOpts {
  /** PRD §5.3 — 'active' | 'active+recent' | 'all' */
  scope: string
  teamId?: string
  /**
   * Optional lazy-fetch extension (0–365 days). When > 0, the adapter
   * additionally fetches canceled + completed issues within this window.
   * Set when the user explicitly checks Canceled/Completed in the filter UI.
   */
  extendedDays?: number
}

export interface IssueDetail extends NormalizedIssue {
  description: string | null
  comments: IssueComment[]
}

export interface RateLimitInfo {
  remaining: number | null
  limit: number | null
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

export interface BackendAdapter {
  /** Identifier for sync_log.backend column. */
  readonly name: string
  fetchAllIssues(opts: FetchOpts): Promise<NormalizedIssue[]>
  fetchIssueDetail(idOrIdentifier: string): Promise<IssueDetail>
  /**
   * Optional — fetch one project's full detail (state, progress, lead,
   * milestones, recent updates, description). Lazy: only called when the user
   * opens the ProjectPanel. Adapters without project-aware backends can skip
   * this; the UI gracefully degrades to showing only id + name + color.
   */
  fetchProjectDetail?(projectId: string): Promise<ProjectDetail>
  fetchViewer(): Promise<Viewer>
  fetchLabels(): Promise<NormalizedLabel[]>
  /**
   * Optional — return the full list of workflow states configured in the
   * backend. Adapters that don't support this can skip it; the UI will fall
   * back to inferring states from cached issues.
   */
  fetchWorkflowStates?(teamId?: string): Promise<WorkflowState[]>
  /** Last fetch's rate-limit info for sync_log. */
  lastRateLimit(): RateLimitInfo
}
