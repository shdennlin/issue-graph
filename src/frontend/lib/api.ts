import type {
  AnnotationDTO,
  DesignDocCoverage,
  DetectedSchema,
  GraphResponse,
  SyncLogEntry,
  Viewer,
  WorkflowState,
} from '@shared/types.js'

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
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
    http<{ data: import('@shared/types.js').NormalizedIssue & { description: string | null } }>(
      `/api/issues/${encodeURIComponent(identifier)}`,
    ),
  fetchLabels: () => http<LabelsResponse>('/api/labels'),
  fetchHealth: () => http<{ ok: boolean }>('/api/health'),
  fetchMe: () => http<{ viewer: Viewer | null; issuesCached: number }>('/api/me'),
  fetchSyncHistory: () => http<{ entries: SyncLogEntry[] }>('/api/sync-history'),
  fetchSettings: () => http<SettingsResponse>('/api/settings'),
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
    fetch('/api/annotations?format=json').then((r) => r.json()),
  importAnnotations: (mode: 'merge' | 'replace', annotations: AnnotationDTO[]) =>
    http<{ ok: boolean; count: number }>('/api/annotations/import', {
      method: 'POST',
      body: JSON.stringify({ mode, annotations }),
    }),
  fetchSnapshots: () => http<{ entries: number[] }>('/api/snapshots'),
  fetchSnapshotDiff: (from: number, to: number) =>
    http<SnapshotDiff>(`/api/snapshot-diff?from=${from}&to=${to}`),
  exportUrl: (format: 'csv' | 'md') => `/api/export?format=${format}`,
  fetchCoverage: () => http<DesignDocCoverage>('/api/designdoc/coverage'),
}
