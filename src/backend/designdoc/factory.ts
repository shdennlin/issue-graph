import { existsSync } from 'node:fs'
import type { DesignDocChange } from '@shared/types.js'
import type { DesignDocAdapter } from './types.js'
import { openspecAdapter } from './openspec.js'
import { spectraAdapter } from './spectra.js'

// Order matters for `auto` detection: try the more-specific (Spectra,
// gated on .spectra.yaml) before the more-permissive (OpenSpec, gated
// on raw openspec/ presence). spectraAdapter.detect() is false unless
// .spectra.yaml or .spectra/ exists, so OpenSpec still wins for pure
// OpenSpec projects.
const ADAPTERS: DesignDocAdapter[] = [spectraAdapter, openspecAdapter]

function pickAdapter(repoRoot: string, configured: string): DesignDocAdapter | null {
  if (!repoRoot || !existsSync(repoRoot)) return null
  if (configured === 'none') return null
  if (configured === 'auto') {
    return ADAPTERS.find((a) => a.detect(repoRoot)) ?? null
  }
  return ADAPTERS.find((a) => a.name === configured) ?? null
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
