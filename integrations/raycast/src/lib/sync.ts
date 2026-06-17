// Cross-workspace sync triggering.
//
// The read side (loadEverything) fans out one GET /api/graph per workspace;
// this is its write-side mirror. /api/sync is workspace-scoped via the same
// `?w=` middleware, so forcing a refresh across workspaces means one POST per
// profile, in parallel. The caller decides the scope (all profiles, just the
// selected one, or the legacy default).

import { syncEndpoint } from "./url";

/** Subset of the backend SyncResult we surface to the UI. */
interface SyncResult {
  ok: boolean;
  count: number | null;
  status: string;
  errorMessage?: string;
}

async function postSync(
  baseUrl: string,
  workspaceId?: string,
): Promise<SyncResult> {
  const res = await fetch(syncEndpoint(baseUrl, workspaceId), {
    method: "POST",
  });
  // /api/sync answers 200 on success and 500 on failure — both carry a JSON
  // body shaped like SyncResult. Treat an unparseable body as a failure.
  const body = (await res
    .json()
    .catch(() => null)) as Partial<SyncResult> | null;
  return {
    ok: res.ok && body?.ok !== false,
    count: body?.count ?? null,
    status: body?.status ?? (res.ok ? "success" : "api_error"),
    errorMessage: body?.errorMessage,
  };
}

export interface SyncSummary {
  /** Workspaces that synced cleanly. */
  okCount: number;
  /** Workspaces whose sync failed. */
  failedCount: number;
  /** Total issues pulled across the synced workspaces. */
  issues: number;
  /** First error message, if any, for the failure toast. */
  firstError?: string;
}

/**
 * Force-sync the given workspaces in parallel and roll the per-workspace
 * results into one summary. Pass a single `undefined` for legacy mode.
 */
export async function syncWorkspaces(
  baseUrl: string,
  workspaceIds: Array<string | undefined>,
): Promise<SyncSummary> {
  const results = await Promise.all(
    workspaceIds.map((id) => postSync(baseUrl, id)),
  );
  const okCount = results.filter((r) => r.ok).length;
  return {
    okCount,
    failedCount: results.length - okCount,
    issues: results.reduce((n, r) => n + (r.count ?? 0), 0),
    firstError: results.find((r) => !r.ok)?.errorMessage,
  };
}
