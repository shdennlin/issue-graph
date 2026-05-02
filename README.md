# issue-graph

Self-hosted, read-only graph viewer for issue dependencies. Fetches from Linear, renders an interactive graph of issues, buckets, and `blocks` relationships. Optionally enriches with local design-doc progress.

![Issue Graph — dependency view with detail panel showing the selected issue's design-doc progress, blocks/blocked-by, and annotations](docs/screenshots/dependency.png)

## What it shows

- **Dependency view** — `blocks` edges between issues. Default landing view. Answers "what should I work on next?"
- **Mix view** — issues grouped into buckets by a configurable Linear label group (`service`, `module`, `team`, `area` — auto-detected); cross-bucket `blocks` edges highlighted in red.
- **Design-doc view** — issues with linked design-doc changes only.

## Five-minute setup

```bash
git clone https://github.com/<owner>/issue-graph
cd issue-graph
cp .env.example .env
# edit .env, set LINEAR_API_KEY
mkdir -p data
docker compose up -d --build
open http://localhost:31415
```

When the page loads, the backend pulls active+recent issues from Linear, scans the optional repo at `REPO_PATH` for design docs, and renders the dependency graph.

> [!WARNING]
> **Do not expose this port to a LAN or the internet without auth.**
> `issue-graph` ships with **no authentication**. The write endpoints (`POST /api/sync`,
> `POST/DELETE /api/annotations`, `POST /api/settings`) are open to anyone who can reach
> the port. The default Docker compose binds `31415` on all interfaces — fine for
> `localhost`-only use, but if you need remote access put it behind a reverse proxy
> with auth (Tailscale, Cloudflare Access, basic-auth nginx, etc.).

### Required env vars

| Var | Purpose |
|---|---|
| `LINEAR_API_KEY` | Personal API key — Linear → Settings → API → Create Personal API Key |

Everything else has a sane default. See `.env.example` for the full list.

### Optional design-doc integration

If your team writes design docs / RFCs / change proposals as markdown files alongside your code — common in **Spec-Driven Development (SDD)** workflows — `issue-graph` can read them and show **per-issue progress bars** on the graph (e.g. `4/9 tasks done`). Currently only the **[Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/)** layout is supported — proposals at `openspec/changes/<name>/proposal.md` with a `tasks.md` containing `- [ ]` / `- [x]` checkboxes.

![Design-doc view — only issues with linked proposals, each showing a per-issue progress bar derived from the proposal's tasks.md](docs/screenshots/designdoc.png)

#### 1. Point at your repo

Set one absolute path in `.env`:

```bash
REPO_PATH=/path/to/your/repo
```

Used identically by `bun run dev` and `docker compose up` — under Docker the path is bind-mounted at the same location inside the container, so the backend reads it the same way in both modes. Path **must** be absolute.

If `openspec/` doesn't exist under `REPO_PATH`, the integration is silently disabled — no errors, the design-doc filter just doesn't appear in the UI.

> [!TIP]
> Curious what proposals look like? See [`demo-repo/`](demo-repo) — a sample `openspec/` directory used by the project's own screenshots. Set `REPO_PATH=/absolute/path/to/issue-graph/demo-repo` to load it.

#### 2. Link issues to design-doc changes

The adapter tries **three strategies** in sequence and unions the results. Pick whichever fits your workflow — you don't need all three:

| Strategy | When to use | Example |
|---|---|---|
| **A. Frontmatter** *(recommended for new teams)* | Want a machine-readable, copy-paste convention. Survives folder renames. | `proposal.md` opens with:<br>`---`<br>`linear: [PROJ-123, PROJ-456]`<br>`---` |
| **B. Folder name** | Want the link visible at filesystem level / `git status`. | Rename change dir to `openspec/changes/PROJ-123-checkpoint-resume/` |
| **C. Regex line** *(legacy / informal)* | Already have proposals with prose like "Related Linear issues: PROJ-105, PROJ-107". | Any line in `proposal.md` mentioning "linear" — IDs on that line are extracted. |

**Examples — all three produce the same link:**

```markdown
<!-- A. Frontmatter -->
---
linear: [PROJ-123]
---
# Refactor authentication
```

```text
<!-- B. Folder name -->
openspec/changes/PROJ-123-refactor-auth/proposal.md
```

```markdown
<!-- C. Regex line -->
Linear: PROJ-123

# Refactor authentication
```

```markdown
<!-- C. Regex line, "Related" form -->
Related Linear issues: PROJ-105 (resume), PROJ-107, PROJ-70
```

#### 3. Verify with the Coverage report

Click the **📊 button** in the toolbar to open the Coverage modal. It shows:

- Total changes scanned, how many are linked, how many aren't
- Breakdown by strategy (`5 frontmatter / 2 folder / 6 regex`)
- A per-change list — click "Unlinked" filter to see exactly which proposals need a Linear ID
- Active issues (started / unstarted) without any linked design doc — i.e. work happening without a written plan

Use the report to decide where to add structure. The most common workflow:

1. Open Coverage → switch filter to **Unlinked**
2. For each unlinked change you care about, add `--- linear: [PROJ-XXX] ---` to its `proposal.md`
3. Click 🔄 Refresh in the banner
4. Re-open Coverage to confirm the count moved

The data comes from the last sync — refresh after editing files to see updates.

#### 4. Other layouts

If your design docs aren't in `openspec/`, the adapter doesn't auto-detect anything. The architecture supports adding more adapters under `src/backend/designdoc/` (e.g. `rfc-folder`, `notion-export`) — see `spectra.ts` for the contract.

## Fifteen-minute customization

### Quick override (env vars)

Out of the box, `issue-graph` autodetects label groups whose names match `service|component|owner|module|team|area|domain` (used to group issues into buckets) and `type|kind|category` (used to pick a leading icon).

If your team uses different names — e.g. you call your buckets "squads" — set:

```bash
PRIMARY_GROUP=squad
TYPE_GROUP=Type
TYPE_ICONS={"Bug":"🐛","Feature":"✨","Spike":"🔬"}
```

Restart, and the Mix view buckets, filter sidebar, and node icons all pick up the override.

### Full control (`label-schema.yaml`)

For full control over how every label group and prefix renders, drop a YAML file at `LABEL_SCHEMA_PATH` (default `/app/data/label-schema.yaml`). See `label-schema.example.yaml` for a complete reference. The file is hot-reloaded — edit it, then click "Refresh" in the banner to pick up changes without restarting the container.

## Backup posture

- **Daily SQLite backup**: `scripts/backup.sh` runs via cron, keeps 30 days locally at `data/backups/`.
- **If the SQLite volume is lost**: the next sync repopulates issue data from Linear. Snapshot history (max 1 year) and user-added annotations would be lost.
- **Off-site replication**: the tool deliberately does not ship with cloud-storage credentials handling. Operators wanting off-site backup should add their own rsync/rclone job pointing at `data/backups/`.

## Architecture

- **Single Docker image** running both backend (Hono + Bun's built-in SQLite) and frontend (React + React Flow + dagre).
- **Pluggable backend adapter** (`src/backend/sources/`) — Linear in v1; Jira / Plane / GitHub Projects in future.
- **Pluggable design-doc adapter** (`src/backend/designdoc/`) — [Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/) in v1.

For full design rationale, see [`docs/PRD.md`](docs/PRD.md).

## Backends

- **v1**: [Linear](https://linear.app) (read-only via personal API key)
- **Future** (architecture is in place): Jira, Plane, GitHub Projects

## URL deep linking

Every filter, the active view, the focused node, and the theme are encoded in the URL:

```
http://localhost:31415/?view=mix&bucket=svc1,svc2&priority=1,2&focus=PROJ-123&theme=dark
```

Share a link in chat — your teammate sees the same view.

## Keyboard

- `Cmd/Ctrl + click` on a node — multi-select
- `Cmd/Ctrl + Shift + S` — screenshot the current canvas as PNG
- Right-click on a node — context menu
- Double-click a node — open in Linear

## Development

```bash
bun install
bun run dev        # concurrent backend + frontend (Vite proxies /api → :31415)
bun run typecheck
bun run lint
bun run test
bun run build      # production build → dist/ + build/
```

## Troubleshooting

### I changed my `LINEAR_API_KEY` and the graph still shows the old workspace's issues

Issue-graph caches issues by identifier in `data/graph.db`. If you switch `LINEAR_API_KEY` to a different workspace, the old issues stay in the cache (their identifiers don't collide with the new ones), polluting the graph.
The next sync will log a warning when it notices this:

```
WARN: Cache holds far more issues than this sync returned. If you switched
LINEAR_API_KEY to a different workspace, POST /api/reset-cache to clear
stale data.
```

Fix it with a single request — clears `issue_cache`, `label_cache`, and the workspace-tied meta entries (design-doc payload, workflow states).  Snapshots, annotations, and sync history are preserved:

```bash
curl -X POST http://localhost:31415/api/reset-cache
curl -X POST http://localhost:31415/api/sync
```

Or, if you'd rather start over from a blank slate (loses snapshots + annotations too), stop the server and `rm data/graph.db data/graph.db-shm data/graph.db-wal`.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for what's planned, what's likely, and what's explicitly out of scope. The original engineering PRD lives at [`docs/PRD.md`](docs/PRD.md) for historical context.

## License

[MIT](LICENSE)
