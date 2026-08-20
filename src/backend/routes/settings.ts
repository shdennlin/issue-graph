import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import { readWebhookStats } from './webhooks.js'
import { readWorkspaceRows, upsertWorkspace } from '../controlDb.js'
import { getCurrentWorkspaceId } from '../lib/workspaceContext.js'
import { getDefaultWorkspaceId } from '../lib/env.js'
import { getWorkspaceInfo, loadConfig } from '../lib/env.js'
import { SETTING_SPECS, type IntSettingKey, type SettingKey } from '../lib/settingSpecs.js'
import { loadLabelSchemaFile } from '../schema/yamlLoader.js'
import { readViewerCached } from '../sync.js'

// Derived from the registry rather than restated. node_density,
// show_active_only_default and show_my_issues_default used to sit in this list;
// all three were accepted, validated and stored, and then read by nothing on
// either side of the wire, so they are gone rather than wired up on spec.
const SettingsKeys = Object.keys(SETTING_SPECS) as SettingKey[]

function readAllSettings(): Record<SettingKey, string | undefined> {
  const out: Record<string, string | undefined> = {}
  const rows = getDb().prepare('SELECT key, value FROM setting').all() as Array<{ key: string; value: string }>
  for (const r of rows) out[r.key] = r.value
  for (const k of SettingsKeys) if (!(k in out)) out[k] = undefined
  return out as Record<SettingKey, string | undefined>
}

/** Bounds come from the registry, never restated here. The previous version
 *  wrote them out a second time and had already drifted from the reader that
 *  trusted them. */
function intField(key: IntSettingKey) {
  const spec = SETTING_SPECS[key]
  return z.number().int().min(spec.min).max(spec.max).optional()
}

const PatchSchema = z.object({
  default_view: z.enum(SETTING_SPECS.default_view.values).optional(),
  default_theme: z.enum(SETTING_SPECS.default_theme.values).optional(),
  stale_days_threshold: intField('stale_days_threshold'),
  snapshot_retention_days: intField('snapshot_retention_days'),
  daily_snapshot_hour: intField('daily_snapshot_hour'),
  cache_ttl_seconds: intField('cache_ttl_seconds'),
  // Write-only. Never echoed back by GET — see webhookSummary(). An empty
  // string clears it, which disables the webhook route (it then rejects
  // everything, indistinguishably from a wrong signature).
  linear_webhook_secret: z.string().max(200).optional(),
})

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
    webhook: readWebhookStats(),
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
  // The secret goes to the control plane, not `setting`: readAllSettings()
  // returns the whole setting table and this route ships it verbatim, so a row
  // there would be readable by anyone who can reach the UI. It also must not
  // live in the per-workspace graph.db, which is a rebuildable cache.
  const { linear_webhook_secret: secret, ...rest } = parsed.data
  if (secret !== undefined) {
    const wid = getCurrentWorkspaceId() ?? getDefaultWorkspaceId()
    const existing = readWorkspaceRows().find((r) => r.id === wid)
    if (!existing) {
      return c.json(
        { error: { code: 'unconfigured', message: 'Add a workspace before setting a webhook secret.' } },
        400,
      )
    }
    upsertWorkspace({ id: wid, name: existing.name, webhookSecret: secret.trim() })
  }
  const entries: Array<[string, string]> = Object.entries(rest).map(([k, v]) => [
    k,
    typeof v === 'boolean' ? (v ? '1' : '0') : String(v),
  ])
  txn(entries)
  return c.json({ ok: true })
})
