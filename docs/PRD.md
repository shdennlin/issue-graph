# Issue Graph — Engineering PRD

> [!NOTE]
> **Historical document — pre-implementation snapshot from 2026-05-01.**
> Some planned items shifted during implementation:
> - **Bucket view** and **Mix view** merged into a single Mix view (the toolbar no longer has a separate Bucket button).
> - **Timeline view** was deferred — daily snapshots are still written to SQLite (`scripts/backup.sh`, `snapshot` table) but no UI surfaces them yet.
> - **Phasing language** ("Phase 1a / 1b / 2 / 3") is internal planning vocabulary; v1.0 ships everything that was Phases 1a → 3.
> - **Stack:** migrated from `better-sqlite3` to `bun:sqlite` post-spec (Bun refused to load the N-API binding — see [oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290)).
> - **`scripts/backup.sh` was removed.** It was never wired to anything — no cron
>   shipped, nothing invoked it, and no instance had ever run it. §12.1's local
>   rotation design is unimplemented; `rsync` of `data/` is the documented answer.
> > - **Four env vars below were specced but never implemented** and have been dropped from the config schema: `LINEAR_WORKSPACE`, `LOG_TO_FILE`, `SYNC_LOG_RETENTION`, `DESIGNDOC_REQUIRED`. Nothing ever read them. In particular there is **no file logging** — the `/app/data/logs/app.log` mentioned in §"Operations" does not exist; logs go to stdout only.
>
> For **current capabilities**, see [`../README.md`](../README.md). For **what's planned next**, see [`../ROADMAP.md`](../ROADMAP.md). This PRD is preserved for design rationale and decision history (§16).

**Status:** Approved · Phase 1a ready to start
**Author:** shdennlin
**Created:** 2026-05-01
**Audience:** Engineering (self + future contributors + open-source users)
**Revision history:** see git log on this file. Decision rationale: see §16.

> **Naming note:** Tool is named **Issue Graph** (`issue-graph`). Although v1 only supports Linear, the name is intentionally generic — "issue" is the universal term across Linear / GitHub / Jira / Plane / GitLab. The architecture (declarative label schema, pluggable backend adapters) leaves room for additional backends without breaking changes.

> **Public-repo discipline:** This tool is published to a public GitHub repo. **No internal hostnames, server names, IP addresses, or org-specific paths in code, README, or any committed document.** All deployment specifics live in the user's own `.env` and external runbook.

---

## 0. TL;DR

A small **open-source** tool that fetches issues from a project management system (currently Linear), optionally scans local design-doc systems (Spectra/OpenSpec), and renders an interactive graph of issues, buckets, and `blocks` dependencies. Designed for personal use and small-team visibility on internal networks.

- **Repo model:** Standalone GitHub **public** repo
- **Stack:** TypeScript end-to-end. Code is Node-compatible (`@hono/node-server` + `better-sqlite3`); the official v1 image runs Bun for build + runtime simplicity. React + Vite + React Flow + dagre on the frontend.
- **Deployment:** Docker, runs anywhere — local dev box, internal server, home lab.
- **Scope:** Read-only on the source tool. Phase 2 adds local-only writes (annotations, settings).
- **Phasing:** Phase 1a (~1 day): Dependency view + basic node + state filter + manual refresh. Phase 1b (~0.5 day): Bucket / Mix views + schema-driven node rendering + URL deep linking. Phase 2 follows for snapshots, settings, annotations, timeline, exports.
- **Generic by design:** Works with any Linear workspace via declarative label schema. Spectra/OpenSpec integration is opt-in (auto-detected). No hardcoded assumptions about label names, services, or projects.

---

## 1. Problem & Motivation

### 1.1 Current pain (generalizable to any small team using Linear)
- Linear has no native dependency graph view.
- Existing mermaid-based scripts work for tiny graphs but:
  - Look ugly when many issues have no `blocks` relations (all isolated nodes line up on one row).
  - Information density is low (ID + truncated title only).
  - No filtering, no zoom, no project/service grouping.
  - Mermaid does not scale past ~50 nodes.
- For users with separate "design docs" (Spectra, OpenSpec, RFC files), progress on a ticket lives in markdown files — invisible at the Linear issue level.
- Cross-service dependencies are not surfaced anywhere.

### 1.2 Goal
A persistent web-accessible URL where:
- All active issues and their `blocks` relationships are visualized.
- Issues are grouped by component/service (any exclusive Linear label group).
- Design-doc progress per issue is shown inline (when detected; optional).
- Filters by service / priority / assignee / labels can be shared via URL.
- The team can open the same URL from an internal-network browser.

### 1.3 Why open-source
- Tool itself is generic. Most teams with multi-repo / multi-service projects have similar needs.
- All project-specific behavior (label schema, design-doc location, code detectors) is configurable. No hardcoded assumptions.
- Personal portfolio value; encourages contributions and bug reports.

### 1.4 No hardcoded domain assumptions

This tool makes no assumption about:
- The name of label groups (`service`, `module`, `team`, `area`, `domain` — all valid).
- The values inside groups (no "central / core-api / frontend" hardcoded list).
- Whether buckets relate to each other at all (some projects have flat buckets with no inter-bucket edges).
- Whether buckets correspond to code (marketing/content/product teams may use the tool without writing a single line).
- Where design docs live (`openspec/changes/`, `docs/rfc/`, `proposals/` — all configurable).

The vocabulary "service" / "service dependency" used elsewhere in this doc is **example shorthand only** — drawn from a multi-service codebase the author happens to maintain. The actual code uses neutral terms (`bucket`, `bucketLabel`, `bucketRelation`). Substitute "service" with whatever your team's primary label group is called.

### 1.5 Non-goals (explicitly out of scope)
- Editing issues from the UI (Linear already does this well).
- Real-time updates (manual refresh is fine).
- User authentication (internal-network trust model).
- Mobile / responsive layout (desktop only).
- Server-side rendering (pure SPA).
- Internationalization.
- Sub-issue / cycle / project hierarchy display (schema reserves these fields, UI does not consume them in v1).

---

## 2. Users & Use Cases

### 2.1 Primary user (you)

| Scenario | Frequency | Current pain | Solved by |
|---|---|---|---|
| "What should I work on next?" | Daily | Open Linear, scroll, mental model of blockers | Dependency view (READY = no incoming blocks) |
| "How is ticket X progressing?" | Daily | Open design-doc folder, count checkboxes | Progress bar on node |
| "If I change bucket X, what breaks?" | Weekly | Mental model | Bucket view, downstream highlight |
| "Sprint planning — what's at risk?" | Bi-weekly | Slow Linear filtering | Filters + Mix view |

### 2.2 Secondary users (team, 1–2 people)

| Scenario | Frequency | Solved by |
|---|---|---|
| "Where's project X?" | Weekly | Internal URL, see filtered view |
| "Why is my task blocked?" | Daily | Click node → see blocker chain |
| "Discuss in chat" | Frequent | Share deep link with `?focus=<id>` |

---

## 3. High-level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Container: issue-graph (single Docker image)    │
│                                                              │
│   ┌────────────────┐     ┌──────────────────────┐           │
│   │  Frontend SPA  │ ──► │  Backend (Hono)      │           │
│   │  React + RF    │     │  Port 31415          │           │
│   └────────────────┘     │                      │           │
│   served as static       │  /api/graph          │           │
│                          │  /api/sync           │           │
│                          │  /api/snapshots/...  │           │
│                          │  /api/health, /ready │           │
│                          └──────────┬───────────┘           │
│                                     │                       │
│                  ┌──────────────────┼──────────────────┐    │
│                  ▼                  ▼                  ▼    │
│          ┌──────────────┐   ┌──────────────┐  ┌──────────┐ │
│          │ Backend      │   │ SQLite DB    │  │ host repo│ │
│          │ adapter      │   │ (volume)     │  │ (mount)  │ │
│          │ (Linear v1)  │   │              │  │ optional │ │
│          └──────────────┘   └──────────────┘  └──────────┘ │
└──────────────────────────────────────────────────────────────┘
                                                       │
                       ┌───────────────────────────────┘
                       ▼
           Volumes mounted by docker-compose:
           - ./data:/app/data            (SQLite + snapshots)
           - <host repo>:/repo:ro         (optional, for design-doc / code scan)
           - .env                        (secrets, never committed)
```

### 3.1 Why a single container

- One runtime (Bun), one language (TypeScript), one build artifact.
- Frontend is built into static files; backend serves them. No cross-origin, no separate hosts.
- Works the same wherever Docker runs.

### 3.2 Why Bun + Hono

| Choice | Reason |
|---|---|
| Bun (build-time) | Combines runtime + bundler; faster install/build than Node + npm; native TypeScript. Used to build, but **runtime is Node-compatible** — see below. |
| Hono via `@hono/node-server` | Runs on Node's `node:http`; not bound to Bun's `Bun.serve`. Lets users run on either runtime. |
| better-sqlite3 | Synchronous API; battle-tested 12-year-old lib; works in both Bun and Node. Avoids `bun:sqlite` lock-in. |
| React Flow | Mature graph lib; pluggable layouts; good performance to ~200 nodes. |
| dagre | Battle-tested DAG layout; integrates with React Flow via `@dagrejs/dagre`. |
| Tailwind | Standard utility-first CSS; quick prototyping. |
| Zustand | Lighter than Redux; URL-syncable; sufficient for this app. |

**Bun-native vs Node-compat:** v1 deliberately avoids Bun-specific APIs (`bun:sqlite`, `Bun.serve`, `Bun.file`) so the same code runs under either runtime. Trade-off: ~30s slower Docker build (native binding for `better-sqlite3`), but users with existing Node setups can run without installing Bun. Performance difference is negligible at this scale (< 1k issues).

### 3.3 Backend adapter (extension point)

Backend code is structured around a `BackendAdapter` interface so future versions can add Jira, Plane, GitHub Projects, etc. without rewriting the rest of the app.

```ts
// src/backend/sources/types.ts
export type IssueStateType =
  | 'backlog'
  | 'unstarted'      // ≈ "todo"
  | 'started'        // ≈ "in progress"
  | 'completed'      // ≈ "done"
  | 'canceled'
  | 'triage'

export interface Viewer {
  id: string
  displayName: string
  email?: string | null   // optional — GitHub/Jira/Plane may not expose email
}

export interface BackendAdapter {
  fetchAllIssues(opts: FetchOpts): Promise<NormalizedIssue[]>
  fetchIssueDetail(id: string): Promise<IssueDetail>
  fetchViewer(): Promise<Viewer>
  fetchLabels(): Promise<NormalizedLabel[]>
}
```

**Canonical state enum.** Each backend has its own state vocabulary (Linear: `state.type`; GitHub: `state` + closed-reason; Jira: workflow status name). Adapters normalize into the `IssueStateType` union above; UI labels map this to display strings ("Done", "Cancelled", "In Progress"). This is the only contract the rest of the app depends on.

V1 ships with `LinearBackend`. Selection happens via `BACKEND=linear` (only valid value in v1; field exists for future-proofing).

**Configuration philosophy:** vars that talk to a specific backend use that backend's official prefix (`LINEAR_API_KEY`, `LINEAR_TEAM_ID` — matching Linear's official docs). Vars that are intrinsic to issue-graph (`ISSUE_SCOPE`, `PRIMARY_GROUP`, `STALE_DAYS`, `PORT`) use no prefix. This matches industry convention (Sentry, Datadog, Stripe, Cloudflare all use backend-specific prefixes — none use abstraction-layer prefixes like `PM_*`).

### 3.4 Repo location & visibility

**Primary repo:** standalone GitHub **public** repo under personal account.

**Branch strategy:** `main` (stable) + `develop` (active work) + feature branches.

```
issue-graph/        (own GitHub public repo)
├── src/
│   ├── backend/
│   │   ├── sources/             (BackendAdapter implementations: linear, jira-future, …)
│   │   ├── designdoc/           (design-doc scanner: spectra, openspec, …)
│   │   ├── schema/              (label schema autodetect + env override + yaml loader)
│   │   ├── routes/              (HTTP handlers — see §5.1)
│   │   └── lib/                 (logging, env parsing)
│   ├── frontend/
│   └── shared/
├── docs/
│   ├── PRD.md
│   └── (other docs)
├── data/                        (gitignored, SQLite + snapshots live here)
├── public/                      (static frontend assets)
├── scripts/
│   └── backup.sh
├── .github/
│   └── workflows/               (CI: lint + typecheck)
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── .dockerignore
├── LICENSE                      (MIT)
└── README.md
```

**Implications of being open-source:**
- No org-specific assumptions in code or docs.
- README targets a generic user.
- LICENSE file (MIT) included from day one.
- Internal hostnames, server names, IP addresses, and org-specific paths **never** appear in the repo. Deployment specifics live in user's external runbook + `.env`.
- Issue templates + contributing guide added in Phase 3.

---

## 4. Deployment Topology

### 4.1 Same image, multiple instances

The Docker image is identical across deployments. Behavior differs based on `.env` and mounted volumes. Common deployment shapes:

| Shape | Mount design-doc repo? | Audience | Use case |
|---|---|---|---|
| **Personal local** | yes (read-write or read-only path you control) | self | WIP design-doc progress visible |
| **Internal shared** | yes (mount a periodically `git pull`-ed checkout) | small team | committed design-doc progress only |
| **Issues-only** | no | anyone | minimal install — just visualizes Linear |

Identify the instance via `INSTANCE_LABEL=...` (free-form string). UI shows a banner:

```
🟢 personal-local  · uncommitted design-docs included
🌐 team-shared     · last sync 8m ago
🔵 issues-only     · no design-doc integration
```

The instance label is purely cosmetic — it has no effect on behavior.

### 4.2 Optional design-doc directory sync

If the operator wants the "team-shared" shape with committed design-doc progress, they manage the repo checkout themselves (cron, systemd timer, scheduled task — out of scope for this tool). The tool only reads from `${REPO_PATH}` and is unaware of how it got there.

If `${REPO_PATH}` is unset or doesn't contain a recognized design-doc directory, the design-doc integration is silently disabled.

### 4.3 Why no Webhook

Decision deferred to v3+ (or never). Rationale:

- Public endpoint = signature verification + retry/dedup + abuse protection.
- Cache TTL + manual refresh is sufficient for our use cases.
- Internal-network deployment has no public exposure, simpler trust model.

---

## 5. Backend Design

### 5.1 Endpoints

**Phase 1 endpoints (MVP):**

```
GET    /api/graph                       Returns full graph data (cached)
POST   /api/sync                        Force a fresh fetch from backend (bypass cache)
GET    /api/issues/:identifier          Lazy-load full issue detail (description, etc.)
GET    /api/labels                      Return detected label schema (for UI rendering)
GET    /api/health                      Liveness (200 OK if process running)
GET    /api/ready                       Readiness (200 OK if SQLite + last sync OK)
GET    /                                Static frontend
GET    /assets/*                        Static assets
```

**Path-parameter convention:** the URL uses **human-readable identifier** (e.g., `PROJ-123`), not the backend's internal opaque id. This matches the URL deep-link convention (`?focus=PROJ-123`) and means users can paste an issue ID from chat and have it work in the URL bar. The frontend store keeps both `id` (backend-internal, used for foreign-key joins) and `identifier` (URL-safe, displayed); the backend translates incoming identifiers to internal ids before calling the adapter's `fetchIssueDetail(id)`.

**Phase 2 endpoints (added in §15 Phase 2):**

```
GET    /api/snapshots            List snapshot timestamps
GET    /api/snapshots/:ts        Return snapshot data

GET    /api/annotations          List annotations
POST   /api/annotations          Create annotation
PATCH  /api/annotations/:id      Update annotation
DELETE /api/annotations/:id      Delete annotation

GET    /api/settings             Per-instance UI preferences
PATCH  /api/settings             Update preferences
```

The Phase 2 endpoints are write-capable (`POST`/`PATCH`/`DELETE`); see §13 for the security implications.

### 5.2 Data flow on `/api/graph`

```
1. Read cache_meta from SQLite
2. If last_sync < TTL (5 min): return cached graph
3. Else: trigger background fetch (don't block response)
4. Return cached graph immediately + flag "stale: true"
```

Force refresh (`POST /api/sync`) blocks until fetch completes.

### 5.3 Backend adapter (Linear in v1)

The backend never talks to Linear directly outside `src/backend/sources/linear/`. All other code uses the `BackendAdapter` interface and works with `NormalizedIssue` / `NormalizedLabel` shapes.

**Configuration via env vars** — backend-specific configuration uses that backend's official prefix; tool-intrinsic configuration uses no prefix.

**Generic (apply regardless of backend):**

| Variable | Default | Purpose |
|---|---|---|
| `BACKEND` | `linear` | Which adapter to load. v1: only `linear`. |
| `ISSUE_SCOPE` | `active+recent` | `active` / `active+recent` / `all`. Tool-level concept. |

**Linear-specific (when `BACKEND=linear`):**

| Variable | Default | Purpose |
|---|---|---|
| `LINEAR_API_KEY` | (required) | Personal API key from Linear → Settings → API. |
| `LINEAR_API_ENDPOINT` | `https://api.linear.app/graphql` | Override for self-hosted Linear (rare). |
| `LINEAR_WORKSPACE` | (auto from API key) | Workspace slug, when API key has access to multiple workspaces. |
| `LINEAR_TEAM_ID` | (empty = all) | Restrict to one team. |

**Future Jira-specific (when `BACKEND=jira`, Phase 4):**

| Variable | Default | Purpose |
|---|---|---|
| `JIRA_BASE_URL` | (required) | e.g. `https://yourorg.atlassian.net` |
| `JIRA_EMAIL` | (required) | API token authentication user |
| `JIRA_API_TOKEN` | (required) | Token from Atlassian → Profile → Security |
| `JIRA_PROJECT_KEY` | (empty = all) | Restrict to one project |

**Linear-specific GraphQL query** (lives in `src/backend/sources/linear/queries.ts`):

```graphql
query GraphData($after: String, $filter: IssueFilter) {
  issues(first: 100, after: $after, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier              # e.g., "PROJ-123"
      title
      url
      priority                # 0=none, 1=urgent, 2=high, 3=med, 4=low
      state { name type }
      assignee { displayName email }
      labels(first: 30) {
        nodes {
          id
          name
          color
          parent { id name }            # if non-null, label belongs to a label group
        }
      }
      cycle { number startsAt endsAt }
      project { id name }
      parent { identifier }
      children(first: 20) { nodes { identifier } }
      relations(first: 30) {
        nodes {
          type                # "blocks", "blocked_by", "duplicate", "related"
          relatedIssue { identifier }
        }
      }
      createdAt
      updatedAt
      completedAt
    }
  }
}
```

Pagination: 100 per page, follow `hasNextPage` until exhausted.

**Issue scope filter:** `ISSUE_SCOPE` (default: `active+recent`). Uses canonical `IssueStateType` enum (defined in §3.3):
- `active` — `state.type IN ('backlog', 'unstarted', 'started', 'triage')`
- `active+recent` — active + `completed` within last 30 days
- `all` — everything including `canceled`

**Description loading:** `description` field is **NOT** fetched in the bulk query (large payload, often unused). Lazy-loaded via separate `query Issue($id)` when user opens detail panel — implemented as `fetchIssueDetail(id)` in the adapter.

**Label group metadata.** Linear represents label groups via the `parent` field on a label (parent label = the group; group labels themselves have null `parent`). The adapter normalizes this into `NormalizedLabel.group` (see §5.3 type definition). `exclusive` is **not directly available** on the parent in the issue-bound query — it's a property of the group label itself fetched via a separate `issueLabels(filter: { parent: { null: true } })` call once at sync time. Auto-detection treats any label whose `parent.name` matches the heuristics in §8.1 as the bucket label; whether the group is enforced exclusive is observed empirically (does any issue have two labels from the same group?), not asserted from API metadata.

**`NormalizedIssue` shape** (what the rest of the app sees, regardless of backend):

```ts
type NormalizedIssue = {
  id: string                   // backend-internal id
  identifier: string           // human-readable, e.g. "PROJ-123"
  title: string
  url: string                  // direct link to issue in source tool
  priority: 0 | 1 | 2 | 3 | 4
  state: { name: string; type: IssueStateType }   // see canonical enum in §3.3
  assignee: { displayName: string; email?: string | null } | null
  labels: NormalizedLabel[]
  parent: string | null        // identifier
  children: string[]
  // Canonical edge direction (see normalization rule below):
  //   - For 'blocks':    `from` = THIS issue (blocker), `to` = `targetIdentifier` (blocked).
  //   - 'blocked_by' is reversed at normalization time into a 'blocks' edge with swapped endpoints,
  //     and is therefore NOT present in this list.
  //   - 'duplicate' / 'related' are symmetric; we keep them as-is, dedup within the adapter.
  relations: Array<{ type: 'blocks' | 'duplicate' | 'related'; targetIdentifier: string }>
  createdAt: string            // ISO 8601
  updatedAt: string
  completedAt: string | null
  // Backend-specific extras stashed here for views that opt in
  raw?: unknown
}

type NormalizedLabel = {
  id: string
  name: string
  color: string                // hex
  group: {
    id: string
    name: string
    exclusive: boolean         // observed exclusivity (see §8.1) — true = no issue has two labels from this group
  } | null                     // null if flat label (no parent group)
}
```

**`blocks` edge normalization (canonical direction).**

Linear (and most PM tools) record blocking as a bidirectional relation: from the blocker's view it's `blocks`, from the blocked issue's view it's `blocked_by`. Without normalization, the same edge appears twice in the data with opposite types — confusing both for code that builds the graph and for "READY = no incoming blocks" logic.

The adapter normalizes:

```
INPUT  (Linear API):
  Issue A.relations = [{ type: 'blocks', targetIdentifier: 'B' }]
  Issue B.relations = [{ type: 'blocked_by', targetIdentifier: 'A' }]

OUTPUT (NormalizedIssue):
  A.relations = [{ type: 'blocks', targetIdentifier: 'B' }]    # kept
  B.relations = []                                              # 'blocked_by' dropped (already represented on A)
```

**Canonical edge for the graph layer:** `edge.from = blocker`, `edge.to = blocked`. So in the Dependency view, an arrow from A → B reads "A blocks B" / "B is waiting on A."

**READY definition** (used by Dependency view's default sort):

> An issue is READY if no other active issue currently blocks it — i.e., it has no `blocks` edges pointing at it from any active issue.

Computed by scanning all issues' outgoing `blocks` edges and checking which target identifiers receive zero edges from active sources.

### 5.4 Design-doc scanner (optional, pluggable)

**Concept:** Many teams keep design docs / RFCs / spec files in their repo, with task checklists that track ticket progress. This tool can read those checklists and show progress on the corresponding issue node.

**Pluggable adapters.** Each adapter targets one design-doc layout. v1 ships with:

| Adapter | Looks for | Recognized by |
|---|---|---|
| `spectra` | `${REPO_PATH}/openspec/changes/*/{proposal,tasks}.md` | `openspec/` directory exists |
| `openspec` | (alias of spectra; same layout) | same |

Future adapters (Phase 3+): `rfc-folder`, `notion-export`, etc.

**Auto-detection:** Backend probes for known adapter signatures at `${REPO_PATH}` on startup. If none match, design-doc integration is silently disabled (no UI mention, no errors). Operator can force a specific adapter via `DESIGNDOC_ADAPTER=spectra`.

**Adapter interface:**

```ts
// src/backend/designdoc/types.ts
export interface DesignDocAdapter {
  detect(repoRoot: string): boolean
  scan(repoRoot: string): DesignDocChange[]
}

export type DesignDocChange = {
  name: string                  // directory or file name
  issueIdentifiers: string[]    // PM identifiers found in the doc (1-to-N)
  status: 'active' | 'parked' | 'archived'
  totalTasks: number
  doneTasks: number
  progress: number              // 0..1
  filePath: string              // for "open in editor" link
}
```

**Linking convention:** Each adapter defines its own way to extract issue identifiers. Spectra adapter looks for `Linear:\s*([A-Z]+-\d+)` lines in `proposal.md`. Other adapters might use frontmatter, filename patterns, or commit trailers.

**1-to-N mapping:** A single PM issue may map to multiple design-doc changes. UI handles this in §7.5.

**No design-doc system in your project?** Tool works fine — issue nodes just don't show progress bars. Filter "has design doc" / "missing design doc" simply hidden from UI when no adapter loaded.

### 5.5 Bucket-to-bucket relations (NOT a v1 feature)

Earlier drafts proposed deriving inter-bucket dependencies (e.g., "service A depends on service B") from code scanning (imports, proto files, etc.). **This is dropped from the design.**

**Reasons:**
- Every project records architectural relationships differently — there is no universal scan that works.
- Many users have no code at all (marketing, content, ops teams).
- Cross-bucket coupling is **already visible** at the issue level: when an issue in bucket A `blocks` an issue in bucket B, the graph naturally shows that crossing.
- Auto-deriving graph edges from code creates maintenance debt — the algorithm goes wrong, the user has no way to fix it without writing new code.

**Alternative we DO support:** Mix View highlights cross-bucket `blocks` edges in red/bold. That's enough signal to spot architectural coupling without claiming to derive it.

**If a user really wants explicit bucket-to-bucket relations**, they can:
- Add Linear labels like `relates-to: bucket-X` and we'll surface them.
- Use sticky annotations on bucket-level nodes.
- Maintain their own dependency diagram outside this tool — and link to it from the bucket detail panel.

This whole section is intentionally minimal. Don't bring it back without strong evidence of demand.

### 5.6 Database schema

```sql
-- Cached normalized issues (backend-agnostic shape)
CREATE TABLE issue_cache (
  identifier TEXT PRIMARY KEY,
  payload JSON NOT NULL,         -- NormalizedIssue
  fetched_at INTEGER NOT NULL    -- unix epoch ms
);

CREATE TABLE label_cache (
  id TEXT PRIMARY KEY,
  payload JSON NOT NULL          -- NormalizedLabel
);

-- Sync history (visible in UI)
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,          -- 'success' | 'rate_limited' | 'api_error' | 'partial'
  backend TEXT NOT NULL,         -- 'linear' | future: 'jira', 'plane', etc.
  issues_count INTEGER,
  error_message TEXT
);

-- Snapshots for time-series analysis
CREATE TABLE snapshot (
  ts INTEGER PRIMARY KEY,        -- unix epoch ms
  issues_json JSON NOT NULL,
  designdoc_json JSON,           -- nullable; only when adapter loaded
  schema_json JSON               -- detected label schema at the time
);

-- User annotations (sticky notes) — bucket = whatever PRIMARY_GROUP is configured to
CREATE TABLE annotation (
  id INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL,     -- 'issue' | 'edge' | 'bucket'
  target_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Per-instance settings (UI prefs, label schema overrides)
CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_sync_started ON sync_log(started_at DESC);
CREATE INDEX idx_snapshot_ts ON snapshot(ts DESC);
CREATE INDEX idx_annotation_target ON annotation(target_type, target_id);
```

### 5.7 Cache invalidation

| Trigger | Behavior |
|---|---|
| TTL expired (5 min) | Background fetch, return stale + flag |
| `POST /api/sync` | Foreground fetch, bypass cache |
| Backend credentials env changed (restart) | Cache flushed at startup |
| `BACKEND` env changed (restart) | Cache flushed at startup |
| API returns rate-limit (429) | Don't write cache, surface warning |
| Same-second multiple force-refreshes | Debounce to one fetch |

**Sync log retention:** Forever (no pruning). Estimated ~100 bytes/row × ~12 fetches/hour × 365 days = ~10 MB/year. Negligible.

### 5.8 Snapshot strategy

- One snapshot per day (configurable), at first successful sync of the day.
- Stored in `snapshot` table.
- **Retained 365 days** (configurable via `SNAPSHOT_RETENTION_DAYS`); older snapshots pruned by daily job.
- Backup: `sqlite3 ... ".backup ..."` daily, keep 30 days.
- Estimated size: ~50 KB/snapshot × 365 = ~18 MB/year. Negligible.

Snapshots unlock Phase 2 features:
- "Compare this week vs last week"
- "Velocity per bucket"
- "Stale issue detection (no state change in N days, configurable)"

### 5.9 Rate limiting

Each backend has its own rate-limit characteristics. The adapter is responsible for surfacing remaining quota. Common mitigations:
- Cache TTL → bounds polling frequency.
- Pagination: 100 issues/page → ~1 page typical, 5 pages worst case.
- Track `x-ratelimit-remaining` from response header in `sync_log`.
- UI shows warning banner when remaining quota < 10%.

### 5.10 Error handling

| Failure | Response | UI |
|---|---|---|
| Backend API 5xx | Use cache, log error | Yellow banner "Backend API error, using cache" |
| Backend API 429 | Don't fetch, use cache | Red banner "Rate limited, will retry in N min" |
| API key invalid | Return 200 with empty data | Onboarding screen instructing how to set credentials |
| SQLite corrupt | Recreate from latest snapshot | Banner "Recovered from snapshot Y/M/D" |
| Repo not mounted | Skip design-doc scan, continue | (silent — design-doc UI hidden) |

Never crash. Always render something.

### 5.11 Logging

Structured JSON logs via `pino`:

```ts
log.info({ issuesFetched: 37, cacheHit: false, durationMs: 1234 }, 'fetch complete')
log.warn({ rateLimitRemaining: 50 }, 'approaching rate limit')
log.error({ err, query: 'graph' }, 'fetch failed')
```

Logs to stdout (Docker captures). Optionally tee to `/app/data/logs/`.

---

## 6. Frontend Design

### 6.1 Component structure

```
src/frontend/
├── main.tsx                    # entry, mounts <App />
├── App.tsx                     # router/layout
├── components/
│   ├── GraphCanvas.tsx         # React Flow wrapper, view-agnostic
│   ├── nodes/
│   │   ├── BucketNode.tsx
│   │   ├── IssueNode.tsx
│   │   └── MixedNode.tsx
│   ├── Toolbar.tsx             # view switcher + filters
│   ├── FilterPanel.tsx         # sidebar filters; auto-built from detected schema
│   ├── DetailPanel.tsx         # right panel on node click
│   ├── SyncBanner.tsx          # last update + refresh button
│   ├── InstanceBadge.tsx       # cosmetic instance label
│   └── Onboarding.tsx          # shown when no API key / setup required
├── views/                      # plugin-style view definitions
│   ├── types.ts                # ViewDefinition interface
│   ├── bucket.ts               # group issues by bucket label, no inter-bucket edges
│   ├── dependency.ts           # issue blocks
│   ├── mix.ts                  # buckets-as-containers + issue blocks inside
│   └── index.ts                # registry export
├── store/
│   ├── graphStore.ts           # Zustand: graph data, sync state
│   ├── viewStore.ts            # Zustand: active view, filters, focus
│   ├── schemaStore.ts          # detected label schema (drives node rendering)
│   └── urlSync.ts              # bidirectional URL ↔ store
├── hooks/
│   ├── useGraphData.ts
│   ├── useViewState.ts
│   └── useTheme.ts
├── lib/
│   ├── api.ts                  # backend client
│   ├── layout.ts               # dagre wrappers
│   ├── labelSchema.ts          # client-side helpers for schema interpretation
│   └── colors.ts               # theme helpers
└── styles/
    ├── tokens.css              # CSS variables for light/dark
    └── globals.css
```

### 6.2 Plugin-style views

```ts
export interface ViewDefinition {
  id: string                                   // URL slug
  label: string                                // toolbar label
  icon: ReactNode
  description: string                          // hover tooltip
  shortcut?: string                            // optional keybinding
  getNodes: (data: GraphData) => Node[]
  getEdges: (data: GraphData) => Edge[]
  getLayout: () => LayoutFn
  defaultFilters?: Filter[]
  customNodeComponent?: ComponentType<NodeProps>
}

// views/index.ts
export const views: ViewDefinition[] = [
  bucketView,
  dependencyView,
  mixView,
]
```

Adding a new view = add a new file to `views/` and append to the registry. No core changes needed.

### 6.3 The three v1 views

| View | Nodes | Edges | Layout | Primary question |
|---|---|---|---|---|
| **Bucket** | bucket labels (e.g. `service:central`) sized by issue count | none (or implicit `relates-to:` if user labeled) | grid / packed | "What buckets exist? How balanced is the load?" |
| **Dependency** | active issues | issue `blocks` issue | dagre LR | "What can I work on next?" |
| **Mix** | bucket labels (as containers) + issues inside | `blocks` (cross-bucket highlighted in red/bold) | container-dagre + intra grid | "What's owned by whom, what's coupled?" |

**Bucket view label** comes from `PRIMARY_GROUP` (the configured label-group name, default auto-detected). UI shows it as the configured singular/plural — e.g., "Services" for an engineering team, "Modules" or "Squads" or "Areas" depending on the team's vocabulary.

**Default view:** `Dependency` is the landing page. Rationale: highest-frequency use case ("what should I work on next?"). Override via Settings page (§6.16) or URL `?view=bucket`.

**Note:** No bucket-to-bucket dependency edges. Cross-bucket coupling is shown via highlighted `blocks` edges in Mix view. See §5.5 for rationale.

### 6.4 View switching animation

Use React Flow's `setNodes` / `setEdges` instead of unmount/remount. Same node IDs across views = automatic position morph. Then `fitView({ duration: 600 })` for camera transition.

### 6.5 Custom node design

The example below is **schema-driven** — what gets shown and where is determined by the detected (or user-configured) label schema. The example shows a project where `Type` is configured for icons, `service` for bucket grouping, and prefixes `risk:` and `affects:` exist as flat labels.

```
┌─────────────────────────────────────┐
│ 🐛 🔴 PROJ-123             [⚠ 3]   │  type icon (from schema) | priority | blocks count badge
│ Refactor authentication flow        │  title (truncated to 60 chars)
│ ─────────────────────────────────── │
│ 👤 alice  📅 14d  🏷️ backend        │  assignee | age | bucket label (PRIMARY_GROUP)
│ ▓▓▓▓░░░░░░ 4/9 · auth-rewrite       │  design-doc progress (when adapter detects)
│ [security] [breaking]               │  prefix labels (display rules from schema)
│ ↓ affects: api · web                │  another prefix group (display rule from schema)
└─────────────────────────────────────┘
```

If no schema is configured, the tool falls back to a generic display: bucket label + Linear-color chips for everything else.

Density modes (toolbar toggle):
- "Compact" — only ID + title
- "Default" — as above
- "Verbose" — adds description preview and last update timestamp (Phase 1). Comments count is a Phase 3 add: requires the adapter to expose comments separately and the bulk query to fetch counts — currently not in the GraphQL query in §5.3.

### 6.6 Filter panel

Filter sidebar is **schema-driven**. The backend auto-detects label groups and prefixes; the frontend renders one filter section per detected group/prefix, in the order specified by the schema (or detection heuristics if no schema).

Example for a typical engineering team's schema (`service` + `Type` + `risk:` / `affects:` / `process:` prefixes):

```
Filters
─────────
View
  ( ) Bucket
  (•) Dependency
  ( ) Mix

Quick toggles
  [ ] 👤 My issues (assignee = me)
  [ ] 🌟 Active only (default ON)

service        (multi, from PRIMARY_GROUP)
  [ ] central (8)
  [ ] core-api (5)
  [ ] frontend (12)
  ...

Type           (multi, from TYPE_GROUP)
  [ ] 🐛 Bug (4)
  [ ] ✨ Feature (12)
  [ ] 🔧 Refactor (3)
  [ ] ⚡ Improvement (5)
  ...

Priority       (multi)
  [ ] 🔴 urgent (2)
  [ ] 🟠 high (8)
  [ ] 🟡 med (15)
  [ ] ⚪ low (5)

Assignee       (multi)
  [ ] alice (20)
  [ ] (unassigned) (5)

risk:          (multi, auto-detected prefix)
  [ ] security (2)
  [ ] breaking-change (1)
  [ ] migration (3)
  ...

affects:       (multi, auto-detected prefix)
  [ ] api (5)
  [ ] frontend (3)
  ...

process:       (multi, auto-detected prefix)
  [ ] needs-design (2)
  [ ] needs-review (1)
  ...

Design doc     (radio)              (hidden if no adapter detected)
  (•) all
  ( ) has design doc
  ( ) missing design doc

State          (multi, canonical enum from §3.3)
  [x] started        (UI label: "In Progress")
  [x] unstarted      (UI label: "Todo")
  [x] backlog        (UI label: "Backlog")
  [ ] triage         (UI label: "Triage")
  [ ] completed      (UI label: "Done")
  [ ] canceled       (UI label: "Cancelled")

Stale          (toggle)
  [ ] only stale (configurable threshold, default 14 days)

[Reset all] [Save as preset...]
```

**Schema-driven filter rendering:**
- Every detected exclusive label group → its own multi-select section.
- Every detected prefix → its own multi-select section, named after the prefix.
- Orphan flat labels (no group, no prefix) → grouped under "Tags" section.
- User can reorder/rename/hide sections via Settings page or `label-schema.yaml`.

**Defaults:**
- "Active only" toggle ON → filters out `completed` + `canceled` states (canonical enum from §3.3).
- "My issues" toggle OFF — when ON, uses the user identified from the backend's API credentials (auto-resolved on startup).
- All other multi-select filters empty (= show all).

**Identifying "me":** On startup, the backend adapter calls `viewer { id, displayName, email }` (Linear) or equivalent and persists in `setting` table.

Filter presets stored in `setting` table per-instance.

### 6.7 URL deep linking

State encoded in query string. Schema:

```
/?view=bucket                   active view (bucket|dependency|mix)
 &bucket=backend,api             filter: primary group values
 &type=feature,chore             filter: Type group values
 &priority=1,2                   filter: priority
 &assignee=alice                 filter: assignee
 &mine=1                         filter: only my issues (current backend user)
 &tag=security                   filter: orphan/tag labels
 &designdoc=has                  filter: design-doc presence (has|missing|all)
 &state=started,unstarted        filter: state (canonical enum from §3.3)
 &active=1                       filter: active only (default 1)
 &stale=1                        filter: stale only
 &focus=PROJ-123                 zoom + highlight node
 &expand=backend,api             in mix view, which buckets expanded
 &theme=dark                     light|dark|auto
 &density=compact                node density (compact|default|verbose)
```

Implementation: `urlSync.ts` subscribes to Zustand store and updates URL via `history.replaceState`. On mount, parse URL into store. Both directions use a shared codec.

### 6.8 Click behavior & detail panel

**Click semantics:**

| Interaction | Action |
|---|---|
| **Single click** on node | Open detail panel on right side; node highlighted |
| **Double click** on node | Open Linear issue in new tab |
| **Click on canvas (empty)** | Close detail panel; clear focus |
| **Cmd/Ctrl + click** on node | Add to multi-select (Phase 2) |
| **Right click** on node | Context menu (open Linear / copy ID / add annotation) |

URL `?focus=<identifier>` mimics single click — opens detail panel and centers camera.

**Detail panel (right sidebar on node click):**

```
┌── PROJ-123 Refactor auth flow ──────┐
│ [Open in Linear ↗]                  │
│                                     │
│ State:    🔵 In Progress            │
│ Priority: 🔴 Urgent                 │
│ Assignee: alice                     │
│ service:  backend                   │
│ affects:  api, web                  │
│ Created:  14 days ago               │
│ Updated:  2 hours ago               │
│                                     │
│ ── Design doc ──────────────────    │
│ auth-rewrite                        │
│ ▓▓▓▓░░░░░░ 4/9 tasks                │
│  ✓ Phase 1: token refresh           │
│  ✓ Phase 1: error handler           │
│  ✓ Phase 1: state cleanup           │
│  ✓ Phase 1: test recovery flow      │
│  ○ Phase 2: session store           │
│  ○ Phase 2: resume from snapshot    │
│  ...                                │
│                                     │
│ ── Blocks ──────────────────────    │
│ → PROJ-130 (next phase)             │
│ → PROJ-145 (cleanup)                │
│                                     │
│ ── Annotations (2) ─────────────    │
│ [alice · 3d ago]                    │
│ "Blocked on review from PM..."      │
│                                     │
│ [+ Add annotation]                  │
│                                     │
│ Description:                        │  ← lazy loaded on panel open
│ <markdown rendered>                 │     (separate per-issue API call)
└─────────────────────────────────────┘
```

**Description loading:** When detail panel opens for the first time on a given issue, frontend issues `GET /api/issues/:identifier` (matching the v3.5 endpoint convention — see §5.1) which proxies to the backend's per-issue endpoint. Result cached in-memory for 10 minutes. Avoids bloating bulk graph payload.

**1-to-N design-doc display:** When one issue has multiple design-doc changes, detail panel shows each change as its own collapsible row with its own progress bar:

```
── Design docs (2 changes) ──────────
▼ auth-rewrite                       4/9
   ✓ Phase 1: token refresh
   ✓ Phase 1: error handler
   ...
▶ auth-cleanup                       0/12 (parked)
```

On the **node** itself, the progress bar is the union: `(sum of done) / (sum of total)`. Hover tooltip lists individual changes.

### 6.9 Sticky annotations

User-added notes attached to nodes/edges. Stored in SQLite (server-side), **not** synced to the backend.

```ts
type Annotation = {
  id: number
  targetType: 'issue' | 'edge' | 'bucket'
  targetId: string                            // 'PROJ-123' or 'PROJ-123→PROJ-130' or '<bucket value>'
  body: string                                // markdown
  createdAt: number
  updatedAt: number
}
```

UI: in detail panel; visible badge on canvas when node has annotations.

**Why server-side, not localStorage:**
- Persists across browsers (you draft on laptop, read on phone — though phone is non-goal in v1).
- Backed up by SQLite snapshot script (§12.1).
- Visible to teammates on TEAM instance (intended — they're shared notes).

**Privacy caveat:** LOCAL annotations stay LOCAL (different SQLite); TEAM annotations are visible to anyone who can reach the TEAM URL. UI labels each annotation with its origin instance to avoid surprise.

**Export to JSON:** Settings page exposes "Export annotations" button → downloads `annotations-2026-05-01.json`. Useful for:
- Migrating between LOCAL and TEAM (manual sync).
- Backup before nuking SQLite.
- Sharing notes outside the tool.

**Import from JSON:** Companion "Import annotations" accepts the same format, with `--merge` (keep both) or `--replace` (overwrite) modes. UI confirmation modal before destructive imports.

### 6.10 Theme: dark mode

CSS variables in `tokens.css`:

```css
:root {
  --bg: #ffffff;
  --fg: #111;
  --node-bg: #f5f5f5;
  --node-border: #ddd;
  --edge: #999;
  --priority-urgent: #d62828;
  ...
}

[data-theme='dark'] {
  --bg: #0d1117;
  --fg: #e6e6e6;
  --node-bg: #161b22;
  --node-border: #30363d;
  --edge: #58a6ff;
  ...
}
```

Toggle: top toolbar. Default: `prefers-color-scheme`. Persisted in localStorage.

### 6.11 Last update banner

Top of screen:

```
┌──────────────────────────────────────────────────────┐
│ 🟢 LOCAL  · Last sync: 3m ago  · [↻ Refresh]  ⚙️    │
└──────────────────────────────────────────────────────┘
```

- "3m ago" updates every 30s via setInterval.
- Hover "3m ago" → tooltip with absolute time.
- Color: green (<5m), yellow (5–30m), red (>30m).
- Refresh button → `POST /api/sync`, button shows spinner during fetch.
- **Shift + click** Refresh → force bypass cache (header `X-Force-Sync: 1`).
- Click on the banner → opens sync history modal.

### 6.12 Sync history modal

```
┌─ Sync History ────────────────────────────────────┐
│ Time              Status        Issues  Duration  │
│ 14:23:11          ✓ success     37      1.2s      │
│ 14:08:11          ✓ success     37      1.1s      │
│ 13:53:10          ⚠ rate_limit  -       -         │
│ 13:38:09          ✓ success     36      1.4s      │
│ ...                                                │
└────────────────────────────────────────────────────┘
```

Last 50 entries from `sync_log`.

### 6.13 Onboarding state

Shown when backend credentials are missing or invalid:

```
🌟 Welcome to Issue Graph

The backend isn't configured yet.

Steps for Linear:
  1. Go to Linear → Settings → API
  2. Click "Create Personal API Key"
  3. Copy the key into your .env:
       BACKEND=linear
       LINEAR_API_KEY=lin_api_xxx
  4. Restart Docker:
       docker compose restart

(For other backends, see README.)

[ Show example .env ]   [ Help ]
```

### 6.14 Performance budget

| Metric | Target |
|---|---|
| Initial load (cold) | < 1.5s |
| Initial load (cached) | < 500ms |
| View switch animation | 60fps for 100 nodes |
| Filter apply | < 100ms |
| Refresh (cached) | < 200ms |
| Refresh (force) | < 3s |

Optimizations applied:
- React Flow `nodeTypes` memoized at module level.
- Layout result cached per view × filter signature.
- Filter computation memoized (Zustand selectors).
- Large-graph mode: > 100 nodes auto-collapse minor branches.

### 6.15 Screenshot hotkey (Phase 2)

`Cmd+Shift+S` → React Flow's `toPng` helper → download `pm-graph-YYYY-MM-DD.png`. Useful for slides/chat.

### 6.16 Settings page

Accessible via `⚙️` icon in toolbar. Persists in `setting` table (per-instance).

```
┌─ Settings ──────────────────────────────────────┐
│                                                 │
│ Display                                         │
│   Default view:        [ Dependency ▼ ]         │
│   Default theme:       ( ) Light  ( ) Dark      │
│                        (•) Auto (system)        │
│   Node density:        [ Default ▼ ]            │
│                        (compact|default|verbose)│
│                                                 │
│ Filters (defaults)                              │
│   [x] Active issues only                        │
│   [ ] My issues only                            │
│   Stale threshold:     [ 14 ] days              │
│                                                 │
│ Data                                            │
│   Snapshot retention:  [ 365 ] days             │
│   Daily snapshot at:   [ 02:00 ]                │
│   Cache TTL:           [ 5 ] minutes            │
│                                                 │
│ Backend (Linear)                                │
│   API key:             ●●●●●●●●●●● (set in .env)│
│   Team filter:         [ TEAM ]  (or "all")     │
│   Issue scope:         [ active+recent ▼ ]      │
│   Identified as:       alice (auto-detected)    │
│                                                 │
│ Annotations                                     │
│   [ Export to JSON ]  [ Import from JSON... ]   │
│   Total: 12 annotations                         │
│                                                 │
│ About                                           │
│   Version: 1.2.0                                │
│   Instance: 🟢 LOCAL                            │
│   GitHub: <repo URL>                            │
│   [ View sync history ]                         │
│                                                 │
│                          [ Cancel ] [ Save ]    │
└─────────────────────────────────────────────────┘
```

**Read-only fields** (greyed out): API key (must edit `.env`), Identified as (auto-detected from API key).

**Settings precedence (highest first):**
1. URL query params (`?theme=dark`)
2. Settings page values (per-instance, in SQLite)
3. Environment variable defaults (`STALE_DAYS=14`)
4. Hardcoded defaults

**Settings page is opt-in personalization.** Sane defaults make this page optional — users never need to open it.

---

## 7. Design-Doc Integration (Spectra is one adapter among many)

Detailed because design-doc-to-issue linkage is delicate and project-specific.

### 7.1 Convention (per adapter)

Each adapter defines its own convention for linking to PM issues. Spectra's convention:

> Every `openspec/changes/<name>/proposal.md` opens with one or more `Linear:` lines.

```markdown
Linear: PROJ-123

# Refactor authentication flow

...
```

The convention is **encouraged, not required**. Proposals without `Linear:` lines are still listed; they just don't attach to any issue node.

### 7.2 Scan logic (Spectra adapter example)

```ts
function scanSpectraChanges(repoRoot: string): DesignDocChange[] {
  const changeDirs = [
    ...glob(`${repoRoot}/openspec/changes/*/`),
    ...glob(`${repoRoot}/openspec/changes/_parked/*/`),
    ...glob(`${repoRoot}/openspec/archive/*/`),
  ]
  return changeDirs.map(dir => {
    const proposal = readFileSafe(`${dir}/proposal.md`)
    const tasks = readFileSafe(`${dir}/tasks.md`)
    const matches = [...(proposal ?? '').matchAll(/^Linear:\s*([A-Z]+-\d+)/gm)]
    const issueIdentifiers = [...new Set(matches.map(m => m[1]))]

    const totalTasks = (tasks?.match(/^\s*- \[[x ]\]/gm) || []).length
    const doneTasks = (tasks?.match(/^\s*- \[x\]/gm) || []).length

    return {
      name: path.basename(dir),
      issueIdentifiers,
      status: detectStatus(dir),  // 'active' | 'parked' | 'archived'
      totalTasks,
      doneTasks,
      progress: totalTasks > 0 ? doneTasks / totalTasks : 0,
      filePath: path.relative(repoRoot, `${dir}/tasks.md`),
    }
  })
}
```

### 7.3 Triggering rescan

Decision: piggy-back on issue sync — every fetch from the backend also rescans the design-doc directory.

Cost analysis: a few dozen filesystem reads per fetch is negligible. No fs watcher needed.

### 7.4 Joining issue ↔ design doc (1-to-N)

```ts
const docsByIssue: Map<string, DesignDocChange[]> = new Map()
for (const change of designdocChanges) {
  for (const id of change.issueIdentifiers) {
    if (!docsByIssue.has(id)) docsByIssue.set(id, [])
    docsByIssue.get(id)!.push(change)
  }
}

const enrichedIssues = issues.map(issue => ({
  ...issue,
  designdocs: docsByIssue.get(issue.identifier) ?? [],
}))
```

### 7.5 UI representations

| Surface | Display |
|---|---|
| Node | progress bar (union of all attached docs: `sum_done / sum_total`) + label "N changes" if > 1 |
| Detail panel | each design-doc change as collapsible row with its own progress + tasks list |
| Filter | "has design doc" / "missing design doc" |
| Future | dedicated "Design-doc view" — issues with docs only, layout by adapter-defined phase |

### 7.6 What we surface for "missing design doc"

The set of issues with `state.type IN ('started', 'unstarted')` AND `designdocs.length === 0` is meaningful — these are tickets being worked on without a design-doc plan. Filter exposes this; future Phase 3 could send a weekly digest.

### 7.7 Edge case: parked changes

Parked design-doc changes get `status: 'parked'`. UI:
- Show progress bar grayed out
- Append "(parked)" to change name
- Filter "has design doc" includes parked by default; checkbox to "exclude parked"

---

## 8. Label Schema (fully declarative, no hardcoded names)

The tool makes **zero assumptions** about Linear label names. It supports three layers of configuration, from "no setup at all" to "fully customized display rules."

### 8.1 Layer 1 — Zero config (auto-detect)

On first sync, issue-graph inspects all labels returned by the backend and applies these heuristics:

```
Detected exclusive groups (from Linear API: labels { group { name, exclusive } }):
  → first group whose name matches /^(service|component|owner|module|team|area|domain)$/i
    is treated as PRIMARY (drives bucketing).
  → first group whose name matches /^(type|kind|category)$/i
    is treated as TYPE (drives icon).
  → other exclusive groups → rendered as filter sections, no special role.

Detected flat-label prefixes (regex /^([a-z][a-z0-9-]+):\s*/ on label name):
  → any prefix used by ≥2 labels → auto-creates a filter section.
  → orphan labels (no prefix, no group) → "Tags" filter section.

Display defaults when no schema overrides:
  → primary group label → background color + leading text on node
  → type group label → leading icon (using Type-name → emoji map; falls back to first letter)
  → all prefix-group labels → small chips at bottom of node, colored from Linear
  → orphan labels → small gray chips
```

**Result:** the tool works on a brand-new Linear workspace with literally zero label configuration. The user just sets `LINEAR_API_KEY` and goes.

### 8.2 Layer 2 — Minimal env override

When auto-detection picks the wrong group as primary, override with two env vars:

| Variable | Default | Purpose |
|---|---|---|
| `PRIMARY_GROUP` | (auto-detected) | Name of the exclusive label group used for bucketing (Bucket / Mix views) |
| `TYPE_GROUP` | (auto-detected) | Name of the exclusive label group rendered as leading icon |
| `TYPE_ICONS` | (built-in defaults) | JSON map: `{"Bug":"🐛","Feature":"✨",...}` to override icons |

That's it. Most users never need more than this.

### 8.3 Layer 3 — Full schema override (`label-schema.yaml`)

Power users who want fine-grained display control can drop a `label-schema.yaml` next to their Docker compose. Schema location is configurable via `LABEL_SCHEMA_PATH` (default: `/app/data/label-schema.yaml`, editable via Settings page).

```yaml
# label-schema.yaml — declares exactly how each label group/prefix is rendered.
# Anything not listed here falls back to Layer 1 auto-detection.

groups:
  service:                      # match by group name
    role: primary               # special: drives bucket bucketing
    label_singular: Service
    label_plural: Services
    display:
      kind: bucket
      color: from-linear        # use color set in Linear; or hex like '#0a84ff'
  
  Type:
    role: type
    display:
      kind: icon-leading
      icons:
        Bug: 🐛
        Feature: ✨
        Improvement: ⚡
        Refactor: 🔧
        Chore: 🧹
        Documentation: 📝
        Testing: 🧪
        Observability: 📊

prefixes:
  "affects: ":                  # include trailing space exactly as it appears on Linear
    display:
      kind: footer-list         # small horizontal list at bottom of node
      label: "↓ affects:"
      color: gray
      max_show: 4
  
  "risk: ":
    display:
      kind: chip-corner         # right-corner chips
      max_show: 2
      color_map:
        security: '#d62828'
        breaking-change: '#f77f00'
        migration: '#fcbf49'
        data-loss: '#d62828'
  
  "process: ":
    display:
      kind: badge-overlay       # large badge overlaid on node corner
      color: '#0a84ff'

orphan_labels:
  display:
    kind: chip-bottom
    color: from-linear
    max_show: 3
```

**Schema rules:**
- Anything missing from the schema falls back to auto-detection.
- Display kinds available: `bucket`, `icon-leading`, `chip-corner`, `chip-bottom`, `chip-top`, `footer-list`, `badge-overlay`, `hidden-but-filterable`, `hidden`.
- Order of `prefixes` in the YAML is the rendering order on the node.
- Schema is hot-reloadable: edits to `label-schema.yaml` trigger a re-read on next refresh (no restart needed). Useful when iterating.

### 8.4 No schema enforcement, no required labels

The tool **does not enforce** any label requirements. If issues are missing labels:
- Missing primary group → falls into a synthetic "Unclassified" bucket
- Missing type → no icon (or fallback letter glyph)
- Missing all prefix labels → no chips

Users can choose to enforce required labels in Linear's Team settings, but that's their call.

### 8.5 Why this design

| Need | Solution |
|---|---|
| Out-of-the-box experience | Layer 1 auto-detection |
| Common engineering scheme (`service` + `Type` + 2-3 prefixes) | Layer 2 env override + built-in icon defaults |
| Different conventions (e.g. `team:` `epic:` `quarter:`) | Layer 3 yaml — define new prefixes with display rules |
| Future evolution (rename prefix, add prefix) | Edit yaml, no code change |
| Show same data in multiple representations | Multiple display kinds available |

---

## 9. (Reserved)

(This section was previously "Service-from-Code Scanner." That feature has been dropped from the roadmap — see §5.5 for rationale.)

---

## 10. Configuration

### 10.1 .env

```bash
# ─── Backend selection ───────────────────────────────────────
BACKEND=linear                          # v1: only 'linear' (Jira/Plane/etc. future)

# ─── Linear backend (required when BACKEND=linear) ───────────
LINEAR_API_KEY=lin_api_xxxxxxxx         # from Linear → Settings → API
LINEAR_API_ENDPOINT=                    # empty = official api.linear.app/graphql
LINEAR_WORKSPACE=                       # workspace slug (if API key has multi-workspace access)
LINEAR_TEAM_ID=                         # empty = all teams accessible to API key

# ─── Future Jira backend (when BACKEND=jira; Phase 4+) ───────
# JIRA_BASE_URL=https://yourorg.atlassian.net
# JIRA_EMAIL=
# JIRA_API_TOKEN=
# JIRA_PROJECT_KEY=

# ─── Server (no prefix — generic infra config) ───────────────
PORT=31415                              # internal port; pick anything 30000+
INSTANCE_LABEL=personal-local           # free-form cosmetic label shown in UI
LOG_LEVEL=info                          # debug | info | warn | error
LOG_TO_FILE=false                       # also write to /app/data/logs/app.log

# ─── Storage (no prefix) ─────────────────────────────────────
SQLITE_PATH=/app/data/graph.db
REPO_PATH=/repo                         # mounted host repo (read-only) for design-doc scan; optional
LABEL_SCHEMA_PATH=/app/data/label-schema.yaml  # optional — Layer 3 schema file

# ─── Issue scope (no prefix — issue-graph concept, not backend) ──
ISSUE_SCOPE=active+recent               # active | active+recent | all

# ─── Label schema (no prefix — issue-graph concept) ──────────
PRIMARY_GROUP=                          # empty = auto-detect (e.g. 'service', 'module', 'team')
TYPE_GROUP=                             # empty = auto-detect (e.g. 'Type', 'Kind')
TYPE_ICONS=                             # JSON map override, e.g. '{"Bug":"🐛","Feature":"✨"}'
# For full control: drop a label-schema.yaml at LABEL_SCHEMA_PATH

# ─── Cache & data retention ──────────────────────────────────
CACHE_TTL_SECONDS=900                   # 15 min
DAILY_SNAPSHOT_HOUR=2                   # 0–23, local server time
SNAPSHOT_RETENTION_DAYS=365             # 1 year
SYNC_LOG_RETENTION=forever              # forever | rolling-N (e.g. rolling-1000)

# ─── Design-doc integration (adapters auto-detected from REPO_PATH) ───
DESIGNDOC_ADAPTER=auto                  # auto | spectra | openspec | none
DESIGNDOC_REQUIRED=false                # if true, warns on active issues without design doc

# ─── UI defaults (overridable via Settings page) ─────────────
STALE_DAYS=14
DEFAULT_VIEW=dependency                 # service | dependency | mix
DEFAULT_THEME=auto                      # light | dark | auto
NODE_DENSITY=default                    # compact | default | verbose
SHOW_ACTIVE_ONLY_DEFAULT=true
```

### 10.2 .env.example

Committed. Documents every variable. No secrets.

### 10.3 settings.json (per-instance UI prefs)

Stored in `setting` table, exposed via `/api/settings`:

```json
{
  "default_view": "dependency",
  "default_filters": { "state": ["started", "unstarted"] },
  "node_density": "default",
  "show_done_issues": false,
  "stale_days_threshold": 14
}
```

Editable in UI's settings modal. Per-instance (LOCAL and TEAM can differ).

---

## 11. Docker

### 11.1 Image strategy

Code is Node-compatible (see §3.2). The official **v1 image runs Bun** for build + runtime simplicity (smaller base image, faster startup). A **`Dockerfile.node` for users who prefer Node is planned for Phase 2** (see §11.4) — the code is ready, only the second Dockerfile + CI matrix update remain.

### 11.2 Dockerfile (official, Bun runtime)

```dockerfile
# Build stage
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build       # outputs ./dist (frontend) and ./build (backend)

# Runtime stage
FROM oven/bun:1-slim
WORKDIR /app
# Install minimal tools for healthcheck (oven/bun:1-slim does not ship wget by default)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
# Ensure data directory exists with permissions matching the non-root bun user
RUN mkdir -p /app/data && chown -R bun:bun /app/data
EXPOSE 31415
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:31415/api/health || exit 1
USER bun
CMD ["bun", "run", "start"]
```

### 11.3 docker-compose.yml

```yaml
services:
  app:
    build: .
    image: issue-graph:latest
    container_name: issue-graph
    restart: unless-stopped
    env_file: .env
    ports:
      - "${PORT:-31415}:31415"
    volumes:
      - ./data:/app/data                  # SQLite + snapshots persist
      - ${REPO_HOST_PATH:-./}:/repo:ro    # optional: host repo for design-doc scan
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:31415/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

**Volume permissions.** Because the container runs as a non-root `bun` user (uid varies by base image release), the host-side `./data` directory may need permissions adjusted on first run:

```bash
mkdir -p data && chmod 777 data    # quick fix for personal use
# or, for stricter posture:
mkdir -p data && sudo chown 1000:1000 data
```

The README documents this; the Dockerfile pre-creates `/app/data` with correct ownership inside the image, but the host bind-mount layer overrides that.

### 11.4 Optional Node-runtime Dockerfile

For users who prefer Node, the same code base supports a Node-runtime image. Keep this in `Dockerfile.node` (Phase 2 deliverable):

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
RUN mkdir -p /app/data && chown -R node:node /app/data
EXPOSE 31415
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:31415/api/health || exit 1
USER node
CMD ["node", "build/index.js"]
```

`docker-compose.node.yml` would point `build.dockerfile` at this file. Both runtimes share a single source tree; this is the payoff for the Node-compat decision (§16 #43).

### 11.5 Quick start

```bash
git clone https://github.com/<owner>/issue-graph
cd issue-graph
cp .env.example .env
# edit .env, set LINEAR_API_KEY (or backend-specific credentials)
mkdir -p data
docker compose up -d
open http://localhost:31415
```

### 11.6 Internal-server deploy (operator's responsibility)

The operator manages the deployment host and any periodic `git pull` / image rebuild. The tool itself has no opinion on:
- Which host runs it
- How / when the host is updated
- Hostname / DNS / TLS

These belong in the operator's external runbook. **None of these specifics live in the public repo.**

---

## 12. Operational Runbook

### 12.1 Backups (local only)

Daily SQLite backup script (in `scripts/backup.sh`) — **local rotation only, no off-site replication**:

```bash
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/app/data/backups
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M)
sqlite3 /app/data/graph.db ".backup $BACKUP_DIR/graph-$TS.db"
# Keep 30 days
find "$BACKUP_DIR" -name "graph-*.db" -mtime +30 -delete
```

Cron in container (or host):
```
0 2 * * * /app/scripts/backup.sh
```

**Backup posture statement** (also belongs in README):

> Snapshots and annotations are best-effort, not for compliance. If the SQLite volume is lost, the next sync repopulates issue data from the backend. Snapshot history (max 1 year) and user-added annotations would be lost. Operators concerned about losing this should configure their own off-site rsync / rclone job pointing at `/app/data/backups/` — the tool deliberately does not ship with cloud-storage credentials handling.

### 12.2 Monitoring

Manual: visit `/api/health` and `/api/ready`. If 200, all good.

Optional Phase 2: Uptime Kuma instance on internal network polling `/api/ready`.

### 12.3 Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| Issues all stuck in cache | Backend API rate-limited | Wait per backend's quota; check `sync_log` |
| Design-doc progress all 0 | `/repo` not mounted, or no adapter detected | Check `docker compose config` volumes; verify directory layout |
| "Last sync: 2h ago" | Cache stuck, backend not fetching | Check container logs; restart |
| Onboarding screen | Backend credentials not set (e.g. `LINEAR_API_KEY`) | Update `.env` and restart |
| Wrong bucket grouping | Auto-detect picked wrong group | Set `PRIMARY_GROUP` explicitly |
| Cross-bucket coupling missing | Issues missing primary-group labels | Audit backend workspace, ensure issues are labeled |

### 12.4 Logs location

- Container stdout/stderr: `docker logs issue-graph`
- Optional file logs: `/app/data/logs/app.log` (when `LOG_TO_FILE=true`)

---

## 13. Security Posture

### 13.1 Threat model

- Internal network only. No public exposure.
- Trusted users only (team members).
- API key stored in `.env`, never committed.
- Read-only on the backend (no write operations).
- Public repo: **no internal hostnames, IPs, server names, or org-specific paths in any committed file.**

### 13.2 Hardening

- `.env` not in image; passed via `env_file` at runtime.
- `.dockerignore` excludes `.env`, `data/`, `node_modules`.
- `robots.txt` returns `Disallow: /` (defense in depth).
- CORS: same-origin only (frontend served from same host).
- HTTPS not required for v1 (internal HTTP). Add nginx + TLS in Phase 3 if needed.

### 13.3 State-mutating endpoints

The Phase 1 API is read-mostly: `POST /api/sync` is the only mutator and is idempotent (just refreshes cache).

Phase 2 introduces several **state-mutating endpoints** (annotations, settings — see §5.1). For these, the threat model is still "internal network + trusted users", but the implementation must still:

- Limit request body to a sane size (e.g. 64 KB for annotations).
- Validate inputs (string lengths, target ID format) — no SQL injection possible since we use parameterized queries via `better-sqlite3`, but garbage data still bloats the DB.
- Enforce same-origin via `Origin` header check (defense against unauthenticated cross-site `fetch` from a misconfigured browser tab).

**No CSRF tokens** in v1: same-origin enforcement + internal-network deployment is sufficient. Re-evaluate if the tool is ever exposed publicly.

**No auth** in v1: anyone with network reach can edit annotations/settings. Acceptable because (a) it's a personal/team-internal tool, and (b) damage is bounded — annotations are exportable to JSON for backup (§6.9), and settings can be reset to defaults via a single button in the Settings page. There is **no per-row audit log** for annotation/settings edits in v1; if you need to know who changed an annotation, you need to look at git/Slack/email instead. Add an `audit_log` table + auth in Phase 4 if attribution becomes important.

### 13.4 Data classification

- Issue titles/descriptions = internal confidential. Not exfiltrated outside the container.
- API key = secret, not logged, not exposed in responses.
- Snapshots = internal; not backed up off-site without operator-added encryption.

---

## 14. Testing Strategy

### 14.1 Backend

- Unit: parser functions (Spectra task counter, Linear ID extractor, label classifier).
- Integration: end-to-end `/api/graph` with mocked Linear API (use recorded fixture).
- Schema: SQLite migrations idempotent.

### 14.2 Frontend

- Unit: view definitions return correct nodes/edges given fixture data.
- Integration: filter logic, URL ↔ store sync.
- Visual: storybook stories per node component.
- Manual: open in browser, click around, take screenshots.

### 14.3 E2E

- Skip for v1. Manual verification sufficient.
- Phase 3: Playwright scenario "load → filter → click node → check detail panel".

### 14.4 Runtime checks

- Health endpoint covers basic liveness.
- `bun test` runs in CI (Phase 2).

---

## 15. Phasing Plan

### Phase 1a — Skeletal MVP (target: ~1 day, single end-to-end path)

The smallest thing that's actually useful: open the URL, see a graph of what's blocking what, click a node, get back to Linear.

**Backend:**
- Repo skeleton (Dockerfile, docker-compose.yml, package.json, tsconfig).
- Hono server + SQLite init + migrations.
- `BackendAdapter` interface + `LinearBackend` adapter (with `LINEAR_TEAM_ID`, `ISSUE_SCOPE`).
- `blocks` edge normalization (canonical direction — see §5.3).
- Endpoints: `/api/graph`, `/api/sync`, `/api/issues/:identifier`, `/api/health`, `/api/ready`.
- Viewer auto-detection (`viewer { id }` via backend adapter).

**Frontend:**
- React app skeleton.
- **Dependency view only** (issues + blocks edges). Bucket and Mix views are Phase 1b.
- Basic node component: ID + title + state + priority + assignee. **No** schema-driven icons / chips / Type icon mapping yet.
- Light mode only. Dark mode is Phase 1b.
- Last-update banner with manual refresh.
- One filter: state (default "active only"). All other filters Phase 1b.
- Single-click → detail panel (basic); double-click → open in Linear.
- Onboarding screen (when API key missing).

**Deploy:** Local docker compose runs end-to-end.

### Phase 1b — Polished MVP (target: ~0.5 day)

Everything that turns 1a from "works" into "actually pleasant."

- Bucket view + Mix view (cross-bucket `blocks` highlighted).
- Layer 1 label-schema auto-detection (primary group, type group, prefixes — see §8.1).
- `/api/labels` endpoint.
- `DesignDocAdapter` interface + `SpectraAdapter` (auto-detect, 1-to-N).
- Schema-driven custom node (icons from `TYPE_ICONS`, chips from prefix labels, progress bar from design-doc).
- Dark mode + auto theme.
- Filters: bucket, type, priority, assignee, prefix groups, design-doc presence, stale, "my issues".
- URL deep linking (view + focus + all filters).

### Phase 2 — Polish (target: ~1 day)

- All filters auto-rendered from detected schema (priority, assignee, type, prefix groups, design-doc, stale).
- Layer 2 + Layer 3 schema overrides (`PRIMARY_GROUP`, `label-schema.yaml`).
- Sticky annotations (CRUD via SQLite + export/import JSON).
- Sync history modal.
- Snapshot writer (daily, configurable retention).
- Detail panel: full design-doc task list, lazy description, 1-to-N display.
- Settings page (full UI).
- Description lazy-load on detail panel open.
- "My issues" toggle.
- **GitHub Actions CI:**
  - On every push: lint + typecheck + unit tests (`bun test`).
  - On pull requests only: also run `docker build .` to verify image still builds.
- **README** (Mid depth):
  - 30-second pitch + screenshot.
  - 5-minute setup: `.env` template walk-through.
  - 15-minute customization: Layer 2 env override + Layer 3 yaml example.
  - Backup posture (see §12.1).
  - **Skip:** competitor comparison, vision/roadmap, "why I built this" essays.
- LICENSE (MIT) + `.env.example` + `label-schema.example.yaml`.

### Phase 3 — Power features

- Timeline view (X = time, Y = bucket).
- Stale issue detection (with snapshot history).
- CSV/Markdown export.
- Screenshot hotkey (`Cmd+Shift+S`).
- Snapshot diff view (this week vs last week, velocity per bucket).
- Comment count badge on nodes.
- Multi-select (Cmd+click).
- Right-click context menu.
- Design-doc dedicated view (issues with docs only).
- Issue-without-design-doc dashboard.
- Hot-reload of `label-schema.yaml`.

### Phase 4 — Maybe-never

- Additional backend adapters (Jira, Plane, GitHub Projects).
- Webhook (only if cache+manual refresh demonstrably insufficient).
- WebGL renderer (only if > 200 nodes makes SVG sluggish).
- Multi-team UI (per-team namespace switcher).
- Auth.
- Sub-issue / cycle / project hierarchy display.
- OAuth app (replacing personal API key).
- Bucket-to-bucket relations (only if a fundamentally new use case demands it; see §5.5).

---

## 16. Decisions Log

Each decision documents what we picked AND what we rejected.

| # | Decision | Chosen | Rejected | Reason |
|---|---|---|---|---|
| 1 | Stack | TypeScript end-to-end (Node-compat code; default image runs Bun) + Hono + React + React Flow + better-sqlite3 | Python + FastAPI + React | Shared TypeScript types end-to-end; single language. See decision #43 for runtime detail. |
| 2 | Database | SQLite | Postgres | Single-process; no extra container; sufficient for ~1k issues |
| 3 | Realtime | Manual refresh | Webhook / SSE | Webhook = signature + retry + abuse handling overhead, no real benefit |
| 4 | Deployment shapes | Same image, multiple shapes (personal-local / team-shared / issues-only) | Hardcoded LOCAL/TEAM | Generic; operator-decided |
| 5 | Design-doc link | Adapter-defined convention (Spectra: `Linear:` line) | Filename convention / external mapping file | Adapter encapsulates project-specific rules |
| 6 | Design-doc mapping | 1-to-N (one issue → multiple changes) | 1-to-1 only | Real-world: one ticket can span multiple changes |
| 7 | Design-doc integration | Auto-detect adapter; opt-in | Required / disabled by default | Tool useful without it; enable when detected |
| 8 | Layout | dagre via React Flow | hand-rolled / cytoscape | dagre is mature, handles DAGs natively |
| 9 | Auth | None | OAuth / SSO | Internal network = trust boundary |
| 10 | API protocol | REST | GraphQL | One read-mostly endpoint; GraphQL is overkill |
| 11 | Mobile | No | Yes | Internal desktop tool only |
| 12 | Issue editing | Read-only | Allow create/edit | Source tool's UI is better; conflict-handling burden too high |
| 13 | Cycle/sub-issue UI | Schema only, no UI | Full hierarchical view | Out of scope v1; reserved for Phase 4 |
| 14 | Bucket-to-bucket relations | **Dropped entirely** | Code-derived / Linear `relates-to` | Project-specific recording methods; let cross-bucket `blocks` edges express coupling instead |
| 15 | Snapshot frequency | Daily | Hourly / per-fetch | One per day enough for week-over-week analysis |
| 16 | Snapshot retention | 365 days | 90 days | Costs ~18 MB/year; YoY analysis enabled |
| 17 | Sync log retention | Forever | Rolling window | Costs ~10 MB/year; useful for API debug |
| 18 | Repo model | Standalone GitHub public repo (`issue-graph`) | Folder inside superproject | Generic, reusable, no org-specific paths |
| 19 | License | MIT | Apache 2.0 / proprietary | Standard for small OSS; permissive |
| 20 | Branch strategy | `main` + `develop` + feature | `main` only | Standard convention |
| 21 | API key type | Personal API key | OAuth app | OAuth requires app registration; defer to Phase 4 |
| 22 | Team filter | Optional via `LINEAR_TEAM_ID` (fallback to all) | Required | Single-team users get zero-config experience |
| 23 | Issue scope | `active+recent` (default) | `active` / `all` | Configurable via `ISSUE_SCOPE` |
| 24 | Description loading | Lazy on detail panel open | Bulk fetch with graph | Saves bandwidth + cache size |
| 25 | Default view | Dependency | Bucket / Mix | Highest-frequency use case ("what next?") |
| 26 | Default filter | Active only ON; My issues OFF (toggle) | Show all / show mine by default | Active scope = predictable; mine is opt-in |
| 27 | Click behavior | Single = panel, Double = open in source tool | Single = open / config option | Discoverable; matches "preview vs open" mental model |
| 28 | Stale threshold | 14 days (configurable) | 7 / 30 days fixed | Median between weekly review and quarterly |
| 29 | Settings page | Yes (UI) — global per-instance prefs | Env-only / no settings | Avoid restart for every tweak; UI-discoverable |
| 30 | Annotations storage | SQLite (server-side) + export to JSON | localStorage / PM-tool comments | Survives browser changes; backups via SQLite snapshot |
| 31 | Parked design-doc | Show with "(parked)" suffix, gray progress bar | Hide / show identical | Visible but distinguishable |
| 32 | Label schema | 3-layer: auto-detect → env override → yaml schema | Hardcoded prefixes / required schema | Generic for any Linear setup; zero config out-of-box |
| 33 | Port | 31415 | 3000 / 8080 | 3000 commonly collides; 31415 = `π × 10^4`, memorable |
| 34 | Backend abstraction | `BackendAdapter` interface, `LinearBackend` v1 | Linear-only assumption baked in | Future Jira/Plane/GitHub Projects without rewrite |
| 35 | Backend endpoint config | Per-backend env var (e.g. `LINEAR_API_ENDPOINT`) defaults to official URL | Hardcoded URL | Self-hosted backends (Plane, Jira Server) |
| 36 | Public repo discipline | Zero internal hostnames/IPs/server names in committed files | Document everything inline | Avoid leaking private infra |
| 37 | Tool name | `issue-graph` (short, generic, SEO-friendly) | `linear-graph` (Linear-only) / `project-management-graph` (long, formal) | "issue" is universal across Linear/GitHub/Jira/Plane/GitLab; 11 chars; not too generic; no abbreviation ambiguity |
| 38 | "Service" terminology | Renamed to "bucket" in code; UI label from schema (`label_singular`) | Hardcoded "Service" string | Different orgs use different words (module, team, area) |
| 39 | Tag prefix display | All prefixes auto-detected; no built-in semantic tags (`affects:`/`risk:`/`process:`) | 3 hardcoded prefixes from one example project | Other projects have other prefixes (`team:`, `quarter:`, `epic:`) |
| 40 | Code-derived dependency scanner | Removed | Multi-detector pluggable system | Project-specific; users have own tracking; not worth maintenance |
| 41 | Env var prefix convention | Backend-specific (`LINEAR_API_KEY`, `JIRA_API_TOKEN`) for backend creds; no prefix (`PORT`, `ISSUE_SCOPE`, `PRIMARY_GROUP`) for tool-intrinsic config | Generic `PM_*` prefix (used in v3 draft) | Aligns with industry convention (Sentry/Datadog/Stripe/Cloudflare); matches official Linear docs; no `PM` ambiguity |
| 42 | Type/file naming | `BackendAdapter` interface, `src/backend/sources/` directory | `PMBackend` / `src/backend/pm/` | "PM" overloaded; "sources" describes role (where issues come from) |
| 43 | Runtime compatibility | Node-compat code (works on Bun **or** Node) — `better-sqlite3`, `@hono/node-server`, no `bun:*` APIs | Bun-native (`bun:sqlite`, `Bun.serve`, `Bun.file`) | OSS friendliness — users not forced to install Bun; perf difference negligible at < 1k issues |
| 44 | Cycle/sprint integration | Skip in v1 — schema fields fetched but no UI | Full timeline filter | Author's setup doesn't use cycles; defer until demand emerges |
| 45 | Off-site backup | Local rotation only (`scripts/backup.sh`, 30 days) | rsync/rclone to NAS or S3 | Snapshots are best-effort, not compliance data; cloud creds = scope creep; document in README that operators can add their own off-site job |
| 46 | CI scope | Mid: lint + typecheck + tests on push; docker build on PR only | Minimum (lint+test) / Full (incl. image scan) | PR docker-build catches Dockerfile rot; image scan is overkill for non-shipping OSS |
| 47 | README depth | Mid: pitch + quickstart + schema customization tutorial | Minimum (10-line quickstart) / Full (competitor comparison + vision essay) | Mid is the sweet spot — useful enough to onboard, not a marketing pitch |
| 48 | Issue templates / contributing guide | Skip until first external contributor | Add at v1 launch | Empty templates create false "we expect contributors" signal; add when needed |

---

## 17. Open Questions

All v3.2-era questions resolved into the Decisions Log (§16). Remaining open questions for future versions:

1. **First external contributor** — when one appears, add CONTRIBUTING.md, issue templates, code-of-conduct (decision #48 deferred until then).
2. **Demand-driven features** — cycle/sprint UI (decision #44), bucket-to-bucket relations (decision #14), additional backends (Phase 4) — all deferred until concrete demand.
3. **Hosting on a public registry** — should the Docker image be published to GHCR / Docker Hub for easier `docker run` UX? Currently users must `docker compose build`. Defer to v1.1.
4. **First user feedback** — once 1-2 external users adopt, expect questions about schema edge cases (multiple primary groups? group with same prefix in name?). Address as they arise.

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **Backend** | The issue-tracking tool being read from. v1: Linear. Future: Jira / Plane / GitHub Projects. |
| **Backend adapter** | The code that implements `BackendAdapter` interface for one specific backend. v1: `LinearBackend`. Lives in `src/backend/sources/<name>/`. |
| **Issue** | A ticket from the backend (e.g., `PROJ-123`). Always called "issue" in code; UI may relabel via schema. |
| **Bucket** | An issue grouping based on an exclusive label group. UI label comes from `PRIMARY_GROUP` (defaults to whatever auto-detection picks: "service", "module", "team", etc.). |
| **Design-doc adapter** | Optional filesystem scanner that links issues to local design-doc progress (Spectra, OpenSpec, RFC folder). |
| **View** | A specific way of rendering the graph (Bucket / Dependency / Mix). |
| **Snapshot** | A frozen copy of graph state at a point in time. Used for time-series analysis. |
| **Instance label** | Free-form cosmetic tag (`personal-local`, `team-shared`, …) shown in UI to identify which deployment you're looking at. |
| **Sync** | An operation that fetches issues from the backend, scans design docs, updates SQLite cache. |
| **Stale issue** | An issue with no state changes for > N days (configurable). |
| **Sticky annotation** | A user-added note on a node/edge, stored in local SQLite, not synced to the backend. |
| **Label schema** | The detected (or user-overridden) mapping of label groups/prefixes to display roles. Three layers: auto-detect → env override → yaml file. |

---

## 19. Appendix — Initial File Manifest

Files to create in Phase 1:

```
issue-graph/
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── LICENSE                      (MIT)
├── README.md
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── bun.lockb                    (generated)
├── label-schema.example.yaml    (reference for Layer 3 schema)
├── docs/
│   └── PRD.md                   (this file)
├── scripts/
│   └── backup.sh
└── src/
    ├── backend/
    │   ├── index.ts             (Hono server entry)
    │   ├── db.ts                (SQLite init + migrations)
    │   ├── sources/             (backend adapters: where issues come from)
    │   │   ├── types.ts         (BackendAdapter interface, NormalizedIssue)
    │   │   ├── factory.ts       (selects adapter from BACKEND env)
    │   │   └── linear/
    │   │       ├── index.ts
    │   │       ├── queries.ts
    │   │       └── normalize.ts
    │   ├── designdoc/           (design-doc adapters)
    │   │   ├── types.ts
    │   │   ├── factory.ts
    │   │   └── spectra.ts
    │   ├── schema/              (label schema detection + override)
    │   │   ├── autodetect.ts
    │   │   ├── envOverride.ts
    │   │   └── yamlLoader.ts
    │   ├── cache.ts             (TTL logic)
    │   ├── sync.ts              (orchestration)
    │   ├── routes/              (Phase 1 unless marked)
    │   │   ├── graph.ts
    │   │   ├── sync.ts
    │   │   ├── labels.ts
    │   │   ├── issue.ts         (lazy detail fetch)
    │   │   ├── health.ts
    │   │   ├── snapshots.ts     (Phase 2)
    │   │   ├── annotations.ts   (Phase 2)
    │   │   └── settings.ts      (Phase 2)
    │   └── lib/
    │       ├── log.ts
    │       └── env.ts
    ├── frontend/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── GraphCanvas.tsx
    │   │   ├── Toolbar.tsx
    │   │   ├── FilterPanel.tsx
    │   │   ├── DetailPanel.tsx
    │   │   ├── SyncBanner.tsx
    │   │   ├── InstanceBadge.tsx
    │   │   ├── Onboarding.tsx
    │   │   └── nodes/
    │   │       ├── BucketNode.tsx
    │   │       ├── IssueNode.tsx
    │   │       └── MixedNode.tsx
    │   ├── views/
    │   │   ├── types.ts
    │   │   ├── bucket.ts
    │   │   ├── dependency.ts
    │   │   ├── mix.ts
    │   │   └── index.ts
    │   ├── store/
    │   │   ├── graphStore.ts
    │   │   ├── viewStore.ts
    │   │   ├── schemaStore.ts
    │   │   └── urlSync.ts
    │   ├── hooks/
    │   │   ├── useGraphData.ts
    │   │   ├── useViewState.ts
    │   │   └── useTheme.ts
    │   ├── lib/
    │   │   ├── api.ts
    │   │   ├── layout.ts
    │   │   ├── labelSchema.ts
    │   │   └── colors.ts
    │   └── styles/
    │       ├── tokens.css
    │       └── globals.css
    └── shared/
        └── types.ts             (NormalizedIssue, NormalizedLabel, GraphData, etc.)
```


---

**End of PRD.** Phase 1a / 1b plan stable; minor adjustments expected during implementation.
