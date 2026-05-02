import { loadConfig } from '../lib/env.js'
import type { BackendAdapter } from './types.js'
import { LinearBackend } from './linear/index.js'

let cached: BackendAdapter | null = null

export function getBackend(): BackendAdapter {
  if (cached) return cached
  const cfg = loadConfig()
  switch (cfg.BACKEND) {
    case 'linear':
      cached = new LinearBackend({
        apiKey: cfg.LINEAR_API_KEY ?? '',
        endpoint: cfg.LINEAR_API_ENDPOINT,
        teamId: cfg.LINEAR_TEAM_ID,
      })
      return cached
    default:
      throw new Error(`Unknown BACKEND: ${cfg.BACKEND}. v1 supports only 'linear'.`)
  }
}

export function resetBackendForTests(): void {
  cached = null
}
