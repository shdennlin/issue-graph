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
import { indexBlockedBy, renderStage, stageForIssue, type StageContext } from './stageRender'

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
    fields: [],
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
    note: null,
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
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
    pipeline: [over.stage ?? stage()],
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
      stage: stage({ fields: ['note', 'issue'] }),
      workstream: ws({ members: ['A-1'], notes: { impl: 'a line' } }),
    })
    expect(renderStage(c, t).map((i) => i.token)).toEqual(['note', 'issue'])
  })

  it('ignores an unknown token instead of blanking the stage', () => {
    // The write path rejects these, so one arriving here means a hand-edited
    // row or a retired token — neither should take the whole graph down.
    const c = ctx({ members: [mk('A-1')], stage: stage({ fields: ['nonsense', 'issue'] }) })
    expect(renderStage(c, t)).toHaveLength(1)
  })
})

describe('issues — each member drawn once, where its state puts it', () => {
  const discuss = stage({ key: 'discuss', fields: ['issue'], states: ['Todo'], sortOrder: 0 })
  const impl = stage({ key: 'impl', fields: ['issue'], states: ['In Progress'], sortOrder: 1 })
  const pipeline = [discuss, impl]

  const on = (st: LifecycleStageDTO, members: NormalizedIssue[]) =>
    renderStage(
      ctx({
        members,
        stage: st,
        pipeline,
        workstream: ws({ members: members.map((m) => m.identifier), stage: 'impl' }),
      }),
      t,
    )

  it('puts each member on the stage its Linear state maps to, and nowhere else', () => {
    // Drawing every member on every stage repeated one fact seven times and
    // marked six of them "not in this stage yet" — noise wearing the costume
    // of a warning.
    const members = [mk('A-1', { state: 'Todo' }), mk('A-2', { state: 'In Progress' })]
    expect(texts(on(discuss, members))).toEqual(['A-1 · Todo'])
    expect(texts(on(impl, members))).toEqual(['A-2 · In Progress'])
  })

  it('sends a member no stage claims to the current stage, and says why', () => {
    // An unmapped state is a gap in the pipeline config. The issue still has to
    // be somewhere visible, and somebody should widen a stage.
    const members = [mk('A-1', { state: 'Blocked On Legal' })]
    expect(on(discuss, members)).toEqual([])
    const here = on(impl, members)
    expect(here[0]).toMatchObject({ text: 'A-1 · Blocked On Legal', tone: 'warn' })
    expect(here[0]?.hints).toEqual(['stage.unmappedState'])
  })

  it('lists an uncached member on the current stage rather than dropping it', () => {
    // No state means no stage can claim it, and silently showing two of three
    // makes the workstream lie about its own size.
    const c = ctx({
      members: [mk('A-1', { state: 'In Progress' })],
      stage: impl,
      pipeline,
      workstream: ws({ members: ['A-1', 'GONE-9'], stage: 'impl' }),
    })
    const items = renderStage(c, t)
    expect(texts(items)).toEqual(['A-1 · In Progress', 'GONE-9'])
    expect(items[1]?.hints).toEqual(['stage.notCached'])
  })

  it('does not repeat an uncached member on every stage', () => {
    const c = ctx({
      members: [],
      stage: discuss,
      pipeline,
      workstream: ws({ members: ['GONE-9'], stage: 'impl' }),
    })
    expect(renderStage(c, t)).toEqual([])
  })
})

describe('stageForIssue', () => {
  const a = stage({ key: 'a', states: ['Todo'], sortOrder: 0 })
  const b = stage({ key: 'b', states: ['In Progress'], sortOrder: 1 })

  it('matches case- and space-insensitively', () => {
    expect(stageForIssue(mk('X', { state: '  todo ' }), [a, b])?.key).toBe('a')
  })

  it('gives an unclaimed state no stage at all', () => {
    expect(stageForIssue(mk('X', { state: 'Paused' }), [a, b])).toBeNull()
  })

  it('takes the FIRST stage when two claim the same state', () => {
    // A nine-step pipeline over eight Linear states does this constantly —
    // ADR-0002 is about exactly that. Drawing the issue twice would be worse
    // than picking deterministically.
    const dup = stage({ key: 'b2', states: ['Todo'], sortOrder: 2 })
    expect(stageForIssue(mk('X', { state: 'Todo' }), [a, b, dup])?.key).toBe('a')
  })

  it('never matches a stage that expects any state', () => {
    // Empty `states` opts out of the comparison; it must not become a magnet
    // that swallows every issue in the workstream.
    expect(stageForIssue(mk('X', { state: 'Todo' }), [stage({ key: 'any', states: [] })])).toBeNull()
  })
})

describe('session', () => {
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
        stage: stage({ fields: ['session'] }),
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

describe('pr', () => {
  const shows = stage({ fields: ['pr'] })

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

  it('says "contributes" but shows conflicts as a glyph, not a word', () => {
    // A PR's STATE is an icon and a colour, the way GitHub and Linear both do
    // it. `contributes` is not a state — it is a real PR that does not finish
    // the issue — so that one stays a word.
    const c = ctx({
      members: [mk('A-1', { prs: [{ linkKind: 'contributes', hasConflicts: true }] })],
      stage: shows,
    })
    const pr = renderStage(c, t)[0]
    expect(pr?.hints).toEqual(['stage.contributes'])
    expect(pr?.icon).toBe('pr-conflict')
  })

  it('leads with the state glyph and drops the status word from the text', () => {
    const iconFor = (status: string) =>
      renderStage(ctx({ members: [mk('A-1', { prs: [{ status }] })], stage: shows }), t)[0]
    expect(iconFor('merged')).toMatchObject({ text: 'r#1', icon: 'pr-merged' })
    expect(iconFor('open')).toMatchObject({ icon: 'pr-open' })
    expect(iconFor('closed')).toMatchObject({ icon: 'pr-closed' })
    expect(iconFor('draft')).toMatchObject({ icon: 'pr-draft' })
  })

  it('keeps the status and target branch in the title, where there is room', () => {
    const c = ctx({
      members: [mk('A-1', { prs: [{ status: 'merged' }] })],
      stage: shows,
    })
    expect(renderStage(c, t)[0]?.title).toContain('merged')
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
      token: 'pr',
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

describe('spec', () => {
  const shows = stage({ fields: ['spec'] })
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
  const shows = stage({ fields: ['note'] })

  it('renders the note whole, over as many rows as it needs', () => {
    // An earlier cut showed only the first line, truncated — almost useless,
    // because a note is prose and the reason never fits on line one. The fix
    // was to give it room, not to take it away.
    const c = ctx({
      stage: shows,
      workstream: ws({ notes: { impl: '  first line\nsecond line\nthird  ' } }),
    })
    const items = renderStage(c, t)
    expect(items[0]?.text).toBe('first line\nsecond line\nthird')
    expect(items[0]?.rows).toBe(3)
    expect(items[0]?.manual).toBe(false)
  })

  it('counts a long single line as several rows so the stage reserves room', () => {
    // Nothing measures a stage node after the fact, so an undercount is
    // clipped text that never corrects itself.
    const long = 'x'.repeat(100)
    const c = ctx({ stage: shows, workstream: ws({ notes: { impl: long } }) })
    expect(renderStage(c, t)[0]?.rows).toBe(3)
  })

  it('caps the rows a note may claim', () => {
    const c = ctx({ stage: shows, workstream: ws({ notes: { impl: 'y'.repeat(4000) } }) })
    expect(renderStage(c, t)[0]?.rows).toBe(4)
  })

  it('marks a hand-attached url and carries it as a url, not an issue', () => {
    const c = ctx({
      stage: shows,
      workstream: ws({ links: [{ stageKey: 'impl', kind: 'url', value: 'https://x', label: null }] }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({ manual: true, url: 'https://x', issue: null })
  })
})

describe('blocker', () => {
  const shows = stage({ fields: ['blocker'] })

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

describe('ci and hand-attached issues', () => {
  it('renders a hand-attached CI run, and nothing else, because nothing projects one', () => {
    // Linear's schema has PullRequestCheck but no query path reaches a
    // PullRequest from an issue, and there is no GitHub source. An empty box
    // would look broken; a marked manual row is honest.
    const c = ctx({
      stage: stage({ fields: ['ci'] }),
      workstream: ws({
        links: [{ stageKey: 'impl', kind: 'ci', value: 'https://ci/run/9', label: 'build #9' }],
      }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({
      token: 'ci',
      text: 'build #9',
      manual: true,
      url: 'https://ci/run/9',
    })
  })

  it('shows an attached issue that is not a member of the workstream', () => {
    // The one manual kind that is NOT a broken projection: nothing upstream
    // could ever have said "this issue belongs to THIS stage".
    const c = ctx({
      members: [mk('A-1')],
      stage: stage({ fields: ['issue'] }),
      workstream: ws({
        members: ['A-1'],
        links: [{ stageKey: 'impl', kind: 'issue', value: 'OTHER-9', label: null }],
      }),
    })
    // Projected members first, hand attachments after: the members are what
    // the stage is about, and an attachment is the exception appended to them.
    const items = renderStage(c, t)
    expect(items[0]).toMatchObject({ text: 'A-1 · In Progress', manual: false })
    expect(items[1]).toMatchObject({ text: 'OTHER-9', manual: true, issue: 'OTHER-9' })
  })

  it('uses the cached state when an attached issue happens to be a member', () => {
    const c = ctx({
      members: [mk('A-1', { state: 'Done', type: 'completed' })],
      stage: stage({ fields: ['issue'] }),
      workstream: ws({
        members: ['A-1'],
        links: [{ stageKey: 'impl', kind: 'issue', value: 'A-1', label: null }],
      }),
    })
    // The attachment repeats a member, so it renders with the cached state
    // rather than as a bare identifier.
    expect(renderStage(c, t)[1]?.text).toBe('A-1 · Done')
  })
})

describe('hand attachments always render', () => {
  const link = (kind: string, value = 'https://x', label: string | null = null) => ({
    stageKey: 'impl',
    kind,
    value,
    label,
  })

  it('shows a url even on a stage that shows nothing at all', () => {
    // The trap this replaces: a Figma link attached to a stage whose `shows`
    // did not include `note` vanished with no trace. `shows` governs
    // PROJECTIONS; an attachment is already here, put on THIS stage on
    // purpose, usually because no projection could find it.
    const c = ctx({
      stage: stage({ fields: [] }),
      workstream: ws({ links: [link('url', 'https://figma/abc', 'Figma')] }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({ text: 'Figma', manual: true, url: 'https://figma/abc' })
  })

  it('renders an attachment inside its own box when that box is on', () => {
    const c = ctx({
      stage: stage({ fields: ['pr'] }),
      workstream: ws({ links: [link('pr', 'https://gh/pull/3', 'r#3')] }),
    })
    const items = renderStage(c, t)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ token: 'pr', text: 'r#3' })
  })

  it('renders it once, not twice, when its box is on', () => {
    // The fallback must not duplicate what a token already drew.
    const c = ctx({
      stage: stage({ fields: ['spec'] }),
      workstream: ws({ links: [link('spec', 'openspec/x/proposal.md', 'x')] }),
    })
    expect(renderStage(c, t)).toHaveLength(1)
  })

  it('falls back when the box for that kind is off', () => {
    const c = ctx({
      stage: stage({ fields: ['issue'] }),
      workstream: ws({ links: [link('pr', 'https://gh/pull/3', 'r#3')] }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({ text: 'r#3', manual: true })
  })

  it('keeps an attached issue clickable as an issue, not as a link', () => {
    const c = ctx({
      stage: stage({ fields: [] }),
      workstream: ws({ links: [link('issue', 'OTHER-9')] }),
    })
    expect(renderStage(c, t)[0]).toMatchObject({ text: 'OTHER-9', issue: 'OTHER-9', url: null })
  })
})
