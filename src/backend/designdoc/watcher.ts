// Watch the active adapter's spec dir for changes (in every git worktree
// rooted at REPO_PATH) and re-run the design-doc scan whenever
// proposal.md / tasks.md / frontmatter changes. On settle, write the new
// payload to cache_meta and publish a 'designdoc-changed' event so
// connected SSE clients refetch immediately.
//
// Watch paths come from getDesignDocWatchTargets() rather than being
// hardcoded — Spectra projects may use docs/specs/ or any custom spec_dir
// from .spectra.yaml, and worktree-rooted projects may have multiple spec
// dirs to track at once.
//
// fs.watch with { recursive: true } works on macOS (FSEvents) and modern
// Linux (Node 20+). Falls back to a no-op + warning if the platform's
// fs.watch errors out — the existing sync-time scan still works, so the
// only loss is real-time. Don't crash the server over this.
//
// Per-tab note: the watcher follows the **default** workspace (the one
// control_meta['active_workspace'] names), not every open profile. Tabs
// viewing a non-default workspace fall back to the existing 30s frontend poll.
//
// Worktree caveat: this starts one watcher per worktree present at
// startup. Worktrees added with `git worktree add` while the server is
// running are NOT picked up until the next restart — dynamic discovery
// is a deferred follow-up. Removed worktrees just produce dead watchers
// that fire no events; benign.

import { watch, type FSWatcher } from 'node:fs'
import { writeDesigndocsCached } from '../cache.js'
import { getLogger } from '../lib/log.js'
import { BUS_EVENT, publish } from '../lib/eventBus.js'
import { runWithWorkspace } from '../lib/workspaceContext.js'
import { getDesignDocWatchTargets, runDesignDocScan } from './factory.js'

const DEBOUNCE_MS = 500

const activeWatchers: FSWatcher[] = []
let debounceHandle: ReturnType<typeof setTimeout> | null = null
let watchedWorkspaceId: string | null = null

export function startDesignDocWatcher(repoPath: string, adapter: string, workspaceId: string): void {
  if (activeWatchers.length > 0) return // idempotent — only one watcher set per process
  if (!repoPath) return

  const targets = getDesignDocWatchTargets(repoPath, adapter)
  if (targets.length === 0) {
    // No spec dir present yet in any worktree — design-doc integration
    // silently disabled. Late-arrival of the dir is handled by the next
    // sync-time scan picking it up.
    return
  }

  watchedWorkspaceId = workspaceId
  const log = getLogger()

  for (const target of targets) {
    try {
      const w = watch(target, { recursive: true }, (eventType, filename) => {
        // Only react to files we know affect the scan output. Filter early
        // to avoid re-running the scan for every editor swap-file or cache
        // write.
        if (!filename) return
        const f = String(filename)
        if (
          !f.endsWith('proposal.md') &&
          !f.endsWith('tasks.md') &&
          !f.endsWith('.md') // covers any other markdown the adapter reads
        ) {
          return
        }
        // Debounce: editors fire bursts of write/rename events on save.
        // One scan per quiet window covers all worktrees because
        // runDesignDocScan re-discovers them every call.
        if (debounceHandle) clearTimeout(debounceHandle)
        debounceHandle = setTimeout(() => {
          void rescanAndPublish(repoPath, adapter, eventType, f)
        }, DEBOUNCE_MS)
      })
      w.on('error', (err) => {
        log.warn({ err: String(err), target }, 'designdoc watcher error — closing this watcher')
        try {
          w.close()
        } catch {
          // already gone
        }
      })
      activeWatchers.push(w)
    } catch (err) {
      log.warn({ err: String(err), target }, 'failed to start designdoc watcher for target; sync-time scans still work')
    }
  }

  if (activeWatchers.length > 0) {
    log.info({ targets, workspace: workspaceId }, 'designdoc watcher started')
  }
}

export function stopDesignDocWatcher(): void {
  if (debounceHandle) {
    clearTimeout(debounceHandle)
    debounceHandle = null
  }
  while (activeWatchers.length > 0) {
    const w = activeWatchers.pop()!
    try {
      w.close()
    } catch {
      // Already closed — fine.
    }
  }
  watchedWorkspaceId = null
}

async function rescanAndPublish(
  repoPath: string,
  adapter: string,
  eventType: string,
  filename: string,
): Promise<void> {
  const log = getLogger()
  const wid = watchedWorkspaceId
  if (!wid) return // watcher already torn down
  // Run cache writes under the watched workspace's context so getDb()
  // resolves to that workspace's DB, not whatever stale singleton.
  await runWithWorkspace(wid, async () => {
    try {
      const designdocs = await runDesignDocScan(repoPath, adapter)
      writeDesigndocsCached(designdocs)
      publish({
        type: BUS_EVENT.DESIGNDOC_CHANGED,
        data: {
          eventType,
          filename,
          count: designdocs?.length ?? 0,
          workspaceId: wid,
        },
      })
      log.debug({ filename, workspace: wid, count: designdocs?.length ?? 0 }, 'designdoc rescan published')
    } catch (err) {
      log.warn({ err: String(err) }, 'designdoc rescan failed')
    }
  })
}
