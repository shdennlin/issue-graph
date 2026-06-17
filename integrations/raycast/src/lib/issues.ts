// Cross-workspace issue loading.
//
// issue-graph is multi-tenant: one SQLite cache per workspace, selected via
// `?w=<id>`. There is no single "all issues" endpoint, so to search across
// workspaces the client fans out — one `/api/graph?w=<id>` per profile in
// parallel — and merges, tagging each issue with the workspace it came from so
// deep links carry the correct `?w=`.

import type {
  GraphResponse,
  NormalizedIssue,
  WorkspaceProfile,
  WorkspacesResponse,
} from "./types";
import { graphEndpoint, workspacesEndpoint } from "./url";

export interface IssueRow extends NormalizedIssue {
  /** Owning workspace id, or undefined in legacy (single-workspace) mode. */
  workspaceId?: string;
  workspaceName: string;
}

/** Last successful sync for one workspace (epoch ms from the graph payload). */
export interface WorkspaceSync {
  /** undefined in legacy (single-workspace) mode. */
  workspaceId?: string;
  fetchedAt: number;
}

export interface LoadResult {
  profiles: WorkspaceProfile[];
  rows: IssueRow[];
  /** Per-workspace last-sync times, for the freshness indicator. */
  syncs: WorkspaceSync[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  return (await res.json()) as T;
}

async function loadWorkspaceIssues(
  baseUrl: string,
  profile: WorkspaceProfile,
): Promise<{ rows: IssueRow[]; fetchedAt: number }> {
  const graph = await getJson<GraphResponse>(
    graphEndpoint(baseUrl, profile.id),
  );
  const rows = graph.data.issues.map((issue: NormalizedIssue) => ({
    ...issue,
    workspaceId: profile.id,
    workspaceName: profile.name,
  }));
  return { rows, fetchedAt: graph.fetchedAt };
}

/** Loads the workspace list, then every workspace's issues in parallel. */
export async function loadEverything(baseUrl: string): Promise<LoadResult> {
  const { profiles } = await getJson<WorkspacesResponse>(
    workspacesEndpoint(baseUrl),
  );

  // Legacy mode: no profiles configured — a single default cache.
  if (profiles.length === 0) {
    const graph = await getJson<GraphResponse>(graphEndpoint(baseUrl));
    const rows: IssueRow[] = graph.data.issues.map((issue) => ({
      ...issue,
      workspaceName: "default",
    }));
    return { profiles, rows, syncs: [{ fetchedAt: graph.fetchedAt }] };
  }

  const perWorkspace = await Promise.all(
    profiles.map((p) => loadWorkspaceIssues(baseUrl, p)),
  );
  return {
    profiles,
    rows: perWorkspace.flatMap((w) => w.rows),
    syncs: perWorkspace.map((w, i) => ({
      workspaceId: profiles[i]?.id,
      fetchedAt: w.fetchedAt,
    })),
  };
}
