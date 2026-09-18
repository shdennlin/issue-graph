// Shared types — the contract every other module depends on.
// PRD §3.3 (canonical state enum), §5.3 (NormalizedIssue/edge normalization), §5.4 (DesignDocChange).

export type IssueStateType =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled'
  | 'triage'

/**
 * Linear project state. Separate enum from IssueStateType: Linear's product
 * model distinguishes Project status from Issue workflow status (a project
 * can be 'planned' or 'paused' — states with no issue equivalent). We
 * normalize 'cancelled' (en-GB) → 'canceled' for the same reason as issues.
 */
export type ProjectStateType =
  | 'backlog'
  | 'planned'
  | 'started'
  | 'paused'
  | 'completed'
  | 'canceled'

export type Priority = 0 | 1 | 2 | 3 | 4

// One row from the backend's full workflow-states list. We fetch this
// alongside issues so the filter UI can show all possible states (including
// ones with 0 current matches) instead of inferring from cached issues.
export interface WorkflowState {
  id: string
  name: string                // literal Linear state name, e.g. "Review Spec"
  type: IssueStateType        // canonical type
  color?: string | null
  position?: number | null    // for ordering
  teamKey?: string | null     // multi-team workspaces — null = all/unknown
}

export type RelationType = 'blocks' | 'duplicate' | 'related'

export interface NormalizedLabelGroup {
  id: string
  name: string
}
// Exclusivity deliberately lives on DetectedSchema.otherGroups, not here.
// Linear's API does not expose it, so it can only be measured across the whole
// issue set (see schema/autodetect.ts) — a per-label copy could only ever be a
// hardcoded placeholder, which is what it used to be.

export interface NormalizedLabel {
  id: string
  name: string
  color: string
  group: NormalizedLabelGroup | null
}

export interface NormalizedAssignee {
  id?: string
  displayName: string
  email?: string | null
}

export interface NormalizedRelation {
  type: RelationType
  targetIdentifier: string
  /**
   * When the link itself was drawn. Optional because rows cached before this
   * field existed carry no value, and because a backend adapter need not
   * expose it.
   *
   * Load-bearing for recency: the backend bumps an issue's `updatedAt` when
   * someone merely points a relation *at* it, so an issue nobody touched can
   * look freshly active. Comparing `updatedAt` against this timestamp is what
   * tells the two apart — see `frontend/lib/linkTouch.ts`.
   */
  createdAt?: string
}

/**
 * A pull request Linear has attached to an issue.
 *
 * Sourced entirely from Linear's GitHub integration, which means it spans every
 * repository and needs no GitHub credential of ours. `linkKind` is what makes a
 * count meaningful: a stack's middle PRs say "contributes" and must not be
 * counted towards finishing the issue, while "closes" ones must.
 *
 * CI check status is NOT here and cannot be — Linear has a PullRequestCheck
 * type but no query path reaches PullRequest from an issue.
 */
export interface NormalizedPullRequest {
  url: string
  number: number | null
  repo: string | null
  /** Linear's own words: draft | open | merged | closed, and possibly others.
   *  Kept as reported rather than mapped onto an enum of ours — a value we did
   *  not anticipate should show through to the card, not vanish. */
  status: string | null
  targetBranch: string | null
  hasConflicts: boolean | null
  /** 'closes' counts towards finishing the issue; 'contributes' does not. */
  linkKind: string | null
  mergedAt: string | null
}

export interface NormalizedIssue {
  id: string
  identifier: string
  title: string
  url: string
  priority: Priority
  /** Linear story-point / time estimate. Null when unset. */
  estimate?: number | null
  /** ISO date string ("YYYY-MM-DD") — user-set issue deadline. Null when unset. */
  dueDate?: string | null
  /** ISO datetime — auto-set when issue first transitioned to a "started"
   *  state. Not user-settable; null until the first transition. */
  startedAt?: string | null
  state: { name: string; type: IssueStateType }
  /** Owning Linear team. `key` is the identifier prefix (e.g. "ENG" in
   *  "ENG-123"), `color` is the team accent (hex). */
  team?: { id: string; key: string; name: string; color: string | null } | null
  assignee: NormalizedAssignee | null
  labels: NormalizedLabel[]
  cycle?: { number: number; startsAt: string; endsAt: string } | null
  project?: {
    id: string
    name: string
    /** Linear project color (hex, e.g. '#a44a3f'). Null when never set in Linear. */
    color?: string | null
  } | null
  /** Linear Project Milestone — present only when both project and milestone are assigned. */
  projectMilestone?: {
    id: string
    name: string
    targetDate: string | null
    sortOrder: number | null
  } | null
  parent: string | null
  children: string[]
  relations: NormalizedRelation[]
  createdAt: string
  updatedAt: string
  completedAt: string | null
  /** Optional, backend-specific extras stashed for views that opt in. */
  raw?: unknown
  /** Set when Phase 3 comment-count fetch is enabled. */
  commentsCount?: number
  /**
   * When the newest comment was posted, or absent when the issue has none.
   *
   * Load-bearing for recency, and the reason it rides along in the bulk query
   * rather than waiting for the detail fetch: a comment bumps `updatedAt`, but
   * a later link pointed AT the issue overwrites that bump, and `updatedAt` has
   * only one slot. Without this field the comment becomes unprovable and a card
   * somebody was talking on 45 seconds earlier drops out of "recent activity".
   */
  lastCommentAt?: string
  /** Pull requests Linear has linked to this issue, across repositories. Absent
   *  rather than empty when the field was not fetched, so "no PRs" and "not
   *  asked for" stay distinguishable. */
  pullRequests?: NormalizedPullRequest[]
}

export interface ViewerOrganization {
  /** Linear organization display name (e.g. "OneLegion"). */
  name: string
  /** URL slug used in linear.app/<urlKey>/issue/... — stable workspace identifier. */
  urlKey: string
}

export interface Viewer {
  id: string
  displayName: string
  email?: string | null
  /** Workspace identity. Optional so legacy cached viewers (pre-1.2) still
   * deserialize cleanly until the next sync repopulates the field. */
  organization?: ViewerOrganization | null
}

export type DesignDocStatus = 'active' | 'parked' | 'archived'

export type DesignDocLinkStrategy = 'frontmatter' | 'folderName' | 'regexLine'

export interface DesignDocChange {
  name: string
  issueIdentifiers: string[]
  status: DesignDocStatus
  totalTasks: number
  doneTasks: number
  progress: number
  filePath: string
  // Per-strategy breakdown of which Linear IDs each linkage method found.
  // Used by the diagnostic page to surface why a change is/isn't linked.
  linkSources?: Record<DesignDocLinkStrategy, string[]>
  // Optional: identifies the git worktree this change came from. Absent on
  // single-checkout repos. When the same change name appears in multiple
  // worktrees (rare in practice — Spectra v2.3.0+ relocates rather than
  // duplicates), the linked-wins-by-mtime rule in factory.ts picks one
  // and discards the others, so consumers always see at most one record
  // per name.
  worktree?: { path: string; ref: string }
}

export interface DesignDocCoverage {
  totalChanges: number
  linkedChanges: number
  unlinkedChanges: number
  byStrategy: Record<DesignDocLinkStrategy, number>  // count of changes linked via this strategy (>=1 ID)
  perChange: Array<{
    name: string
    filePath: string
    status: DesignDocStatus
    ids: string[]
    sources: Record<DesignDocLinkStrategy, string[]>
  }>
  issuesMissingDoc: Array<{
    identifier: string
    title: string
    state: IssueStateType
    url: string
  }>
}

/**
 * Detail for a single Linear project, fetched lazily when the user opens the
 * ProjectPanel. Stored in graphStore.projectDetails keyed by project id.
 *
 * `progress` is what Linear reports (scope-weighted, 0..1). The panel also
 * displays a locally-computed issue-count breakdown derived from the cached
 * issue list, so both numbers may differ slightly.
 */
export interface ProjectDetail {
  id: string
  state: ProjectStateType
  progress: number
  lead: { displayName: string } | null
  startDate: string | null
  targetDate: string | null
  /** Short summary teaser (Linear's `description`, ~255 char limit). */
  description: string | null
  /** Full markdown body (Linear's `content`). When present, panels should
   *  render this instead of the short `description`. */
  content: string | null
  updates: Array<{
    id: string
    body: string
    createdAt: string
    userName: string | null
    /** Optional health enum from Linear updates: 'onTrack' | 'atRisk' | 'offTrack' | null. */
    health: string | null
  }>
  milestones: Array<{
    id: string
    name: string
    targetDate: string | null
    sortOrder: number | null
    /** Optional per-milestone markdown body. */
    description: string | null
    /** Linear's scope-weighted progress, 0..1. Same scale as Project.progress.
     *  Null when the backend doesn't expose it (e.g. older backends, or
     *  Linear hasn't populated it yet for a brand-new milestone). */
    progress: number | null
    /** Linear's milestone status enum: 'done' | 'next' | 'overdue' |
     *  'unstarted'. Null when not provided. Distinct from project status. */
    status: string | null
  }>
}

export interface IssueComment {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  user: { displayName: string } | null
}

export interface AnnotationDTO {
  id: number
  targetType: 'issue' | 'edge' | 'bucket'
  targetId: string
  body: string
  createdAt: number
  updatedAt: number
}

export interface NoteDTO {
  id: number
  /** Raw markdown. Title is derived from the first non-empty line at render time. */
  body: string
  /** Lower values sort first. Negative values allowed — new notes inserted at MIN-1. */
  sortOrder: number
  /** Archived notes are hidden from the default grid; recoverable via Restore. */
  archived: boolean
  createdAt: number
  updatedAt: number
}

/** A named snapshot of the URL's view + filter state, shared by everyone
 *  hitting the same server. `query` is a URL query string (no leading '?'),
 *  with `w` and record-pointer params already stripped — see
 *  backend/savedViewStore.ts. */
export interface SavedViewDTO {
  id: number
  name: string
  query: string
  /** Lower values sort first. Appended at max+1. */
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/**
 * One step in a workspace's own lifecycle.
 *
 * This is a PLAYBOOK, not a copy of Linear's workflow states. Linear owns which
 * states exist, their order, and which one an issue is in; what it has no field
 * for is "when an issue is here, this is the command that moves it on" — which
 * is the thing that makes a stage worth storing.
 *
 * `states` lists the Linear state NAMES this stage is compatible with. It is
 * used only to detect disagreement, never to derive the stage (see ADR-0002:
 * stages are finer than states, so derivation is impossible) and never to
 * correct either side.
 */
export interface LifecycleStageDTO {
  id: number
  /** Stable slug a workstream's stage points at. Unique per workspace. */
  key: string
  name: string
  /** Lower values sort first. Appended at max+1, same as SavedViewDTO. */
  sortOrder: number
  /** Compatible Linear state names, e.g. ["In Progress"]. Empty = compatible
   *  with everything, which is how a stage opts out of conflict detection. */
  states: string[]
  /** What usually happens here — a hint for whoever picks the work up, not a
   *  rule. Nothing validates it or triggers it. */
  nextCommand: string | null
  /**
   * Which facts this stage renders, from a closed vocabulary.
   *
   * These are PROJECTIONS, not fields: `pullRequests` means "read the members'
   * PRs", never "this stage stores PRs". So for most of what a stage shows
   * there is nothing to update on the stage — you update upstream.
   */
  shows: string[]
  /** How long a workstream may sit here before it is worth a nudge. Per stage,
   *  because the honest answer differs wildly — Discuss can take a fortnight,
   *  CI sitting for a day is wrong. Null means this stage never goes stale. */
  staleAfterDays: number | null
  createdAt: number
  updatedAt: number
}

/**
 * Whether a stored stage and the current Linear state agree.
 *
 * `unknown` is deliberately distinct from `conflict`: an issue whose stage was
 * never set, or whose stage key no longer exists, is not in disagreement — it
 * is unclassified, and drawing a warning on it would cry wolf on every issue
 * the moment a lifecycle is first configured.
 */
export type StageVerdict = 'ok' | 'conflict' | 'unknown'

/**
 * A Claude Code session reported by the hook plugin.
 *
 * This is the one fact an issue tracker structurally cannot hold: it is runtime
 * state, not a work item. Linear has no field for it and should not grow one.
 *
 * Reported by hooks rather than claimed by the agent on purpose. A hook fires
 * whether or not the model cooperates, so a session that crashes or forgets to
 * announce itself is still visible — and the ABSENCE of heartbeats is what
 * reveals that it died. An agent-claimed marker could only ever show sessions
 * that were well-behaved enough not to need watching.
 */
export interface AgentSessionDTO {
  sessionId: string
  /** The issue resolved from the branch, or null. Null is a normal outcome —
   *  plenty of real work has no ticket. */
  identifier: string | null
  branch: string | null
  cwd: string | null
  host: string | null
  /** Last slash command seen, for display only. */
  phase: string | null
  /**
   * `active` — moving.
   * `waiting` — the turn ended; it is your move, but nothing is stuck.
   * `blocked` — stopped on a permission prompt and doing nothing until someone
   *   answers. The only one that should pull a person over, which is why it is
   *   not folded into `waiting`.
   */
  status: 'active' | 'waiting' | 'blocked'
  lastSeen: number
  /** A name a person can recognise the terminal by — the repo directory and the
   *  branch. Derived server-side; a UUID identifies nothing to a reader. */
  label: string
}

/**
 * A workstream as the graph needs it: who belongs, not how far along.
 *
 * Progress and claims are deliberately absent — the Workstreams panel fetches
 * those per stream, and putting them here would grow every graph response for
 * data only one view reads. Membership alone is what draws the containers.
 *
 * Order is not carried either: the view lays members out with dagre inside a
 * container, and the `blocks` edges that decide sequence are already on the
 * issues.
 */
export interface WorkstreamSummaryDTO {
  id: number
  name: string
  members: string[]
  /** Which pipeline stage this feature has reached, or null before one is set.
   *  Stored and set explicitly — a pipeline describes a feature moving through
   *  it, and nothing else records where it has got to. */
  stage: string | null
  /** When the stage last changed, rewritten on a move backwards too: staleness
   *  times the CURRENT occupancy, not the first one. */
  stageEnteredAt: number | null
  /** Every stage this workstream has ARRIVED at, oldest first.
   *
   *  Carried raw rather than as computed durations because the duration of the
   *  current stage depends on `now`, which only the client knows — a server
   *  that pre-computed it would ship a number that was already stale. Small by
   *  nature: a workstream moves a handful of times over its life.
   *  `shared/stageHistory.ts` turns these into per-stage durations. */
  stageEvents: { stageKey: string; at: number }[]
  status: 'active' | 'archived'
  /** Agents this feature is assigned to. Durable — an agent that is not running
   *  right now is still whose job the work is, which is what separates this
   *  from AgentSessionDTO. */
  assignees: string[]
  /** Per-stage notes, keyed by stage key. Carried in full rather than as a
   *  flag: they are short, user-typed lines, and a truncated copy here plus a
   *  full one behind a click would be two versions of one thing. */
  notes: Record<string, string>
  /** Items attached by hand because the upstream link is missing. Kept apart
   *  from anything projected so the UI can mark them — see the migration
   *  comment on why that mark matters. */
  links: { stageKey: string; kind: string; value: string; label: string | null }[]
}

export interface GraphData {
  issues: NormalizedIssue[]
  labels: NormalizedLabel[]
  designdocs?: DesignDocChange[]
  annotations?: AnnotationDTO[]
  /** The workspace's lifecycle, ordered by sortOrder. Empty until configured. */
  lifecycle?: LifecycleStageDTO[]
  /** Live agent sessions. Already filtered by TTL — a row here is alive. */
  agentSessions?: AgentSessionDTO[]
  /** Workstreams and their membership, for the workstream view. */
  workstreams?: WorkstreamSummaryDTO[]
  viewer?: Viewer | null
  fetchedAt: number
}

export interface WorkspaceChangeWarning {
  /** Previous workspace urlKey (e.g. "shdennlin-example"). */
  previous: string
  /** Current workspace urlKey (e.g. "onelegion"). */
  current: string
  /** Unix ms when the change was detected during sync. */
  detectedAt: number
}

export interface GraphResponse {
  data: GraphData
  stale: boolean
  fetchedAt: number
  instanceLabel: string
  hasDesigndoc: boolean
  cacheEmpty: boolean
  authError?: boolean
  /** Set when the LAST sync failed. Distinct from `authError`, which only means
   *  no key is configured — a *wrong* key IS configured, so it used to surface
   *  as a silently empty graph with nothing on screen to explain it. */
  syncFailure?: { kind: 'auth' | 'error'; message: string | null } | null
  /** Set when sync detected a workspace switch. UI surfaces a banner +
   *  Reset Cache button. Cleared after acknowledge or successful reset. */
  workspaceWarning?: WorkspaceChangeWarning | null
}

export interface SyncLogEntry {
  id: number
  startedAt: number
  finishedAt: number | null
  status: 'success' | 'rate_limited' | 'api_error' | 'partial' | 'started'
  backend: string
  issuesCount: number | null
  errorMessage: string | null
}

export interface DetectedSchema {
  primaryGroup: string | null
  typeGroup: string | null
  prefixes: Array<{ token: string; labels: NormalizedLabel[] }>
  orphans: NormalizedLabel[]
  otherGroups: Array<{ name: string; labels: NormalizedLabel[]; exclusive: boolean }>
}
