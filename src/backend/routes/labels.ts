import { Hono } from 'hono'
import { detectSchema } from '../schema/autodetect.js'
import { loadTypeIcons } from '../schema/envOverride.js'
import { loadLabelSchemaFile } from '../schema/yamlLoader.js'
import { readCachedIssues, readCachedLabels, readWorkflowStatesCached } from '../cache.js'
import { loadConfig } from '../lib/env.js'

export const labelsRoutes = new Hono()

labelsRoutes.get('/api/labels', (c) => {
  const cfg = loadConfig()
  const labels = readCachedLabels()
  const issues = readCachedIssues()
  const detected = detectSchema({
    labels,
    issues,
    primaryGroupOverride: cfg.PRIMARY_GROUP,
    typeGroupOverride: cfg.TYPE_GROUP,
  })
  const typeIcons = loadTypeIcons()
  const yaml = loadLabelSchemaFile(cfg.LABEL_SCHEMA_PATH)
  return c.json({
    schema: detected,
    typeIcons,
    yaml,
    primaryGroupSingular: cfg.PRIMARY_GROUP ?? detected.primaryGroup ?? null,
    workflowStates: readWorkflowStatesCached(),
  })
})
