# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### What's New

**Filters moved out of the sidebar into a panel that floats over the graph**
The filter sidebar is gone. In its place is a compact panel in the top-left corner of the canvas, listing one row per filter you actually have applied — a dimension that is not in use takes no space at all. Click `+ Filter` to open a cascading menu: pick a dimension on the left, its values fly out beside it with checkboxes and live counts. Typing in the menu's search box looks through the *values* of every dimension at once, so searching `bug` finds `Type › Bug` without you needing to remember which dimension it lives under.

**Saved views**
Save the current view and filter combination under a name, and get back to it in one click. Views are stored on the server, so everyone reaching the same instance sees the same list — this is how you hand someone "the board I look at every morning". The panel names the view you are currently on, marks it with `*` once you edit away from it, and offers both Save changes and Discard changes at that point. The window title and the tab label carry the view name too, which matters when you keep several windows open.

**Recent activity filter**
Filter by what changed rather than by what something is: any time / today / last 7 days / last 30 days, measured against either the created or the updated timestamp. "What moved this week, and what is downstream of it" is a question the graph could not previously answer — the only time dimension was its opposite, "not touched in N days".

**Negatable conditions**
Any multi-select filter can be inverted. Click the `is` in a filter row to turn it into `is not`, and the row inverts — everything except the priorities you picked, everyone except the assignees you named. Value counts are hidden while a filter is inverted: they answer "pick this and N remain", which is the wrong question once picking a value excludes it.

**Pinned filter values**
Pin the values you reach for constantly and they sort to the top of their dimension's list. Pins are per browser and per workspace, since they describe your habits rather than the workspace's data.

### Improved

**State filters no longer behave as though they were mutually exclusive**
Picking a specific Linear state used to override every canonical state type at once, blanking the other checkboxes. Specific states now refine within their own type: choosing `Todo` narrows Unstarted to Todo and leaves Started and Backlog untouched, which is what a checkbox tree means everywhere else.

**The panel shows the filters that are on by default**
Two defaults are not neutral — completed and cancelled issues are hidden, and four of the six state types are shown. The panel previously displayed nothing at all in that state, implying no filters were applied. Those constraints now appear as rows you can see and clear like any other.

### Fixed

**Dropdowns close when you click the graph**
Clicking the canvas to dismiss an open menu did nothing. This affected every menu in the app — the toolbar overflow menu, the tab menu, and the note copy menu — not only the new filter panel.

**Shared links keep project, milestone, state-name and search filters**
Four filter dimensions were never written to the URL, so a link you copied silently dropped them and `Cmd+[` cleared them without warning. All four now round-trip, and a test pins every dimension so the class of bug cannot come back.

### Removed

**The `tag` filter, which never filtered anything**
`?tag=` was accepted, stored and carried through history, but no code ever applied it. The dimension it was meant to be shipped long ago as the "other labels" filter under `?label=`.

---

## [v1.4.0] - 2026-05-14

### What's New

**Quick Switcher — jump to any issue instantly**
Press `Cmd+K` (or click the new toolbar button) to open the quick switcher palette. Start typing and a fuzzy search surfaces matching issues across every open tab in real time. Each row shows the issue's title, ID, and current state chip so you can confirm the right item at a glance. Recent picks are remembered and float to the top the next time you open it. Selecting an item pans the canvas to that issue and keeps the detail panel open if it was already visible.

**Workspace notes**
A lightweight markdown notepad scoped to each workspace is now built in. Press `n` to open the notes modal, write in Markdown, and flip between Edit and Preview with `Cmd+E` (or `Cmd+/`). Notes are organised in a grid or list view, can be archived with a one-step undo, and persist alongside the rest of your workspace state. Anywhere you mention an issue ID inside a note, its current status renders inline next to the ID so you always know where things stand.

**Navigation history — back and forward on the canvas**
`Cmd+[` and `Cmd+]` (or `Ctrl+[` / `Ctrl+]` on Windows/Linux) step backward and forward through your view, filter, focus, and chain changes, viewport position included. It works exactly like browser history but scoped to your graph session.

**Linear comments in the detail panel**
The detail panel now surfaces the comment thread from Linear directly inside the app. You no longer need to switch context to Linear to read or reference discussion on an issue.

**Internationalisation — English and Traditional Chinese**
The full UI is now available in Traditional Chinese. Switch languages from Settings → Language; the preference is saved across sessions. English remains the default. The keyboard shortcut cheat sheet, filter panel, detail panel, notes modal, toolbar, onboarding flow, and sync banner are all translated. User-facing documentation (`README`, `docs/`, `ROADMAP`) also ships Traditional Chinese companions.

### Improved

**Detail panel is wider and more flexible**
Wide mode can now stretch up to 75% of the window width (previously capped lower) with a maximum of 1200 px. Resize by dragging the left edge; the panel remembers your chosen width. The text size inside the panel cycles through four grades independently of the global font setting — press the text-size button in the panel header. While the wide panel is open, the canvas inline search automatically hides to avoid overlap. A shimmering skeleton placeholder replaces the plain "Loading…" text while issue data is fetching.

**Click any metadata value in the detail panel to filter the canvas**
Tapping a state, priority, assignee, project, or primary label chip in the detail panel immediately applies that value as a canvas filter. It is the fastest way to jump from a single issue to all related work.

**Keyboard shortcut `d` toggles detail panel auto-open**
Press `d` to flip the auto-open preference for the detail panel. When enabled, focusing an issue opens the panel automatically; when disabled, the panel only opens when you explicitly click through.

**OS-aware keyboard labels**
Shortcut labels now reflect the keyboard you are actually using. `Cmd/⌘` shows as `Ctrl` on Windows and Linux; `Delete` shows as `Backspace`. The correct glyphs appear throughout the app — toolbar tooltips, the shortcuts cheat sheet, and inline hints — without any configuration needed.

**Chain isolation works across all views**
Entering and exiting chain isolation now works consistently in every view (dependency, mix, project), and the viewport position is preserved when you leave isolation mode.

**Filter sidebar overhaul**
Filter sections are now collapsible — click a section header to fold it away and keep the sidebar tidy. Active filter count badges on collapsed headers tell you at a glance what is filtering without expanding. Each section has its own clear button so you can reset one dimension without touching others. Sections are separated by dividers with semantic icons for faster scanning.

**Markdown tables look like tables**
Tables in design docs and notes now render with visible borders and alternating row shading, making structured data readable at a glance.

**Settings label-group surface**
The active bucket or type label group is now visible directly in Settings and in the Mix tooltip, so it is always clear which label schema is driving the current layout.

**UI polish throughout**
Icons across the toolbar, context menu, inline find, and issue node glyphs have been unified to the Lucide icon set. The toolbar collapses lower-frequency actions into an overflow menu to keep the primary bar uncluttered. Mix view containers are tinted with a per-bucket accent colour for quicker visual grouping. Modal headers follow a shared layout. The Settings panel has visually delimited sections and a sticky footer for action buttons. The keyboard shortcuts modal is wider and uses a responsive two-column layout.

### Fixed

- Switching workspaces now correctly clears the focused note, preventing a note from a previous workspace appearing briefly in the new one.
- Opening the quick switcher and selecting an issue pans the canvas to that issue even when starting from a different position, and leaves the detail panel state intact.
- The canvas inline search no longer overlaps the wide-mode detail panel when both would otherwise be visible simultaneously.
- Camera centering (including `F5` / focus-on-issue) now uses the final built node positions rather than pre-layout estimates, eliminating off-center jumps when switching views.

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
