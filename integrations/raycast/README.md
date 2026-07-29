# Issue Graph — Raycast extension

Fuzzy-search the issues cached by your self-hosted [Issue Graph](http://localhost:31415)
and jump straight to one — either focused inside the graph or in Linear.

## Commands

- **Search Issues** — lists every cached issue **across all workspaces** by
  default. Type to filter by identifier, title, assignee, or workspace name. Use
  the dropdown (shown when more than one workspace is configured) to narrow to a
  single workspace. Each result is tagged with its origin workspace.

### List & detail

- **Grouped by state** — sections ordered for action priority: Triage → In
  Progress → Todo → Backlog → Completed → Canceled, each with a count. The order
  is pinned while you type too, so completed and canceled work never outranks
  what's still open, however well its title matches.
- **Frecency** — issues you open most often (and most recently) float to the top
  within their section.
- **Due dates** — shown as an accessory; overdue open issues flag red.
- **Freshness** — the title bar shows when the data was last synced (e.g. *Search
  Issues · Synced 3m ago*). Across workspaces it reports the **oldest** sync, so
  the figure never hides a stale workspace; pin one workspace to see just its time.
- **Inline detail** (`⌘D`) — a metadata panel (status, priority, assignee, due,
  estimate, project, milestone, cycle, team, labels, relations, sub-issues,
  comments, timestamps) rendered from the already-loaded cache — no extra calls.

### Actions

| Action | Shortcut | What it does |
| --- | --- | --- |
| Open in Issue Graph (PWA) | `↵` | Opens `web+issuegraph://<workspace>/<id>` — the OS routes it **straight into the installed PWA** (like Linear's `linear://`) and the app focuses the issue + opens its detail panel |
| Open in Browser | `⌥↵` | Opens `…/?focus=<id>&detail=1&active=0&state=<all>` in a browser — centered + highlighted + detail panel, **regardless of status** |
| Open in Chain Mode (PWA) | `⌘⇧↵` | Opens `web+issuegraph://…?mode=chain` — isolates the issue's combined upstream/downstream dependency chain in the PWA |
| Open Chain in Browser | `⌥⌘↵` | Same chain view, but `…/?chain=<id>&…` in a browser (fallback when no PWA) |
| Open in Linear | `⌘↵` | Opens the issue's Linear URL |
| Show / Hide Details | `⌘D` | Toggles the inline detail panel |
| Copy Identifier | `⌘.` | Copies e.g. `ENG-123` |
| Copy Issue Graph Link | `⌘⇧C` | Copies the http deep link |
| Copy Markdown Link | `⌘⇧M` | Copies `[ENG-123](…)` for notes / PRs |
| Sync Issue Graph | `⌘R` | Forces a fresh pull from the backend (`POST /api/sync`), then reloads the list. Scope follows the workspace dropdown — **All** syncs every workspace, a pinned one syncs just that |

All deep links pin the issue's origin workspace (`?w=` or the protocol host) —
required, or the graph resolves the id against the wrong workspace's cache and
shows nothing.

### Direct-to-PWA (`web+issuegraph://`)

The primary action uses a custom URL scheme that issue-graph's PWA registers via
its manifest `protocol_handlers`. This is the PWA equivalent of Linear's
`linear://` — macOS routes it directly to the installed app, no browser detour.

**Requires the PWA reinstalled** with the scheme registered (the manifest must
include `protocol_handlers`). If it isn't installed/registered, the OS can't
route the scheme — use **Open in Browser** (`⌥↵`) instead.

## Cross-workspace search

issue-graph is multi-tenant: one SQLite cache per workspace, selected via
`?w=<id>`. There is no single "all issues" endpoint, so the extension fans out —
one `GET /api/graph?w=<id>` per workspace in parallel — and merges the results,
tagging each issue with its workspace. With a handful of workspaces this is a few
fast cached reads.

## Why the extra `active=0&state=…` params?

Issue Graph hides non-active issues behind **two independent filters**: the
"Active only" quick toggle and the explicit state filter. A bare `?focus=<id>`
only works for in-progress/backlog issues; completed and canceled issues need
both filters defeated or the camera lands on nothing. The extension always
emits the full recipe so any issue is reachable.

## Configuration

- **Issue Graph URL** — defaults to `http://localhost:31415`. Point it at your
  Docker / Tailscale host if different.
- **Open Links With** — an app picker. Leave empty for your system default
  browser, or pick a **browser** (e.g. Google Chrome).

  > ⚠️ **Do not pick the installed PWA app.** Launching a Chrome PWA *app* via
  > macOS (`open -a "Issue Graph"`) only activates the window — it does **not**
  > pass the deep-link URL, so the issue never focuses. Always open via a
  > browser.

### Landing in the PWA window (optional)

Opening via Chrome puts the issue in a normal Chrome **tab**. To make it land in
your installed **PWA window** instead:

1. Set **Open Links With** → **Google Chrome**.
2. In the PWA, enable **"Open supported links in Issue Graph"** (PWA menu ⋮ →
   or `chrome://apps` → right-click the app).

Chrome then re-routes the in-scope URL into the PWA window, and the manifest's
`launch_handler: navigate-existing` reuses the existing window instead of
spawning a new one.

The extension reads from Issue Graph's local cache (`/api/graph`), so results
reflect the last sync, not live Linear.

## Development

```bash
bun install
bun run dev        # = ray develop — launches the command in Raycast (requires the Raycast app)
bun run typecheck  # tsc --noEmit
bun run icon       # regenerate assets/command-icon.png
```

> Uses **Bun** for install + scripts, consistent with the rest of `issue-graph`.
> Raycast's `ray` CLI runs on Node internally via its shebang — that needs no
> Node setup from you.
