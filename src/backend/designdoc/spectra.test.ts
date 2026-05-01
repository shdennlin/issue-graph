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
})
