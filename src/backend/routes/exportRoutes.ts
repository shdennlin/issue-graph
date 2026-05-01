import { Hono } from 'hono'
import { readCachedIssues } from '../cache.js'
import type { NormalizedIssue } from '@shared/types.js'

export const exportRoutes = new Hono()

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(issues: NormalizedIssue[]): string {
  const headers = [
    'identifier',
    'title',
    'state',
    'priority',
    'assignee',
    'labels',
    'createdAt',
    'updatedAt',
    'completedAt',
    'url',
    'blocks',
  ]
  const lines = [headers.join(',')]
  for (const i of issues) {
    lines.push(
      [
        i.identifier,
        i.title,
        i.state.type,
        i.priority,
        i.assignee?.displayName ?? '',
        i.labels.map((l) => l.name).join('|'),
        i.createdAt,
        i.updatedAt,
        i.completedAt ?? '',
        i.url,
        i.relations.filter((r) => r.type === 'blocks').map((r) => r.targetIdentifier).join('|'),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\n')
}

function toMarkdown(issues: NormalizedIssue[]): string {
  const lines = ['# Issue export', '', `Generated: ${new Date().toISOString()}`, '']
  for (const i of issues) {
    lines.push(`## [${i.identifier}](${i.url}) ${i.title}`)
    lines.push('')
    lines.push(`- State: ${i.state.type}`)
    lines.push(`- Priority: ${i.priority}`)
    if (i.assignee) lines.push(`- Assignee: ${i.assignee.displayName}`)
    if (i.labels.length) lines.push(`- Labels: ${i.labels.map((l) => l.name).join(', ')}`)
    const blocks = i.relations.filter((r) => r.type === 'blocks').map((r) => r.targetIdentifier)
    if (blocks.length) lines.push(`- Blocks: ${blocks.join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}

exportRoutes.get('/api/export', (c) => {
  const format = (c.req.query('format') ?? 'csv').toLowerCase()
  const issues = readCachedIssues()
  if (format === 'md' || format === 'markdown') {
    return c.body(toMarkdown(issues), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="issues-${Date.now()}.md"`,
    })
  }
  return c.body(toCsv(issues), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="issues-${Date.now()}.csv"`,
  })
})
