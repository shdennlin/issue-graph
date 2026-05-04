import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { NormalizedIssue } from '@shared/types.js'
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
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function IssueNodeImpl({ data }: NodeProps<IssueNodeData>) {
  const { issue, focused, isChainRoot } = data
  const { schema, typeIcons } = useSchemaStore()
  const density = useViewStore((s) => s.density)
  const annotations = useGraphStore((s) => s.graph?.data.annotations ?? [])
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
      style={
        isChainRoot
          ? {
              // position: relative so the absolutely-positioned chain-root
              // star (below) anchors to this card. Outline rather than
              // border so it doesn't shift the layout dagre calculated.
              position: 'relative',
              outline: '2px solid var(--accent, #2563eb)',
              outlineOffset: 2,
              boxShadow: '0 0 0 4px rgba(37, 99, 235, 0.15)',
            }
          : undefined
      }
    >
      {isChainRoot && (
        <span
          title="Chain root — this is the issue you isolated the chain from"
          aria-label="Chain root"
          style={{
            position: 'absolute',
            top: -8,
            left: -8,
            background: 'var(--accent, #2563eb)',
            color: '#fff',
            fontSize: 11,
            lineHeight: 1,
            padding: '3px 6px',
            borderRadius: 999,
            fontWeight: 700,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >
          ★
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
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M2 4.5C2 3.67 2.67 3 3.5 3h9c0.83 0 1.5 0.67 1.5 1.5v5c0 0.83-0.67 1.5-1.5 1.5H6l-3 3v-3H3.5C2.67 11 2 10.33 2 9.5v-5z" />
              </svg>
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
            {progress.done}/{progress.total} · {docs.length === 1 ? docs[0]!.name : `${docs.length} changes`}
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
