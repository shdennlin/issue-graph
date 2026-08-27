import { memo, useMemo } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, ListTree, MessageSquare, Minus, Star } from 'lucide-react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { AnnotationDTO, NormalizedIssue } from '@shared/types.js'
import { useSchemaStore } from '../../store/schemaStore'
import { useViewStore } from '../../store/viewStore'
import { useGraphStore } from '../../store/graphStore'
import {
  getPrimaryLabel,
  getTypeLabel,
  groupIssueLabels,
  getDesignDocsForIssue,
  unionProgress,
  shortPrefixDisplay,
} from '../../lib/labelSchema'
import { priorityClass, priorityLabel, stateColorVar, stateIcon, stateLabel } from '../../lib/colors'
import { isOverdueIssue } from '../../lib/dueDate'
import type { HierarchyCounts } from '../../views/hierarchy'
import { compactAge } from '../../lib/relativeTime'
import { useT, type DictKey } from '../../i18n'

function formatDueDate(iso: string): string {
  // Render as locale-short ("MMM D") for the chip; full ISO stays on hover.
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface IssueNodeData {
  issue: NormalizedIssue
  focused?: boolean
  /** Set when this issue is part of the multi-selection (Cmd/Ctrl+click).
   * Renders a dashed accent outline so batch operations (open all, isolate
   * chain of selection) have visible scope. Distinct from `focused` (the
   * single sticky cursor) and `isChainRoot` (the chain's origin). */
  selected?: boolean
  /** Set by the dependency view when chain isolation is active and this is
   * the root the chain was rooted at. Renders a star + accent ring so the
   * user can see at a glance where the chain started from. */
  isChainRoot?: boolean
  /** Cache-wide connectivity counts for the small "→3 ←2 ⊸1" badge so the
   * user sees hub-ness at a glance without tracing edges. Optional —
   * absent for views that haven't computed it. */
  connectivity?: { out: number; in: number; related: number }
  /** View-bound counts (only edges actually rendered in the current view).
   * Differs from `connectivity` when chain mode hides connections. Used
   * by the badge tooltip to clarify "X visible / Y total" so the user
   * understands why the badge shows 5 but only 2 edges are drawn. */
  visibleConnectivity?: { out: number; in: number; related: number }
  /** Cache-wide sub-issue progress for the badge's "⊞ 3/7" segment. Linear
   * models hierarchy outside `relations`, so this rides alongside
   * `connectivity` rather than inside it. Absent when the issue has no
   * children — the segment should not render at all. */
  hierarchy?: HierarchyCounts
  /** How many children are actually drawn in the current view. Same purpose
   * as `visibleConnectivity`: chain isolation can hide most of them, and the
   * tooltip discloses the gap. */
  visibleChildren?: number
  /** Container-view chain-mode stripe. When a container view (mix/project/
   * milestone) falls through to dagre layout because chain mode is active,
   * each card carries this color band on its left edge so the user still
   * sees the issue's bucket/project identity without containers. Absent in
   * the dependency view and in container views' default container mode. */
  projectStripe?: { color: string; label?: string }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

// Module-scope stable empty fallback for the annotations selector. Returning
// `?? []` *inside* the selector creates a new array reference per render,
// which Zustand sees as a state change and re-subscribes — fine while
// `s.graph` is non-null, but as soon as anything sets it to null (e.g. the
// tab snapshot/restore layer), the selector spirals into "Maximum update
// depth exceeded" because every forced re-render re-allocates the fallback.
/** Age units, translated rather than concatenated — both existing
 *  relative-time helpers hardcoded English, so a zh-TW session read
 *  "updated 3d ago". */
const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

const EMPTY_ANNOTATIONS: AnnotationDTO[] = []

function IssueNodeImpl({ data }: NodeProps<IssueNodeData>) {
  const { issue, focused, selected, isChainRoot, connectivity, visibleConnectivity, hierarchy, visibleChildren, projectStripe } = data
  const { schema, typeIcons } = useSchemaStore()
  const density = useViewStore((s) => s.density)
  const annotations = useGraphStore((s) => s.graph?.data.annotations ?? EMPTY_ANNOTATIONS)
  const designdocs = useGraphStore((s) => s.graph?.data.designdocs)
  const t = useT()

  const primary = getPrimaryLabel(issue, schema)
  const type = getTypeLabel(issue, schema)
  const typeIcon = type ? typeIcons[type.name] ?? type.name.charAt(0).toUpperCase() : null
  // Prefix + group + orphan sections; primary/type are rendered separately.
  const chipSections = groupIssueLabels(issue, schema).filter(
    (sec) => sec.kind === 'prefix' || sec.kind === 'group' || sec.kind === 'orphan',
  )
  const docs = getDesignDocsForIssue(issue, designdocs)
  const progress = unionProgress(docs)
  const annCount = annotations.filter((a) => a.targetType === 'issue' && a.targetId === issue.identifier).length

  const isCompact = density === 'compact'
  const isVerbose = density === 'verbose'

  const recencyWindow = useViewStore((s) => s.filters.recencyWindow)
  const recencyMode = useViewStore((s) => s.filters.recencyMode)
  // Verbose density has always shown an updated-at line; it now goes through
  // the same translatable formatter instead of a local English-only helper.
  const verboseAge = useMemo(() => {
    const { value, unit } = compactAge(new Date(issue.updatedAt).getTime())
    return t(AGE_UNIT_KEYS[unit], { count: value })
  }, [issue.updatedAt, t])

  const age = useMemo(() => {
    if (recencyWindow === 'any') return null
    const iso = recencyMode === 'created' ? issue.createdAt : issue.updatedAt
    const ts = new Date(iso).getTime()
    if (!Number.isFinite(ts)) return null
    const { value, unit } = compactAge(ts)
    return {
      text: t(AGE_UNIT_KEYS[unit], { count: value }),
      mode: t(
        recencyMode === 'created'
          ? 'filterPanel.recencyModeCreated'
          : 'filterPanel.recencyModeUpdated',
      ),
      title: iso,
    }
  }, [recencyWindow, recencyMode, issue.createdAt, issue.updatedAt, t])

  // The badge renders when there is anything at all to report — edge counts
  // OR sub-issues. An issue can have children without touching a single
  // blocks/related edge, and that card still deserves the "⊞ 3/7" summary.
  const hasEdgeCounts =
    !!connectivity && (connectivity.out > 0 || connectivity.in > 0 || connectivity.related > 0)
  const hasSubIssues = !!hierarchy && hierarchy.total > 0
  const subIssueTotal = hierarchy?.truncated ? `${hierarchy.total}+` : hierarchy?.total ?? 0

  return (
    <div
      className={`issue-node${focused ? ' focused' : ''}${selected ? ' selected' : ''}${isChainRoot ? ' chain-root' : ''}`}
      style={{
        // position: relative so absolutely-positioned children (chain-root
        // star, connectivity badge) anchor to this card.
        position: 'relative',
        ...(isChainRoot && {
          // Outline rather than border so it doesn't shift the layout
          // dagre calculated.
          outline: '2px solid var(--accent, #2563eb)',
          outlineOffset: 2,
          boxShadow: '0 0 0 4px rgba(37, 99, 235, 0.15)',
        }),
      }}
    >
      {projectStripe && (
        <span
          className="project-stripe"
          style={{ background: projectStripe.color }}
          title={projectStripe.label}
          aria-label={projectStripe.label}
        />
      )}
      {isChainRoot && (
        <span
          title="Chain root — this is the issue you isolated the chain from"
          aria-label="Chain root"
          style={{
            position: 'absolute',
            top: -8,
            left: -8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent, #2563eb)',
            color: '#fff',
            lineHeight: 1,
            padding: 4,
            borderRadius: 999,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >
          <Star size={11} fill="currentColor" />
        </span>
      )}
      {age && (
        // Outside the card, like the chain-root star above. Absolutely
        // positioned children do not count toward offsetHeight, which is what
        // GraphCanvas measures and feeds back to dagre — so this cannot make
        // the graph re-lay-out when the filter is switched on.
        //
        // Only rendered while a recency filter is active. The timestamp is
        // worth the space precisely when you are asking a time question, and
        // is noise on forty cards when you are not. It also reports the
        // timestamp the filter is using, so it can never be ambiguous about
        // whether it means created or updated.
        <span className="issue-age" title={age.title}>
          <span className="issue-age-mode">{age.mode}</span>
          {age.text}
        </span>
      )}
      {!isCompact && (hasEdgeCounts || hasSubIssues) && (
        // Relationship badge — global blocks/blocked-by/related counts plus
        // sub-issue progress, so the user can spot hubs and unfinished
        // breakdowns without tracing edges or opening the panel. Hidden in
        // compact density (cards are too short) and when there is nothing to
        // report. Position is anchored relative to the card so it survives
        // node drag/zoom.
        <span
          title={(() => {
            const parts: string[] = []
            if (hasEdgeCounts && connectivity) {
              parts.push(t('issueNode.badgeBlocks', { count: connectivity.out }))
              parts.push(t('issueNode.badgeBlockedBy', { count: connectivity.in }))
              if (connectivity.related > 0) {
                parts.push(t('issueNode.badgeRelated', { count: connectivity.related }))
              }
            }
            if (hasSubIssues && hierarchy) {
              parts.push(
                t('issueNode.badgeSubIssues', { done: hierarchy.done, total: subIssueTotal }),
              )
            }
            const base = parts.join(' • ')

            // Disclose the cache-wide vs. view-bound gap. Chain isolation and
            // filters can hide most connections/children, and without this the
            // badge reads as a lie ("says 5, I count 2 lines").
            const v = visibleConnectivity
            const connHidden =
              !!v &&
              !!connectivity &&
              (v.out !== connectivity.out ||
                v.in !== connectivity.in ||
                v.related !== connectivity.related)
            const childrenHidden =
              hasSubIssues && visibleChildren !== undefined && visibleChildren !== hierarchy!.total
            if (!connHidden && !childrenHidden) return base

            const visible: string[] = []
            if (connHidden) {
              visible.push(`→ ${v!.out}`, `← ${v!.in}`)
              if (v!.related > 0 || connectivity!.related > 0) visible.push(`↔ ${v!.related}`)
            }
            if (childrenHidden) visible.push(`⊞ ${visibleChildren}`)
            return (
              `${base}\n\n${t('issueNode.badgeVisible')} ${visible.join(' • ')}` +
              `\n${t('issueNode.badgeCacheWideNote')}`
            )
          })()}
          style={{
            position: 'absolute',
            bottom: 6,
            right: 6,
            display: 'inline-flex',
            gap: 6,
            alignItems: 'baseline',
            background: 'var(--bg-elev, rgba(0,0,0,0.35))',
            color: 'var(--fg)',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            padding: '3px 7px',
            borderRadius: 5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            pointerEvents: 'none',
          }}
        >
          {/* Lucide icons replace the previous Unicode glyphs
              (⇨ U+21E8 / ⇦ U+21E6 / ╍ U+254D). SVG renders with
              consistent stroke weight across OS / browser font
              fallbacks, where the glyphs varied (especially the
              dashed-bar that some platforms rendered as just a dash).
              Minus stays as the "non-directional connection" cue,
              echoing the dashed related-edge style on the canvas. */}
          {connectivity && connectivity.out > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <ArrowRight size={13} strokeWidth={2.5} aria-hidden />
              {connectivity.out}
            </span>
          )}
          {connectivity && connectivity.in > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <ArrowLeft size={13} strokeWidth={2.5} aria-hidden />
              {connectivity.in}
            </span>
          )}
          {connectivity && connectivity.related > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Minus size={13} strokeWidth={3} aria-hidden />
              {connectivity.related}
            </span>
          )}
          {hasSubIssues && hierarchy && (
            // ListTree reads as "structure", deliberately unlike the arrows
            // (which mean dependency direction) and the Minus (non-directional
            // link) — hierarchy is neither.
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <ListTree size={13} strokeWidth={2.5} aria-hidden />
              {hierarchy.done}/{subIssueTotal}
            </span>
          )}
        </span>
      )}
      <Handle type="target" position={Position.Left} />
      <div className="top">
        {typeIcon && (
          <span
            title={type?.name ?? ''}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
          >
            <span aria-hidden>{typeIcon}</span>
            {isVerbose && type?.name && (
              <span className="meta" style={{ fontSize: 11 }}>{type.name}</span>
            )}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span className={priorityClass(issue.priority)} title={priorityLabel(issue.priority)} />
          {isVerbose && issue.priority !== 0 && (
            <span className="meta" style={{ fontSize: 11 }}>{priorityLabel(issue.priority)}</span>
          )}
        </span>
        {issue.team?.color && (
          <span
            aria-hidden
            title={issue.team.name}
            style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: 999,
              background: issue.team.color,
              flexShrink: 0,
            }}
          />
        )}
        <span className="pid">{issue.identifier}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span
            className={`state-pill is-${issue.state.type}`}
            style={{ color: stateColorVar(issue.state.type) }}
            title={`${issue.state.name} (${stateLabel(issue.state.type)})`}
          >
            <span className="glyph" aria-hidden>{stateIcon(issue.state.type)}</span>
            {issue.state.name}
          </span>
          {annCount > 0 && (
            <span className="annotation-count" title={`${annCount} annotations`} aria-label={`${annCount} annotations`}>
              <MessageSquare size={11} strokeWidth={1.7} aria-hidden />
              {annCount}
            </span>
          )}
        </span>
      </div>
      {!isCompact && <div className="title">{truncate(issue.title, 80)}</div>}
      {!isCompact && (
        <div className="meta">
          <span>{issue.assignee?.displayName ?? 'unassigned'}</span>
          {typeof issue.estimate === 'number' && (
            <span className="chip" title={`${t('detailPanel.estimate')}: ${issue.estimate}`}>
              {t('detailPanel.estimatePointsShort', { value: issue.estimate })}
            </span>
          )}
          {issue.dueDate && (
            <span
              className="chip"
              title={`${t('detailPanel.dueDate')}: ${issue.dueDate}${isOverdueIssue(issue) ? ` (${t('detailPanel.overdue')})` : ''}`}
              style={
                isOverdueIssue(issue)
                  ? {
                      // Inline override to surface overdue without theming a new
                      // chip variant. Mirrors the multi-spec warn color so the
                      // "needs attention" semantics are consistent.
                      background: 'var(--danger-bg, rgba(239, 68, 68, 0.15))',
                      color: 'var(--danger, #ef4444)',
                      fontWeight: 600,
                    }
                  : undefined
              }
            >
              {formatDueDate(issue.dueDate)}
            </span>
          )}
          {primary && (
            <span
              className="chip"
              style={primary.color ? ({ ['--chip-tint' as string]: primary.color } as React.CSSProperties) : undefined}
              title={`${primary.group?.name}: ${primary.name}`}
            >
              {primary.name}
            </span>
          )}
        </div>
      )}
      {!isCompact && progress && (
        <>
          <div className="progress">
            <div style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </div>
          <div className="progress-label">
            {progress.done}/{progress.total} ·{' '}
            {docs.length === 1 ? (
              docs[0]!.name
            ) : (
              // Multi-spec warning: linking one issue to multiple design docs
              // is rare and usually a smell — typically the issue should be
              // split, or the docs should be split, or the linkage is wrong.
              // Make it red so the human reviewer notices and decides.
              <span
                style={{
                  color: 'var(--warn, #f59e0b)',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
                title={
                  `This issue is linked to ${docs.length} design-doc changes (specs):\n` +
                  docs.map((d) => `  • ${d.name}`).join('\n') +
                  `\n\nA spec is one delivery batch. An issue spanning multiple specs ` +
                  `usually means the issue is too large to fit in one batch — split it ` +
                  `into per-spec sub-issues so each batch has contained scope.`
                }
              >
                <AlertTriangle size={11} aria-hidden /> {docs.length} specs
              </span>
            )}
          </div>
        </>
      )}
      {/* Chips for every label the header doesn't already show. Primary and
          type render above (as the accent chip and the type glyph), so this
          row covers prefix, other groups, and unclassified labels — the card
          used to drop the last two entirely. Driven by the same helper as the
          detail panel so a label reads the same in both places. */}
      {!isCompact && chipSections.length > 0 && (
        <div className="chips">
          {chipSections.flatMap((sec) =>
            sec.labels.map((l) => (
              <span
                key={l.id}
                className="chip"
                style={l.color ? ({ ['--chip-tint' as string]: l.color } as React.CSSProperties) : undefined}
                title={sec.kind === 'orphan' ? l.name : `${sec.key}: ${l.name}`}
              >
                {sec.kind === 'prefix' ? `${sec.key}: ${shortPrefixDisplay(l.name, sec.key)}` : l.name}
              </span>
            )),
          )}
        </div>
      )}
      {isVerbose && !age && (
        // Verbose already carried an updated-at line. It is redundant while the
        // badge is up, which is why it steps aside rather than duplicating it.
        <div className="meta" style={{ marginTop: 6 }}>
          <span title={issue.updatedAt}>
            {t('filterPanel.recencyModeUpdated')} {verboseAge}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const IssueNode = memo(IssueNodeImpl)
