import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spectraAdapter } from './spectra.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spectra-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function mkChange(name: string, proposal: string, tasks: string, sub = 'changes'): void {
  const dir = join(root, 'openspec', sub, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'proposal.md'), proposal)
  writeFileSync(join(dir, 'tasks.md'), tasks)
}

describe('spectraAdapter', () => {
  it('detects when openspec/ exists', () => {
    expect(spectraAdapter.detect(root)).toBe(false)
    mkdirSync(join(root, 'openspec'), { recursive: true })
    expect(spectraAdapter.detect(root)).toBe(true)
  })

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
    const out = spectraAdapter.scan(root)
    expect(out).toHaveLength(1)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-123'])
    expect(out[0]!.totalTasks).toBe(3)
    expect(out[0]!.doneTasks).toBe(2)
    expect(out[0]!.progress).toBeCloseTo(2 / 3, 5)
  })

  it('handles 1-to-N (multiple Linear: lines)', () => {
    mkChange('multi', 'Linear: PROJ-1\nLinear: PROJ-2\n', '- [ ] one')
    const out = spectraAdapter.scan(root)
    expect(out[0]!.issueIdentifiers.sort()).toEqual(['PROJ-1', 'PROJ-2'])
  })

  it('marks parked changes', () => {
    mkChange('parked-thing', 'Linear: PROJ-9\n', '', 'changes/_parked')
    const out = spectraAdapter.scan(root)
    const parked = out.find((c: { name: string }) => c.name === 'parked-thing')
    expect(parked?.status).toBe('parked')
  })

  it('marks archived changes', () => {
    mkChange('done-thing', 'Linear: PROJ-10\n', '- [x] all', 'archive')
    const out = spectraAdapter.scan(root)
    const archived = out.find((c: { name: string }) => c.name === 'done-thing')
    expect(archived?.status).toBe('archived')
  })

  it('returns empty when no openspec/changes', () => {
    expect(spectraAdapter.scan(root)).toEqual([])
  })

  it('extracts ids from frontmatter (linear: [...])', () => {
    mkChange(
      'fm-array',
      `---\nlinear: [PROJ-100, PROJ-101]\n---\n\n# Change\n`,
      '- [ ] task',
    )
    const out = spectraAdapter.scan(root)
    expect(out[0]!.issueIdentifiers.sort()).toEqual(['PROJ-100', 'PROJ-101'])
    expect(out[0]!.linkSources?.frontmatter.sort()).toEqual(['PROJ-100', 'PROJ-101'])
    expect(out[0]!.linkSources?.regexLine).toEqual([])
  })

  it('extracts ids from frontmatter (linear: PROJ-1 single)', () => {
    mkChange('fm-single', `---\nlinear: PROJ-1\n---\n`, '')
    const out = spectraAdapter.scan(root)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-1'])
    expect(out[0]!.linkSources?.frontmatter).toEqual(['PROJ-1'])
  })

  it('extracts ids from folder name', () => {
    mkChange('PROJ-42-some-feature', '# No linear mention here\n', '')
    const out = spectraAdapter.scan(root)
    expect(out[0]!.issueIdentifiers).toEqual(['PROJ-42'])
    expect(out[0]!.linkSources?.folderName).toEqual(['PROJ-42'])
  })

  it('unions ids from all three strategies', () => {
    mkChange(
      'PROJ-1-feature',
      `---\nlinear: PROJ-2\n---\n\nLinear: PROJ-3\n`,
      '',
    )
    const out = spectraAdapter.scan(root)
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
    const out = spectraAdapter.scan(root)
    expect(out[0]!.issueIdentifiers.sort()).toEqual(['PROJ-105', 'PROJ-107', 'PROJ-70'])
  })
})
