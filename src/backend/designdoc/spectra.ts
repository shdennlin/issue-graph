// Spectra adapter (kaochenlong/spectra-app).
//
// Spectra extends OpenSpec but pulled the project config out to
// .spectra.yaml at the repo root (vs OpenSpec's bootstrap-circular
// openspec/config.yaml), which lets it expose `spec_dir` for projects
// that want to host specs somewhere other than openspec/. Spectra's
// default changed from `openspec/` to `docs/specs/` in v2.2.5
// (https://github.com/kaochenlong/spectra-app/releases/tag/v2.2.5).
//
// spec_dir resolution order:
//   1. If .spectra.yaml exists AND has a non-empty `spec_dir` value,
//      use it verbatim (relative to repoRoot).
//   2. Else, prefer the new default `docs/specs/` if it exists.
//   3. Else, fall back to the legacy `openspec/` if it exists.
//   4. Else, no usable spec dir — detect() returns false.
//
// (3) supports projects mid-migration from OpenSpec — they have
// .spectra.yaml installed but the actual spec content still lives under
// openspec/ until the user runs Spectra's relocation flow.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { DesignDocChange } from '@shared/types.js'
import type { DesignDocAdapter } from './types.js'
import { scanSpecDir } from './scanner.js'

const SPECTRA_CONFIG = '.spectra.yaml'
const SPECTRA_META_DIR = '.spectra'
const NEW_DEFAULT_DIR = 'docs/specs'
const LEGACY_DIR = 'openspec'

function isSpectraProject(repoRoot: string): boolean {
  return existsSync(join(repoRoot, SPECTRA_CONFIG)) || existsSync(join(repoRoot, SPECTRA_META_DIR))
}

/**
 * Resolve the spec directory (relative to repoRoot) for a Spectra project,
 * or null when no usable directory can be found.
 */
export function resolveSpectraSpecDir(repoRoot: string): string | null {
  // (1) Explicit spec_dir from .spectra.yaml takes precedence.
  const configPath = join(repoRoot, SPECTRA_CONFIG)
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = parseYaml(raw)
      if (parsed && typeof parsed === 'object') {
        const v = (parsed as Record<string, unknown>).spec_dir
        if (typeof v === 'string' && v.trim().length > 0) {
          const dir = v.trim().replace(/^\/+|\/+$/g, '')
          if (existsSync(join(repoRoot, dir))) return dir
          // Configured dir doesn't exist yet — still return it so the
          // watcher can wait for it to be created (matches Spectra's own
          // late-arriving directory behavior).
          return dir
        }
      }
    } catch {
      // Malformed YAML — fall through to defaults.
    }
  }
  // (2) New default.
  if (existsSync(join(repoRoot, NEW_DEFAULT_DIR))) return NEW_DEFAULT_DIR
  // (3) Legacy fallback (mid-migration projects).
  if (existsSync(join(repoRoot, LEGACY_DIR))) return LEGACY_DIR
  // (4) Nothing usable.
  return null
}

export const spectraAdapter: DesignDocAdapter = {
  name: 'spectra',
  detect(repoRoot: string): boolean {
    if (!isSpectraProject(repoRoot)) return false
    return resolveSpectraSpecDir(repoRoot) !== null
  },
  scan(repoRoot: string): DesignDocChange[] {
    if (!isSpectraProject(repoRoot)) return []
    const dir = resolveSpectraSpecDir(repoRoot)
    if (!dir) return []
    return scanSpecDir(repoRoot, dir)
  },
  getWatchTarget(repoRoot: string): string | null {
    if (!isSpectraProject(repoRoot)) return null
    const dir = resolveSpectraSpecDir(repoRoot)
    if (!dir) return null
    return join(repoRoot, dir)
  },
}
