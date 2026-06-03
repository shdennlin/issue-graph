# Issue Graph — Raycast extension

Fuzzy-search the issues cached by your self-hosted [Issue Graph](http://localhost:31415)
and jump straight to one — either focused inside the graph or in Linear.

## Commands

- **Search Issues** — lists every cached issue **across all workspaces** by
  default. Type to filter by identifier, title, assignee, or workspace name. Use
  the dropdown (shown when more than one workspace is configured) to narrow to a
  single workspace. Each result is tagged with its origin workspace.

### Actions

| Action | Shortcut | What it does |
| --- | --- | --- |
| Open in Issue Graph | `↵` | Opens `…/?focus=<id>&active=0&state=<all>` so the issue is centered + highlighted **regardless of its status** |
| Open in Chain Mode | `⌘⇧↵` | Opens `…/?chain=<id>&…` — isolates the issue's combined upstream/downstream dependency chain |
| Open in Linear | `⌘↵` | Opens the issue's Linear URL |
| Copy Identifier | `⌘.` | Copies e.g. `ENG-123` |
| Copy Issue Graph Link | `⌘⇧C` | Copies the deep link |

All deep links pin `?w=<workspace>` to the issue's origin workspace — required,
or the graph resolves the id against the wrong workspace's cache and shows
nothing.

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
