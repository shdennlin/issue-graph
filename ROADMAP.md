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

## v1.3 — shipped

**Workspaces — multi-tab UI**
- Tab bar replaces the single-workspace header. Each tab holds its own
  workspace + view + filters + focus + viewport, persisted to
  sessionStorage and restored across reload / browser restart
- `Cmd/Ctrl + 1..9` jump-to-Nth-tab, drag to reorder, ⭐ "set as default"
  per workspace
- `WORKSPACE_<ID>_*` env-var schema with a fallback legacy mode for the
  single-key `LINEAR_API_KEY` setup
- Resolves the prior "Multi-workspace / multi-team toggle" Likely item

**Project view**
- New top-level view grouping issues by Linear project; cross-project
  `blocks` edges highlighted; "(No project)" pinned last
- Project filter dimension in the sidebar (combinable with all other
  filters)

**Layout — multi-column buckets**
- Mix and Project containers pack into 2–3 columns based on issue count;
  tall single-column stacks gone

**Design-doc / git worktrees**
- Adapter scans every git worktree rooted at `REPO_PATH` and dedupes
  linked issues across worktrees so nothing renders twice
- OpenSpec / Spectra adapters split into separate modules; Spectra picks
  up the new default `spec_dir` introduced in v2.2.5+ and supports
  configurable `spec_dir` for non-standard layouts

**PWA**
- Web app manifest + service worker; installable from Chrome / Edge URL
  bar or Safari → File → Add to Dock. App shell pre-cached; Linear data
  + SSE stream remain network-only

**Stability**
- Viewport restore wins over ReactFlow's startup `fitView` race
- SQLite path pinned to `/app/data/graph.db` inside the Docker container
  to prevent host-path leakage
- `data-dev/` host-only dev tree gitignored, kept disjoint from `data/`
  so concurrent SQLite WAL writes can't corrupt either

## v1.4 — shipped

**Quick switcher — `Cmd+K`**
- Fuzzy palette searches issues across every open tab; rows show title,
  identifier, and current state chip
- Persisted recents float to the top; toolbar trigger button alongside
  the keyboard shortcut
- Selecting an item pans the canvas to that issue and preserves the
  detail panel state across the navigation

**Workspace notes**
- Markdown notes scoped per workspace; grid + list views, archive +
  one-step undo, `n` shortcut to toggle the modal, `Cmd+E` (or `Cmd+/`
  inside the PWA) to flip Edit / Preview inside an open note
- Issue-ID mentions inside a note render the issue's current status
  inline next to the ID

**Navigation history**
- `Cmd/Ctrl + [ / ]` back-forward through view / filter / focus / chain
  changes — restores viewport on undo too

**Detail panel improvements**
- Linear comment thread surfaced directly in the panel; no more
  context-switching to Linear to read discussion
- Click any metadata value (state, priority, assignee, project, primary
  label) to filter the canvas by it
- Wide-mode resize cap widened to 75 % of viewport / 1200 px; side-mode
  also adopts the new cap. Per-panel 4-grade text-size cycle
  independent of the global font setting
- Shimmering skeleton placeholder replaces the plain "Loading…" text
  during issue fetch
- Inline canvas find auto-hides while wide mode is open to avoid overlap
- Focus is decoupled from the panel: clicking a node highlights it
  without forcing the panel open; `Space` / `Enter` open the panel
  on-demand; two-step `Esc` peels the panel before clearing focus
- `d` toggles the "auto-open detail panel on focus" preference

**Cross-platform keyboard labels**
- `Cmd/⌘` renders as `Ctrl` on Windows/Linux; `Delete` renders as
  `Backspace`. Centralised in `src/frontend/lib/platform.ts`. QA override
  via `?platform=windows` or `localStorage.ig-platform`

**i18n — English + Traditional Chinese**
- Tiny custom dict + Zustand-backed locale store; English is the default,
  zh-TW opt-in via Settings → Language; persisted to localStorage
- Translations cover Toolbar, Settings, Shortcuts cheat sheet,
  Onboarding, Sync banner, modal headers, FilterPanel, DetailPanel,
  NotesModal, view labels
- `README.zh-TW.md` plus zh-TW companions for the user-facing docs in
  `docs/` and `ROADMAP.md`. `docs/PRD.md` intentionally English-only

**Chain isolation — universal**
- Chain-isolation entry and exit now work in every view (dependency,
  mix, project) with viewport preserved across the toggle

**Filter sidebar overhaul**
- Filter sections are collapsible with sticky headers + active-count
  badges; each section has its own clear button. Semantic icons + section
  dividers make scanning faster

**Markdown tables**
- Tables in design docs and notes render with visible borders and
  zebra striping for legible structured data

**Settings — label-group surface**
- Active bucket / type label group is shown directly in Settings and
  in the Mix tooltip, so it is always clear which schema drives layout

**Polish**
- Header row: TabBar and SyncBanner merged into a single row
- Settings: visually delimited sections, sticky footer actions
- Shortcuts modal: wider, responsive 2-column layout
- Toolbar: low-frequency actions collapse into an overflow menu;
  modernised with `lucide` icons and flat buttons
- Mix containers tinted with per-bucket accent colour
- ContextMenu / inline find / IssueNode glyphs swapped for `lucide`
  icons; modal headers unified via shared `ModalHeader` helper

**Stability**
- Camera centering uses the freshly built node positions (no more
  pre-layout off-center jumps when switching views or after `F5`)
- Quick-switcher activation now reliably pans the canvas regardless of
  detail-panel state (bypasses a broken d3-transition path with a
  self-driven rAF tween)
- Switching workspaces clears any focused-note stub so the notes modal
  opens cleanly on the new workspace instead of hanging on
  "Loading note…"

**Dev experience**
- React-hooks v7 recommended preset adopted
- Opt-in bundle-composition report via `rollup-plugin-visualizer`

## Unreleased — filter panel rebuild

**Filter panel — from sidebar to floating facet bar**
- The fixed-width sidebar is gone. A compact panel floats over the canvas's
  top-left corner, one row per applied filter, so an unused dimension costs
  no vertical space at all
- `+ Filter` opens a cascading menu: dimensions on the left, that dimension's
  values flying out beside the hovered row with checkboxes and counts
- The menu's search box fuzzy-matches **values across every dimension**, not
  just dimension names — `bug` finds `Type › Bug`. Capped at 12 ranked results
- Chips render as aligned rows rather than pills: dimension, operator, value,
  clear. Structure comes from column alignment, so the panel carries one border

**Negatable conditions**
- Any multi-select filter can be inverted (`is` ↔ `is not`), stored as
  `Filters.negated` and serialized as one `neg=` URL param, so a new dimension
  is negatable for free
- Value counts hide while inverted — they are leave-one-out ("pick this and N
  remain"), which answers the wrong question once picking excludes

**Saved views**
- Named view + filter snapshots in a new `saved_view` table, per workspace and
  shared by everyone reaching the instance. Survive a cache reset
- Stores the URL query string, not structured JSON, so `urlSync` stays the
  single codec and a view cannot drift from what the URL can express
- The panel names the active view, marks divergence with `*`, and offers Save
  changes / Discard changes. Name also carried in the window title and tab label

**Recent activity filter**
- `any / today / 7d / 30d` against either `createdAt` or `updatedAt`.
  `today` means since local midnight; the rolling windows match `staleDays`

**Pinned filter values**
- Pinned values sort to the top of their dimension's list. localStorage, keyed
  per workspace — pins hold raw label/project ids that mean nothing elsewhere

**Fixes**
- Four filter dimensions (project, milestone, state name, search) were never
  written to the URL: shared links dropped them and Back cleared them silently.
  A pure `filterCodec` now owns all three registration points with a round-trip
  test over every dimension
- Specific Linear states used to shadow every canonical type at once, making
  the state tree behave as though it were mutually exclusive. Names now refine
  within their own type
- Clicking the canvas failed to dismiss any dropdown in the app — d3-drag stops
  propagation on the pane, so a bubble-phase listener never fired
- Constraints live at their defaults (active-only, four of six state types) now
  appear as clearable rows instead of an empty panel implying no filters

**Removed**
- `Filters.tagIds`, stored and serialized since the first release but never
  read by `applyFilters`. Its intended role shipped as `orphanValues`

## v1.5 — next
- [x] **Linear push-style updates** — `POST /api/webhooks/linear` accepts Linear's
      HMAC-signed deliveries, debounces a burst into one sync, and broadcasts
      `issues-changed` over the existing SSE channel, so issue edits land without
      waiting for the cache TTL. Publish that path alone (e.g. a path-scoped
      Tailscale funnel); it is the only route meant to be reachable from outside.

- [x] **Workspaces move out of `.env`** — the roster (names, API keys, webhook
      secrets) lives in `data/workspaces.db` and is managed from a setup form
      and Settings, so a remote deployment no longer needs shell access to add
      a Linear workspace. Replaces the `WORKSPACE_<ID>_*` env schema and its
      single-key legacy mode listed under v1.3.
      **Breaking:** per-workspace `REPO_PATH` is gone; `REPO_PATH` is now one
      server-wide value. Existing deployments start with an empty roster and
      re-enter their workspaces — re-using the same id reconnects the cached data.
- [ ] Optional auth (basic-auth or token gate) for non-localhost deployments
- [ ] Migrate the remaining v7 hook-rule violations (`set-state-in-effect`, `purity`) — currently suppressed per-call-site
- [ ] Document the JSON shape of `/api/export` so users can build their own tools on top

## v1.6+ — likely

- [ ] **GitHub Issues backend** — same `Source` interface as Linear; high-value for OSS teams
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
- [ ] Themed graph exports (SVG with embedded fonts)

## Not planned

- Replacing Linear/Jira/GitHub UI — this is a *visualizer*, not a tracker
- Multi-tenant SaaS hosting — self-hosted by design
- Mobile app — desktop-first; the mobile web view should still work, but no native app

---

If you want to work on something in **v1.5** or **v1.6+**, open an issue first so we can align on scope.
For **Maybe** items, open an issue to gauge interest before writing code.
