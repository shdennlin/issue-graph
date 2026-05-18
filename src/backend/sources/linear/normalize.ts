// Pure normalization functions — Linear API shape → NormalizedIssue/Label.
// PRD §5.3 (canonical edge direction); critical correctness piece.

import type {
  IssueStateType,
  NormalizedIssue,
  NormalizedLabel,
  NormalizedRelation,
  Priority,
  RelationType,
} from '@shared/types.js'

const STATE_TYPES: ReadonlySet<IssueStateType> = new Set<IssueStateType>([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'triage',
])

function coerceStateType(t: unknown): IssueStateType {
  if (typeof t === 'string') {
    const lc = t.toLowerCase()
    if ((STATE_TYPES as ReadonlySet<string>).has(lc)) return lc as IssueStateType
    // Linear sometimes uses "cancelled" in older docs; accept both.
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
          // Exclusivity is observed empirically (PRD §5.3); default true and corrected in autodetect.
          exclusive: true,
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
    out.push({ type: canonical, targetIdentifier: String(target) })
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
    state: {
      name: String(raw.state?.name ?? ''),
      type: coerceStateType(raw.state?.type),
    },
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
    project: raw.project ? { id: String(raw.project.id), name: String(raw.project.name) } : null,
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
    completedAt: raw.completedAt ?? null,
  }
}
