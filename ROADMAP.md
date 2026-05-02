# Roadmap

Direction, not commitment. Issues and PRs welcome on anything below.

## v1.0 — shipped

- Linear backend (read-only sync, configurable team/scope)
- Views: dependency, mix, design-doc
- [Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/) adapter (frontmatter, folder-name, regex-line strategies)
- SQLite persistence, daily snapshots with retention
- Annotations, settings page, PNG export
- Auto-detected label schema with optional `label-schema.yaml` override
- Single-binary Docker image

## v1.1 — shipped

- Unified `REPO_PATH` env var (replaces the `REPO_HOST_PATH` / in-container `/repo` split — works identically in `bun run dev` and `docker compose up`); startup warning when `REPO_PATH` is non-absolute
- `POST /api/reset-cache` endpoint to wipe issue + label cache and workspace-tied meta (preserves annotations, snapshots, sync history)
- Settings → "Reset cache & re-sync" button — one-click recovery after switching `LINEAR_API_KEY` to a different workspace
- Sync-time warning when cached count >> synced count (heuristic for "you probably switched workspaces")
- `demo-repo/` — sample `openspec/` directory shipped with the repo, demonstrates all three linkage strategies
- README hero + design-doc screenshots, GitHub `[!WARNING]` / `[!TIP]` alert syntax
- Doc alignment: dropped pre-1.0 phasing language and stale view names (Bucket / Timeline)

## v1.2 — next

- [ ] Optional auth (basic-auth or token gate) for non-localhost deployments
- [ ] Resolve the 4 known `react-hooks/exhaustive-deps` warnings in `FilterPanel` and `DetailPanel`
- [ ] Migrate the remaining v7 hook-rule violations (`set-state-in-effect`, `purity`)
- [ ] Document the JSON shape of `/api/export` so users can build their own tools on top
- [ ] Detect workspace change automatically via `viewer.organization.urlKey` and offer the user a one-click reset (today: manual via the Settings → "Reset cache" button)

## v1.3+ — likely

- [ ] **GitHub Issues backend** — same `Source` interface as Linear; high-value for OSS teams
- [ ] Multi-workspace / multi-team toggle in the UI (currently env-pinned)
- [ ] Saved views (named filter sets, not just URL params)
- [ ] **Mix view layout improvements** — the bucket-as-container layout gets cramped past ~15 nodes:
  - Collapsible buckets (click header to collapse to a `▶ docs (3)` chip)
  - Per-bucket auto-density (large buckets switch to compact cards automatically; small buckets keep full detail)
  - Zoom-aware bucket summary (when zoomed out, replace cards with a state-count chip like `backend ◯3 ⏳2 ✓1`)
  - Drag to reorder buckets
- [ ] Timeline view — surface the daily snapshot data (already persisted; needs a UI)

## Maybe — no commitment

- [ ] **Jira backend** — env shape already sketched in `docs/PRD.md` §10
- [ ] Plane / GitLab issue backends
- [ ] Read-write mode (state transitions from the graph itself)
- [ ] WebSocket live updates (currently poll-on-load + manual sync)
- [ ] Themed graph exports (SVG with embedded fonts)

## Not planned

- Replacing Linear/Jira/GitHub UI — this is a *visualizer*, not a tracker
- Multi-tenant SaaS hosting — self-hosted by design
- Mobile app — desktop-first; the mobile web view should still work, but no native app

---

If you want to work on something in **v1.2** or **v1.3+**, open an issue first so we can align on scope.
For **Maybe** items, open an issue to gauge interest before writing code.
