// Tool-agnostic spec scanner. Both OpenSpec and Spectra use the same
// proposal.md / tasks.md / frontmatter / checkbox conventions — only the
// directory layout (where the spec root lives) differs. Adapters resolve
// the absolute spec root, then call scanSpecDir to walk it.
//
// Helpers (extractFrontmatterIds, extractFolderNameIds, extractRegexLineIds)
// are exported so future adapters with the same content format but different
// layout (e.g. an in-house variant) can compose them too.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  DesignDocChange,
  DesignDocLinkStrategy,
  DesignDocStatus,
} from '@shared/types.js'

const FRONTMATTER_RE = /^---\r?\n([\s\S]+?)\r?\n---/
const LINEAR_LINE_RE = /^.*linear.*$/gim
// Kept identical to ISSUE_ID_PATTERN in src/frontend/lib/issueLinks.ts, which
// linkifies the same ids in notes and descriptions. Change both or neither.
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

export function extractFrontmatterIds(proposal: string): string[] {
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

export function extractFolderNameIds(dirName: string): string[] {
  const ids: string[] = []
  for (const m of dirName.matchAll(ISSUE_ID_RE)) {
    if (m[1]) ids.push(m[1])
  }
  return ids
}

function stripFrontmatter(proposal: string): string {
  return proposal.replace(FRONTMATTER_RE, '')
}

export function extractRegexLineIds(proposal: string): string[] {
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

/**
 * Walk a spec root and produce DesignDocChange records. The spec root is
 * the directory that contains `changes/` (and optionally `_parked/`,
 * `archive/`). Both OpenSpec (root = openspec/) and Spectra (root =
 * docs/specs/ or whatever spec_dir points at) share this layout below the
 * root, so adapters only need to resolve the root and hand it here.
 *
 * `repoRoot` is used to compute the relative `filePath` field — the same
 * change at /repo/openspec/changes/foo and /repo/docs/specs/changes/foo
 * should report different filePaths so the diagnostic UI can show where
 * the spec actually lives.
 */
export function scanSpecDir(repoRoot: string, specDir: string): DesignDocChange[] {
  const root = join(repoRoot, specDir)
  const changeDirs = [
    ...listDirs(join(root, 'changes')).filter(
      (d) => !d.endsWith('/archive') && !d.endsWith('/_parked'),
    ),
    ...listDirs(join(root, 'changes', '_parked')),
    ...listDirs(join(root, 'changes', 'archive')),
    ...listDirs(join(root, '_parked')),
    ...listDirs(join(root, 'archive')),
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
      filePath: relative(repoRoot, join(dir, 'tasks.md')),
      linkSources,
    })
  }
  return out
}
