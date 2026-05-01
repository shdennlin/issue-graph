# issue-graph

Self-hosted, read-only graph viewer for issue dependencies. Fetches from Linear, renders an interactive graph of issues, buckets, and `blocks` relationships. Optionally enriches with local design-doc progress.

> **Status:** Phases 1a → 3 implemented · Linear backend · Spectra/OpenSpec adapter included.

## What it shows

- **Dependency view** — `blocks` edges between issues. Default landing view. Answers "what should I work on next?"
- **Bucket view** — issues grouped by a configurable Linear label group (`service`, `module`, `team`, `area` — auto-detected).
- **Mix view** — buckets as containers + issues inside; cross-bucket `blocks` edges highlighted in red.
- **Design-doc view** *(Phase 3)* — issues with linked design-doc changes only.
- **Timeline view** *(Phase 3)* — historical state counts from daily snapshots.

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

### Required env vars

| Var | Purpose |
|---|---|
| `LINEAR_API_KEY` | Personal API key — Linear → Settings → API → Create Personal API Key |

Everything else has a sane default. See `.env.example` for the full list.

### Optional design-doc integration

Mount any directory at `/repo` to enable design-doc progress on nodes:

```yaml
# docker-compose.yml override
volumes:
  - /path/to/your/repo:/repo:ro
```

The Spectra/OpenSpec adapter looks for `openspec/changes/<name>/proposal.md` files containing a `Linear: PROJ-123` line and counts checkboxes in the corresponding `tasks.md`. If `openspec/` doesn't exist, the integration is silently disabled.

## Fifteen-minute customization

### Layer 2 — env-var schema overrides

Out of the box, `issue-graph` autodetects label groups whose names match `service|component|owner|module|team|area|domain` (used to group issues into buckets) and `type|kind|category` (used to pick a leading icon).

If your team uses different names — e.g. you call your buckets "squads" — set:

```bash
PRIMARY_GROUP=squad
TYPE_GROUP=Type
TYPE_ICONS={"Bug":"🐛","Feature":"✨","Spike":"🔬"}
```

Restart, and the bucket view, filter sidebar, and node icons all pick up the override.

### Layer 3 — `label-schema.yaml`

For full control over how every label group and prefix renders, drop a YAML file at `LABEL_SCHEMA_PATH` (default `/app/data/label-schema.yaml`). See `label-schema.example.yaml` for a complete reference. The file is hot-reloaded — edit it, then click "Refresh" in the banner to pick up changes without restarting the container.

## Backup posture

- **Daily SQLite backup**: `scripts/backup.sh` runs via cron, keeps 30 days locally at `data/backups/`.
- **If the SQLite volume is lost**: the next sync repopulates issue data from Linear. Snapshot history (max 1 year) and user-added annotations would be lost.
- **Off-site replication**: the tool deliberately does not ship with cloud-storage credentials handling. Operators wanting off-site backup should add their own rsync/rclone job pointing at `data/backups/`.

## Architecture

- **Single Docker image** running both backend (Hono + better-sqlite3) and frontend (React + React Flow + dagre).
- **Pluggable backend adapter** (`src/backend/sources/`) — Linear in v1; Jira / Plane / GitHub Projects in future.
- **Pluggable design-doc adapter** (`src/backend/designdoc/`) — Spectra/OpenSpec in v1.
- **Code is Node-compatible**; the official image runs Bun. A `Dockerfile.node` is also provided.

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
npm install
npm run dev        # concurrent backend + frontend (Vite proxies /api → :31415)
npm run typecheck
npm run lint
npm test
npm run build      # production build → dist/ + build/
```

## License

[MIT](LICENSE)
