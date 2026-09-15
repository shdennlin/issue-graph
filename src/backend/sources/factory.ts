import { loadConfig } from '../lib/env.js'
import { getCurrentWorkspaceId, UNCONFIGURED_WORKSPACE_ID } from '../lib/workspaceContext.js'
import { getDefaultWorkspaceId } from '../lib/env.js'
import type { BackendAdapter } from './types.js'
import { LinearBackend } from './linear/index.js'

// One BackendAdapter per workspace id (LinearBackend holds an apiKey/endpoint
// pair, which can differ per profile). Same id → same instance.
const backendByWorkspaceId: Map<string, BackendAdapter> = new Map()

function currentWid(): string {
  return getCurrentWorkspaceId() ?? getDefaultWorkspaceId() ?? UNCONFIGURED_WORKSPACE_ID
}

export function getBackend(): BackendAdapter {
  const wid = currentWid()
  const cached = backendByWorkspaceId.get(wid)
  if (cached) return cached
  // The stored workspace key, passed exactly as before — a personal API key
  // goes into the Authorization header raw. Nothing about the read path changes
  // because writes gained a second credential type.
  const built = buildBackend(loadConfig().LINEAR_API_KEY ?? '')
  backendByWorkspaceId.set(wid, built)
  return built
}

/** `authorization` is the header value, already framed — LinearBackend passes
 *  its `apiKey` straight into the Authorization header. */
function buildBackend(authorization: string): BackendAdapter {
  const cfg = loadConfig()
  switch (cfg.BACKEND) {
    case 'linear':
      return new LinearBackend({
        apiKey: authorization,
        endpoint: cfg.LINEAR_API_ENDPOINT,
        teamId: cfg.LINEAR_TEAM_ID,
      })
    default:
      throw new Error(`Unknown BACKEND: ${cfg.BACKEND}. v1 supports only 'linear'.`)
  }
}

/**
 * An adapter that acts as the *caller*, for one request — the per-user OAuth
 * token that arrived on a write.
 *
 * **Uncached, and never a mutated shared instance.** Two reasons, both real:
 * `gql` reads `this.opts.apiKey` per call and after an await boundary, so a
 * concurrent background sync would send whichever token was swapped in last;
 * and the instance's `rate` field tracks the *workspace key's* rate-limit
 * budget, which sync.ts reports — a per-user token's headers would quietly
 * corrupt that number. Instances are otherwise stateless, so a fresh one per
 * write costs nothing.
 *
 * The endpoint still comes from server config, never from the request. Same
 * invariant as verifyKey in routes/workspaces.ts: a caller-supplied endpoint
 * would be handed the credential in the Authorization header.
 */
export function buildBackendWithToken(token: string): BackendAdapter {
  // `Bearer` unconditionally, with no sniffing: this caller is the only one
  // that knows it holds an OAuth token, and Linear's two credential types are
  // framed differently (a personal key goes raw, an OAuth token needs the
  // prefix). A heuristic here would be guessing about a fact the call site
  // already has, and getting it wrong yields a 401 that reads as "bad token"
  // when only the framing was wrong.
  return buildBackend(`Bearer ${token}`)
}

/**
 * Drop the cached backend for one workspace (or all of them when called
 * with no arg, primarily for tests). Per-tab workspace switching does NOT
 * call this — different tabs viewing the same workspace must keep sharing
 * the same backend instance.
 */
export function resetBackendCache(workspaceId?: string): void {
  if (workspaceId) {
    backendByWorkspaceId.delete(workspaceId)
    return
  }
  backendByWorkspaceId.clear()
}

export const resetBackendForTests = resetBackendCache
