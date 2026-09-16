import { describe, it, expect } from 'vitest'
import { allIssuesFromBranch, issueFromBranch, teamKeysFrom } from './branchIssue.js'

const ONE = { teamKeys: ['ONE'] }

describe('issueFromBranch', () => {
  it('resolves the lowercase form real branches actually use', () => {
    // This is the shape Linear's own "copy branch name" produces, and every
    // real branch in the repos this runs against is lowercase. The existing
    // uppercase-only ISSUE_ID_RE matches none of them, which is why it is not
    // reused here.
    expect(issueFromBranch('fix/one-393-task-failed-status', ONE)).toBe('ONE-393')
    expect(issueFromBranch('feat/ONE-393-thing', ONE)).toBe('ONE-393')
    expect(issueFromBranch('one-393', ONE)).toBe('ONE-393')
  })

  it.each([
    ['a model name that looks like an id', 'feat/gemma-4-mtp'],
    ['another one', 'feat/nemotron-35-lightning-eval'],
  ])('does not resolve %s', (_label, branch) => {
    // Both satisfy <letters>-<digits>. Only the team-key list separates them
    // from a real id, and a wrong attribution is worse than none: it would
    // park a live session on an unrelated issue.
    expect(issueFromBranch(branch, ONE)).toBeNull()
  })

  it('takes the first KNOWN candidate, not the first candidate', () => {
    // Giving up at the first <letters>-<digits> would lose a real id sitting
    // behind a model name.
    expect(issueFromBranch('feat/gemma-4-one-393-fix', ONE)).toBe('ONE-393')
  })

  it('returns only the first id on a multi-issue branch', () => {
    // `372` has no letter prefix, so nothing distinguishes it from a version
    // number. Linear's own matcher behaves the same way; the remaining ids are
    // the PR description's job.
    expect(issueFromBranch('fix/one-371-372-374-l1-tool-calls', ONE)).toBe('ONE-371')
    expect(issueFromBranch('fix/one-385-386-l2-execution-bounds', ONE)).toBe('ONE-385')
  })

  it.each([
    ['no id at all', 'feat/skill-system'],
    ['a word that merely starts with the key', 'fix/one-bad-manifest-should-not-die'],
    ['a prefix with no number', 'feat/one-'],
    ['an empty branch', ''],
  ])('returns null for %s', (_label, branch) => {
    // "No issue" is a normal outcome — plenty of real work has no ticket.
    expect(issueFromBranch(branch, ONE)).toBeNull()
  })

  it('resolves nothing without a team-key list', () => {
    // Refusing to guess is the whole safety property. An empty list must not
    // fall back to "any <letters>-<digits> will do".
    expect(issueFromBranch('fix/one-393-x', { teamKeys: [] })).toBeNull()
    expect(issueFromBranch('fix/gemma-4-x', { teamKeys: [] })).toBeNull()
  })

  it('matches team keys case-insensitively', () => {
    expect(issueFromBranch('fix/one-393-x', { teamKeys: ['one'] })).toBe('ONE-393')
  })

  it('handles a missing branch', () => {
    expect(issueFromBranch(null, ONE)).toBeNull()
    expect(issueFromBranch(undefined, ONE)).toBeNull()
  })

  it('requires a two-character prefix, as Linear does', () => {
    expect(issueFromBranch('fix/a-393-x', { teamKeys: ['A'] })).toBeNull()
  })

  it('does not match an id glued to surrounding alphanumerics', () => {
    expect(issueFromBranch('fix/xone-393', ONE)).toBeNull()
    expect(issueFromBranch('fix/one-393x', ONE)).toBeNull()
  })
})

describe('allIssuesFromBranch', () => {
  it('returns every known-team candidate, deduped, in order', () => {
    expect(allIssuesFromBranch('fix/one-393-and-one-401-and-one-393', ONE)).toEqual([
      'ONE-393',
      'ONE-401',
    ])
  })

  it('still cannot see the bare numbers on a multi-issue branch', () => {
    // Documents the known limit rather than pretending it is solved.
    expect(allIssuesFromBranch('fix/one-371-372-374-l1', ONE)).toEqual(['ONE-371'])
  })

  it('skips unknown prefixes and copes with no keys', () => {
    expect(allIssuesFromBranch('feat/gemma-4-one-1', ONE)).toEqual(['ONE-1'])
    expect(allIssuesFromBranch('fix/one-1', { teamKeys: [] })).toEqual([])
  })
})

describe('teamKeysFrom', () => {
  it('collects distinct uppercase keys and ignores issues without a team', () => {
    expect(
      teamKeysFrom([
        { team: { key: 'ONE' } },
        { team: { key: 'one' } },
        { team: null },
        {},
        { team: { key: 'VDKR' } },
      ]).sort(),
    ).toEqual(['ONE', 'VDKR'])
  })

  it('returns an empty list for no issues, which resolves nothing downstream', () => {
    expect(teamKeysFrom([])).toEqual([])
  })
})
