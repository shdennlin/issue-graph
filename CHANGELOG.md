# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
