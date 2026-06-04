**English** | [繁體中文](README.zh-TW.md)

# issue-graph

Self-hosted, read-only graph viewer for issue dependencies. Fetches from Linear, renders an interactive graph of issues, buckets, and `blocks` relationships. Optionally enriches with local design-doc progress.

![Issue Graph — dependency view with detail panel showing the selected issue's design-doc progress, blocks/blocked-by, and annotations](docs/screenshots/dependency.png)

## What it shows

- **Dependency view** — `blocks` edges between issues. Default landing view. Answers "what should I work on next?"
- **Mix view** — issues grouped into buckets by a configurable Linear label group (`service`, `module`, `team`, `area` — auto-detected); cross-bucket `blocks` edges highlighted in red.
- **Project view** — issues grouped by their Linear project. Each project becomes a container; cross-project `blocks` edges highlighted.
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

Everything else has a sane default. `.env.example` is intentionally minimal;
advanced workspace profile details live in [Advanced workspace profiles](docs/advanced-workspaces.md).

### Multiple Linear workspaces

For the default single-workspace setup, keep using `LINEAR_API_KEY`. If you
regularly switch between Linear workspaces, define named profiles in `.env`
instead:

```env
WORKSPACE_ACTIVE=personal

WORKSPACE_PERSONAL_NAME=Personal
WORKSPACE_PERSONAL_LINEAR_API_KEY=lin_api_xxx
WORKSPACE_PERSONAL_LINEAR_TEAM_ID=
WORKSPACE_PERSONAL_REPO_PATH=/path/to/personal/repo

WORKSPACE_CLIENT_A_NAME=Client A
WORKSPACE_CLIENT_A_LINEAR_API_KEY=lin_api_yyy
WORKSPACE_CLIENT_A_LINEAR_TEAM_ID=
WORKSPACE_CLIENT_A_REPO_PATH=/path/to/client-a/repo
```

The top-left becomes a **tab bar** when profiles are configured. Each tab
holds its own workspace + filters + view + viewport, so you can keep two
workspaces (or two views of the same workspace) open side-by-side and
flip between them without losing context. Drag tabs left/right to reorder,
`Cmd/Ctrl + 1..9` to jump to the Nth tab. Switching tabs (or workspaces)
does not require a backend restart. API keys remain in `.env`.

Each profile gets isolated local data:

```text
data/workspaces/personal/graph.db
data/workspaces/client_a/graph.db
```

`Reset current workspace data` only clears the active profile's cache. Other
workspace databases are left untouched.

For profile naming, Docker mounts, and design-doc scanning with multiple repos,
see [Advanced workspace profiles](docs/advanced-workspaces.md).

### Optional design-doc integration

If your team writes design docs / RFCs / change proposals as markdown files alongside your code, `issue-graph` can scan them and show **per-issue progress bars** plus a "design-doc only" view filter.

> [!IMPORTANT]
> Only the [Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/) layout is supported, with proposals at `<REPO_PATH>/<spec_dir>/changes/<name>/proposal.md` and `tasks.md`. `<spec_dir>` is `openspec/` for OpenSpec; for Spectra it comes from `spec_dir` in `.spectra.yaml` (defaulting to `docs/specs/`, falling back to `openspec/` during migration). Other formats (ADRs, custom layouts) are not auto-detected.

See **[Design-doc integration](docs/design-doc-integration.md)** for the full setup, three linkage strategies (frontmatter / folder name / `Linear: PROJ-123` line), and the Coverage report workflow.

![Design-doc view — only issues with linked proposals, each showing a per-issue progress bar derived from the proposal's tasks.md](docs/screenshots/designdoc.png)

### Install as a desktop app (optional)

`issue-graph` ships a web app manifest and service worker, so once it's running you can install it as a standalone window:

- **Chrome / Edge:** click the **install** icon in the URL bar (or `⋮` → *Install Issue Graph*).
- **Safari (macOS):** *File* → *Add to Dock*.

The service worker pre-caches only the app shell (HTML / CSS / JS / icons). Linear data and the SSE event stream stay network-only, so workspace data is never served stale. Uninstalling reverses both — no leftover state on disk.

## Customization

`issue-graph` autodetects common Linear label group names (`service|component|owner|module|team|area|domain` for buckets, `type|kind|category` for icons). For different naming conventions or full control via `label-schema.yaml`, see **[Customizing labels and icons](docs/configuration.md)**.

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

The active workspace, view, every filter, the focused node, and the theme are encoded in the URL:

```
http://localhost:31415/?w=team_a&view=project&bucket=svc1,svc2&priority=1,2&focus=PROJ-123&theme=dark
```

Share a link in chat — your teammate sees the same view. Valid `view=`
values are `dependency`, `mix`, `project`, `designdoc`. The `w=`
parameter selects a workspace profile by id.

## Keyboard

Press `?` in the app for the full cheat sheet. Highlights:

- `Cmd/Ctrl + F` — find on canvas; `Enter` jumps to next match and returns keyboard focus to the canvas
- `Cmd/Ctrl + Shift + F` — focus the toolbar filter search
- `Cmd/Ctrl + 1..9` — switch to the Nth tab in the tab bar (each tab keeps its own filters / view / viewport)
- `c` / `Shift + C` — isolate chain on focused issue (preserve / auto-layout)
- `r` — toggle Related-edges overlay
- `Shift + R` — re-layout (re-run dagre, recenters on focused issue)
- `Esc` — peel one layer: Find → context menu → focused issue → chain isolation
- `Cmd/Ctrl + click` on a node — multi-select
- `Cmd/Ctrl + Shift + S` — screenshot the current canvas as PNG
- Right-click on a node — context menu
- Double-click a node — open in Linear

> [!NOTE]
> **Desktop-first.** Hover-highlight and the keyboard shortcuts above assume a real keyboard + pointer. On touch devices the basics still work (click to focus / pin, pinch to zoom, drag to pan, the toolbar / detail panel) but the fast hover-to-scan flow doesn't translate.

## Raycast extension

A [Raycast](https://raycast.com) extension lives in [`integrations/raycast/`](integrations/raycast/) — fuzzy-search every cached issue **across all workspaces** and jump straight to one, without opening the app first.

- **Search Issues** — type to filter by id, title, assignee, or workspace. Results are grouped by state (Triage → In Progress → Todo → Backlog → Completed → Canceled) and the issues you open most often float to the top (frecency).
- **Inline detail** (`⌘D`) — status, priority, assignee, due date (overdue flagged red), labels, project, milestone, relations, sub-issues, comments — read from the local cache, no extra calls.
- **Open straight into the PWA** via the `web+issuegraph://` URL scheme — the OS routes it into the installed app, which focuses the issue and opens its detail panel (the PWA equivalent of Linear's `linear://`). Browser fallbacks (`⌥↵`) work with no PWA installed.

Install (needs the Raycast app):

```bash
cd integrations/raycast
bun install
bun run dev        # = ray develop — imports the command into Raycast
```

Running `ray develop` once imports the extension; it stays available in Raycast even after you stop the dev process. Point **Issue Graph URL** at your host if it isn't `http://localhost:31415`. See [`integrations/raycast/README.md`](integrations/raycast/README.md) for the full action list, the `web+issuegraph://` scheme, and how to land links in the PWA window.

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

For common issues — stale cache after switching `LINEAR_API_KEY`, blank-slate reset, etc. — see **[Troubleshooting](docs/troubleshooting.md)**.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for what's planned, what's likely, and what's explicitly out of scope. The original engineering PRD lives at [`docs/PRD.md`](docs/PRD.md) for historical context.

## License

[MIT](LICENSE)
