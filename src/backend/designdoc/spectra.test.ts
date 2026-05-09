// Adapter-level tests for Spectra: focus on detect() gating and spec_dir
// resolution from .spectra.yaml. Scan-content correctness is covered by
// scanner.test.ts since both adapters share the same parser.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSpectraSpecDir, spectraAdapter } from './spectra.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spectra-adapter-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeYaml(content: string): void {
  writeFileSync(join(root, '.spectra.yaml'), content)
}

describe('spectraAdapter.detect', () => {
  it('false when neither .spectra.yaml nor .spectra/ present', () => {
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(spectraAdapter.detect(root)).toBe(false)
  })

  it('false when .spectra.yaml exists but no spec dir resolves', () => {
    writeYaml('locale: en\n')
    expect(spectraAdapter.detect(root)).toBe(false)
  })

  it('true when .spectra.yaml + docs/specs/ both present', () => {
    writeYaml('locale: en\n')
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    expect(spectraAdapter.detect(root)).toBe(true)
  })

  it('true when .spectra.yaml + legacy openspec/ (mid-migration)', () => {
    writeYaml('locale: en\n')
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(spectraAdapter.detect(root)).toBe(true)
  })

  it('true when only .spectra/ metadata dir present + spec dir', () => {
    mkdirSync(join(root, '.spectra'), { recursive: true })
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    expect(spectraAdapter.detect(root)).toBe(true)
  })
})

describe('resolveSpectraSpecDir', () => {
  it('honors explicit spec_dir from .spectra.yaml', () => {
    writeYaml('spec_dir: my/custom/path\n')
    mkdirSync(join(root, 'my', 'custom', 'path'), { recursive: true })
    expect(resolveSpectraSpecDir(root)).toBe('my/custom/path')
  })

  it('returns the configured spec_dir even if the directory does not exist (lets watcher wait for it)', () => {
    writeYaml('spec_dir: not/yet/created\n')
    expect(resolveSpectraSpecDir(root)).toBe('not/yet/created')
  })

  it('strips leading/trailing slashes from configured spec_dir', () => {
    writeYaml('spec_dir: "/custom/dir/"\n')
    mkdirSync(join(root, 'custom', 'dir'), { recursive: true })
    expect(resolveSpectraSpecDir(root)).toBe('custom/dir')
  })

  it('falls back to docs/specs/ as the new default when spec_dir is unset', () => {
    writeYaml('locale: en\n')
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    expect(resolveSpectraSpecDir(root)).toBe('docs/specs')
  })

  it('falls back to legacy openspec/ when neither configured nor docs/specs/ exists', () => {
    writeYaml('locale: en\n')
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(resolveSpectraSpecDir(root)).toBe('openspec')
  })

  it('prefers docs/specs/ over openspec/ when both exist (matches Spectra default)', () => {
    writeYaml('locale: en\n')
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(resolveSpectraSpecDir(root)).toBe('docs/specs')
  })

  it('returns null when no config and no recognizable dir exists', () => {
    writeYaml('locale: en\n')
    expect(resolveSpectraSpecDir(root)).toBe(null)
  })

  it('returns null when .spectra.yaml is malformed YAML', () => {
    writeYaml('not: valid: yaml: [unclosed')
    // Without a parseable config, detect will fall through to defaults,
    // but those don't exist either → null.
    expect(resolveSpectraSpecDir(root)).toBe(null)
  })
})

describe('spectraAdapter.scan + getWatchTarget', () => {
  it('scan returns content from the resolved spec dir', () => {
    writeYaml('spec_dir: docs/specs\n')
    const change = join(root, 'docs', 'specs', 'changes', 'foo')
    mkdirSync(change, { recursive: true })
    writeFileSync(join(change, 'proposal.md'), 'Linear: PROJ-7\n')
    writeFileSync(join(change, 'tasks.md'), '- [ ] one')
    const out = spectraAdapter.scan(root)
    expect(out).toHaveLength(1)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-7'])
  })

  it('getWatchTarget returns the absolute spec dir', () => {
    writeYaml('locale: en\n')
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    expect(spectraAdapter.getWatchTarget(root)).toBe(join(root, 'docs', 'specs'))
  })

  it('getWatchTarget returns null when the project is not Spectra', () => {
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(spectraAdapter.getWatchTarget(root)).toBe(null)
  })
})
