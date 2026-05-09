// Tests for the tool-agnostic spec scanner. Uses an arbitrary spec dir
// name ('openspec' here, just because the fixture predates the rename) to
// prove scanSpecDir works for any layout. Adapter-specific behaviors
// (which dir to point at, how to detect the tool) live in the per-adapter
// test files.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSpecDir } from './scanner.js'

const SPEC_DIR = 'openspec'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spec-scanner-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function mkChange(name: string, proposal: string, tasks: string, sub = 'changes'): void {
  const dir = join(root, SPEC_DIR, sub, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'proposal.md'), proposal)
  writeFileSync(join(dir, 'tasks.md'), tasks)
}

describe('scanSpecDir', () => {
  it('extracts Linear identifiers and counts checkboxes', () => {
    mkChange(
      'auth-rewrite',
      'Linear: PROJ-123\n\n# Some change\n',
      `# tasks
- [x] foo
- [x] bar
- [ ] baz
`,
    )
    const out = scanSpecDir(root, SPEC_DIR)
    expect(out).toHaveLength(1)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-123'])
    expect(out[0]!.totalTasks).toBe(3)
    expect(out[0]!.doneTasks).toBe(2)
    expect(out[0]!.progress).toBeCloseTo(2 / 3, 5)
  })

  it('handles 1-to-N (multiple Linear: lines)', () => {
    mkChange('multi', 'Linear: PROJ-1\nLinear: PROJ-2\n', '- [ ] one')
    const out = scanSpecDir(root, SPEC_DIR)
    expect(out[0]!.issueIdentifiers.sort()).toEqual(['PROJ-1', 'PROJ-2'])
  })

  it('marks parked changes', () => {
    mkChange('parked-thing', 'Linear: PROJ-9\n', '', 'changes/_parked')
    const out = scanSpecDir(root, SPEC_DIR)
    const parked = out.find((c) => c.name === 'parked-thing')
    expect(parked?.status).toBe('parked')
  })

  it('marks archived changes', () => {
    mkChange('done-thing', 'Linear: PROJ-10\n', '- [x] all', 'archive')
    const out = scanSpecDir(root, SPEC_DIR)
    const archived = out.find((c) => c.name === 'done-thing')
    expect(archived?.status).toBe('archived')
  })

  it('returns empty when no changes/ subdirs exist', () => {
    mkdirSync(join(root, SPEC_DIR), { recursive: true })
    expect(scanSpecDir(root, SPEC_DIR)).toEqual([])
  })

  it('returns empty when the spec dir itself is missing', () => {
    expect(scanSpecDir(root, SPEC_DIR)).toEqual([])
  })

  it('extracts ids from frontmatter (linear: [...])', () => {
    mkChange(
      'fm-array',
      `---\nlinear: [PROJ-100, PROJ-101]\n---\n\n# Change\n`,
      '- [ ] task',
    )
    const out = scanSpecDir(root, SPEC_DIR)
    expect(out[0]!.issueIdentifiers.sort()).toEqual(['PROJ-100', 'PROJ-101'])
    expect(out[0]!.linkSources?.frontmatter.sort()).toEqual(['PROJ-100', 'PROJ-101'])
    expect(out[0]!.linkSources?.regexLine).toEqual([])
  })

  it('extracts ids from frontmatter (linear: PROJ-1 single)', () => {
    mkChange('fm-single', `---\nlinear: PROJ-1\n---\n`, '')
    const out = scanSpecDir(root, SPEC_DIR)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-1'])
    expect(out[0]!.linkSources?.frontmatter).toEqual(['PROJ-1'])
  })

  it('extracts ids from folder name', () => {
    mkChange('PROJ-42-some-feature', '# No linear mention here\n', '')
    const out = scanSpecDir(root, SPEC_DIR)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-42'])
    expect(out[0]!.linkSources?.folderName).toEqual(['PROJ-42'])
  })

  it('unions ids from all three strategies', () => {
    mkChange(
      'PROJ-1-feature',
      `---\nlinear: PROJ-2\n---\n\nLinear: PROJ-3\n`,
      '',
    )
    const out = scanSpecDir(root, SPEC_DIR)
    expect(out[0]!.issueIdentifiers.sort()).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3'])
    expect(out[0]!.linkSources?.folderName).toEqual(['PROJ-1'])
    expect(out[0]!.linkSources?.frontmatter).toEqual(['PROJ-2'])
    expect(out[0]!.linkSources?.regexLine).toEqual(['PROJ-3'])
  })

  it('handles "Related Linear issues:" line', () => {
    mkChange(
      'related-format',
      'Related Linear issues: PROJ-105 (resume), PROJ-107, PROJ-70.\n',
      '',
    )
    const out = scanSpecDir(root, SPEC_DIR)
    expect(out[0]!.issueIdentifiers.sort()).toEqual(['PROJ-105', 'PROJ-107', 'PROJ-70'])
  })

  it('uses a non-default spec dir (proves the path is parameterized)', () => {
    const customDir = 'docs/specs'
    const dir = join(root, customDir, 'changes', 'custom')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'proposal.md'), 'Linear: PROJ-99\n')
    writeFileSync(join(dir, 'tasks.md'), '- [ ] one')
    const out = scanSpecDir(root, customDir)
    expect(out).toHaveLength(1)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-99'])
    expect(out[0]!.filePath).toBe(join(customDir, 'changes', 'custom', 'tasks.md'))
  })
})
