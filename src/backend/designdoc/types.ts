import type { DesignDocChange } from '@shared/types.js'

export interface DesignDocAdapter {
  readonly name: string
  detect(repoRoot: string): boolean
  scan(repoRoot: string): DesignDocChange[]
  /**
   * Absolute path to watch for live spec changes (recursive). Returns null
   * when the adapter has nothing to watch — e.g. detect() would fail. The
   * watcher uses this so it doesn't need to know any tool's directory
   * convention; each adapter owns where its specs live.
   */
  getWatchTarget(repoRoot: string): string | null
}
