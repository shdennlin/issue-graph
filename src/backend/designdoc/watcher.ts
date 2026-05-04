// Watch REPO_PATH/openspec/ for changes and re-run the design-doc scan
// whenever proposal.md / tasks.md / frontmatter changes. On settle, write
// the new payload to cache_meta and publish a 'designdoc-changed' event so
// connected SSE clients refetch immediately.
//
// fs.watch with { recursive: true } works on macOS (FSEvents) and modern
// Linux (Node 20+). Falls back to a no-op + warning if the platform's
// fs.watch errors out — the existing sync-time scan still works, so the
// only loss is real-time. Don't crash the server over this.

import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { writeDesigndocsCached } from '../cache.js'
import { getLogger } from '../lib/log.js'
import { publish } from '../lib/eventBus.js'
import { runDesignDocScan } from './factory.js'

const DEBOUNCE_MS = 500

let activeWatcher: FSWatcher | null = null
let debounceHandle: ReturnType<typeof setTimeout> | null = null

export function startDesignDocWatcher(repoPath: string, adapter: string): void {
  if (activeWatcher) return // idempotent — only one watcher per process
  if (!repoPath) return
  const target = join(repoPath, 'openspec')
  if (!existsSync(target)) {
    // No openspec/ directory — design-doc integration silently disabled.
    // Nothing to watch.
    return
  }

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
    log.info({ target }, 'designdoc watcher started')
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
}

async function rescanAndPublish(
  repoPath: string,
  adapter: string,
  eventType: string,
  filename: string,
): Promise<void> {
  const log = getLogger()
  try {
    const designdocs = await runDesignDocScan(repoPath, adapter)
    writeDesigndocsCached(designdocs)
    publish({
      type: 'designdoc-changed',
      data: { eventType, filename, count: designdocs?.length ?? 0 },
    })
    log.debug({ filename, count: designdocs?.length ?? 0 }, 'designdoc rescan published')
  } catch (err) {
    log.warn({ err: String(err) }, 'designdoc rescan failed')
  }
}
