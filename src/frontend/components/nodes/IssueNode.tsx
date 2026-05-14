import { memo } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, MessageSquare, Minus, Star } from 'lucide-react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { AnnotationDTO, NormalizedIssue } from '@shared/types.js'
import { useSchemaStore } from '../../store/schemaStore'
import { useViewStore } from '../../store/viewStore'
import { useGraphStore } from '../../store/graphStore'
import {
  getPrimaryLabel,
  getTypeLabel,
  getPrefixLabels,
  getDesignDocsForIssue,
  unionProgress,
  shortPrefixDisplay,
} from '../../lib/labelSchema'
import { priorityClass, priorityLabel, stateColorVar, stateIcon, stateLabel } from '../../lib/colors'

interface IssueNodeData {
  issue: NormalizedIssue
  focused?: boolean
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
const EMPTY_ANNOTATIONS: AnnotationDTO[] = []

function IssueNodeImpl({ data }: NodeProps<IssueNodeData>) {
  const { issue, focused, isChainRoot, connectivity, visibleConnectivity } = data
  const { schema, typeIcons } = useSchemaStore()
  const density = useViewStore((s) => s.density)
  const annotations = useGraphStore((s) => s.graph?.data.annotations ?? EMPTY_ANNOTATIONS)
  const designdocs = useGraphStore((s) => s.graph?.data.designdocs)

  const primary = getPrimaryLabel(issue, schema)
  const type = getTypeLabel(issue, schema)
  const typeIcon = type ? typeIcons[type.name] ?? type.name.charAt(0).toUpperCase() : null
  const prefixes = getPrefixLabels(issue, schema)
  const docs = getDesignDocsForIssue(issue, designdocs)
  const progress = unionProgress(docs)
  const annCount = annotations.filter((a) => a.targetType === 'issue' && a.targetId === issue.identifier).length

  const isCompact = density === 'compact'
  const isVerbose = density === 'verbose'

  return (
    <div
      className={`issue-node${focused ? ' focused' : ''}${isChainRoot ? ' chain-root' : ''}`}
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
      {connectivity && !isCompact && (connectivity.out > 0 || connectivity.in > 0 || connectivity.related > 0) && (
        // Connectivity badge — global blocks/blocked-by/related counts so the
        // user can spot hubs without tracing edges. Hidden in compact density
        // (cards are too short) and when all counts are zero. Position is
        // anchored relative to the card so it survives node drag/zoom.
        <span
          title={(() => {
            const v = visibleConnectivity
            const c = connectivity
            const hidden =
              v &&
              (v.out !== c.out || v.in !== c.in || v.related !== c.related)
            const base =
              `Blocks ${c.out} • Blocked by ${c.in}` +
              (c.related > 0 ? ` • Related ${c.related}` : '')
            if (!hidden) return base
            return (
              base +
              `\n\nVisible in current view: → ${v!.out} • ← ${v!.in}` +
              (v!.related > 0 || c.related > 0 ? ` • ↔ ${v!.related}` : '') +
              `\n(Counts above are cache-wide; some connections are hidden ` +
              `by chain isolation or filters.)`
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
          {connectivity.out > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <ArrowRight size={13} strokeWidth={2.5} aria-hidden />
              {connectivity.out}
            </span>
          )}
          {connectivity.in > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <ArrowLeft size={13} strokeWidth={2.5} aria-hidden />
              {connectivity.in}
            </span>
          )}
          {connectivity.related > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Minus size={13} strokeWidth={3} aria-hidden />
              {connectivity.related}
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
      {!isCompact && prefixes.length > 0 && (
        <div className="chips">
          {prefixes.flatMap(({ token, labels }) =>
            labels.map((l) => (
              <span
                key={l.id}
                className="chip"
                style={l.color ? ({ ['--chip-tint' as string]: l.color } as React.CSSProperties) : undefined}
                title={l.name}
              >
                {token}: {shortPrefixDisplay(l.name, token)}
              </span>
            )),
          )}
        </div>
      )}
      {isVerbose && (
        <div className="meta" style={{ marginTop: 6 }}>
          <span title={issue.updatedAt}>updated {timeAgo(issue.updatedAt)}</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export const IssueNode = memo(IssueNodeImpl)
