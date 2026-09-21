import type {
  AnnotationDTO,
  DesignDocCoverage,
  DetectedSchema,
  GraphResponse,
  ProjectDetail,
  SavedViewDTO,
  FieldDTO,
  LifecycleStageDTO,
  SyncLogEntry,
  Viewer,
  WorkflowState,
} from '@shared/types.js'
import { useWorkspaceStore } from '../store/workspaceStore'
import { ApiError, extractApiError } from './apiError'
import { authHeader } from './linearAuth'

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
  // 204 carries no body, and neither does a 200 with an empty one. Calling
  // res.json() on either throws "Unexpected end of JSON input" — which reads
  // as a failure even though the request succeeded, so the caller skips its
  // refresh and leaves a row on screen that the server has already deleted.
  // Clicking it again then 404s, which is how this surfaced.
  //
  // Pre-existing: DELETE /api/saved-views has always returned 204, so
  // savedViewsStore's delete path has had the same defect.
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (text.length === 0) return undefined as T
  return JSON.parse(text) as T
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
  // ─── Write-back ───────────────────────────────────────────────────────────
  // The only two calls that change something outside this app. They live on
  // `api` for the same reason saved views do (see the note further down): this
  // `http` helper throws a typed ApiError, which apiErrorMessage turns into a
  // translated sentence — a hand-rolled client would surface the server's raw
  // English instead.
  //
  // The Authorization header is attached per call rather than injected into
  // `http`, so the shared secret rides along with the two requests that need
  // it instead of every request the app makes.
  //
  // `assigneeId: null` means unassign; omitting the key leaves the assignee
  // alone. JSON.stringify preserves that difference, which is the whole reason
  // the patch is built by the caller rather than spread from a form.
  updateIssue: (
    identifier: string,
    patch: {
      stateId?: string
      assigneeId?: string | null
      priority?: number
      addedLabelIds?: string[]
      removedLabelIds?: string[]
    },
  ) =>
    http<{ ok: true }>(`/api/issues/${encodeURIComponent(identifier)}`, {
      method: 'PATCH',
      headers: authHeader(),
      body: JSON.stringify(patch),
    }),
  addIssueComment: (identifier: string, body: string) =>
    http<{ ok: true }>(`/api/issues/${encodeURIComponent(identifier)}/comments`, {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ body }),
    }),
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
  // Saved views deliberately live on `api` rather than in their own client
  // module: this `http` helper throws a typed ApiError that flows into
  // apiErrorMessage -> i18n, whereas notesApi.ts rolls its own and throws a
  // bare Error, which is why note failures surface untranslated.
  /** Create a batch of issues for agent sessions to work through one at a
   *  time. Members are stored; the ORDER is derived from `blocks` at read time,
   *  so it is never sent. */
  createBatch: (name: string, members: string[]) =>
    http<{ id: number; name: string; members: string[] }>('/api/batches', {
      method: 'POST',
      body: JSON.stringify({ name, members }),
    }),
  fetchBatch: (id: number) =>
    http<{
      id: number
      name: string
      progress: { total: number; done: number; claimed: number }
      members: { identifier: string; claimedBy: string | null; doneAt: number | null; blockedBy: string[] }[]
    }>(`/api/batches/${id}`),
  /** Move a workstream to a stage. Null takes it off the pipeline. The server
   *  only restamps its clock and records history on a REAL change, so calling
   *  this with the current stage is a no-op rather than a fake advance. */
  /** The workstream's own note. Null clears it; the route treats an absent key
   *  as "leave alone", so this always sends one. */
  setBatchNote: (id: number, note: string | null) =>
    http<unknown>(`/api/batches/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) }),
  setBatchStage: (id: number, stage: string | null) =>
    http<unknown>(`/api/batches/${id}`, { method: 'PATCH', body: JSON.stringify({ stage }) }),
  /** Archiving is how you take a workstream off the board without claiming it
   *  finished — the graph payload drops archived ones entirely. */
  setBatchStatus: (id: number, status: 'active' | 'archived') =>
    http<unknown>(`/api/batches/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  renameBatch: (id: number, name: string) =>
    http<unknown>(`/api/batches/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  addBatchMembers: (id: number, members: string[]) =>
    http<unknown>(`/api/batches/${id}/members`, { method: 'POST', body: JSON.stringify({ members }) }),
  removeBatchMember: (id: number, identifier: string) =>
    http<unknown>(`/api/batches/${id}/members/${identifier}`, { method: 'DELETE' }),
  /** A stage note. Writable on ANY stage, not only the current one — the spec
   *  folder is known before Spec review is reached, and a decision is recorded
   *  after Result review has passed. */
  setStageNote: (id: number, stageKey: string, body: string) =>
    http<unknown>(`/api/batches/${id}/notes/${encodeURIComponent(stageKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    }),
  clearStageNote: (id: number, stageKey: string) =>
    http<unknown>(`/api/batches/${id}/notes/${encodeURIComponent(stageKey)}`, { method: 'DELETE' }),
  /** Attach something by hand when the automatic link is missing. `kind` picks
   *  where it renders — see STAGE_LINK_KINDS. */
  attachToStage: (id: number, stageKey: string, kind: string, value: string, label?: string) =>
    http<unknown>(`/api/batches/${id}/links/${encodeURIComponent(stageKey)}`, {
      method: 'POST',
      body: JSON.stringify({ kind, value, label }),
    }),
  detachFromStage: (id: number, stageKey: string, value: string) =>
    http<unknown>(`/api/batches/${id}/links/${encodeURIComponent(stageKey)}`, {
      method: 'DELETE',
      body: JSON.stringify({ value }),
    }),
  deleteBatch: (id: number) => http<unknown>(`/api/batches/${id}`, { method: 'DELETE' }),
  /** `includeArchived` opts back in to what archiving took off the board. The
   *  panel is the one place they have to be reachable, or archiving would be
   *  indistinguishable from deleting. */
  fetchBatches: (includeArchived = false) =>
    http<{
      entries: {
        id: number
        name: string
        /** The note's first line — see shared/noteSummary.ts for why there is
         *  no separate description column. */
        summary: string | null
        stage: string | null
        status: 'active' | 'archived'
        createdAt: number
        updatedAt: number
        archivedAt: number | null
        progress: { total: number; done: number }
      }[]
    }>(
      includeArchived ? '/api/batches?status=all' : '/api/batches',
    ),
  fetchLifecycle: () => http<{ entries: LifecycleStageDTO[] }>('/api/lifecycle'),
  fetchFields: () => http<{ entries: FieldDTO[] }>('/api/fields'),
  /** An empty description removes the definition — see the route's note on why
   *  that is one call rather than a separate DELETE. */
  setFieldDescription: (name: string, description: string) =>
    http<FieldDTO | null>(`/api/fields/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ description }),
    }),
  createStage: (s: { name: string; key?: string; states?: string[]; nextCommand?: string | null }) =>
    http<LifecycleStageDTO>('/api/lifecycle', { method: 'POST', body: JSON.stringify(s) }),
  patchStage: (
    id: number,
    patch: {
      key?: string
      name?: string
      states?: string[]
      nextCommand?: string | null
      /** Everything that belongs on this stage — one list. A name in
       *  AUTO_FIELDS is filled by the app; any other is attached by hand.
       *  See migration 17 for why this is not two lists. */
      fields?: string[]
      /** Null means this stage never goes stale — the honest setting for a
       *  Discuss stage that legitimately runs for a fortnight. */
      staleAfterDays?: number | null
    },
  ) => http<{ ok: boolean }>(`/api/lifecycle/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteStage: (id: number) => http<unknown>(`/api/lifecycle/${id}`, { method: 'DELETE' }),
  /** The full key list, always — the server refuses a partial reorder rather
   *  than interleaving a stale order with the current one. */
  reorderStages: (keys: string[]) =>
    http<{ ok: boolean }>('/api/lifecycle/reorder', { method: 'POST', body: JSON.stringify({ keys }) }),
  fetchSavedViews: () => http<{ entries: SavedViewDTO[] }>('/api/saved-views'),
  createSavedView: (name: string, query: string) =>
    http<SavedViewDTO>('/api/saved-views', { method: 'POST', body: JSON.stringify({ name, query }) }),
  patchSavedView: (id: number, patch: { name?: string; query?: string; sortOrder?: number }) =>
    http<SavedViewDTO>(`/api/saved-views/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSavedView: (id: number) =>
    fetch(withWorkspaceParam(`/api/saved-views/${id}`), { method: 'DELETE' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
    }),
}
