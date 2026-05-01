import { Hono } from 'hono'
import { readCachedIssues, readDesigndocsCached } from '../cache.js'
import type {
  DesignDocCoverage,
  DesignDocLinkStrategy,
  IssueStateType,
} from '@shared/types.js'

export const coverageRoutes = new Hono()

// GET /api/designdoc/coverage — diagnostic data for the linkage report UI.
// Surfaces (1) per-change linking status across the three strategies, and
// (2) issues currently being worked on but not linked to any design-doc.
coverageRoutes.get('/api/designdoc/coverage', (c) => {
  const docs = readDesigndocsCached() ?? []
  const issues = readCachedIssues()

  const byStrategy: Record<DesignDocLinkStrategy, number> = {
    frontmatter: 0,
    folderName: 0,
    regexLine: 0,
  }
  let linked = 0

  const perChange = docs.map((d) => {
    const sources: Record<DesignDocLinkStrategy, string[]> = d.linkSources ?? {
      frontmatter: [],
      folderName: [],
      regexLine: [],
    }
    if (sources.frontmatter.length > 0) byStrategy.frontmatter += 1
    if (sources.folderName.length > 0) byStrategy.folderName += 1
    if (sources.regexLine.length > 0) byStrategy.regexLine += 1
    if (d.issueIdentifiers.length > 0) linked += 1
    return {
      name: d.name,
      filePath: d.filePath,
      status: d.status,
      ids: d.issueIdentifiers,
      sources,
    }
  })

  // "Issues missing design doc" = active-state issues not referenced by any
  // change. Mirrors PRD §7.6 — these are the tickets where work is happening
  // without a written plan.
  const linkedIds = new Set<string>()
  for (const d of docs) for (const id of d.issueIdentifiers) linkedIds.add(id)
  const ACTIVE: IssueStateType[] = ['started', 'unstarted']
  const issuesMissingDoc = issues
    .filter((i) => ACTIVE.includes(i.state.type))
    .filter((i) => !linkedIds.has(i.identifier))
    .map((i) => ({
      identifier: i.identifier,
      title: i.title,
      state: i.state.type,
      url: i.url,
    }))

  const coverage: DesignDocCoverage = {
    totalChanges: docs.length,
    linkedChanges: linked,
    unlinkedChanges: docs.length - linked,
    byStrategy,
    perChange,
    issuesMissingDoc,
  }
  return c.json(coverage)
})
