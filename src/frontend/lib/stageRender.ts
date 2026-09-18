// What a pipeline stage draws, derived from what it declared in `shows`.
//
// One function per token, all pure, because vitest's include glob is
// `src/**/*.{test,spec}.ts` — `.tsx` is not in it, so no JSX in this repo is
// testable. Every decision therefore lives here and the node component only
// renders what it gets back.
//
// THE KEY IDEA: `shows` is a list of PROJECTIONS, not fields. `pullRequests`
// means "go and read the members' PRs", never "this stage stores PRs" — so
// nothing here reads per-stage storage except `note` and the hand-attached
// links. Changing what a stage displays means changing something upstream, in
// Linear or in the spec, not on the stage.
//
// Prose goes through `t`, data does not: an identifier, a Linear state name and
// `repo#12` are facts and stay as they are, while every qualifier around them
// is a DictKey resolved by the caller's translator. That split is what keeps
// `en.ts` / `zh-TW.ts` the only place wording lives — and the tests pass an
// identity `t`, so they assert which key was chosen rather than its wording.

import type {
  AgentSessionDTO,
  DesignDocChange,
  LifecycleStageDTO,
  NormalizedIssue,
  WorkstreamSummaryDTO,
} from '@shared/types.js'
import type { ShowToken } from '@shared/showTokens.js'
import type { Translate } from '../i18n'

/** One row drawn inside a stage. */
export interface StageItem {
  /** Which token produced it, so the node can pick an icon. */
  token: ShowToken
  /** The fact itself — an identifier, `repo#12`, a spec name, a note line.
   *  Never translated, because none of it is prose. */
  text: string
  /** Translated qualifiers. Several can apply at once: a PR can both have
   *  conflicts and only contribute, and dropping either loses something the
   *  reader needs. */
  hints: string[]
  tone: 'ok' | 'warn' | 'muted'
  /** True when a person attached this because the automatic link was missing.
   *  Drawn with a visible mark: if a hand attachment looked as good as a
   *  projected one it would quietly become the default, and the upstream
   *  convention that makes projection work would stop being maintained. */
  manual: boolean
  /** An issue to focus in the graph, or null. Kept apart from `url` because
   *  "centre that card" and "open a tab" are different actions, and a single
   *  field would make the component guess which one it was holding. */
  issue: string | null
  /** Something to open externally, or null. */
  url: string | null
}

export interface StageContext {
  workstream: WorkstreamSummaryDTO
  stage: LifecycleStageDTO
  /** Members found in the issue cache. Fewer than `workstream.members` when
   *  some fall outside the sync window — which `renderIssues` says out loud
   *  rather than quietly shortening the list. */
  members: NormalizedIssue[]
  sessionsByIssue: Map<string, AgentSessionDTO[]>
  designdocs: DesignDocChange[]
  /** Who blocks whom, across the WHOLE graph — see `indexBlockedBy`. */
  blockedBy: Map<string, NormalizedIssue[]>
}

/**
 * Invert `blocks` edges once for the whole graph.
 *
 * Needed because `normalize.ts` drops Linear's `blocked_by` side and keeps only
 * `blocks` (source = blocker), so "what is holding this issue up" cannot be
 * read off the issue itself. Built once per render rather than scanned per
 * stage: a workstream has a handful of members but the graph has thousands of
 * issues, and the useful blocker is usually one of the ones OUTSIDE the
 * workstream — no other view of a workstream shows those at all.
 */
export function indexBlockedBy(issues: NormalizedIssue[]): Map<string, NormalizedIssue[]> {
  const map = new Map<string, NormalizedIssue[]>()
  for (const i of issues) {
    for (const r of i.relations) {
      if (r.type !== 'blocks') continue
      const list = map.get(r.targetIdentifier)
      if (list) list.push(i)
      else map.set(r.targetIdentifier, [i])
    }
  }
  return map
}

/** Members whose Linear state is not one this stage expects. */
export function laggingMembers(ctx: StageContext): NormalizedIssue[] {
  // An empty `states` opts the stage out of the comparison entirely, which is
  // how a stage Linear cannot see — "Discuss" — avoids flagging everything.
  if (ctx.stage.states.length === 0) return []
  const want = new Set(ctx.stage.states.map((s) => s.trim().toLowerCase()))
  return ctx.members.filter((m) => !want.has(m.state.name.trim().toLowerCase()))
}

function item(over: Partial<StageItem> & Pick<StageItem, 'token' | 'text'>): StageItem {
  return { hints: [], tone: 'muted', manual: false, issue: null, url: null, ...over }
}

function renderIssues(ctx: StageContext, t: Translate): StageItem[] {
  const lagging = new Set(laggingMembers(ctx).map((m) => m.identifier))
  const out = ctx.members.map((m) =>
    item({
      token: 'issues',
      text: `${m.identifier} · ${m.state.name}`,
      // The useful signal is which member is holding the workstream where it
      // is; restating the stage's own name for the rest would say nothing.
      hints: lagging.has(m.identifier) ? [t('stage.lagging')] : [],
      tone: lagging.has(m.identifier) ? 'warn' : 'ok',
      issue: m.identifier,
    }),
  )

  // A member outside the sync window has no card and no state, and silently
  // showing two of three would make the stage lie about its own size.
  const resolved = new Set(ctx.members.map((m) => m.identifier))
  for (const id of ctx.workstream.members) {
    if (resolved.has(id)) continue
    out.push({
      token: 'issues',
      text: id,
      hints: [t('stage.notCached')],
      tone: 'muted',
      manual: false,
      issue: null,
      url: null,
    })
  }
  return out
}

function renderSessions(ctx: StageContext, t: Translate): StageItem[] {
  const out: StageItem[] = []
  for (const m of ctx.members) {
    for (const s of ctx.sessionsByIssue.get(m.identifier) ?? []) {
      // Only `blocked` warns. `waiting` means the turn ended and it is your
      // move whenever you like; `blocked` means nothing is running at all until
      // someone answers a prompt. Folding them together loses the only status
      // worth walking over for.
      const hints =
        s.status === 'blocked'
          ? [t('stage.needsYou')]
          : s.status === 'waiting'
            ? [t('stage.yourMove')]
            : []
      out.push(
        item({
          token: 'sessions',
          text: s.label,
          hints,
          tone: s.status === 'blocked' ? 'warn' : s.status === 'active' ? 'ok' : 'muted',
          issue: m.identifier,
        }),
      )
    }
  }
  return out
}

function renderPullRequests(ctx: StageContext, t: Translate): StageItem[] {
  const seen = new Set<string>()
  const out: StageItem[] = []
  for (const m of ctx.members) {
    for (const pr of m.pullRequests ?? []) {
      // One PR can close several issues in a workstream; it is still one PR.
      if (seen.has(pr.url)) continue
      seen.add(pr.url)
      const status = (pr.status ?? '').toLowerCase()
      const hints: string[] = []
      // 'contributes' is said rather than hidden: it is a real PR doing real
      // work, it simply does not finish the issue, so it must not read as
      // progress towards closing it.
      if (pr.linkKind === 'contributes') hints.push(t('stage.contributes'))
      if (pr.hasConflicts) hints.push(t('stage.conflicts'))
      out.push(
        item({
          token: 'pullRequests',
          text: `${pr.repo ?? 'pr'}${pr.number === null ? '' : `#${pr.number}`} ${pr.status ?? '?'}`.trim(),
          hints,
          // A closed-unmerged PR is abandoned work still attached to the issue,
          // which is worth noticing rather than greying out.
          tone: pr.hasConflicts || status === 'closed' ? 'warn' : status === 'merged' ? 'ok' : 'muted',
          issue: m.identifier,
          url: pr.url,
        }),
      )
    }
  }
  // Hand-attached PRs sit with the projected ones, marked — a PR whose body
  // names no issue is exactly the case this exists for.
  for (const l of ctx.workstream.links) {
    if (l.stageKey !== ctx.stage.key || l.kind !== 'pr') continue
    if (seen.has(l.value)) continue
    seen.add(l.value)
    out.push(item({ token: 'pullRequests', text: l.label ?? l.value, manual: true, url: l.value }))
  }
  return out
}

function renderDesignDocs(ctx: StageContext, _t: Translate): StageItem[] {
  const ids = new Set(ctx.members.map((m) => m.identifier))
  const out: StageItem[] = []
  // Both the name and the path, because a hand attachment stores whichever the
  // person had to hand. Without matching on both, adding the Linear id to the
  // spec would leave the manual copy sitting next to the projected one forever
  // — and then the mark would be telling people to do something that does not
  // work.
  const projected = new Set<string>()
  for (const d of ctx.designdocs) {
    if (!d.issueIdentifiers.some((id) => ids.has(id))) continue
    projected.add(d.name)
    projected.add(d.filePath)
    out.push(
      item({
        token: 'designdocs',
        text: `${d.name} ${d.doneTasks}/${d.totalTasks}`,
        tone: d.totalTasks > 0 && d.doneTasks >= d.totalTasks ? 'ok' : 'muted',
      }),
    )
  }
  for (const l of ctx.workstream.links) {
    if (l.stageKey !== ctx.stage.key || l.kind !== 'spec') continue
    if (projected.has(l.value)) continue
    out.push(item({ token: 'designdocs', text: l.label ?? l.value, manual: true }))
  }
  return out
}

function renderNote(ctx: StageContext, _t: Translate): StageItem[] {
  const out: StageItem[] = []
  const body = ctx.workstream.notes[ctx.stage.key]
  if (body && body.trim().length > 0) {
    // First line only. A note may run to paragraphs and a stage box is not
    // where anyone reads those; the panel shows the whole thing.
    const first = body.trim().split('\n')[0] ?? ''
    // Not `manual` — a note is authored, not a workaround for a broken link.
    out.push(item({ token: 'note', text: first }))
  }
  for (const l of ctx.workstream.links) {
    if (l.stageKey !== ctx.stage.key || l.kind !== 'url') continue
    out.push(item({ token: 'note', text: l.label ?? l.value, manual: true, url: l.value }))
  }
  return out
}

function renderBlockers(ctx: StageContext, t: Translate): StageItem[] {
  const out: StageItem[] = []
  const seen = new Set<string>()
  for (const m of ctx.members) {
    for (const b of ctx.blockedBy.get(m.identifier) ?? []) {
      // A finished blocker blocks nothing. Linear leaves the relation in place
      // after the work is done, so without this every stage would accumulate
      // blockers that stopped mattering months ago.
      if (b.state.type === 'completed' || b.state.type === 'canceled') continue
      const key = `${b.identifier}→${m.identifier}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(
        item({
          token: 'blockers',
          text: b.identifier,
          hints: [t('stage.blocking', { target: m.identifier })],
          tone: 'warn',
          issue: b.identifier,
        }),
      )
    }
  }
  return out
}

const RENDERERS: Record<ShowToken, (ctx: StageContext, t: Translate) => StageItem[]> = {
  issues: renderIssues,
  sessions: renderSessions,
  pullRequests: renderPullRequests,
  designdocs: renderDesignDocs,
  note: renderNote,
  blockers: renderBlockers,
}

/**
 * Everything one stage of one workstream draws, in the order the stage asked
 * for its tokens.
 *
 * An unknown token yields nothing rather than throwing. The write path rejects
 * them, so one arriving here means a row was hand-edited or a token was
 * retired — neither of which should blank the whole graph.
 */
export function renderStage(ctx: StageContext, t: Translate): StageItem[] {
  const out: StageItem[] = []
  for (const token of ctx.stage.shows) {
    const fn = RENDERERS[token as ShowToken]
    if (fn) out.push(...fn(ctx, t))
  }
  return out
}
