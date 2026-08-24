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
import { ApiError, extractApiError } from './apiError'

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
    // Surface the server's sentence, not the JSON envelope around it — these
    // reach the user directly in the setup form.
    const { code, message } = extractApiError(text)
    throw new ApiError(message, res.status, code)
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
  webhookSecretSet: boolean
  linearTeamId: string | null
  dbPath: string
}

export interface WorkspaceListResponse {
  active: WorkspaceProfile | null
  profiles: WorkspaceProfile[]
  /** Empty roster — nothing has been set up yet, so the app shows onboarding. */
  unconfigured: boolean
}

/** Credential fields are patch-style: omit one to keep the stored value, pass
 *  '' to clear it. That is what lets the form show an empty password box
 *  without wiping the secret on every unrelated save. */
export interface WorkspaceInput {
  name?: string
  apiKey?: string
  teamId?: string | null
  webhookSecret?: string
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
  createWorkspace: (input: WorkspaceInput & { id: string }) =>
    http<{ ok: boolean; id: string; dbPath: string; adoptedExistingData: boolean }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWorkspace: (id: string, input: WorkspaceInput) =>
    http<{ ok: boolean; id: string }>(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteWorkspace: (id: string) =>
    http<{ ok: boolean; id: string; dataRetained: boolean }>(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
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
