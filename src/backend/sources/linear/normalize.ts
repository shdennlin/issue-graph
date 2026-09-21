// Pure normalization functions — Linear API shape → NormalizedIssue/Label.
// PRD §5.3 (canonical edge direction); critical correctness piece.

import type {
  IssueStateType,
  NormalizedIssue,
  NormalizedLabel,
  NormalizedRelation,
  Priority,
  ProjectDetail,
  ProjectStateType,
  RelationType,
  NormalizedPullRequest,
} from '@shared/types.js'

const STATE_TYPES: ReadonlySet<IssueStateType> = new Set<IssueStateType>([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'triage',
])

export function coerceStateType(t: unknown): IssueStateType {
  if (typeof t === 'string') {
    const lc = t.toLowerCase()
    if ((STATE_TYPES as ReadonlySet<string>).has(lc)) return lc as IssueStateType
    // Linear sometimes uses "cancelled" in older docs; accept both.
    if (lc === 'cancelled') return 'canceled'
  }
  return 'backlog'
}

const PROJECT_STATE_TYPES: ReadonlySet<ProjectStateType> = new Set<ProjectStateType>([
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
])

export function coerceProjectStateType(t: unknown): ProjectStateType {
  if (typeof t === 'string') {
    const lc = t.toLowerCase()
    if ((PROJECT_STATE_TYPES as ReadonlySet<string>).has(lc)) return lc as ProjectStateType
    if (lc === 'cancelled') return 'canceled'
  }
  return 'backlog'
}

function coercePriority(p: unknown): Priority {
  const n = typeof p === 'number' ? p : 0
  if (n === 0 || n === 1 || n === 2 || n === 3 || n === 4) return n
  return 0
}

export function normalizeLabel(raw: any): NormalizedLabel {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    color: String(raw.color ?? '#888'),
    group: raw.parent
      ? {
          id: String(raw.parent.id),
          name: String(raw.parent.name ?? ''),
        }
      : null,
  }
}

/**
 * Normalize Linear's bidirectional relations into a single canonical 'blocks' edge:
 *   - 'blocks'      kept as-is  (this issue blocks targetIdentifier)
 *   - 'blocked_by'  DROPPED     (already represented by the other side's 'blocks')
 *   - 'duplicate' / 'related' kept (symmetric; deduped within this issue)
 *
 * Edge direction in the resulting graph: source = blocker = `selfIdentifier`,
 * target = blocked = `targetIdentifier`. PRD §5.3.
 */
export function normalizeRelations(rawRelations: any[] | undefined | null): NormalizedRelation[] {
  if (!rawRelations) return []
  const out: NormalizedRelation[] = []
  const seen = new Set<string>()
  for (const r of rawRelations) {
    const type = String(r?.type ?? '').toLowerCase()
    const target = r?.relatedIssue?.identifier
    if (!target) continue
    let canonical: RelationType | null = null
    if (type === 'blocks') canonical = 'blocks'
    else if (type === 'blocked_by') continue // dropped — represented on the other side
    else if (type === 'duplicate') canonical = 'duplicate'
    else if (type === 'related') canonical = 'related'
    if (!canonical) continue
    const key = `${canonical}:${target}`
    if (seen.has(key)) continue
    seen.add(key)
    const createdAt = typeof r?.createdAt === 'string' ? r.createdAt : undefined
    out.push({ type: canonical, targetIdentifier: String(target), ...(createdAt ? { createdAt } : {}) })
  }
  return out
}

export function normalizeProjectDetail(raw: any): ProjectDetail {
  const rawProgress = typeof raw?.progress === 'number' ? raw.progress : 0
  const progress = Math.max(0, Math.min(1, Number.isFinite(rawProgress) ? rawProgress : 0))

  const updates = ((raw?.projectUpdates?.nodes ?? []) as any[]).map((u) => ({
    id: String(u?.id ?? ''),
    body: String(u?.body ?? ''),
    createdAt: String(u?.createdAt ?? ''),
    userName: u?.user?.displayName ? String(u.user.displayName) : null,
    health: typeof u?.health === 'string' ? u.health : null,
  }))

  const milestones = ((raw?.projectMilestones?.nodes ?? []) as any[]).map((m) => {
    const rawMilestoneProgress = typeof m?.progress === 'number' ? m.progress : null
    const milestoneProgress =
      rawMilestoneProgress === null
        ? null
        : Math.max(0, Math.min(1, Number.isFinite(rawMilestoneProgress) ? rawMilestoneProgress : 0))
    return {
      id: String(m?.id ?? ''),
      name: String(m?.name ?? ''),
      targetDate: m?.targetDate ?? null,
      sortOrder: typeof m?.sortOrder === 'number' ? m.sortOrder : null,
      description: typeof m?.description === 'string' ? m.description : null,
      progress: milestoneProgress,
      status: typeof m?.status === 'string' ? m.status : null,
    }
  })

  return {
    id: String(raw?.id ?? ''),
    state: coerceProjectStateType(raw?.state),
    progress,
    lead: raw?.lead?.displayName ? { displayName: String(raw.lead.displayName) } : null,
    startDate: raw?.startDate ?? null,
    targetDate: raw?.targetDate ?? null,
    description: raw?.description ?? null,
    content: typeof raw?.content === 'string' ? raw.content : null,
    updates,
    milestones,
  }
}

/**
 * Pull requests out of Linear's attachment list.
 *
 * `metadata` is an untyped blob that Linear fills from GitHub, so every field is
 * checked rather than trusted: a shape we did not anticipate must degrade to
 * null, not throw inside a sync.
 *
 * Only `sourceType === 'github'` survives. An attachment can be a Slack thread,
 * a Figma file or anything else someone linked, and counting those as pull
 * requests would make "2/5 merged" meaningless.
 *
 * `status` is kept as Linear words it rather than mapped onto an enum of ours.
 * A value we have not seen should show through to the card, not vanish into a
 * default.
 */
export function normalizePullRequests(raw: any): NormalizedPullRequest[] {
  const nodes = raw?.attachments?.nodes
  if (!Array.isArray(nodes)) return []
  const out: NormalizedPullRequest[] = []
  const seen = new Set<string>()
  for (const n of nodes) {
    if (n?.sourceType !== 'github') continue
    const m = (n?.metadata ?? {}) as Record<string, unknown>
    const url = typeof n?.url === 'string' ? n.url : typeof m.url === 'string' ? m.url : null
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      number: typeof m.number === 'number' ? m.number : null,
      repo: typeof m.repoName === 'string' ? m.repoName : null,
      status: typeof m.status === 'string' ? m.status : null,
      targetBranch: typeof m.targetBranch === 'string' ? m.targetBranch : null,
      hasConflicts: typeof m.hasConflicts === 'boolean' ? m.hasConflicts : null,
      linkKind: typeof m.linkKind === 'string' ? m.linkKind : null,
      mergedAt: typeof m.mergedAt === 'string' ? m.mergedAt : null,
    })
  }
  return out
}

export function normalizeIssue(raw: any): NormalizedIssue {
  const labels: NormalizedLabel[] = (raw.labels?.nodes ?? []).map(normalizeLabel)
  const children: string[] = (raw.children?.nodes ?? [])
    .map((n: any) => n?.identifier)
    .filter((x: any): x is string => typeof x === 'string')
  const relations = normalizeRelations(raw.relations?.nodes)

  return {
    id: String(raw.id),
    identifier: String(raw.identifier),
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    priority: coercePriority(raw.priority),
    estimate: typeof raw.estimate === 'number' ? raw.estimate : null,
    dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    state: {
      name: String(raw.state?.name ?? ''),
      type: coerceStateType(raw.state?.type),
    },
    team: raw.team
      ? {
          id: String(raw.team.id),
          key: String(raw.team.key ?? ''),
          name: String(raw.team.name ?? ''),
          color: typeof raw.team.color === 'string' ? raw.team.color : null,
        }
      : null,
    assignee: raw.assignee
      ? {
          id: raw.assignee.id ? String(raw.assignee.id) : undefined,
          displayName: String(raw.assignee.displayName ?? ''),
          email: raw.assignee.email ?? null,
        }
      : null,
    labels,
    cycle: raw.cycle
      ? {
          number: Number(raw.cycle.number ?? 0),
          startsAt: String(raw.cycle.startsAt ?? ''),
          endsAt: String(raw.cycle.endsAt ?? ''),
        }
      : null,
    project: raw.project
      ? {
          id: String(raw.project.id),
          name: String(raw.project.name),
          // Linear's project color is a hex like '#a44a3f'. May be null/missing
          // for projects that never had a color set — UI falls back to muted.
          color: typeof raw.project.color === 'string' ? raw.project.color : null,
        }
      : null,
    projectMilestone: raw.projectMilestone
      ? {
          id: String(raw.projectMilestone.id),
          name: String(raw.projectMilestone.name ?? ''),
          targetDate: raw.projectMilestone.targetDate ?? null,
          sortOrder: typeof raw.projectMilestone.sortOrder === 'number' ? raw.projectMilestone.sortOrder : null,
        }
      : null,
    parent: raw.parent?.identifier ?? null,
    children,
    relations,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    // Absent rather than empty when there are no comments: the field means
    // "the newest comment was at", and '' would read as a 1970 timestamp.
    // Absent rather than empty when the field was not fetched at all, so "this
    // issue has no PRs" and "we did not ask" stay distinguishable — the same
    // reason lastCommentAt below is a conditional spread.
    ...(raw.attachments ? { pullRequests: normalizePullRequests(raw) } : {}),
    ...(typeof raw.comments?.nodes?.[0]?.createdAt === 'string'
      ? { lastCommentAt: String(raw.comments.nodes[0].createdAt) }
      : {}),
    completedAt: raw.completedAt ?? null,
  }
}
