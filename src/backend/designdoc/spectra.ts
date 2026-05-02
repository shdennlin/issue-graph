import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  DesignDocChange,
  DesignDocLinkStrategy,
  DesignDocStatus,
} from '@shared/types.js'
import type { DesignDocAdapter } from './types.js'

// ─── Linkage strategies ──────────────────────────────────────────────────
// We try three independent strategies and union their results. Each change
// records which strategy contributed which IDs so the diagnostic page can
// show exactly why a link was made (or wasn't).
//
// 1. Frontmatter — recommended for new users, machine-readable.
//    Example:
//      ---
//      linear: [PROJ-123, PROJ-456]
//      ---
//
// 2. Folder name — visible at filesystem level. Triggers when the change
//    directory name starts with or contains a Linear-style identifier.
//    Example: openspec/changes/PROJ-123-checkpoint-resume/
//
// 3. Regex line — matches any line in proposal.md mentioning "Linear" and
//    extracts IDs from that line. Backwards-compatible with existing teams.
//    Example:
//      Linear: PROJ-123
//      Related Linear issues: PROJ-105 (resume), PROJ-107, PROJ-70
// ─────────────────────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]+?)\r?\n---/
const LINEAR_LINE_RE = /^.*linear.*$/gim
const ISSUE_ID_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g
const CHECKBOX_TOTAL_RE = /^\s*-\s\[[xX ]\]/gm
const CHECKBOX_DONE_RE = /^\s*-\s\[[xX]\]/gm

function readSafe(p: string): string | null {
  try {
    return readFileSync(p, 'utf-8')
  } catch {
    return null
  }
}

function listDirs(p: string): string[] {
  if (!existsSync(p)) return []
  try {
    return readdirSync(p)
      .map((name) => join(p, name))
      .filter((full) => {
        try {
          return statSync(full).isDirectory()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

function detectStatus(dir: string): DesignDocStatus {
  if (dir.includes(`/_parked/`)) return 'parked'
  if (dir.includes(`/archive/`)) return 'archived'
  if (dir.includes(`/changes/archive/`)) return 'archived'
  return 'active'
}

function extractFrontmatterIds(proposal: string): string[] {
  const match = proposal.match(FRONTMATTER_RE)
  if (!match || !match[1]) return []
  let parsed: unknown
  try {
    parsed = parseYaml(match[1])
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const linearVal = (parsed as Record<string, unknown>).linear ?? (parsed as Record<string, unknown>).Linear
  if (linearVal == null) return []
  const out: string[] = []
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(ISSUE_ID_RE)) if (m[1]) out.push(m[1])
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item)
    }
  }
  visit(linearVal)
  return out
}

function extractFolderNameIds(dirName: string): string[] {
  const ids: string[] = []
  for (const m of dirName.matchAll(ISSUE_ID_RE)) {
    if (m[1]) ids.push(m[1])
  }
  return ids
}

function stripFrontmatter(proposal: string): string {
  return proposal.replace(FRONTMATTER_RE, '')
}

function extractRegexLineIds(proposal: string): string[] {
  // Strip frontmatter first so its `linear:` key doesn't double-count as a
  // regex-line match (frontmatter strategy already covered it).
  const body = stripFrontmatter(proposal)
  const ids: string[] = []
  for (const lineMatch of body.matchAll(LINEAR_LINE_RE)) {
    const line = lineMatch[0]
    for (const idMatch of line.matchAll(ISSUE_ID_RE)) {
      if (idMatch[1]) ids.push(idMatch[1])
    }
  }
  return ids
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)]
}

export const spectraAdapter: DesignDocAdapter = {
  name: 'spectra',
  detect(repoRoot: string): boolean {
    return existsSync(join(repoRoot, 'openspec'))
  },
  scan(repoRoot: string): DesignDocChange[] {
    const root = repoRoot
    const changeDirs = [
      ...listDirs(join(root, 'openspec', 'changes')).filter(
        (d) => !d.endsWith('/archive') && !d.endsWith('/_parked'),
      ),
      ...listDirs(join(root, 'openspec', 'changes', '_parked')),
      ...listDirs(join(root, 'openspec', 'changes', 'archive')),
      ...listDirs(join(root, 'openspec', '_parked')),
      ...listDirs(join(root, 'openspec', 'archive')),
    ]
    const out: DesignDocChange[] = []
    for (const dir of changeDirs) {
      const proposal = readSafe(join(dir, 'proposal.md')) ?? ''
      const tasks = readSafe(join(dir, 'tasks.md')) ?? ''
      const dirName = basename(dir)

      const fromFrontmatter = uniq(extractFrontmatterIds(proposal))
      const fromFolderName = uniq(extractFolderNameIds(dirName))
      const fromRegexLine = uniq(extractRegexLineIds(proposal))

      const linkSources: Record<DesignDocLinkStrategy, string[]> = {
        frontmatter: fromFrontmatter,
        folderName: fromFolderName,
        regexLine: fromRegexLine,
      }
      const allIds = uniq([...fromFrontmatter, ...fromFolderName, ...fromRegexLine])

      const total = (tasks.match(CHECKBOX_TOTAL_RE) || []).length
      const done = (tasks.match(CHECKBOX_DONE_RE) || []).length
      out.push({
        name: dirName,
        issueIdentifiers: allIds,
        status: detectStatus(dir),
        totalTasks: total,
        doneTasks: done,
        progress: total > 0 ? done / total : 0,
        filePath: relative(root, join(dir, 'tasks.md')),
        linkSources,
      })
    }
    return out
  },
}
