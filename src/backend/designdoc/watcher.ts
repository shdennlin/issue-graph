// Watch the active adapter's spec dir for changes and re-run the design-doc
// scan whenever proposal.md / tasks.md / frontmatter changes. On settle,
// write the new payload to cache_meta and publish a 'designdoc-changed'
// event so connected SSE clients refetch immediately.
//
// The watch path comes from the adapter's getWatchTarget() rather than
// being hardcoded to openspec/ — Spectra projects may use docs/specs/ or
// any custom spec_dir from .spectra.yaml.
//
// fs.watch with { recursive: true } works on macOS (FSEvents) and modern
// Linux (Node 20+). Falls back to a no-op + warning if the platform's
// fs.watch errors out — the existing sync-time scan still works, so the
// only loss is real-time. Don't crash the server over this.
//
// Per-tab note: the watcher follows the **default** workspace (the one
// `active-workspace.json` points at), not every open profile. Tabs viewing
// a non-default workspace fall back to the existing 30s frontend poll.

import { existsSync, watch, type FSWatcher } from 'node:fs'
import { writeDesigndocsCached } from '../cache.js'
import { getLogger } from '../lib/log.js'
import { BUS_EVENT, publish } from '../lib/eventBus.js'
import { runWithWorkspace } from '../lib/workspaceContext.js'
import { getActiveDesignDocAdapter, runDesignDocScan } from './factory.js'

const DEBOUNCE_MS = 500

let activeWatcher: FSWatcher | null = null
let debounceHandle: ReturnType<typeof setTimeout> | null = null
let watchedWorkspaceId: string | null = null

export function startDesignDocWatcher(repoPath: string, adapter: string, workspaceId: string): void {
  if (activeWatcher) return // idempotent — only one watcher per process
  if (!repoPath) return
  // Ask the active adapter where to watch — it knows whether the project
  // uses openspec/, docs/specs/, or a custom spec_dir from config.
  const active = getActiveDesignDocAdapter(repoPath, adapter)
  const target = active?.getWatchTarget(repoPath) ?? null
  if (!target || !existsSync(target)) {
    // No spec dir present yet — design-doc integration silently disabled.
    // Nothing to watch. (Late-arrival of the dir is handled by the next
    // sync-time scan picking it up.)
    return
  }

  watchedWorkspaceId = workspaceId

  const log = getLogger()
  try {
    activeWatcher = watch(target, { recursive: true }, (eventType, filename) => {
      // Only react to files we know affect the scan output. Filter early to
      // avoid re-running the scan for every editor swap-file or cache write.
      if (!filename) return
      const f = String(filename)
      if (
        !f.endsWith('proposal.md') &&
        !f.endsWith('tasks.md') &&
        !f.endsWith('.md') // covers any other markdown the adapter reads
      ) {
        return
      }

      // Debounce: editors fire bursts of write/rename events on save. Coalesce
      // into one re-scan after the dust settles.
      if (debounceHandle) clearTimeout(debounceHandle)
      debounceHandle = setTimeout(() => {
        void rescanAndPublish(repoPath, adapter, eventType, f)
      }, DEBOUNCE_MS)
    })
    activeWatcher.on('error', (err) => {
      log.warn({ err: String(err) }, 'designdoc watcher error — closing')
      stopDesignDocWatcher()
    })
    log.info({ target, workspace: workspaceId }, 'designdoc watcher started')
  } catch (err) {
    log.warn({ err: String(err) }, 'failed to start designdoc watcher; falling back to sync-time scans only')
  }
}

export function stopDesignDocWatcher(): void {
  if (debounceHandle) {
    clearTimeout(debounceHandle)
    debounceHandle = null
  }
  if (activeWatcher) {
    try {
      activeWatcher.close()
    } catch {
      // Already closed — fine.
    }
    activeWatcher = null
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
