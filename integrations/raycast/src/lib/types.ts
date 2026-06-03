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

export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  state: { name: string; type: IssueStateType };
  assignee: NormalizedAssignee | null;
}

export interface GraphResponse {
  data: { issues: NormalizedIssue[] };
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
