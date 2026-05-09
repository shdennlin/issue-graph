// OpenSpec adapter (Fission-AI/OpenSpec).
//
// OpenSpec hardcodes the spec directory name to "openspec" — there is no
// configurable spec_dir option (the project config lives at
// openspec/config.yaml, which makes the dir itself bootstrap-circular).
// See: https://github.com/Fission-AI/OpenSpec/blob/main/src/core/config.ts
//
// Detection signal: openspec/ exists AND no Spectra config — without the
// negative check, a project that's mid-migration from OpenSpec to Spectra
// (has both openspec/ and .spectra.yaml) would match both adapters and the
// factory's auto-pick order would silently determine which wins. Better to
// be explicit: if .spectra.yaml is present, defer to spectraAdapter, which
// can read the config and pick the right spec_dir (potentially still
// openspec/ during migration, but via the Spectra path not OpenSpec's).

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DesignDocChange } from '@shared/types.js'
import type { DesignDocAdapter } from './types.js'
import { scanSpecDir } from './scanner.js'

const OPENSPEC_DIR = 'openspec'
const SPECTRA_CONFIG = '.spectra.yaml'
const SPECTRA_META_DIR = '.spectra'

function isPureOpenSpec(repoRoot: string): boolean {
  if (!existsSync(join(repoRoot, OPENSPEC_DIR))) return false
  // Defer to Spectra adapter when its config is present so migrating
  // projects get Spectra's spec_dir resolution (which may still point at
  // openspec/ via fallback, but via the Spectra code path).
  if (existsSync(join(repoRoot, SPECTRA_CONFIG))) return false
  if (existsSync(join(repoRoot, SPECTRA_META_DIR))) return false
  return true
}

export const openspecAdapter: DesignDocAdapter = {
  name: 'openspec',
  detect(repoRoot: string): boolean {
    return isPureOpenSpec(repoRoot)
  },
  scan(repoRoot: string): DesignDocChange[] {
    if (!isPureOpenSpec(repoRoot)) return []
    return scanSpecDir(repoRoot, OPENSPEC_DIR)
  },
  getWatchTarget(repoRoot: string): string | null {
    if (!isPureOpenSpec(repoRoot)) return null
    return join(repoRoot, OPENSPEC_DIR)
  },
}
