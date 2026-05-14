import { dirname, join } from 'node:path'
import { loadConfig } from './env.js'

/**
 * Directory holding the current workspace's data files. Mirrors the per-workspace
 * SQLite layout — for a profile id `client_a` this is `data/workspaces/client_a/`.
 * Resolved per-request via AsyncLocalStorage (loadConfig reads workspace context).
 */
export function getWorkspaceDataDir(): string {
  return dirname(loadConfig().SQLITE_PATH)
}

/**
 * On-disk location for note attachments (images). Each note gets its own
 * subdirectory so cleanup on delete is one `rm -rf`.
 */
export function getNoteAssetDir(noteId: number): string {
  return join(getWorkspaceDataDir(), 'notes-assets', String(noteId))
}
