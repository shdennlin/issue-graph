// Tests for worktree discovery. Focuses on parseWorktreeList (pure
// function, easy to feed hand-crafted git output) and isInsideRepo
// (path-prefix safety). The shell-out path in listWorktrees is
// integration-flavored — we trust git itself and verify the parser.

import { describe, expect, it } from 'vitest'
import { parseWorktreeList, isInsideRepo } from './worktrees.js'

describe('parseWorktreeList', () => {
  it('parses a single main checkout', () => {
    const out = parseWorktreeList(`worktree /repo
HEAD abc1234567890
branch refs/heads/main
`)
    expect(out).toEqual([
      { path: '/repo', ref: 'main', isMain: true },
    ])
  })

  it('parses main + linked worktrees', () => {
    const out = parseWorktreeList(`worktree /repo
HEAD abc1234
branch refs/heads/main

worktree /repo/wt-feature
HEAD def5678
branch refs/heads/feature

worktree /repo/wt-bug
HEAD 1234567
branch refs/heads/bugfix
`)
    expect(out).toEqual([
      { path: '/repo', ref: 'main', isMain: true },
      { path: '/repo/wt-feature', ref: 'feature', isMain: false },
      { path: '/repo/wt-bug', ref: 'bugfix', isMain: false },
    ])
  })

  it('uses short SHA for detached HEAD worktrees', () => {
    const out = parseWorktreeList(`worktree /repo
HEAD abc1234
branch refs/heads/main

worktree /repo/wt-detached
HEAD 1234567abcdef
detached
`)
    expect(out).toEqual([
      { path: '/repo', ref: 'main', isMain: true },
      { path: '/repo/wt-detached', ref: '1234567', isMain: false },
    ])
  })

  it('falls back to (unknown) when detached HEAD has no SHA', () => {
    // Defensive — git always emits HEAD, but be safe.
    const out = parseWorktreeList(`worktree /weird
detached
`)
    expect(out[0]?.ref).toBe('(unknown)')
  })

  it('skips bare repo entries', () => {
    const out = parseWorktreeList(`worktree /repo.git
bare

worktree /repo/wt-feature
HEAD abc1234
branch refs/heads/feature
`)
    expect(out).toEqual([
      { path: '/repo/wt-feature', ref: 'feature', isMain: true },
    ])
  })

  it('preserves non-standard refs without stripping', () => {
    const out = parseWorktreeList(`worktree /repo
HEAD abc1234
branch refs/tags/v1
`)
    expect(out[0]?.ref).toBe('refs/tags/v1')
  })

  it('handles CRLF line endings (Windows git output)', () => {
    const out = parseWorktreeList(`worktree /repo\r\nHEAD abc1234\r\nbranch refs/heads/main\r\n`)
    expect(out).toEqual([
      { path: '/repo', ref: 'main', isMain: true },
    ])
  })

  it('returns empty for empty input', () => {
    expect(parseWorktreeList('')).toEqual([])
    expect(parseWorktreeList('\n\n\n')).toEqual([])
  })
})

describe('isInsideRepo', () => {
  it('true for path equal to repo root', () => {
    expect(isInsideRepo('/repo', '/repo')).toBe(true)
  })

  it('true for descendant paths', () => {
    expect(isInsideRepo('/repo/sub', '/repo')).toBe(true)
    expect(isInsideRepo('/repo/sub/deep', '/repo')).toBe(true)
  })

  it('false for sibling-with-shared-prefix (no false-positive on /foobar)', () => {
    expect(isInsideRepo('/repobar', '/repo')).toBe(false)
    expect(isInsideRepo('/repo-other', '/repo')).toBe(false)
  })

  it('false for paths outside repo root', () => {
    expect(isInsideRepo('/other', '/repo')).toBe(false)
    expect(isInsideRepo('/', '/repo')).toBe(false)
  })

  it('handles trailing-slash repo root', () => {
    expect(isInsideRepo('/repo/sub', '/repo/')).toBe(true)
    expect(isInsideRepo('/repo', '/repo/')).toBe(false) // exact match must include trailing slash too
  })
})
