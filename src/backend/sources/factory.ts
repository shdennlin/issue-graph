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
  const cfg = loadConfig()
  switch (cfg.BACKEND) {
    case 'linear': {
      const built = new LinearBackend({
        apiKey: cfg.LINEAR_API_KEY ?? '',
        endpoint: cfg.LINEAR_API_ENDPOINT,
        teamId: cfg.LINEAR_TEAM_ID,
      })
      backendByWorkspaceId.set(wid, built)
      return built
    }
    default:
      throw new Error(`Unknown BACKEND: ${cfg.BACKEND}. v1 supports only 'linear'.`)
  }
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
