import type { DetectedSchema, NormalizedIssue, NormalizedLabel, DesignDocChange } from '@shared/types.js'

export function getPrimaryLabel(issue: NormalizedIssue, schema: DetectedSchema): NormalizedLabel | null {
  if (!schema.primaryGroup) return null
  return issue.labels.find((l) => l.group?.name === schema.primaryGroup) ?? null
}

export function getTypeLabel(issue: NormalizedIssue, schema: DetectedSchema): NormalizedLabel | null {
  if (!schema.typeGroup) return null
  return issue.labels.find((l) => l.group?.name === schema.typeGroup) ?? null
}

export function getPrefixLabels(
  issue: NormalizedIssue,
  schema: DetectedSchema,
): Array<{ token: string; labels: NormalizedLabel[] }> {
  const out: Array<{ token: string; labels: NormalizedLabel[] }> = []
  for (const { token, labels } of schema.prefixes) {
    const ids = new Set(labels.map((l) => l.id))
    const matching = issue.labels.filter((l) => ids.has(l.id))
    if (matching.length) out.push({ token, labels: matching })
  }
  return out
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
