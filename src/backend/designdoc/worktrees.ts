// Discovery of git worktrees rooted at REPO_PATH.
//
// Usage shape:
//   listWorktrees(repoRoot) → [{ path, ref, isMain } …]
//
// Filtering: only worktrees whose path equals or is a descendant of repoRoot
// are returned. Worktrees added outside REPO_PATH (e.g. `git worktree add
// ../foo`) are excluded because they collide with Docker bind-mount
// boundaries — only REPO_PATH itself is mounted into the container, so a
// sibling worktree path that resolves on the host won't exist inside the
// container. Supporting outside-REPO worktrees would require a separate
// mount-discovery step and is deferred.
//
// Implementation split:
//   - parseWorktreeList(output): pure parser for `git worktree list
//     --porcelain` output. Easy to test with hand-crafted strings.
//   - listWorktrees(repoRoot): shells out to git, parses, filters. Returns
//     a single-entry list pointing at repoRoot if git is missing or the
//     command fails — design-doc scanning then degrades gracefully to the
//     pre-worktree behavior (only REPO_PATH itself).

import { spawnSync } from 'node:child_process'
import { sep } from 'node:path'
import { getLogger } from '../lib/log.js'

export interface Worktree {
  /** Absolute path to the worktree's working tree. */
  path: string
  /** Branch name (without `refs/heads/`) when on a branch, otherwise the
   *  short commit SHA when detached. Always populated so the UI has
   *  something to display. */
  ref: string
  /** True for the main checkout (the first entry in porcelain output). */
  isMain: boolean
}

/**
 * Parse `git worktree list --porcelain` output into Worktree records.
 *
 * Porcelain format (one record per blank-line-separated block):
 *   worktree /abs/path
 *   HEAD <sha>
 *   branch refs/heads/<name>     ← OR
 *   detached
 *   [bare]                        ← marks the bare repo entry
 *
 * The first non-bare record is treated as the main checkout. Bare records
 * are ignored — they have no working tree to scan.
 */
export function parseWorktreeList(output: string): Worktree[] {
  const blocks = output.split(/\r?\n\r?\n/).filter((b) => b.trim().length > 0)
  const result: Worktree[] = []
  let mainAssigned = false
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    let path: string | null = null
    let ref: string | null = null
    let head: string | null = null
    let bare = false
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim()
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim()
      else if (line.startsWith('branch ')) {
        const raw = line.slice('branch '.length).trim()
        // Strip standard refs/heads/ prefix; leave non-standard refs alone
        // so the UI shows something meaningful (e.g. refs/tags/v1).
        ref = raw.startsWith('refs/heads/') ? raw.slice('refs/heads/'.length) : raw
      } else if (line === 'detached') {
        // Will fall back to short SHA below.
      } else if (line === 'bare') {
        bare = true
      }
    }
    if (bare) continue
    if (!path) continue
    if (!ref) {
      // Detached HEAD — use first 7 chars of SHA for compactness, mirroring
      // what `git log --oneline` shows.
      ref = head ? head.slice(0, 7) : '(unknown)'
    }
    const isMain = !mainAssigned
    mainAssigned = true
    result.push({ path, ref, isMain })
  }
  return result
}

/**
 * True iff `candidate` equals `repoRoot` or is a strict descendant of it.
 * Uses the OS path separator and avoids the `<root>foo` false-positive that
 * naive `startsWith(repoRoot)` would produce (e.g. /foo matching /foobar).
 */
export function isInsideRepo(candidate: string, repoRoot: string): boolean {
  if (candidate === repoRoot) return true
  const prefix = repoRoot.endsWith(sep) ? repoRoot : repoRoot + sep
  return candidate.startsWith(prefix)
}

/**
 * Discover all git worktrees rooted at (or inside) repoRoot. Falls back to
 * a single-entry list pointing at repoRoot when git is unavailable, the
 * directory isn't a git repo, or any other error — callers then operate on
 * just the main checkout, identical to pre-worktree behavior.
 */
export function listWorktrees(repoRoot: string): Worktree[] {
  if (!repoRoot) return []
  let output: string
  try {
    const r = spawnSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf-8',
      // Defensive: cap output so a runaway git invocation can't OOM us.
      maxBuffer: 10 * 1024 * 1024,
    })
    if (r.status !== 0 || !r.stdout) {
      // Not a git repo, git missing, or git error — fall back gracefully.
      return [{ path: repoRoot, ref: '(no-git)', isMain: true }]
    }
    output = r.stdout
  } catch (err) {
    getLogger().debug({ err: String(err), repoRoot }, 'git worktree list failed; using single-entry fallback')
    return [{ path: repoRoot, ref: '(no-git)', isMain: true }]
  }
  const all = parseWorktreeList(output)
  const inside = all.filter((wt) => isInsideRepo(wt.path, repoRoot))
  // If nothing is inside (e.g. repoRoot is a linked worktree and all
  // others live elsewhere), at minimum return repoRoot itself so the
  // caller still scans something.
  if (inside.length === 0) {
    const self = all.find((wt) => wt.path === repoRoot)
    return self ? [self] : [{ path: repoRoot, ref: '(unknown)', isMain: true }]
  }
  return inside
}
