import { existsSync } from 'node:fs'
import type { DesignDocChange } from '@shared/types.js'
import type { DesignDocAdapter } from './types.js'
import { spectraAdapter } from './spectra.js'

const ADAPTERS: DesignDocAdapter[] = [spectraAdapter]
const ALIASES: Record<string, string> = { openspec: 'spectra' }

function pickAdapter(repoRoot: string, configured: string): DesignDocAdapter | null {
  if (!repoRoot || !existsSync(repoRoot)) return null
  if (configured === 'none') return null
  if (configured === 'auto') {
    return ADAPTERS.find((a) => a.detect(repoRoot)) ?? null
  }
  const resolved = ALIASES[configured] ?? configured
  return ADAPTERS.find((a) => a.name === resolved) ?? null
}

export async function runDesignDocScan(
  repoRoot: string,
  configured: string,
): Promise<DesignDocChange[] | undefined> {
  const adapter = pickAdapter(repoRoot, configured)
  if (!adapter) return undefined
  return adapter.scan(repoRoot)
}

export function getActiveDesignDocAdapter(repoRoot: string, configured: string): DesignDocAdapter | null {
  return pickAdapter(repoRoot, configured)
}
