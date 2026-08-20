import type {
  AnnotationDTO,
  DesignDocCoverage,
  DetectedSchema,
  GraphResponse,
  ProjectDetail,
  SyncLogEntry,
  Viewer,
  WorkflowState,
} from '@shared/types.js'
import { useWorkspaceStore } from '../store/workspaceStore'

/**
 * Inject the current tab's workspace id as `?w=<id>` into a path. The
 * backend's per-request middleware (src/backend/index.ts) reads this and
 * scopes loadConfig / getDb / getBackend / sync to that workspace.
 *
 * No-op when:
 *   - the path already specifies `?w=` (caller is being explicit), or
 *   - the workspace store hasn't initialised yet (early bootstrap before
 *     /api/workspaces returns; the backend then falls back to its default).
 */
export function withWorkspaceParam(path: string): string {
  const id = useWorkspaceStore.getState().currentWorkspaceId
  if (!id) return path
  if (path.includes('?w=') || path.includes('&w=')) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}w=${encodeURIComponent(id)}`
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const url = withWorkspaceParam(path)
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export interface LabelsResponse {
  schema: DetectedSchema
  typeIcons: Record<string, string>
  yaml: unknown
  primaryGroupSingular: string | null
  workflowStates: WorkflowState[]
}

export interface SettingsResponse {
  env: Record<string, unknown>
  stored: Record<string, string | undefined>
  viewer: Viewer | null
  workspace?: {
    active: WorkspaceProfile | null
    profiles: WorkspaceProfile[]
  }
  /** Inbound-webhook health. The secret itself is never sent — this endpoint
   *  has no auth, so only the fact that one is set crosses the wire. */
  webhook?: {
    secret_set: boolean
    last_ok_ms: number | null
    ok_count: number
    last_reject_ms: number | null
    reject_count: number
    last_reject_reason: string | null
  }
}

export interface WorkspaceProfile {
  id: string
  name: string
  linearApiKeySet: boolean
  linearTeamId: string | null
  repoPath: string | null
  dbPath: string | null
}

export interface WorkspaceListResponse {
  active: WorkspaceProfile | null
  profiles: WorkspaceProfile[]
  legacyMode: boolean
}

export interface SnapshotDiff {
  from: number
  to: number
  added: string[]
  removed: string[]
  stateChanged: Array<{ identifier: string; from: string; to: string }>
}

export const api = {
  fetchGraph: () => http<GraphResponse>('/api/graph'),
  forceSync: () => http<{ ok: boolean; count: number; durationMs: number }>('/api/sync', { method: 'POST' }),
  resetCache: () =>
    http<{ ok: boolean; cleared: { issues: number; labels: number } }>('/api/reset-cache', { method: 'POST' }),
  acknowledgeWorkspaceChange: () =>
    http<{ ok: boolean }>('/api/acknowledge-workspace-change', { method: 'POST' }),
  // Lazy fetch extension: tell backend to also pull Canceled/Completed issues
  // within `days` (max 365). 0 clears. Triggers force-sync when days > 0.
  extendSyncScope: (days: number) =>
    http<{ ok: boolean; days: number; refetched: boolean; count?: number }>('/api/sync/extend', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  getSyncScope: () => http<{ days: number }>('/api/sync/extend'),
  fetchIssueDetail: (identifier: string) =>
    http<{ data: import('@shared/types.js').NormalizedIssue & { description: string | null; comments: import('@shared/types.js').IssueComment[] } }>(
      `/api/issues/${encodeURIComponent(identifier)}`,
    ),
  fetchProjectDetail: (projectId: string, opts?: { fresh?: boolean }) =>
    http<{ data: ProjectDetail }>(
      `/api/projects/${encodeURIComponent(projectId)}${opts?.fresh ? '?fresh=1' : ''}`,
    ),
  fetchLabels: () => http<LabelsResponse>('/api/labels'),
  fetchHealth: () => http<{ ok: boolean }>('/api/health'),
  fetchMe: () => http<{ viewer: Viewer | null; issuesCached: number }>('/api/me'),
  fetchSyncHistory: () => http<{ entries: SyncLogEntry[] }>('/api/sync-history'),
  fetchSettings: () => http<SettingsResponse>('/api/settings'),
  // GET /api/workspaces returns the **server-default** workspace + the full
  // profile list, regardless of this tab's `?w=`. Used by App bootstrap.
  fetchWorkspaces: () => http<WorkspaceListResponse>('/api/workspaces'),
  // Sets the server-default workspace (the one new tabs land on, and the one
  // the file watcher follows). Distinct from changing this tab's view —
  // that's a URL change handled in the workspace store.
  setDefaultWorkspace: (id: string) =>
    http<{ ok: boolean; active: WorkspaceProfile | null; changed: boolean }>('/api/workspaces/active', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  patchSettings: (patch: Record<string, unknown>) =>
    http<{ ok: boolean }>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  fetchAnnotations: () => http<{ entries: AnnotationDTO[] }>('/api/annotations'),
  createAnnotation: (a: { targetType: 'issue' | 'edge' | 'bucket'; targetId: string; body: string }) =>
    http<{ id: number }>('/api/annotations', { method: 'POST', body: JSON.stringify(a) }),
  patchAnnotation: (id: number, body: string) =>
    http<{ ok: boolean }>(`/api/annotations/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteAnnotation: (id: number) =>
    http<{ ok: boolean }>(`/api/annotations/${id}`, { method: 'DELETE' }),
  exportAnnotations: () =>
    fetch(withWorkspaceParam('/api/annotations?format=json')).then((r) => r.json()),
  importAnnotations: (mode: 'merge' | 'replace', annotations: AnnotationDTO[]) =>
    http<{ ok: boolean; count: number }>('/api/annotations/import', {
      method: 'POST',
      body: JSON.stringify({ mode, annotations }),
    }),
  fetchSnapshots: () => http<{ entries: number[] }>('/api/snapshots'),
  fetchSnapshotDiff: (from: number, to: number) =>
    http<SnapshotDiff>(`/api/snapshot-diff?from=${from}&to=${to}`),
  exportUrl: (format: 'csv' | 'md') => withWorkspaceParam(`/api/export?format=${format}`),
  fetchCoverage: () => http<DesignDocCoverage>('/api/designdoc/coverage'),
}
