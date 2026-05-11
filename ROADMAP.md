**English** | [繁體中文](ROADMAP.zh-TW.md)

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

## v1.2 — shipped

**Chain isolation**
- Right-click → "Isolate chain" / "Isolate chain (auto-layout)" — filters dependency view to the connected component over `blocks` edges (both directions, transitive); auto-layout variant re-runs dagre and refits camera
- Keyboard shortcuts: `c` / `Shift+C` to isolate; toolbar chip with node count + clear (×); URL-synced as `?chain=<id>`
- Chain root visual accent (★ badge + accent ring)
- Chain bypasses other filters so off-state blockers don't fragment the chain
- "Load full history" prompt when chain references issues outside the current cache window (extends scope to 365 days on click)
- 1-hop `related` neighbor expansion when the Related toggle is on
- Auto re-layout when chain isolation is cleared (no overlap on exit)

**Related edges**
- Toolbar toggle to overlay `related` relations as dashed gray edges (off by default; URL-synced as `?related=1`)
- Bidirectional dedup so each pair draws once
- `r` shortcut to toggle

**Visual scanning**
- Hover-highlight: hover any card or edge → its neighborhood stays opaque, others dim to ~15%
- Auto-dim on focus: clicking a card dims non-neighbors automatically
- Connectivity badge per card: bottom-right `⇨3 ⇦2 ╍1` shows global blocks-out / blocked-by / related counts
- Larger graph arrowheads (22 → 36) so direction reads at default zoom

**Layout primitives**
- Unified fitView pipeline driven by `measuredHeights` settling (replaces three `setTimeout` hacks; no more guessed-timing camera frames)
- Manual re-layout: ⤴ button in `<Controls>` and `Shift+R` shortcut; recenters on the focused issue if any (don't lose your place)

**Keyboard / discoverability**
- `?` and toolbar ⌨ button open a keyboard shortcut cheat sheet (modal lists every shortcut grouped by category)
- `Cmd+Shift+F` focuses the toolbar filter search (with select-all)
- Inline find-on-canvas (`Cmd+F`): Enter commits + sets focused issue + blurs so canvas shortcuts (`c`, `Shift+R`, etc) work on the match; query preserved on close; select-all on reopen
- Esc peel order: Find → context menu → focused issue (closes DetailPanel) → chain isolation

**Workspace identity**
- Settings → Backend shows current Linear workspace as a clickable Linear link (resolves earlier "Detect workspace change" v1.2 item)
- Red banner when sync detects a different `viewer.organization.urlKey` than last time, with one-click "Open Settings" / "Dismiss"
- "Display label" rename for `INSTANCE_LABEL` (was misleadingly named "Instance") with a tooltip clarifying it's cosmetic
- Reset cache & re-sync flow: blocking overlay with phase progress + auto page reload (no more "did it work?" guessing)
- "Loading…" vs "⏳ Syncing…" SyncBanner label distinguishes cache reads from real Linear syncs

**Real-time updates** (partially fulfills the prior "WebSocket live updates" Maybe item — implemented via SSE)
- File watcher on `REPO_PATH/openspec/` (debounced 500ms) — edit a `tasks.md` checkbox in your IDE, see the progress bar tick over within ~½ sec without manual refresh
- New `GET /api/events` SSE endpoint with in-process pub/sub
- Frontend `EventSource` subscriber + `refetchSilent` graphStore action
- 30 s background polling on visible tabs picks up backend TTL-driven syncs without manual refresh

**Settings**
- Cache TTL editable from Settings → Backend (was `.env` + restart only); range 10 s–24 h

**Dev experience**
- `SERVE_STATIC=false` env flag for `dev:server` so a stale `dist/` doesn't shadow the live Vite dev server
- Vite ↔ backend port collision: auto-shifts `VITE_PORT` with a loud warning instead of silently failing
- Backend root `/` 302-redirects to Vite in dev — users only need to remember one URL

**Lint / hygiene**
- All 5 pre-existing react-hooks / unused-disable warnings cleared (resolves "Resolve the 4 known `react-hooks/exhaustive-deps` warnings" v1.2 item)

## v1.3 — next

- [ ] Optional auth (basic-auth or token gate) for non-localhost deployments
- [ ] Migrate the remaining v7 hook-rule violations (`set-state-in-effect`, `purity`)
- [ ] Document the JSON shape of `/api/export` so users can build their own tools on top

## v1.4+ — likely

- [ ] **GitHub Issues backend** — same `Source` interface as Linear; high-value for OSS teams
- [ ] Multi-workspace / multi-team toggle in the UI (currently env-pinned)
- [ ] Saved views (named filter sets, not just URL params)
- [ ] **Mix view layout improvements** — the bucket-as-container layout gets cramped past ~15 nodes:
  - Collapsible buckets (click header to collapse to a `▶ docs (3)` chip)
  - Per-bucket auto-density (large buckets switch to compact cards automatically; small buckets keep full detail)
  - Zoom-aware bucket summary (when zoomed out, replace cards with a state-count chip like `backend ◯3 ⏳2 ✓1`)
  - Drag to reorder buckets
- [ ] Timeline view — surface the daily snapshot data (already persisted; needs a UI)
- [ ] Linear push-style updates — extend the SSE channel to broadcast Linear webhooks so issue changes (not just design-doc edits) appear without polling

## Maybe — no commitment

- [ ] **Jira backend** — env shape already sketched in `docs/PRD.md` §10
- [ ] Plane / GitLab issue backends
- [ ] Read-write mode (state transitions from the graph itself)
- [ ] Themed graph exports (SVG with embedded fonts)

## Not planned

- Replacing Linear/Jira/GitHub UI — this is a *visualizer*, not a tracker
- Multi-tenant SaaS hosting — self-hosted by design
- Mobile app — desktop-first; the mobile web view should still work, but no native app

---

If you want to work on something in **v1.2** or **v1.3+**, open an issue first so we can align on scope.
For **Maybe** items, open an issue to gauge interest before writing code.
