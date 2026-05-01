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

/** PRD §5.3 — translate ISSUE_SCOPE into Linear IssueFilter. */
function buildIssueFilter(scope: string, teamId?: string): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {}
  if (teamId) filter.team = { id: { eq: teamId } }

  if (scope === 'all') {
    if (Object.keys(filter).length === 0) return undefined
    return filter
  }

  const stateTypes = ['backlog', 'unstarted', 'started', 'triage'] as const
  const baseStateFilter = { type: { in: stateTypes as unknown as string[] } }

  if (scope === 'active') {
    filter.state = baseStateFilter
    return filter
  }

  // 'active+recent' (default): active OR completed in last 30 days.
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  filter.or = [
    { state: baseStateFilter },
    {
      and: [
        { state: { type: { eq: 'completed' } } },
        { completedAt: { gte: thirtyDaysAgoIso } },
      ],
    },
  ]
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
    const filter = buildIssueFilter(opts.scope, opts.teamId ?? this.opts.teamId)
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
    return {
      ...base,
      description: data.issue?.description ?? null,
    }
  }

  async fetchViewer(): Promise<Viewer> {
    const data = await this.gql<{ viewer: any }>(VIEWER_QUERY)
    return {
      id: String(data.viewer.id),
      displayName: String(data.viewer.displayName ?? ''),
      email: data.viewer.email ?? null,
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
