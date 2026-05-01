import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { DesignDocChange, DesignDocStatus } from '@shared/types.js'
import type { DesignDocAdapter } from './types.js'

const LINEAR_ID_RE = /^Linear:\s*([A-Z][A-Z0-9]*-\d+)/gm
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
  return 'active'
}

export const spectraAdapter: DesignDocAdapter = {
  name: 'spectra',
  detect(repoRoot: string): boolean {
    return existsSync(join(repoRoot, 'openspec'))
  },
  scan(repoRoot: string): DesignDocChange[] {
    const root = repoRoot
    const changeDirs = [
      ...listDirs(join(root, 'openspec', 'changes')),
      ...listDirs(join(root, 'openspec', 'changes', '_parked')),
      ...listDirs(join(root, 'openspec', 'archive')),
    ]
    const out: DesignDocChange[] = []
    for (const dir of changeDirs) {
      const proposal = readSafe(join(dir, 'proposal.md')) ?? ''
      const tasks = readSafe(join(dir, 'tasks.md')) ?? ''
      const ids = new Set<string>()
      for (const m of proposal.matchAll(LINEAR_ID_RE)) {
        if (m[1]) ids.add(m[1])
      }
      const total = (tasks.match(CHECKBOX_TOTAL_RE) || []).length
      const done = (tasks.match(CHECKBOX_DONE_RE) || []).length
      out.push({
        name: dir.split('/').pop() ?? dir,
        issueIdentifiers: [...ids],
        status: detectStatus(dir),
        totalTasks: total,
        doneTasks: done,
        progress: total > 0 ? done / total : 0,
        filePath: relative(root, join(dir, 'tasks.md')),
      })
    }
    return out
  },
}
