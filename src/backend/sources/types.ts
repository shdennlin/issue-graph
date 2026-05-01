import type { NormalizedIssue, NormalizedLabel, Viewer } from '@shared/types.js'

export interface FetchOpts {
  /** PRD §5.3 — 'active' | 'active+recent' | 'all' */
  scope: string
  teamId?: string
}

export interface IssueDetail extends NormalizedIssue {
  description: string | null
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
  fetchViewer(): Promise<Viewer>
  fetchLabels(): Promise<NormalizedLabel[]>
  /** Last fetch's rate-limit info for sync_log. */
  lastRateLimit(): RateLimitInfo
}
