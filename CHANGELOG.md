# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [v1.3.0] - 2026-05-09

### What's New

**Tabs — open multiple workspaces side by side**
The app now has a full tab bar at the top of the window. Each tab holds its own workspace, its own view, and its own graph position. You can open as many tabs as you need, drag them into any order, and switch between them with `Cmd+1` through `Cmd+9`. Everything about the current session — which tabs are open, which workspace each one points to, the graph's zoom level and scroll position — is saved automatically and restored exactly as you left it when you reload or reopen the app.

**Project view**
A new "Project" grouping mode organises your issues by Linear project rather than by status or assignee. Switch to it from the view selector in the toolbar to get a clear per-project breakdown of what is blocked, blocking, or in flight.

**Filter by project**
The filter panel now includes a Project dimension alongside the existing Team, Assignee, and Label filters. You can combine it with any other filter to narrow the graph to just the issues that belong to a particular initiative.

**Multi-column container layout**
Wide buckets — such as "In Progress" columns with many issues — are now packed into two or three columns automatically. Tall single-column stacks are gone; the layout breathes horizontally and is much easier to scan.

**Design doc support for git worktrees**
If you work with `git worktree` to check out multiple branches simultaneously, the design doc panel now scans every worktree rooted at your repository and surfaces the right spec file for each issue, deduplicating entries so nothing appears twice.

**OpenSpec and Spectra adapters separated**
The two design-doc backends (OpenSpec and Spectra) are now fully independent modules. Spectra picks up the new default `spec_dir` introduced in Spectra v2.2.5+, and the `spec_dir` path is configurable for teams that keep specs in a non-standard location.

**Install as a desktop app (PWA)**
The app ships a web app manifest and service worker, so browsers that support Progressive Web Apps can install it to the dock or taskbar. Once installed it opens in its own window, without browser chrome, and works as a first-class desktop app.

### Improved

**Graph position survives tab switches**
Switching tabs no longer resets your zoom level or scroll position. When you come back to a tab the graph is exactly where you left it. Viewport state is also saved to local storage, so a page reload or browser restart brings you back to the same position.

**Viewport restore is reliable**
A timing conflict between the app's saved viewport and ReactFlow's own startup animation has been resolved. The saved position now reliably wins, so the graph no longer snaps to a different location a fraction of a second after loading.

**Hover highlighting works at full cursor speed**
Rapidly moving the cursor across the graph no longer leaves nodes or edges stuck in a half-highlighted state. The highlight now self-heals instantly as the cursor moves, even on dense graphs with many overlapping edges.

**Consistent arrowhead sizes**
Dependency arrowheads are now the same size in every view mode. Previously, switching views could cause arrowheads to render at different scales.

**Data isolation between development and production**
When running locally, the app now keeps developer data in a separate `data-dev/` directory that is never committed to the repository. The Docker container always writes to `/app/data/graph.db`, eliminating the risk of a host path leaking into the container or corrupting a production database.

### Fixed

- SQLite corruption that could occur when the container was started without an explicit `SQLITE_PATH` has been resolved. The path is now pinned inside the container so it is always consistent.
- Switching tabs no longer briefly applies the outgoing tab's filters or view settings to the incoming tab before that tab's own state loads.
- The graph no longer flickers or jumps when switching workspaces via the tab bar.

---

## [v1.2.0] - 2026-05-04

### What's New

**Chain isolation**
Right-click any issue in the dependency view and choose "Isolate chain" to focus on just that issue and the sequence of work it belongs to. The root of the chain is visually accented, and a counter chip shows how many issues are in it. Press `C` to enter chain mode from the keyboard. If some chain members haven't been loaded yet, the graph will offer a "Load full history" prompt so nothing is silently missing. Clearing chain isolation smoothly re-fits the layout so you land back in context.

**Related edges**
A new toggle overlays "related" links as dashed lines alongside the normal blocking/blocked-by arrows. When the Related toggle is on, chain isolation automatically expands one hop to include related neighbors — so you see the full picture without leaving focus mode. The detail panel also now shows a dedicated "Related" section next to "Blocks", so related issues are visible even without the overlay.

**Hover highlight and auto-dim**
Hovering over any issue in the graph now highlights its direct connections and softly dims everything else. This makes it much easier to trace dependencies in a busy graph without having to click in.

**Connectivity badges**
Each node now displays a small badge showing how many connections it has, with glyphs and sizing that scale to the count. At a glance you can tell which issues are hubs versus leaves.

**Keyboard shortcuts and cheat sheet**
A full set of keyboard shortcuts is now available. Press `?` or click the keyboard icon in the toolbar to open the cheat sheet. Key bindings include:
- `C` — enter chain isolation mode
- `R` — toggle the Related overlay
- `Shift+R` — re-run the auto-layout
- `Cmd+Shift+F` — jump directly to the toolbar filter search
- `Esc` — step back one layer at a time (search → context menu → chain)

**Re-layout keeps your place**
Triggering an auto-layout (via the toolbar button or `Shift+R`) now re-centers the view on whichever issue you have focused, so you don't lose your spot in a large graph.

**Design doc live updates**
The design doc panel now watches the underlying spec file for changes and refreshes automatically via a server-sent event stream. No more manual reloads when you edit a spec outside the app. If an issue is linked to more than one spec, an amber warning is shown so the ambiguity is immediately visible.

**Inline search flow improvements**
Selecting an item from the inline search now smoothly transitions into the next action, reducing the number of clicks needed to find an issue and act on it.

### Improved

**Workspace identity in Settings**
The Settings panel now shows the name of the connected Linear workspace prominently, above the API key field. This makes it much easier to confirm at a glance which account you are working against — especially useful when switching between workspaces.

**Safer cache reset**
The "Reset cache and re-sync" action in Settings now shows a blocking overlay while the sync runs and automatically reloads the app when it finishes, preventing any interaction with stale data mid-sync.

**Honest loading states**
The top banner now accurately distinguishes between the initial "Loading…" state (no data yet) and "Syncing…" (data is present but a background refresh is in progress).

**Clearer dependency arrows**
Arrowheads in the dependency view are larger and more readable, so the direction of a dependency is unambiguous even on dense graphs.

### Fixed

- Pressing `Esc` now steps back in the correct order: dismiss search first, then context menu, then chain isolation — rather than jumping straight to the outermost level.
- Edge clicks no longer accidentally pin nodes on desktop; pin-on-tap is now restricted to touch devices where it is intentional.
- Related edges are now drawn without arrowheads, visually distinguishing them from directional blocking edges.
- The layout no longer jumps or reflows unexpectedly when chain isolation is cleared.
- The dev server no longer serves a stale build from `dist/` when the port is in use, ensuring the live Vite server is always what you see during development.

---

## [v1.1.0] - 2025-05-03

_See previous release notes._
