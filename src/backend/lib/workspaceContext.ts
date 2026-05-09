// Per-request workspace context, propagated via AsyncLocalStorage so that
// existing call sites (loadConfig, getDb, getBackend, cache.*) don't have to
// thread a workspaceId argument through every function.
//
// A request middleware wraps the handler in `runWithWorkspace(wid, ...)`.
// Background tasks (designdoc watcher rescans, server bootstrap, daily
// snapshot timer) wrap their own work in the same helper so writes land in
// the right DB.

import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<string>()

/**
 * Sentinel id used when no `WORKSPACE_*` profiles are configured (legacy
 * single-workspace mode). All caches still keyed by id, just one entry.
 */
export const LEGACY_WORKSPACE_ID = '__legacy__'

export function runWithWorkspace<T>(workspaceId: string, fn: () => T): T {
  return storage.run(workspaceId, fn)
}

/** Returns the current request's workspace id, or null if none was set. */
export function getCurrentWorkspaceId(): string | null {
  return storage.getStore() ?? null
}
