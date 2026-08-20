import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import { readMeta, writeMeta } from '../cache.js'
import {
  WEBHOOK_SECRET_KEY,
  WEBHOOK_STAT_LAST_OK,
  WEBHOOK_STAT_OK_COUNT,
  WEBHOOK_STAT_LAST_REJECT,
  WEBHOOK_STAT_REJECT_COUNT,
  WEBHOOK_STAT_LAST_REASON,
} from './webhooks.js'
import { getWorkspaceInfo, loadConfig } from '../lib/env.js'
import { loadLabelSchemaFile } from '../schema/yamlLoader.js'
import { readViewerCached } from '../sync.js'

const SettingsKeys = [
  'default_view',
  'default_theme',
  'node_density',
  'show_active_only_default',
  'show_my_issues_default',
  'stale_days_threshold',
  'snapshot_retention_days',
  'daily_snapshot_hour',
  'cache_ttl_seconds',
] as const

type SettingKey = (typeof SettingsKeys)[number]

function readAllSettings(): Record<SettingKey, string | undefined> {
  const out: Record<string, string | undefined> = {}
  const rows = getDb().prepare('SELECT key, value FROM setting').all() as Array<{ key: string; value: string }>
  for (const r of rows) out[r.key] = r.value
  for (const k of SettingsKeys) if (!(k in out)) out[k] = undefined
  return out as Record<SettingKey, string | undefined>
}

const PatchSchema = z.object({
  default_view: z.enum(['dependency', 'bucket', 'mix']).optional(),
  default_theme: z.enum(['light', 'dark', 'auto']).optional(),
  node_density: z.enum(['compact', 'default', 'verbose']).optional(),
  show_active_only_default: z.boolean().optional(),
  show_my_issues_default: z.boolean().optional(),
  stale_days_threshold: z.number().int().min(1).max(365).optional(),
  snapshot_retention_days: z.number().int().min(1).max(3650).optional(),
  daily_snapshot_hour: z.number().int().min(0).max(23).optional(),
  cache_ttl_seconds: z.number().int().min(10).max(24 * 3600).optional(),
  // Write-only. Never echoed back by GET — see webhookSummary(). An empty
  // string clears it, which disables the webhook route (it then rejects
  // everything, indistinguishably from a wrong signature).
  linear_webhook_secret: z.string().max(200).optional(),
})

/** What the UI is allowed to know about the webhook: whether a secret exists
 *  and how the endpoint has been behaving. Never the secret itself — this
 *  response is served without auth. */
function webhookSummary() {
  const num = (k: string): number => {
    const n = Number(readMeta(k) ?? '0')
    return Number.isFinite(n) ? n : 0
  }
  return {
    secret_set: Boolean(readMeta(WEBHOOK_SECRET_KEY)),
    last_ok_ms: num(WEBHOOK_STAT_LAST_OK) || null,
    ok_count: num(WEBHOOK_STAT_OK_COUNT),
    last_reject_ms: num(WEBHOOK_STAT_LAST_REJECT) || null,
    reject_count: num(WEBHOOK_STAT_REJECT_COUNT),
    last_reject_reason: readMeta(WEBHOOK_STAT_LAST_REASON),
  }
}

export const settingsRoutes = new Hono()

settingsRoutes.get('/api/settings', (c) => {
  const cfg = loadConfig()
  const stored = readAllSettings()
  const viewer = readViewerCached()
  const workspace = getWorkspaceInfo()
  // Surface the label-schema source so Settings can show users which
  // group the Mix view is bucketing on AND how that decision was made
  // (yaml file > PRIMARY_GROUP env > auto-detect from label group names).
  const labelSchemaLoaded = loadLabelSchemaFile(cfg.LABEL_SCHEMA_PATH) !== null
  return c.json({
    env: {
      backend: cfg.BACKEND,
      instance_label: cfg.INSTANCE_LABEL,
      issue_scope: cfg.ISSUE_SCOPE,
      linear_team_id: cfg.LINEAR_TEAM_ID ?? null,
      linear_api_key_set: Boolean(cfg.LINEAR_API_KEY),
      stale_days: cfg.STALE_DAYS,
      default_view: cfg.DEFAULT_VIEW,
      default_theme: cfg.DEFAULT_THEME,
      node_density: cfg.NODE_DENSITY,
      cache_ttl_seconds: cfg.CACHE_TTL_SECONDS,
      daily_snapshot_hour: cfg.DAILY_SNAPSHOT_HOUR,
      snapshot_retention_days: cfg.SNAPSHOT_RETENTION_DAYS,
      show_active_only_default: cfg.SHOW_ACTIVE_ONLY_DEFAULT,
      primary_group_override: cfg.PRIMARY_GROUP ?? null,
      type_group_override: cfg.TYPE_GROUP ?? null,
      label_schema_path: cfg.LABEL_SCHEMA_PATH,
      label_schema_loaded: labelSchemaLoaded,
    },
    stored,
    viewer,
    workspace,
    webhook: webhookSummary(),
  })
})

settingsRoutes.patch('/api/settings', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  const stmt = getDb().prepare(
    `INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
  const txn = getDb().transaction((entries: Array<[string, string]>) => {
    for (const [k, v] of entries) stmt.run(k, v)
  })
  // The secret goes to cache_meta, not `setting`: readAllSettings() returns
  // the whole setting table and this route ships it verbatim, so a row there
  // would be readable by anyone who can reach the UI.
  const { linear_webhook_secret: secret, ...rest } = parsed.data
  if (secret !== undefined) writeMeta(WEBHOOK_SECRET_KEY, secret.trim())
  const entries: Array<[string, string]> = Object.entries(rest).map(([k, v]) => [
    k,
    typeof v === 'boolean' ? (v ? '1' : '0') : String(v),
  ])
  txn(entries)
  return c.json({ ok: true })
})
