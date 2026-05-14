import type { IssueStateType, NormalizedIssue, NormalizedLabel, Viewer, WorkflowState } from '@shared/types.js'
import { getLogger } from '../../lib/log.js'
import {
  AuthError,
  RateLimitError,
  type BackendAdapter,
  type FetchOpts,
  type IssueDetail,
  type RateLimitInfo,
} from '../types.js'
import { ISSUES_QUERY, ISSUE_DETAIL_QUERY, LABELS_QUERY, VIEWER_QUERY, WORKFLOW_STATES_QUERY } from './queries.js'
import { normalizeIssue, normalizeLabel } from './normalize.js'

interface LinearOptions {
  apiKey: string
  endpoint: string
  teamId?: string | undefined
}

/**
 * PRD §5.3 — translate ISSUE_SCOPE into Linear IssueFilter.
 *
 * `extendedDays` (optional, 0–365) is a lazy add-on persisted in cache_meta.
 * When > 0, we include canceled + completed issues whose updatedAt is within
 * the window. Used when the user explicitly checks Canceled / Completed in
 * the state filter so we fetch the data they're asking to see.
 */
function buildIssueFilter(
  scope: string,
  teamId?: string,
  extendedDays = 0,
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {}
  if (teamId) filter.team = { id: { eq: teamId } }

  if (scope === 'all') {
    if (Object.keys(filter).length === 0) return undefined
    return filter
  }

  const stateTypes = ['backlog', 'unstarted', 'started', 'triage'] as const
  const baseStateFilter = { type: { in: stateTypes as unknown as string[] } }

  // Build OR clauses incrementally so 'active', 'active+recent', and the
  // optional extended scope are composable.
  const clauses: Array<Record<string, unknown>> = [{ state: baseStateFilter }]

  if (scope === 'active+recent' || scope === undefined) {
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    clauses.push({
      and: [
        { state: { type: { eq: 'completed' } } },
        { completedAt: { gte: thirtyDaysAgoIso } },
      ],
    })
  }

  if (extendedDays > 0) {
    const cutoffIso = new Date(Date.now() - extendedDays * 24 * 3600 * 1000).toISOString()
    // canceled in window — Linear doesn't have a `canceledAt`, so we filter
    // by updatedAt as a proxy for "recently relevant".
    clauses.push({
      and: [
        { state: { type: { eq: 'canceled' } } },
        { updatedAt: { gte: cutoffIso } },
      ],
    })
    // Completed beyond 30 days, up to extendedDays — extends the existing
    // recent-completed clause backward.
    clauses.push({
      and: [
        { state: { type: { eq: 'completed' } } },
        { completedAt: { gte: cutoffIso } },
      ],
    })
  }

  if (scope === 'active' && extendedDays === 0) {
    filter.state = baseStateFilter
    return filter
  }

  filter.or = clauses
  return filter
}

export class LinearBackend implements BackendAdapter {
  readonly name = 'linear'
  private rate: RateLimitInfo = { remaining: null, limit: null }

  constructor(private readonly opts: LinearOptions) {}

  lastRateLimit(): RateLimitInfo {
    return this.rate
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.opts.apiKey) {
      throw new AuthError('LINEAR_API_KEY is not configured.')
    }
    const log = getLogger()
    const res = await fetch(this.opts.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.opts.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    })

    const remaining = res.headers.get('x-ratelimit-requests-remaining')
    const limit = res.headers.get('x-ratelimit-requests-limit')
    if (remaining) this.rate.remaining = Number(remaining)
    if (limit) this.rate.limit = Number(limit)

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`Linear auth failed: ${res.status}`)
    }
    if (res.status === 429) {
      throw new RateLimitError('Linear rate-limited (429).')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Linear API ${res.status}: ${text.slice(0, 300)}`)
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
    if (json.errors && json.errors.length > 0) {
      const msg = json.errors.map((e) => e.message).join('; ')
      // Detect auth errors phrased in body rather than HTTP status.
      if (/authentication|api key|unauthorized/i.test(msg)) {
        throw new AuthError(msg)
      }
      throw new Error(`Linear GraphQL error: ${msg}`)
    }
    if (!json.data) throw new Error('Linear returned no data.')
    log.debug({ rateRemaining: this.rate.remaining }, 'linear request ok')
    return json.data
  }

  async fetchAllIssues(opts: FetchOpts): Promise<NormalizedIssue[]> {
    const filter = buildIssueFilter(opts.scope, opts.teamId ?? this.opts.teamId, opts.extendedDays ?? 0)
    const out: NormalizedIssue[] = []
    let after: string | null = null
    type IssuesResp = {
      issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: any[] }
    }
    for (let page = 0; page < 50; page++) {
      const data: IssuesResp = await this.gql<IssuesResp>(ISSUES_QUERY, { after, filter })
      for (const raw of data.issues.nodes) out.push(normalizeIssue(raw))
      if (!data.issues.pageInfo.hasNextPage) break
      after = data.issues.pageInfo.endCursor
    }
    return out
  }

  async fetchIssueDetail(idOrIdentifier: string): Promise<IssueDetail> {
    const data = await this.gql<{ issue: any }>(ISSUE_DETAIL_QUERY, { id: idOrIdentifier })
    const base = normalizeIssue(data.issue)
    const commentNodes = (data.issue?.comments?.nodes ?? []) as Array<{
      id: string
      body: string
      createdAt: string
      updatedAt: string
      user?: { displayName?: string } | null
    }>
    const comments = commentNodes.map((n) => ({
      id: String(n.id),
      body: String(n.body ?? ''),
      createdAt: String(n.createdAt),
      updatedAt: String(n.updatedAt),
      user: n.user?.displayName ? { displayName: String(n.user.displayName) } : null,
    }))
    return {
      ...base,
      description: data.issue?.description ?? null,
      comments,
    }
  }

  async fetchViewer(): Promise<Viewer> {
    const data = await this.gql<{ viewer: any }>(VIEWER_QUERY)
    const org = data.viewer.organization
    return {
      id: String(data.viewer.id),
      displayName: String(data.viewer.displayName ?? ''),
      email: data.viewer.email ?? null,
      organization: org ? { name: String(org.name ?? ''), urlKey: String(org.urlKey ?? '') } : null,
    }
  }

  async fetchWorkflowStates(teamId?: string): Promise<WorkflowState[]> {
    const filter = teamId ? { team: { id: { eq: teamId } } } : undefined
    type Resp = { workflowStates: { nodes: any[] } }
    const data = await this.gql<Resp>(WORKFLOW_STATES_QUERY, { filter })
    return data.workflowStates.nodes.map((n) => ({
      id: String(n.id),
      name: String(n.name),
      type: String(n.type) as IssueStateType,
      color: n.color ?? null,
      position: typeof n.position === 'number' ? n.position : null,
      teamKey: n.team?.key ?? null,
    }))
  }

  async fetchLabels(): Promise<NormalizedLabel[]> {
    const out: NormalizedLabel[] = []
    let after: string | null = null
    type LabelsResp = {
      issueLabels: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: any[]
      }
    }
    for (let page = 0; page < 50; page++) {
      const data: LabelsResp = await this.gql<LabelsResp>(LABELS_QUERY, { after })
      for (const raw of data.issueLabels.nodes) out.push(normalizeLabel(raw))
      if (!data.issueLabels.pageInfo.hasNextPage) break
      after = data.issueLabels.pageInfo.endCursor
    }
    return out
  }
}
