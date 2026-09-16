// Which label dimension the Mix view buckets by.
//
// The view used to be hardwired to schema.primaryGroup. That silently dies on
// a workspace where autodetect picks a group no issue actually carries: every
// issue lands in one "Unclassified" container and the view is useless even
// though other perfectly good dimensions (a type group, a `risk:` prefix)
// exist. So the dimension is now a user choice, encoded as one string:
//
//   null            → auto: the primary group, i.e. the old behavior
//   'group:<name>'  → any label group, including the primary/type ones
//   'prefix:<token>'→ a detected `token: value` label family
//
// A key outlives the schema that minted it — a shared URL, a tab pinned to a
// different workspace, a renamed Linear group — so every lookup tolerates a
// key the current schema cannot resolve and reverts to auto.

import type { DetectedSchema, NormalizedIssue, NormalizedLabel } from '@shared/types.js'

export interface MixDimension {
  key: string
  title: string
  /** Issues carrying at least one label in this dimension. */
  coverage: number
}

/** Group names the schema knows about, primary and type included — they are
 *  ordinary label groups that autodetect merely promoted. */
function schemaGroupNames(schema: DetectedSchema): string[] {
  const names: string[] = []
  if (schema.primaryGroup) names.push(schema.primaryGroup)
  if (schema.typeGroup) names.push(schema.typeGroup)
  for (const g of schema.otherGroups) if (!names.includes(g.name)) names.push(g.name)
  return names
}

function autoKey(schema: DetectedSchema): string | null {
  return schema.primaryGroup ? `group:${schema.primaryGroup}` : null
}

/** Normalize a stored key to one this schema can actually resolve, or null
 *  (auto). Unknown keys degrade to auto rather than to an empty view. */
export function resolveMixKey(schema: DetectedSchema, key: string | null): string | null {
  if (!key) return autoKey(schema)
  if (key.startsWith('group:') && schemaGroupNames(schema).includes(key.slice(6))) return key
  if (key.startsWith('prefix:') && schema.prefixes.some((p) => p.token === key.slice(7))) return key
  return autoKey(schema)
}

/** Labels of `issue` that belong to `key`'s dimension, alphabetically. */
function labelsInDimension(
  issue: NormalizedIssue,
  schema: DetectedSchema,
  key: string,
): NormalizedLabel[] {
  let matching: NormalizedLabel[]
  if (key.startsWith('group:')) {
    const name = key.slice(6)
    matching = issue.labels.filter((l) => l.group?.name === name)
  } else {
    const token = key.slice(7)
    const ids = new Set(schema.prefixes.find((p) => p.token === token)?.labels.map((l) => l.id))
    matching = issue.labels.filter((l) => ids.has(l.id))
  }
  return [...matching].sort((a, b) => a.name.localeCompare(b.name))
}

/** The one label that decides which bucket `issue` lands in.
 *
 *  React Flow gives a node exactly one parent, so an issue belongs to exactly
 *  one container even when the dimension is non-exclusive (an issue with three
 *  `risk:` labels). Taking the alphabetically first keeps that pick stable
 *  across renders instead of following Linear's response order. */
export function labelForDimension(
  issue: NormalizedIssue,
  schema: DetectedSchema,
  key: string | null,
): NormalizedLabel | null {
  const resolved = resolveMixKey(schema, key)
  if (!resolved) return null
  return labelsInDimension(issue, schema, resolved)[0] ?? null
}

/** Dimensions worth offering in the picker: those that actually bucket
 *  something, most-classifying first. A dimension no issue uses is exactly the
 *  failure this picker exists to escape, so it is not offered — the caller
 *  still shows the auto entry separately, which is how a zero-coverage default
 *  stays visible instead of looking like the view is broken. */
export function mixDimensions(issues: NormalizedIssue[], schema: DetectedSchema): MixDimension[] {
  const out: MixDimension[] = []
  const add = (key: string, title: string): void => {
    const coverage = issues.filter((i) => labelsInDimension(i, schema, key).length > 0).length
    if (coverage > 0) out.push({ key, title, coverage })
  }
  // A Linear group can hold exactly the labels a prefix already covers (a
  // group literally named 'type:*' full of 'type: Bug' labels). Both would
  // bucket identically, so the group is dropped — prefix wins, matching how
  // labelSchema.groupLabels resolves the same overlap for the filter panel.
  const prefixed = new Set(schema.prefixes.flatMap((p) => p.labels.map((l) => l.id)))
  for (const name of schemaGroupNames(schema)) {
    const own = schema.otherGroups.find((g) => g.name === name)?.labels
      ?? issues.flatMap((i) => i.labels).filter((l) => l.group?.name === name)
    if (own.length > 0 && own.every((l) => prefixed.has(l.id))) continue
    add(`group:${name}`, name)
  }
  for (const p of schema.prefixes) add(`prefix:${p.token}`, `${p.token}:`)
  // Ties keep schema order (primary → type → other groups → prefixes) rather
  // than falling back to alphabetical: when the familiar default classifies as
  // much as some prefix, it should still read first.
  const order = new Map(out.map((d, i) => [d.key, i]))
  return out.sort((a, b) => b.coverage - a.coverage || order.get(a.key)! - order.get(b.key)!)
}
