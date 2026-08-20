// Inbound Linear webhooks.
//
// EXPOSURE NOTE. Every other route in this app assumes it is unreachable from
// the internet (localhost / Tailscale only — see the warning in README.md).
// This one is meant to be published, via a path-scoped Tailscale Funnel mount:
//
//   tailscale funnel --bg --set-path=/linear-hook \
//     http://localhost:31415/api/webhooks/linear?w=<workspace>
//
// Only that public path is served; the rest of the port stays unreachable
// (verified: /, /api/graph, /api/health all 404 from outside). The funnel
// hostname is resolvable in public DNS, so the HMAC below is the only thing
// standing between a stranger and this handler — not an optimization.
//
// Registered with Linear as `https://<host>.ts.net/linear-hook?w=<workspace>`;
// the `?w=` is what the /api/* middleware in index.ts resolves, which is why
// one funnel mount serves every workspace.

import { Hono } from 'hono'
import { readMeta, writeMeta } from '../cache.js'
import { publish, BUS_EVENT } from '../lib/eventBus.js'
import { getLogger } from '../lib/log.js'
import { getCurrentWorkspaceId, LEGACY_WORKSPACE_ID, runWithWorkspace } from '../lib/workspaceContext.js'
import { isFreshTimestamp, verifyLinearSignature } from '../lib/webhookAuth.js'
import { scheduleWorkspaceSync } from '../lib/webhookDebounce.js'
import { syncOnce } from '../sync.js'

/** cache_meta keys. Deliberately not `setting` rows: readAllSettings() returns
 *  the whole table and GET /api/settings ships it verbatim, so a secret stored
 *  there would be readable by anything that can reach the UI. */
export const WEBHOOK_SECRET_KEY = 'linear_webhook_secret'
export const WEBHOOK_STAT_LAST_OK = 'linear_webhook_last_ok_ms'
export const WEBHOOK_STAT_OK_COUNT = 'linear_webhook_ok_count'
export const WEBHOOK_STAT_LAST_REJECT = 'linear_webhook_last_reject_ms'
export const WEBHOOK_STAT_REJECT_COUNT = 'linear_webhook_reject_count'
export const WEBHOOK_STAT_LAST_REASON = 'linear_webhook_last_reject_reason'

function bump(key: string): void {
  const n = Number(readMeta(key) ?? '0')
  writeMeta(key, String((Number.isFinite(n) ? n : 0) + 1))
}

type RejectReason = 'unconfigured' | 'bad-signature' | 'stale-timestamp' | 'bad-body'

function reject(reason: RejectReason): void {
  writeMeta(WEBHOOK_STAT_LAST_REJECT, String(Date.now()))
  writeMeta(WEBHOOK_STAT_LAST_REASON, reason)
  bump(WEBHOOK_STAT_REJECT_COUNT)
  // Logged, never returned. The response is a bare 401 in every case: telling
  // a caller *why* it failed distinguishes "no secret configured here" from
  // "wrong secret", which is config state leaking to an unauthenticated party.
  getLogger().warn({ reason }, 'linear webhook rejected')
}

export const webhookRoutes = new Hono()

webhookRoutes.post('/api/webhooks/linear', async (c) => {
  // Raw text, before any JSON parse: Linear signs the exact bytes, and a
  // re-serialized object will not reproduce them.
  const rawBody = await c.req.text()
  const secret = readMeta(WEBHOOK_SECRET_KEY) ?? ''

  if (!verifyLinearSignature(rawBody, c.req.header('linear-signature'), secret)) {
    reject(secret ? 'bad-signature' : 'unconfigured')
    return c.json({ error: 'unauthorized' }, 401)
  }

  let payload: { webhookTimestamp?: unknown; action?: unknown; type?: unknown }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    reject('bad-body')
    return c.json({ error: 'unauthorized' }, 401)
  }

  if (!isFreshTimestamp(payload.webhookTimestamp, Date.now())) {
    reject('stale-timestamp')
    return c.json({ error: 'unauthorized' }, 401)
  }

  writeMeta(WEBHOOK_STAT_LAST_OK, String(Date.now()))
  bump(WEBHOOK_STAT_OK_COUNT)
  // Log accepted deliveries too, not just rejections. A webhook that quietly
  // stops arriving is this feature's most likely failure, and "the counter
  // went up but nothing is in the log" leaves no way to tell a real delivery
  // apart from a local test. action/type identify the entity Linear changed.
  getLogger().info(
    { action: payload.action, type: payload.type },
    'linear webhook accepted',
  )

  // Capture the workspace now. The debounce timer fires after this request's
  // AsyncLocalStorage scope has closed, and it can be re-armed by a later
  // request, so the job must carry its own scope rather than inherit one.
  const wid = getCurrentWorkspaceId() ?? LEGACY_WORKSPACE_ID
  scheduleWorkspaceSync(wid, async () => {
    await runWithWorkspace(wid, async () => {
      // force: true — a plain sync returns the in-flight promise, which would
      // silently drop a change that landed mid-sync. syncOnce already
      // serializes per workspace, and the debounce collapsed the burst, so
      // this is one fresh pull rather than a stampede.
      const result = await syncOnce({ force: true })
      if (!result.ok) {
        getLogger().warn({ workspaceId: wid }, 'webhook-triggered sync failed')
        return
      }
      getLogger().info({ workspaceId: wid }, 'webhook-triggered sync completed')
      // Tagged with the workspace so tabs viewing a different one ignore it —
      // same convention as 'designdoc-changed'.
      publish({ type: BUS_EVENT.ISSUES_CHANGED, data: { workspaceId: wid } })
    })
  })

  // Ack immediately. Linear retries on 5xx, and holding the connection open
  // for the duration of a sync would turn a slow Linear API into webhook
  // timeouts and duplicate deliveries.
  return c.json({ ok: true })
})
