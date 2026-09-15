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

/**
 * Fields a write-capable adapter can change on one issue. Absent means "leave
 * alone"; an explicit `null` means "clear". The two are NOT the same, so build
 * this object with `'assigneeId' in patch` rather than a truthiness check —
 * Linear (and every tracker worth adapting) treats an explicit null as a clear.
 */
export interface IssuePatch {
  stateId?: string
  assigneeId?: string | null
  /** 0 = none, 1 = urgent … 4 = low. 0 is a real value, not "unset", so this
   *  one is guarded on `!== undefined` rather than truthiness. */
  priority?: number
  /**
   * Labels are sent as a delta rather than a replacement set. `labelIds` would
   * also work and is one field instead of two, but it clobbers any label added
   * concurrently by someone else between our read and our write — the graph is
   * a cache, so our idea of the current set is always a little stale.
   */
  addedLabelIds?: string[]
  removedLabelIds?: string[]
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
  /**
   * Optional — write one issue's state and/or assignee back to the backend.
   * Optional for the same reason as fetchProjectDetail: an adapter for a
   * read-only source (or one not yet taught to write) simply omits it, and the
   * route answers 501 rather than the app pretending the control does nothing.
   *
   * Resolves on success; throws on failure. The caller treats a throw as "the
   * change did not happen" and reloads from cache, so an adapter must not
   * resolve on a partial write.
   */
  updateIssue?(idOrIdentifier: string, patch: IssuePatch): Promise<void>
  /**
   * Optional — append a comment. Separate from updateIssue because it is a
   * different verb: it adds a new object rather than changing the issue's own
   * fields, and it must not share a failure mode with a state change.
   */
  addComment?(idOrIdentifier: string, body: string): Promise<void>
  /** Last fetch's rate-limit info for sync_log. */
  lastRateLimit(): RateLimitInfo
}
