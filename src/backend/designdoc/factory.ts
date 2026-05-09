import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DesignDocChange } from '@shared/types.js'
import type { DesignDocAdapter } from './types.js'
import { openspecAdapter } from './openspec.js'
import { spectraAdapter } from './spectra.js'
import { listWorktrees } from './worktrees.js'

// Order matters for `auto` detection: try the more-specific (Spectra,
// gated on .spectra.yaml) before the more-permissive (OpenSpec, gated
// on raw openspec/ presence). spectraAdapter.detect() is false unless
// .spectra.yaml or .spectra/ exists, so OpenSpec still wins for pure
// OpenSpec projects.
const ADAPTERS: DesignDocAdapter[] = [spectraAdapter, openspecAdapter]

function pickAdapter(repoRoot: string, configured: string): DesignDocAdapter | null {
  if (!repoRoot || !existsSync(repoRoot)) return null
  if (configured === 'none') return null
  if (configured === 'auto') {
    return ADAPTERS.find((a) => a.detect(repoRoot)) ?? null
  }
  return ADAPTERS.find((a) => a.name === configured) ?? null
}

/**
 * Pick the canonical record when the same change name appears in multiple
 * worktrees. Rules (in order):
 *   1. Linked worktree(s) win over the main checkout. Rationale: when a
 *      user has both a copy on main and an active edit in a feature
 *      worktree, the feature copy is "what they're working on now."
 *   2. Among multiple linked candidates (rare), pick the one whose
 *      tasks.md was modified most recently. tasks.md is the canonical
 *      progress signal; using its mtime, not the directory's, avoids
 *      false positives from `git checkout` touching dir mtimes (matches
 *      the same fix Spectra v2.3.0 made — see release notes).
 *   3. Fall back to first when mtime can't be read for either.
 */
function pickLinkedWinner(group: DesignDocChange[], repoRoot: string): DesignDocChange {
  if (group.length === 1) return group[0]!
  const linked = group.filter((c) => c.worktree && c.worktree.path !== repoRoot)
  const candidates = linked.length > 0 ? linked : group
  if (candidates.length === 1) return candidates[0]!

  // Sort by tasks.md mtime descending. filePath is stored relative to
  // the worktree root (per scanner.ts), so we resolve against that.
  let bestIdx = 0
  let bestMtime = -Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    const tasksPath = c.worktree
      ? join(c.worktree.path, c.filePath)
      : join(repoRoot, c.filePath)
    let m = -Infinity
    try {
      m = statSync(tasksPath).mtimeMs
    } catch {
      // File gone since scan — treat as oldest.
    }
    if (m > bestMtime) {
      bestMtime = m
      bestIdx = i
    }
  }
  return candidates[bestIdx]!
}

function dedupAcrossWorktrees(
  changes: DesignDocChange[],
  repoRoot: string,
): DesignDocChange[] {
  if (changes.length <= 1) return changes
  const groups = new Map<string, DesignDocChange[]>()
  for (const c of changes) {
    const arr = groups.get(c.name)
    if (arr) arr.push(c)
    else groups.set(c.name, [c])
  }
  const out: DesignDocChange[] = []
  for (const group of groups.values()) {
    out.push(pickLinkedWinner(group, repoRoot))
  }
  return out
}

export async function runDesignDocScan(
  repoRoot: string,
  configured: string,
): Promise<DesignDocChange[] | undefined> {
  if (!repoRoot || !existsSync(repoRoot) || configured === 'none') return undefined

  const worktrees = listWorktrees(repoRoot)
  // Per-worktree adapter pick: a feature branch could (rarely) carry a
  // different .spectra.yaml than main, so rerunning detection per
  // worktree avoids silently reading the wrong layout.
  const all: DesignDocChange[] = []
  let anyAdapterMatched = false
  for (const wt of worktrees) {
    const adapter = pickAdapter(wt.path, configured)
    if (!adapter) continue
    anyAdapterMatched = true
    const changes = adapter.scan(wt.path)
    for (const c of changes) {
      // Annotate every change with its source worktree so the dedup pass
      // can apply linked-wins-by-mtime and so the UI/diagnostics can show
      // where a spec actually lives.
      c.worktree = { path: wt.path, ref: wt.ref }
    }
    all.push(...changes)
  }
  if (!anyAdapterMatched) return undefined
  const deduped = dedupAcrossWorktrees(all, repoRoot)
  // Single-worktree projects (most projects) don't need the field
  // populated — there's nothing to disambiguate, and stripping keeps the
  // payload clean for existing consumers that pre-date this addition.
  if (worktrees.length <= 1) {
    for (const c of deduped) delete c.worktree
  }
  return deduped
}

export function getActiveDesignDocAdapter(repoRoot: string, configured: string): DesignDocAdapter | null {
  return pickAdapter(repoRoot, configured)
}

/**
 * Resolve all watch targets for the active adapter across every worktree
 * inside repoRoot. Returns absolute paths to existing spec dirs only —
 * the watcher uses this to start one fs.watch per worktree, so live edits
 * in a feature worktree (not just the main checkout) propagate.
 */
export function getDesignDocWatchTargets(repoRoot: string, configured: string): string[] {
  if (!repoRoot || !existsSync(repoRoot) || configured === 'none') return []
  const worktrees = listWorktrees(repoRoot)
  const targets = new Set<string>()
  for (const wt of worktrees) {
    const adapter = pickAdapter(wt.path, configured)
    if (!adapter) continue
    const t = adapter.getWatchTarget(wt.path)
    if (t && existsSync(t)) targets.add(t)
  }
  return [...targets]
}

// Re-export for callers that need to know where a worktree is anchored.
export type { Worktree } from './worktrees.js'
