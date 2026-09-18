import { describe, it, expect } from 'vitest'
import {
  HOOK_PAYLOAD_VERSION,
  SESSION_TTL_MS,
  indexSessionsByIssue,
  isLive,
  liveSessions,
  parseSessionReport,
  sessionRowToDTO,
  type AgentSessionRow,
} from './agentSessionStore.js'

const row = (over: Partial<AgentSessionRow> = {}): AgentSessionRow => ({
  session_id: 's1',
  identifier: 'ONE-393',
  branch: 'fix/one-393-x',
  cwd: '/repo',
  host: 'laptop',
  phase: null,
  status: 'active',
  last_seen: 1_000_000,
  payload_version: HOOK_PAYLOAD_VERSION,
  label: null,
  ...over,
})

describe('parseSessionReport', () => {
  it('accepts a full report', () => {
    expect(
      parseSessionReport({
        sessionId: 'abc',
        branch: 'fix/one-1-x',
        cwd: '/repo',
        host: 'laptop',
        phase: '/spectra-apply',
        status: 'idle',
        payloadVersion: 1,
      }),
    ).toEqual({
      sessionId: 'abc',
      branch: 'fix/one-1-x',
      cwd: '/repo',
      host: 'laptop',
      phase: '/spectra-apply',
      // An old plugin still reports 'idle'; it means the same as 'waiting'.
      status: 'waiting',
      label: null,
      payloadVersion: 1,
    })
  })

  it('accepts a report with nothing but a session id', () => {
    // A hook running outside a git repo has no branch, and a branch with no
    // issue id is normal. Rejecting those would drop exactly the sessions most
    // worth seeing — the ones somewhere unexpected.
    const r = parseSessionReport({ sessionId: 'abc' })
    expect(r?.sessionId).toBe('abc')
    expect(r?.branch).toBeNull()
    expect(r?.status).toBe('active')
  })

  it('defaults an unrecognised status to active rather than rejecting', () => {
    expect(parseSessionReport({ sessionId: 'a', status: 'weird' })?.status).toBe('active')
  })

  it('keeps blocked distinct from waiting', () => {
    // `blocked` means a permission prompt with nothing running behind it, and
    // it is the only status that should pull a person over. Folding it into
    // `waiting` — the turn merely ended — would lose exactly that.
    expect(parseSessionReport({ sessionId: 'a', status: 'blocked' })?.status).toBe('blocked')
    expect(parseSessionReport({ sessionId: 'a', status: 'waiting' })?.status).toBe('waiting')
  })

  it("still accepts an old plugin's 'idle'", () => {
    // The wire format cannot be renegotiated once installs exist in the wild.
    expect(parseSessionReport({ sessionId: 'a', status: 'idle' })?.status).toBe('waiting')
  })

  it('records an unversioned report as version 0, not as the current version', () => {
    // Claiming it speaks the current format would hide a genuinely old
    // reporter, which is the one thing the version field exists to reveal.
    expect(parseSessionReport({ sessionId: 'a' })?.payloadVersion).toBe(0)
    expect(parseSessionReport({ sessionId: 'a', payloadVersion: 1.5 })?.payloadVersion).toBe(0)
  })

  it.each([
    ['a missing session id', {}],
    ['a blank session id', { sessionId: '   ' }],
    ['a non-string session id', { sessionId: 7 }],
    ['a non-object', 'nope'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(parseSessionReport(input)).toBeNull()
  })

  it('drops over-long fields without failing the whole report', () => {
    const r = parseSessionReport({ sessionId: 'a', branch: 'x'.repeat(5000) })
    expect(r).not.toBeNull()
    expect(r?.branch).toBeNull()
  })
})

describe('liveness', () => {
  const now = 2_000_000

  it('counts a recent heartbeat as live', () => {
    expect(isLive(row({ last_seen: now - 1000 }), now)).toBe(true)
  })

  it('presumes a silent session dead once the TTL passes', () => {
    // A session killed with SIGKILL never sends SessionEnd. Without this, its
    // card would claim work is in progress indefinitely.
    expect(isLive(row({ last_seen: now - SESSION_TTL_MS - 1 }), now)).toBe(false)
  })

  it('treats the TTL boundary as dead, so the rule has one edge', () => {
    expect(isLive(row({ last_seen: now - SESSION_TTL_MS }), now)).toBe(false)
  })

  it('filters and orders by most recent heartbeat', () => {
    const out = liveSessions(
      [
        row({ session_id: 'old', last_seen: now - SESSION_TTL_MS - 1 }),
        row({ session_id: 'stale', last_seen: now - 60_000 }),
        row({ session_id: 'fresh', last_seen: now - 1_000 }),
      ],
      now,
    )
    expect(out.map((s) => s.sessionId)).toEqual(['fresh', 'stale'])
  })
})

describe('sessionRowToDTO', () => {
  it('maps a row', () => {
    expect(sessionRowToDTO(row({ phase: '/spectra-apply' }))).toEqual({
      sessionId: 's1',
      identifier: 'ONE-393',
      branch: 'fix/one-393-x',
      cwd: '/repo',
      host: 'laptop',
      phase: '/spectra-apply',
      status: 'active',
      lastSeen: 1_000_000,
      label: 'repo · fix/one-393-x',
    })
  })

  it('normalises an unexpected stored status to active', () => {
    expect(sessionRowToDTO(row({ status: 'garbage' })).status).toBe('active')
  })

  it('derives a label a person can recognise, and lets the hook override it', () => {
    // A UUID identifies nothing to a reader; the repo and branch are how
    // someone actually holds "which window is this" in their head.
    expect(sessionRowToDTO(row()).label).toBe('repo · fix/one-393-x')
    expect(sessionRowToDTO(row({ label: 'my terminal' })).label).toBe('my terminal')
  })

  it('falls back sensibly when there is no branch or no directory', () => {
    expect(sessionRowToDTO(row({ branch: null })).label).toBe('repo')
    expect(sessionRowToDTO(row({ cwd: null })).label).toBe('fix/one-393-x')
    expect(sessionRowToDTO(row({ cwd: null, branch: null })).label).toBe('session')
  })
})

describe('indexSessionsByIssue', () => {
  const dto = (sessionId: string, identifier: string | null) =>
    sessionRowToDTO(row({ session_id: sessionId, identifier }))

  it('groups by issue and keeps several sessions on one issue', () => {
    const map = indexSessionsByIssue([dto('a', 'ONE-1'), dto('b', 'ONE-1'), dto('c', 'ONE-2')])
    expect(map.get('ONE-1')?.map((s) => s.sessionId)).toEqual(['a', 'b'])
    expect(map.get('ONE-2')).toHaveLength(1)
  })

  it('drops sessions with no issue', () => {
    // They are real sessions, but no card can display them — a branch with no
    // ticket is ordinary, not an error.
    expect(indexSessionsByIssue([dto('a', null)]).size).toBe(0)
  })
})
