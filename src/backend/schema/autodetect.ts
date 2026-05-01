// Layer 1 schema autodetection. PRD §8.1.

import type { DetectedSchema, NormalizedIssue, NormalizedLabel } from '@shared/types.js'

const PRIMARY_GROUP_RE = /^(service|component|owner|module|team|area|domain)$/i
const TYPE_GROUP_RE = /^(type|kind|category)$/i
const PREFIX_RE = /^([a-z][a-z0-9-]+):\s*/

export interface AutodetectInput {
  labels: NormalizedLabel[]
  issues: NormalizedIssue[]
  primaryGroupOverride?: string | undefined
  typeGroupOverride?: string | undefined
}

export function detectSchema(input: AutodetectInput): DetectedSchema {
  const { labels, issues } = input

  // Bucket labels by group name. Group ids are not stable across rename, so use name keys.
  const labelsByGroup = new Map<string, NormalizedLabel[]>()
  const orphans: NormalizedLabel[] = []
  for (const lab of labels) {
    if (lab.group) {
      const arr = labelsByGroup.get(lab.group.name) ?? []
      arr.push(lab)
      labelsByGroup.set(lab.group.name, arr)
    } else {
      orphans.push(lab)
    }
  }

  // Empirical exclusivity: a group is exclusive if no issue carries ≥2 labels from it.
  const exclusiveByGroup = new Map<string, boolean>()
  for (const groupName of labelsByGroup.keys()) exclusiveByGroup.set(groupName, true)
  for (const issue of issues) {
    const counts = new Map<string, number>()
    for (const lab of issue.labels) {
      if (!lab.group) continue
      counts.set(lab.group.name, (counts.get(lab.group.name) ?? 0) + 1)
    }
    for (const [group, count] of counts) {
      if (count >= 2) exclusiveByGroup.set(group, false)
    }
  }

  // Pick primary group (override wins).
  let primaryGroup: string | null = null
  if (input.primaryGroupOverride && labelsByGroup.has(input.primaryGroupOverride)) {
    primaryGroup = input.primaryGroupOverride
  } else {
    for (const groupName of labelsByGroup.keys()) {
      if (PRIMARY_GROUP_RE.test(groupName) && exclusiveByGroup.get(groupName)) {
        primaryGroup = groupName
        break
      }
    }
  }

  // Pick type group.
  let typeGroup: string | null = null
  if (input.typeGroupOverride && labelsByGroup.has(input.typeGroupOverride)) {
    typeGroup = input.typeGroupOverride
  } else {
    for (const groupName of labelsByGroup.keys()) {
      if (TYPE_GROUP_RE.test(groupName) && exclusiveByGroup.get(groupName)) {
        typeGroup = groupName
        break
      }
    }
  }

  // Detect prefix patterns on orphan labels (and labels whose names happen to match the prefix shape regardless of group).
  const prefixCounts = new Map<string, NormalizedLabel[]>()
  for (const lab of labels) {
    const m = lab.name.match(PREFIX_RE)
    if (!m || !m[1]) continue
    const token = m[1]
    const arr = prefixCounts.get(token) ?? []
    arr.push(lab)
    prefixCounts.set(token, arr)
  }
  const prefixes = [...prefixCounts.entries()]
    .filter(([, arr]) => arr.length >= 2)
    .map(([token, arr]) => ({ token, labels: arr }))

  const otherGroups: DetectedSchema['otherGroups'] = []
  for (const [name, arr] of labelsByGroup) {
    if (name === primaryGroup || name === typeGroup) continue
    otherGroups.push({ name, labels: arr, exclusive: exclusiveByGroup.get(name) ?? true })
  }

  // True orphans = no group AND not already in a prefix bucket of size ≥2.
  const inPrefix = new Set<string>()
  for (const { labels: ls } of prefixes) for (const l of ls) inPrefix.add(l.id)
  const orphanFinal = orphans.filter((l) => !inPrefix.has(l.id))

  return {
    primaryGroup,
    typeGroup,
    prefixes,
    orphans: orphanFinal,
    otherGroups,
  }
}
