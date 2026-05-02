// Layer 3 — yaml schema overrides. PRD §8.3.
// Phase 2 base + Phase 3 hot-reload via mtime cache.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

const DisplaySchema = z.object({
  kind: z
    .enum([
      'bucket',
      'icon-leading',
      'chip-corner',
      'chip-bottom',
      'chip-top',
      'footer-list',
      'badge-overlay',
      'hidden-but-filterable',
      'hidden',
    ])
    .optional(),
  color: z.string().optional(),
  label: z.string().optional(),
  max_show: z.number().optional(),
  color_map: z.record(z.string(), z.string()).optional(),
  icons: z.record(z.string(), z.string()).optional(),
})

const GroupSchema = z.object({
  role: z.enum(['primary', 'type']).optional(),
  label_singular: z.string().optional(),
  label_plural: z.string().optional(),
  display: DisplaySchema.optional(),
})

const PrefixSchema = z.object({
  display: DisplaySchema.optional(),
})

export const LabelSchemaFile = z.object({
  groups: z.record(z.string(), GroupSchema).optional(),
  prefixes: z.record(z.string(), PrefixSchema).optional(),
  orphan_labels: z.object({ display: DisplaySchema.optional() }).optional(),
})

export type LabelSchemaFile = z.infer<typeof LabelSchemaFile>

interface CacheEntry {
  mtimeMs: number
  schema: LabelSchemaFile
}

const cache = new Map<string, CacheEntry>()

export function loadLabelSchemaFile(path: string): LabelSchemaFile | null {
  if (!path || !existsSync(path)) return null
  try {
    const stat = statSync(path)
    const cached = cache.get(path)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.schema
    const raw = readFileSync(path, 'utf-8')
    const parsed = LabelSchemaFile.parse(parseYaml(raw))
    cache.set(path, { mtimeMs: stat.mtimeMs, schema: parsed })
    return parsed
  } catch {
    return null
  }
}
