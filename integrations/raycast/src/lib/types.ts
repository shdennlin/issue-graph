// Minimal mirror of the subset of Issue Graph's wire contract this extension
// reads. The full shape lives in issue-graph's src/shared/types.ts — we only
// duplicate the fields we render so the extension stays decoupled.

export type IssueStateType =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "triage";

export interface NormalizedAssignee {
  displayName: string;
  avatarUrl?: string | null;
}

export interface NormalizedLabel {
  id: string;
  name: string;
  /** Hex colour (e.g. "#a44a3f"). Raycast tags accept hex strings directly. */
  color: string;
}

export type RelationType = "blocks" | "duplicate" | "related";

export interface NormalizedRelation {
  type: RelationType;
  targetIdentifier: string;
}

// Mirrors the subset of issue-graph's NormalizedIssue this extension renders.
// The `/api/graph` payload already carries all of these — the previous mirror
// just under-declared them, leaving the data unused. Newly-surfaced fields are
// optional so legacy/partial payloads still deserialize cleanly.
export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  estimate?: number | null;
  /** ISO date "YYYY-MM-DD" — user-set deadline. */
  dueDate?: string | null;
  startedAt?: string | null;
  state: { name: string; type: IssueStateType };
  team?: { key: string; name: string; color?: string | null } | null;
  assignee: NormalizedAssignee | null;
  labels?: NormalizedLabel[];
  cycle?: { number: number; startsAt: string; endsAt: string } | null;
  project?: { name: string; color?: string | null } | null;
  projectMilestone?: { name: string; targetDate: string | null } | null;
  parent?: string | null;
  children?: string[];
  relations?: NormalizedRelation[];
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  commentsCount?: number;
}

export interface GraphResponse {
  data: { issues: NormalizedIssue[] };
  /** Epoch ms of this workspace's last successful sync (0 if never synced). */
  fetchedAt: number;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
}

export interface WorkspacesResponse {
  active: WorkspaceProfile | null;
  profiles: WorkspaceProfile[];
  legacyMode: boolean;
}
