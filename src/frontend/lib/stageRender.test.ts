import { describe, expect, it } from 'vitest'
import type {
  AgentSessionDTO,
  DesignDocChange,
  IssueStateType,
  LifecycleStageDTO,
  NormalizedIssue,
  NormalizedPullRequest,
  WorkstreamSummaryDTO,
} from '@shared/types.js'
import { indexBlockedBy, laggingMembers, renderStage, type StageContext } from './stageRender'

// Echoes the key back, so an assertion names the key rather than a translation
// that could change without the behaviour changing. Same trick, and the same
// reason, as describeScope.test.ts.
const t = ((k: string, params?: Record<string, string | number>) =>
  params ? `${k}:${Object.values(params).join(',')}` : k) as Parameters<typeof renderStage>[1]

function mk(
  id: string,
  opts: {
    state?: string
    type?: IssueStateType
    blocks?: string[]
    prs?: Partial<NormalizedPullRequest>[]
  } = {},
): NormalizedIssue {
  return {
    id,
    identifier: id,
    title: id,
    url: '',
    priority: 0,
    state: { name: opts.state ?? 'In Progress', type: opts.type ?? 'started' },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: (opts.blocks ?? []).map((target) => ({
      type: 'blocks' as const,
      targetIdentifier: target,
    })),
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    ...(opts.prs
      ? {
          pullRequests: opts.prs.map((p) => ({
            url: p.url ?? 'https://github.com/o/r/pull/1',
            number: p.number ?? 1,
            repo: p.repo ?? 'r',
            status: p.status ?? 'open',
            targetBranch: null,
            hasConflicts: p.hasConflicts ?? false,
            linkKind: p.linkKind ?? 'closes',
            mergedAt: null,
          })),
        }
      : {}),
  }
}

function stage(over: Partial<LifecycleStageDTO> = {}): LifecycleStageDTO {
  return {
    id: 1,
    key: 'impl',
    name: 'Implement',
    sortOrder: 0,
    states: [],
    nextCommand: null,
    shows: [],
    staleAfterDays: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function ws(over: Partial<WorkstreamSummaryDTO> = {}): WorkstreamSummaryDTO {
  return {
    id: 1,
    name: 'Feature',
    members: [],
    stage: 'impl',
    stageEnteredAt: 0,
    stageEvents: [],
    status: 'active',
    assignees: [],
    notes: {},
    links: [],
    ...over,
  }
}

function ctx(over: Partial<StageContext> = {}): StageContext {
  const members = over.members ?? []
  return {
    workstream: ws({ members: members.map((m) => m.identifier) }),
    stage: stage(),
    members,
    sessionsByIssue: new Map(),
    designdocs: [],
    blockedBy: new Map(),
    ...over,
  }
}

const texts = (items: ReturnType<typeof renderStage>) => items.map((i) => i.text)

describe('renderStage — dispatch', () => {
  it('draws nothing for a stage that asked for nothing', () => {
    expect(renderStage(ctx({ members: [mk('A-1')] }), t)).toEqual([])
  })

  it('draws tokens in the order the stage listed them', () => {
    const c = ctx({
      members: [mk('A-1')],
      stage: stage({ shows: ['note', 'issues'] }),
      workstream: ws({ members: ['A-1'], notes: { impl: 'a line' } }),
    })
    expect(renderStage(c, t).map((i) => i.token)).toEqual(['note', 'issues'])
  })

  it('ignores an unknown token instead of blanking the stage', () => {
    // The write path rejects these, so one arriving here means a hand-edited
    // row or a retired token — neither should take the whole graph down.
    const c = ctx({ members: [mk('A-1')], stage: stage({ shows: ['nonsense', 'issues'] }) })
    expect(renderStage(c, t)).toHaveLength(1)
  })
})

describe('issues', () => {
  const shows = stage({ shows: ['issues'], states: ['In Progress'] })

  it('flags a member whose Linear state is not one the stage expects', () => {
    const c = ctx({ members: [mk('A-1'), mk('A-2', { state: 'Done', type: 'completed' })], stage: shows })
    const items = renderStage(c, t)
    expect(items.map((i) => [i.text, i.tone, i.hints])).toEqual([
      ['A-1 · In Progress', 'ok', []],
      ['A-2 · Done', 'warn', ['stage.lagging']],
    ])
  })

  it('flags nothing when the stage expects any state', () => {
    // An empty `states` is how a stage Linear cannot see — "Discuss" — opts out
    // of the comparison rather than flagging every member it has.
    const c = ctx({ members: [mk('A-1', { state: 'Anything' })], stage: stage({ shows: ['issues'] }) })
    expect(renderStage(c, t)[0]?.hints).toEqual([])
    expect(laggingMembers(c)).toEqual([])
  })

  it('says so when a member is outside the synced range rather than shortening the list', () => {
    // Silently showing two of three is a stage lying about its own size.
    const c = ctx({
      members: [mk('A-1')],
      stage: stage({ shows: ['issues'] }),
      workstream: ws({ members: ['A-1', 'A-9'] }),
    })
    const items = renderStage(c, t)
    expect(texts(items)).toEqual(['A-1 · In Progress', 'A-9'])
    expect(items[1]).toMatchObject({ hints: ['stage.notCached'], tone: 'muted', issue: null })
  })

  it('compares state names case- and space-insensitively', () => {
    const c = ctx({
      members: [mk('A-1', { state: ' in progress ' })],
      stage: stage({ shows: ['issues'], states: ['In Progress'] }),
    })
    expect(renderStage(c, t)[0]?.tone).toBe('ok')
  })
})

describe('sessions', () => {
  const sess = (over: Partial<AgentSessionDTO>): AgentSessionDTO => ({
    sessionId: 's',
    identifier: 'A-1',
    branch: null,
    cwd: null,
    host: null,
    phase: null,
    status: 'active',
    lastSeen: 0,
    label: 'repo · branch',
    ...over,
  })

  const build = (status: AgentSessionDTO['status']) =>
    renderStage(
      ctx({
        members: [mk('A-1')],
        stage: stage({ shows: ['sessions'] }),
        sessionsByIssue: new Map([['A-1', [sess({ status })]]]),
      }),
      t,
    )

  it('warns only for blocked, because only blocked means nothing is running', () => {
    expect(build('blocked')[0]).toMatchObject({ tone: 'warn', hints: ['stage.needsYou'] })
    expect(build('waiting')[0]).toMatchObject({ tone: 'muted', hints: ['stage.yourMove'] })
    expect(build('active')[0]).toMatchObject({ tone: 'ok', hints: [] })
  })

  it('points a session at the issue it is on, not at a URL', () => {
    expect(build('active')[0]).toMatchObject({ issue: 'A-1', url: null })
  })
})

describe('pullRequests', () => {
  const shows = stage({ shows: ['pullRequests'] })

  it('counts one PR once even when it closes two members', () => {
    const pr = { url: 'https://github.com/o/r/pull/7', number: 7 }
    const c = ctx({ members: [mk('A-1', { prs: [pr] }), mk('A-2', { prs: [pr] })], stage: shows })
    expect(renderStage(c, t)).toHaveLength(1)
  })

  it('says a contributing PR does not close the issue', () => {
    // It is real work, so it must show — but it must not read as progress
    // towards finishing, because it is not.
    const c = ctx({ members: [mk('A-1', { prs: [{ linkKind: 'contributes' }] })], stage: shows })
    expect(renderStage(c, t)[0]?.hints).toEqual(['stage.contributes'])
  })

  it('keeps both qualifiers when both apply', () => {
    const c = ctx({
      members: [mk('A-1', { prs: [{ linkKind: 'contributes', hasConflicts: true }] })],
      stage: shows,
    })
    expect(renderStage(c, t)[0]?.hints).toEqual(['stage.contributes', 'stage.conflicts'])
  })

  it('warns on an abandoned PR as well as a conflicted one', () => {
    const tone = (status: string) =>
      renderStage(ctx({ members: [mk('A-1', { prs: [{ status }] })], stage: shows }), t)[0]?.tone
    expect(tone('merged')).toBe('ok')
    expect(tone('open')).toBe('muted')
    expect(tone('closed')).toBe('warn')
  })

  it('shows a hand-attached PR beside the projected ones, marked', () => {
    // The case this exists for: a PR whose body names no issue, so Linear never
    // linked it and nothing can project it.
    const c = ctx({
      members: [mk('A-1')],
      stage: shows,
      workstream: ws({
        members: ['A-1'],
        links: [{ stageKey: 'impl', kind: 'pr', value: 'https://x/pull/3', label: 'r#3' }],
      }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({
      token: 'pullRequests',
      text: 'r#3',
      manual: true,
      url: 'https://x/pull/3',
    })
  })

  it('ignores a link attached to a different stage', () => {
    const c = ctx({
      members: [mk('A-1')],
      stage: shows,
      workstream: ws({
        members: ['A-1'],
        links: [{ stageKey: 'ci', kind: 'pr', value: 'https://x/pull/3', label: null }],
      }),
    })
    expect(renderStage(c, t)).toEqual([])
  })
})

describe('designdocs', () => {
  const shows = stage({ shows: ['designdocs'] })
  const doc = (over: Partial<DesignDocChange> = {}): DesignDocChange => ({
    name: 'add-thing',
    issueIdentifiers: ['A-1'],
    status: 'active',
    totalTasks: 4,
    doneTasks: 1,
    progress: 0.25,
    filePath: 'openspec/changes/add-thing/proposal.md',
    ...over,
  })

  it('projects a spec linked to a member', () => {
    const c = ctx({ members: [mk('A-1')], stage: shows, designdocs: [doc()] })
    expect(renderStage(c, t)[0]).toMatchObject({ text: 'add-thing 1/4', tone: 'muted' })
  })

  it('ignores a spec linked to nobody in this workstream', () => {
    const c = ctx({ members: [mk('A-1')], stage: shows, designdocs: [doc({ issueIdentifiers: ['B-9'] })] })
    expect(renderStage(c, t)).toEqual([])
  })

  it.each([
    ['its name', 'add-thing'],
    ['its path', 'openspec/changes/add-thing/proposal.md'],
  ])('drops a hand-attached spec once the projected one arrives, matched by %s', (_l, value) => {
    // A person attaches whichever they had to hand. If only one form matched,
    // adding the Linear id to the spec would leave the manual copy sitting
    // beside the projected one forever — and the "manual" mark would then be
    // telling people to do something that does not work.
    const c = ctx({
      members: [mk('A-1')],
      stage: shows,
      designdocs: [doc()],
      workstream: ws({ members: ['A-1'], links: [{ stageKey: 'impl', kind: 'spec', value, label: null }] }),
    })
    expect(renderStage(c, t)).toHaveLength(1)
    expect(renderStage(c, t)[0]?.manual).toBe(false)
  })

  it('keeps a hand-attached spec that nothing projects', () => {
    const c = ctx({
      members: [mk('A-1')],
      stage: shows,
      workstream: ws({
        members: ['A-1'],
        links: [{ stageKey: 'impl', kind: 'spec', value: 'openspec/changes/other/proposal.md', label: null }],
      }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({ manual: true })
  })
})

describe('note', () => {
  const shows = stage({ shows: ['note'] })

  it('shows only the first line, because a stage box is not where a note is read', () => {
    const c = ctx({
      stage: shows,
      workstream: ws({ notes: { impl: '  first line\nsecond line\nthird  ' } }),
    })
    expect(texts(renderStage(c, t))).toEqual(['first line'])
  })

  it('does not mark an authored note as manual', () => {
    // `manual` means "attached to work around a missing upstream link". A note
    // has no upstream to be missing — it is written here on purpose.
    const c = ctx({ stage: shows, workstream: ws({ notes: { impl: 'hi' } }) })
    expect(renderStage(c, t)[0]?.manual).toBe(false)
  })

  it('ignores a blank note', () => {
    expect(renderStage(ctx({ stage: shows, workstream: ws({ notes: { impl: '   ' } }) }), t)).toEqual([])
  })

  it("reads another stage's note as absent", () => {
    expect(renderStage(ctx({ stage: shows, workstream: ws({ notes: { ci: 'hi' } }) }), t)).toEqual([])
  })

  it('marks a hand-attached url and carries it as a url, not an issue', () => {
    const c = ctx({
      stage: shows,
      workstream: ws({ links: [{ stageKey: 'impl', kind: 'url', value: 'https://x', label: null }] }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({ manual: true, url: 'https://x', issue: null })
  })
})

describe('blockers', () => {
  const shows = stage({ shows: ['blockers'] })

  it('finds a blocker that is NOT in the workstream', () => {
    // The whole point. `blocked_by` is dropped in normalize, so a member cannot
    // name what holds it up; and the blocker worth knowing about is usually the
    // one outside, which no other view of a workstream shows at all.
    const outsider = mk('B-9', { blocks: ['A-1'] })
    const c = ctx({
      members: [mk('A-1')],
      stage: shows,
      blockedBy: indexBlockedBy([outsider, mk('A-1')]),
    })
    expect(renderStage(c, t)[0]).toMatchObject({
      text: 'B-9',
      hints: ['stage.blocking:A-1'],
      tone: 'warn',
      issue: 'B-9',
    })
  })

  it.each([['completed' as const], ['canceled' as const]])(
    'ignores a %s blocker, because Linear leaves the relation behind',
    (type) => {
      const done = mk('B-9', { blocks: ['A-1'], type, state: 'Done' })
      const c = ctx({ members: [mk('A-1')], stage: shows, blockedBy: indexBlockedBy([done]) })
      expect(renderStage(c, t)).toEqual([])
    },
  )

  it('lists one blocker once per issue it blocks', () => {
    const b = mk('B-9', { blocks: ['A-1', 'A-2'] })
    const c = ctx({
      members: [mk('A-1'), mk('A-2')],
      stage: shows,
      blockedBy: indexBlockedBy([b]),
    })
    expect(renderStage(c, t).map((i) => i.hints[0])).toEqual([
      'stage.blocking:A-1',
      'stage.blocking:A-2',
    ])
  })
})

describe('indexBlockedBy', () => {
  it('inverts blocks edges', () => {
    const a = mk('A-1', { blocks: ['A-2'] })
    const map = indexBlockedBy([a, mk('A-2')])
    expect(map.get('A-2')?.map((i) => i.identifier)).toEqual(['A-1'])
    // Direction matters and is easy to invert: `blocks` means source blocks
    // target, so the blocker never appears under its own key.
    expect(map.get('A-1')).toBeUndefined()
  })

  it('ignores relation types that are not blocks', () => {
    const a = mk('A-1')
    a.relations = [{ type: 'related', targetIdentifier: 'A-2' }]
    expect(indexBlockedBy([a]).size).toBe(0)
  })
})
