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
  /**
   * Incremental-sync cursor (ISO 8601). When set, the adapter ANDs an
   * `updatedAt > updatedAfter` clause into the base filter so the response
   * only contains issues changed since the last successful sync.
   */
  updatedAfter?: string
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
  /**
   * Lightweight identifier-only fetch used by the periodic reconcile pass
   * (sync.ts) to detect issues deleted in the backend. Returns the full set
   * of issue identifiers within the same scope as `fetchAllIssues` — callers
   * must NOT pass `updatedAfter` here (reconcile needs the complete list).
   */
  fetchIssueIdentifiers?(opts: FetchOpts): Promise<string[]>
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
