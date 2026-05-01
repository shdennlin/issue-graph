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
import { priorityClass, priorityLabel, stateLabel } from '../../lib/colors'

interface IssueNodeData {
  issue: NormalizedIssue
  focused?: boolean
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function IssueNodeImpl({ data }: NodeProps<IssueNodeData>) {
  const { issue, focused } = data
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
    <div className={`issue-node${focused ? ' focused' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="top">
        {typeIcon && <span title={type?.name ?? ''}>{typeIcon}</span>}
        <span className={priorityClass(issue.priority)} title={priorityLabel(issue.priority)} />
        <span className="pid">{issue.identifier}</span>
        <span style={{ marginLeft: 'auto' }} className="meta">
          {stateLabel(issue.state.type)}
          {annCount > 0 && <span style={{ marginLeft: 6 }} title={`${annCount} annotations`}>💬{annCount}</span>}
        </span>
      </div>
      {!isCompact && <div className="title">{truncate(issue.title, 80)}</div>}
      {!isCompact && (
        <div className="meta">
          <span>{issue.assignee?.displayName ?? 'unassigned'}</span>
          {primary && (
            <span
              className="chip"
              style={{ background: primary.color || 'var(--chip-bg)', color: '#fff' }}
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
                style={{ background: l.color || 'var(--chip-bg)' }}
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
