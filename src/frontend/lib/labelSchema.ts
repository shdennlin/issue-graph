import type { DetectedSchema, NormalizedIssue, NormalizedLabel, DesignDocChange } from '@shared/types.js'

export function getPrimaryLabel(issue: NormalizedIssue, schema: DetectedSchema): NormalizedLabel | null {
  if (!schema.primaryGroup) return null
  return issue.labels.find((l) => l.group?.name === schema.primaryGroup) ?? null
}

export function getTypeLabel(issue: NormalizedIssue, schema: DetectedSchema): NormalizedLabel | null {
  if (!schema.typeGroup) return null
  return issue.labels.find((l) => l.group?.name === schema.typeGroup) ?? null
}

export function getDesignDocsForIssue(
  issue: NormalizedIssue,
  designdocs: DesignDocChange[] | undefined,
): DesignDocChange[] {
  if (!designdocs) return []
  return designdocs.filter((d) => d.issueIdentifiers.includes(issue.identifier))
}

export function unionProgress(docs: DesignDocChange[]): { done: number; total: number; ratio: number } | null {
  if (docs.length === 0) return null
  let done = 0
  let total = 0
  for (const d of docs) {
    done += d.doneTasks
    total += d.totalTasks
  }
  return { done, total, ratio: total > 0 ? done / total : 0 }
}

export function shortPrefixDisplay(name: string, token: string): string {
  return name.slice(token.length + 1).replace(/^\s+/, '') || name
}

export type LabelSectionKind = 'primary' | 'type' | 'prefix' | 'group' | 'orphan'

export interface LabelSection {
  kind: LabelSectionKind
  /** Group name for primary/type/group, prefix token for prefix, '' for orphan. */
  key: string
  labels: NormalizedLabel[]
}

/** Every label on an issue, bucketed by schema category and ordered
 *  primary → type → prefix → group → orphan.
 *
 *  Two properties matter more than the bucketing itself:
 *
 *  1. **Nothing is dropped.** The orphan bucket is "everything not claimed by
 *     an earlier bucket", not "labels listed in schema.orphans". The schema
 *     arrives from a separate /api/labels call and can lag behind the graph
 *     (a label created since the last schema load classifies as nothing), so
 *     deriving the last bucket by subtraction is what makes an unknown label
 *     structurally impossible to lose.
 *  2. **Nothing is shown twice.** detectSchema scans prefixes across *all*
 *     labels regardless of group, so a grouped label named `env: prod` lands
 *     in both `prefixes` and `otherGroups`. First bucket wins; the dedupe
 *     lives here rather than in detectSchema so existing IssueNode prefix
 *     chips and the autodetect tests keep their current behavior.
 */
export function groupIssueLabels(issue: NormalizedIssue, schema: DetectedSchema): LabelSection[] {
  return groupLabels(issue.labels, schema)
}

/** Same bucketing over a bare label list — the filter panel classifies every
 *  label present across all issues, not the labels of one issue. Sharing this
 *  with groupIssueLabels is what keeps a label in the same named section in
 *  the panel and in the detail view. */
export function groupLabels(labels: NormalizedLabel[], schema: DetectedSchema): LabelSection[] {
  const sections: LabelSection[] = []
  const taken = new Set<string>()

  const claim = (kind: LabelSectionKind, key: string, labels: NormalizedLabel[]): void => {
    const fresh = labels.filter((l) => !taken.has(l.id))
    if (fresh.length === 0) return
    for (const l of fresh) taken.add(l.id)
    sections.push({ kind, key, labels: fresh })
  }

  const inGroup = (name: string): NormalizedLabel[] =>
    labels.filter((l) => l.group?.name === name)

  if (schema.primaryGroup) claim('primary', schema.primaryGroup, inGroup(schema.primaryGroup))
  if (schema.typeGroup) claim('type', schema.typeGroup, inGroup(schema.typeGroup))

  for (const { token, labels: inToken } of schema.prefixes) {
    const ids = new Set(inToken.map((l) => l.id))
    claim('prefix', token, labels.filter((l) => ids.has(l.id)))
  }

  for (const g of schema.otherGroups) claim('group', g.name, inGroup(g.name))

  claim('orphan', '', labels)

  return sections
}
