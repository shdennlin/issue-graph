// Adapter-level tests for OpenSpec: focus on the negative-detection logic
// that defers to spectraAdapter when Spectra config is present. Scan-content
// correctness is covered by scanner.test.ts.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openspecAdapter } from './openspec.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openspec-adapter-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('openspecAdapter.detect', () => {
  it('false when openspec/ does not exist', () => {
    expect(openspecAdapter.detect(root)).toBe(false)
  })

  it('true when only openspec/ exists (pure OpenSpec project)', () => {
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(openspecAdapter.detect(root)).toBe(true)
  })

  it('false when both openspec/ and .spectra.yaml exist (defer to Spectra)', () => {
    mkdirSync(join(root, 'openspec'), { recursive: true })
    writeFileSync(join(root, '.spectra.yaml'), 'locale: en\n')
    expect(openspecAdapter.detect(root)).toBe(false)
  })

  it('false when both openspec/ and .spectra/ metadata dir exist (defer to Spectra)', () => {
    mkdirSync(join(root, 'openspec'), { recursive: true })
    mkdirSync(join(root, '.spectra'), { recursive: true })
    expect(openspecAdapter.detect(root)).toBe(false)
  })
})

describe('openspecAdapter.scan + getWatchTarget', () => {
  it('scan reads from openspec/ when project is pure OpenSpec', () => {
    const change = join(root, 'openspec', 'changes', 'foo')
    mkdirSync(change, { recursive: true })
    writeFileSync(join(change, 'proposal.md'), 'Linear: PROJ-1\n')
    writeFileSync(join(change, 'tasks.md'), '- [ ] task')
    const out = openspecAdapter.scan(root)
    expect(out).toHaveLength(1)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-1'])
  })

  it('scan returns empty when Spectra config is present (defers)', () => {
    const change = join(root, 'openspec', 'changes', 'foo')
    mkdirSync(change, { recursive: true })
    writeFileSync(join(change, 'proposal.md'), 'Linear: PROJ-1\n')
    writeFileSync(join(change, 'tasks.md'), '- [ ] task')
    writeFileSync(join(root, '.spectra.yaml'), 'locale: en\n')
    expect(openspecAdapter.scan(root)).toEqual([])
  })

  it('getWatchTarget returns absolute openspec/ path for pure OpenSpec', () => {
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(openspecAdapter.getWatchTarget(root)).toBe(join(root, 'openspec'))
  })

  it('getWatchTarget returns null when Spectra config present', () => {
    mkdirSync(join(root, 'openspec'), { recursive: true })
    writeFileSync(join(root, '.spectra.yaml'), 'locale: en\n')
    expect(openspecAdapter.getWatchTarget(root)).toBe(null)
  })
})
