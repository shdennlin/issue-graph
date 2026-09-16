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
 * Sentinel id used when the workspace roster is empty — nothing has been set
 * up yet and the onboarding screen is what the user sees. All caches stay
 * keyed by id, this one just has no credentials behind it.
 *
 * Previously named UNCONFIGURED_WORKSPACE_ID, for the single-workspace mode that
 * existed when profiles came from `WORKSPACE_*` env vars. That mode is gone:
 * an empty roster no longer means "one implicit workspace from LINEAR_API_KEY",
 * it means "not configured".
 */
export const UNCONFIGURED_WORKSPACE_ID = '__unconfigured__'

export function runWithWorkspace<T>(workspaceId: string, fn: () => T): T {
  return storage.run(workspaceId, fn)
}

/** Returns the current request's workspace id, or null if none was set. */
export function getCurrentWorkspaceId(): string | null {
  return storage.getStore() ?? null
}
