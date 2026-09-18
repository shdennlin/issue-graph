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
  /** How many rows this item occupies. Almost always 1; a note wraps. The
   *  view sums these to size the stage, because nothing measures a stage node
   *  after the fact — see the height comment in views/workstream.ts. */
  rows: number
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
  /** The whole pipeline, in order. Needed because which stage an issue is
   *  DRAWN on is a property of the pipeline, not of this stage alone: the
   *  answer is "the first stage whose `states` claims it", which this stage
   *  cannot work out by looking only at itself. */
  pipeline: LifecycleStageDTO[]
}

/**
 * Which stage an issue is drawn on: the first whose `states` names its Linear
 * state, or null when no stage claims it.
 *
 * DERIVED, never stored — an issue's position in the pipeline is already
 * recorded, by Linear, as its state. Storing a second copy would be two
 * writers on one fact, which is the `activeOnly` trap at a larger scale. What
 * IS stored is the workstream's own stage, because nothing else records where
 * a FEATURE has got to; the two disagreeing is the evidence signal, not a bug.
 *
 * `states` is matched case- and space-insensitively, like everywhere else. The
 * FIRST match wins so that two stages listing the same state (a nine-step
 * pipeline over eight Linear states does this constantly — see ADR-0002) puts
 * the issue in the earlier one deterministically rather than drawing it twice.
 */
export function stageForIssue(
  issue: NormalizedIssue,
  pipeline: LifecycleStageDTO[],
): LifecycleStageDTO | null {
  const name = issue.state.name.trim().toLowerCase()
  return (
    pipeline.find((s) => s.states.some((v) => v.trim().toLowerCase() === name)) ?? null
  )
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

function item(over: Partial<StageItem> & Pick<StageItem, 'token' | 'text'>): StageItem {
  return { hints: [], tone: 'muted', manual: false, rows: 1, issue: null, url: null, ...over }
}

/**
 * Rows a wrapped note needs, capped.
 *
 * Approximate on purpose: the exact count depends on the font, and
 * over-reserving a row costs a little whitespace while under-reserving clips
 * the text with nothing to correct it.
 *
 * The cap differs by where the note is drawn, which is why it is a parameter.
 * Inside a STAGE a note is one item among several and must not crowd out the
 * issues, so four rows and the rest is read in the panel. On the workstream's
 * own CARD holding the note is the entire job, so it may run much longer
 * before the card starts scrolling.
 */
const NOTE_COLS = 38
export function noteRows(body: string, maxRows = 4): number {
  const lines = body.split('\n')
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / NOTE_COLS)), 0)
  return Math.min(maxRows, Math.max(1, rows))
}

function renderIssues(ctx: StageContext, t: Translate): StageItem[] {
  const out: StageItem[] = []

  // Each member is drawn ONCE, on the stage its Linear state maps to. Drawing
  // every member on every stage repeated one fact seven times and marked six of
  // them "not in this stage yet" — the same three identifiers over and over, in
  // a colour that means "wrong", which is noise wearing the costume of a
  // warning.
  //
  // A member whose state no stage claims falls to the workstream's CURRENT
  // stage rather than vanishing: an unmapped state is a gap in the pipeline
  // config, and the issue still has to be somewhere you can see it.
  const currentIsFallback = ctx.workstream.stage === ctx.stage.key
  for (const m of ctx.members) {
    const home = stageForIssue(m, ctx.pipeline)
    const belongsHere = home ? home.key === ctx.stage.key : currentIsFallback
    if (!belongsHere) continue
    out.push(
      item({
        token: 'issues',
        text: `${m.identifier} \u00b7 ${m.state.name}`,
        // Only said on the fallback path, where it is true and useful: this
        // issue's state is in nobody's `states`, so the pipeline cannot place
        // it and somebody should widen a stage.
        hints: home ? [] : [t('stage.unmappedState')],
        tone: home ? 'ok' : 'warn',
        issue: m.identifier,
      }),
    )
  }

  // A ticket that matters here without being a member — somebody else's
  // dependency, an incident that blocked the merge. Unlike the rest of the
  // manual kinds this is not a broken projection: there is nothing upstream
  // that could ever have said "this issue belongs to THIS stage".
  for (const l of ctx.workstream.links) {
    if (l.stageKey !== ctx.stage.key || l.kind !== 'issue') continue
    const known = ctx.members.find((m) => m.identifier === l.value)
    out.push(
      item({
        token: 'issues',
        text: known ? `${known.identifier} \u00b7 ${known.state.name}` : (l.label ?? l.value),
        manual: true,
        issue: l.value,
      }),
    )
  }

  // A member outside the sync window has no card and no state, so no stage can
  // claim it. Listed on the current stage, because silently showing two of
  // three makes the workstream lie about its own size.
  if (currentIsFallback) {
    const resolved = new Set(ctx.members.map((m) => m.identifier))
    for (const id of ctx.workstream.members) {
      if (resolved.has(id)) continue
      out.push(item({ token: 'issues', text: id, hints: [t('stage.notCached')] }))
    }
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
  // The note reads ON its stage, wrapped over as many rows as it needs. An
  // earlier cut showed only its first line, truncated, which was almost
  // useless — a note is prose and the reason never fits on line one.
  //
  // Hand-attached URLs used to render here too, which was wrong twice over: a
  // link is not a note, and a stage that did not show `note` swallowed them
  // without trace. They come through `renderAttachments` now.
  const body = (ctx.workstream.notes[ctx.stage.key] ?? '').trim()
  if (body.length > 0) {
    // Not `manual` — a note is authored, not a workaround for a broken link.
    out.push(item({ token: 'note', text: body, rows: noteRows(body) }))
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

/**
 * Check runs, which are hand-attached and ONLY hand-attached.
 *
 * Linear's schema has a `PullRequestCheck` type but no query path reaches a
 * PullRequest from an issue — existence is not reachability — and this app has
 * no GitHub source. So there is nothing to project, and saying so with a
 * visible manual mark beats a stage that renders an empty box. The day a
 * source exists, the projected runs join these and no stage needs
 * reconfiguring.
 */
function renderCi(ctx: StageContext, _t: Translate): StageItem[] {
  const out: StageItem[] = []
  for (const l of ctx.workstream.links) {
    if (l.stageKey !== ctx.stage.key || l.kind !== 'ci') continue
    out.push(item({ token: 'ci', text: l.label ?? l.value, manual: true, url: l.value }))
  }
  return out
}

/**
 * Which `shows` token renders a hand attachment of each kind, when that token
 * is switched on. A kind with no entry — `url` — is never claimed by a token,
 * so it always falls to `renderAttachments`.
 */
const KIND_TOKEN: Record<string, ShowToken | undefined> = {
  spec: 'designdocs',
  pr: 'pullRequests',
  ci: 'ci',
  issue: 'issues',
}

/**
 * Hand attachments that no active token has already drawn.
 *
 * `shows` governs PROJECTIONS — "go and read the members' PRs". An attachment
 * is not a projection: it is already here, and a person put it on THIS stage
 * deliberately, usually because the projection could not find it. Dropping it
 * because a checkbox is off is the app overruling an explicit act, and it did
 * so silently — a Figma link attached to a stage that did not show `note`
 * vanished with no trace at all.
 *
 * So attachments always render. Inside its own box when that box is on, and
 * here when it is not.
 */
function renderAttachments(ctx: StageContext, _t: Translate): StageItem[] {
  const shown = new Set(ctx.stage.shows)
  const out: StageItem[] = []
  for (const l of ctx.workstream.links) {
    if (l.stageKey !== ctx.stage.key) continue
    const token = KIND_TOKEN[l.kind]
    if (token && shown.has(token)) continue
    out.push(
      item({
        token: 'note',
        text: l.label ?? l.value,
        manual: true,
        url: l.value.startsWith('http') ? l.value : null,
        issue: l.kind === 'issue' && !l.value.startsWith('http') ? l.value : null,
      }),
    )
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
  ci: renderCi,
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
  // Last, and outside the token loop on purpose: an attachment the stage's
  // own boxes did not claim still has to appear somewhere.
  out.push(...renderAttachments(ctx, t))
  return out
}
