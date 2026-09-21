**English** | [繁體中文](README.zh-TW.md)

# issue-graph

Self-hosted, read-only graph viewer for issue dependencies. Fetches from Linear, renders an interactive graph of issues, buckets, and `blocks` relationships. Optionally enriches with local design-doc progress.

![Issue Graph — dependency view with detail panel showing the selected issue's design-doc progress, blocks/blocked-by, and annotations](docs/screenshots/dependency.png)

## What it shows

- **Dependency view** — `blocks` edges between issues. Default landing view. Answers "what should I work on next?"
- **Mix view** — issues grouped into buckets by a configurable Linear label group (`service`, `module`, `team`, `area` — auto-detected); cross-bucket `blocks` edges highlighted in red.
- **Project view** — issues grouped by their Linear project. Each project becomes a container; cross-project `blocks` edges highlighted.
- **Design-doc view** — issues with linked design-doc changes only.
- **Workstreams view** — a feature in flight, drawn as the pipeline it is moving through. Each workstream is a block of stage cards; every card shows what belongs on that step. See [Workstreams](#workstreams) below.
- **Sub-issue hierarchy** — Linear's parent/sub-issue links, shown as violet edges in the dependency view (toggle with `h`, off by default) and as a `3/7 done` progress badge on every parent card. The detail panel lists the parent and each sub-issue.

## Filtering

Filters live in a small panel floating over the top-left of the graph. It lists
one row per filter you actually have applied, so a dimension you are not using
costs no space.

- **`+ Filter`** opens a cascading menu — dimensions on the left, that
  dimension's values flying out beside it with checkboxes and live counts.
  The search box searches **values across every dimension at once**, so typing
  `bug` finds `Type › Bug` without you needing to recall where it lives.
- **`is` / `is not`** — click the operator in any multi-select row to invert it.
  Value counts hide while a filter is inverted: they mean "pick this and N
  remain", which stops being the right question once picking excludes.
- **Recent activity** filters by *when* rather than *what* — today / 7 days /
  30 days, or any span you type, against either the created or updated
  timestamp. Linear marks an issue as updated when someone merely points a
  link at it, which on a real workspace was two-thirds of every window, so
  those are left out by default; untick *Ignore issues only linked to* and
  they come back labelled "Linked" on the card.
- **Pin** a value (the pin icon on any option) and it sorts to the top of its
  dimension's list. Pins are per browser and per workspace.

Three filters are on by default and appear as rows you can clear like any
other: completed and cancelled issues are hidden, four of the six state types
are shown, and link-only bumps are ignored while a recency window is set.

### Saved views

Name the current view + filter combination and return to it in one click.
Saved views live **on the server**, so everyone reaching the same instance sees
the same list — this is how you hand a teammate "the board I look at every
morning".

The panel names the view you are on and marks it `*` once you edit away from
it, offering **Save changes** and **Discard changes** at that point. The window
title and tab label carry the name too, which matters with several windows
open.

> Saved views are stored in the workspace's `graph.db` and survive a cache
> reset. There is no authentication (see the warning below), so anyone who can
> reach the server can edit or delete any view.

## Five-minute setup

```bash
git clone https://github.com/shdennlin/issue-graph
cd issue-graph
mkdir -p data
docker compose up -d --build
open http://localhost:31415
```

The app opens on a setup form. Give your workspace a name, paste a Linear
personal API key (Linear → Settings → API → Create Personal API Key), and save.
The key is checked against Linear before it is stored, so a typo comes back
immediately instead of showing up later as an empty graph. The backend then
pulls active+recent issues, scans the optional repo at `REPO_PATH` for design
docs, and renders the dependency graph.

No `.env` is required — `docker compose` runs without one. Your API key is
stored server-side in `data/workspaces.db` and is never sent back to the
browser; the API only ever reports whether one is set.

> [!WARNING]
> **This app ships with no authentication.** Anyone who can reach the port can read every
> workspace's issue data and call the write endpoints (`POST /api/sync`, `POST/DELETE
> /api/annotations`, `PATCH /api/settings`, and the workspace routes, which accept API keys).
>
> Docker compose therefore publishes on `127.0.0.1` only. For remote access put a layer
> with auth in front rather than widening the bind — on a Tailscale host,
> `tailscale serve --bg 31415` reaches the loopback bind and terminates HTTPS, which the
> PWA needs anyway (service workers require a secure context, so a plain
> `http://<tailnet-ip>:31415` silently loses offline support). Cloudflare Access or an
> auth-ing nginx work equally well.
>
> The one exception is `POST /api/webhooks/linear`, which is designed to be published and
> is HMAC-authenticated. Expose that path alone — e.g. `tailscale funnel --bg
> --set-path=/linear-hook http://localhost:31415/api/webhooks/linear` — never the whole port.

> [!IMPORTANT]
> **Write-back is off by default, and each person authorises it with their own Linear
> account.** Changing an issue's status, assignee, priority or labels, or posting a comment,
> needs `LINEAR_OAUTH_CLIENT_ID` in the server environment; leave it unset and the write routes
> answer 401, so upgrading does not grow a mutation surface.
>
> Setup is more work than a random string in `.env`: register an OAuth application at
> **linear.app → Settings → API → Applications**, and add a redirect URI for **every origin you
> browse the app from** — `http://localhost:31415/` for a built or Docker run,
> `http://localhost:31414/` for `bun run dev`, plus your tailnet or proxy host. Linear matches
> the redirect URI exactly, and a mismatch is the most likely first-run failure. Then put the
> client id in the environment and restart. There is no client secret to configure: the browser
> completes the exchange with PKCE, which is what keeps the server out of it.
>
> Each person then clicks **Settings → Write access → Connect Linear** once. The access token
> lives in that browser and nowhere else — this server never stores it, and only borrows it for
> the one call a write makes. **Changes are recorded in Linear as that person's**, which is the
> difference from a shared secret: the tracker's history says who did what. Access lasts about a
> day (the refresh token is deliberately not kept, so a stolen browser profile is worth a day,
> not forever) and Disconnect clears it. Reads are untouched by any of this — they still use the
> workspace's API key, because syncing is a background pull into a shared cache and not an act
> by a person.

### Configuration

There is nothing you must put in `.env`. Workspaces are managed in the app;
`.env` carries only the handful of settings the server needs *before* it can
open a database — where the data lives, which port to bind, log level — and all
of them have defaults. See [`.env.example`](.env.example).

One value is deliberately not configurable anywhere: the Linear API endpoint.
Anyone who could change it could point the app at their own host and receive
your API key in the next sync's `Authorization` header, so it is fixed in the
source.

### Realtime updates (optional)

By default the cache refreshes on a TTL, so an issue edited in Linear shows up
on the next sync. A webhook makes it appear within a couple of seconds.

1. **Set a shared secret.** Settings → Webhook, pick any long random string,
   save. This has to come after you have added a workspace — the secret is
   stored on the workspace row, not globally.
2. **Publish just the webhook path.** It is the only route designed to be
   reachable from outside; everything else must stay behind your loopback bind.
   On a Tailscale host:

   ```bash
   tailscale funnel --bg --set-path=/linear-hook \
     http://localhost:31415/api/webhooks/linear
   ```

3. **Register it in Linear.** Settings → API → Webhooks → new webhook, URL
   `https://<your-host>.ts.net/linear-hook?w=<workspace-id>`, and paste the same
   secret. The `?w=` is what routes a delivery to the right workspace, so one
   funnel mount serves all of them.

Deliveries are HMAC-verified, rejected if the timestamp is stale, rate-limited,
and a burst is collapsed into a single sync. Settings → Webhook shows accepted
and rejected counts — worth a look if updates stop arriving, since a webhook
that silently stops just looks like a stale graph.

Note that the secret lives on the workspace row, so removing and re-adding a
workspace means setting it again.

### Multiple Linear workspaces

Add as many as you like from **Settings → Workspaces**. Each one needs a short
id (a slug like `client-a`) alongside its name; that id appears in the URL as
`?w=client-a` and names the folder its cached data lives in, so re-adding an id
you used before reconnects that workspace's existing cache instead of
re-syncing from scratch.

The top-left becomes a **tab bar** once you have a workspace. Each tab
holds its own workspace + filters + view + viewport, so you can keep two
workspaces (or two views of the same workspace) open side-by-side and
flip between them without losing context. Drag tabs left/right to reorder,
`Cmd/Ctrl + 1..9` to jump to the Nth tab. Switching tabs (or workspaces)
does not require a backend restart, and neither does changing an API key.

Each workspace gets isolated local data:

```text
data/workspaces.db              <- the roster: names, API keys, webhook secrets
data/workspaces/personal/graph.db   <- cached issues; safe to delete and re-sync
data/workspaces/client-a/graph.db
```

Only the first of those is worth backing up: it is small, holds your
credentials, and cannot be rebuilt. The `graph.db` files are a cache.

Removing a workspace deletes its roster entry and leaves its data directory
alone, so nothing is destroyed behind a delete button.

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

## Running on a server

The setup above is the whole install — a server is the same three commands.
What differs is access, timezone, and what you must *not* bring with you.

```bash
git clone https://github.com/shdennlin/issue-graph
cd issue-graph && mkdir -p data
docker compose up -d --build
```

**Do not copy your laptop's `.env` across.** A fresh server does not need one,
and a stale `REPO_PATH` in it makes Compose create that directory empty on the
host — the design-doc scanner then happily scans nothing. Leave `.env` out
entirely unless you have a reason.

**Set the timezone.** `docker-compose.yml` pins `TZ: Asia/Taipei`; change it to
yours. Containers default to UTC, and the daily snapshot fires on local time, so
the wrong `TZ` just means snapshots at a surprising hour.

**Decide how you will reach it.** The app has no authentication, so Compose
publishes on `127.0.0.1` only and something with auth has to sit in front. On a
Tailscale host that is one command:

```bash
tailscale serve --bg 31415
```

That reaches the loopback bind and terminates HTTPS, which you want regardless:
the PWA installs a service worker, and service workers need a secure context, so
a plain `http://<tailnet-ip>:31415` silently loses offline support. Cloudflare
Access or an authenticating nginx work equally well. Do not widen the bind to
`0.0.0.0` and call it done — that publishes every workspace's issue data, and
the routes that accept API keys, to anything that can route to the host.

**Design docs will be off**, since the repo is not checked out there. That is
the intended state for a server; see [Workspaces](docs/advanced-workspaces.md)
if you need them.

Then open the URL and add your workspaces through the setup form, exactly as
you would locally. Nothing is configured over SSH.

### Updating

```bash
git pull && docker compose up -d --build
```

`data/` is a bind mount, so it survives. Schema migrations run at startup.
Your roster, keys and cached issues are all still there afterwards.

### Moving an instance

Copy `data/workspaces.db` — that is the roster and the credentials. The
`data/workspaces/<id>/` directories are caches; bring them if you want the
snapshot history, or leave them and let the first sync refill from Linear.

## Customization

`issue-graph` autodetects common Linear label group names (`service|component|owner|module|team|area|domain` for buckets, `type|kind|category` for icons). For different naming conventions or full control via `label-schema.yaml`, see **[Customizing labels and icons](docs/configuration.md)**.

## Backup posture

Almost nothing here is worth backing up. `issue-graph` is a view over Linear:
delete a cache and the next sync rebuilds it.

The one exception is **`data/workspaces.db`** — a few KB holding the workspace
roster, API keys and webhook secrets. It cannot be rebuilt, though recreating it
means little more than re-entering each workspace by hand. Everything under
`data/workspaces/<id>/` is a cache; only its snapshot history and any
annotations are unrecoverable, and neither is treated as durable data.

There is no backup script. If you want one, `rsync` the `data/` directory —
and note that doing so copies your API keys, so treat the destination
accordingly.

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
http://localhost:31415/?w=team_a&view=project&proj=p1&priority=1,2&recent=7d&neg=priority&q=auth&focus=PROJ-123
```

Share a link in chat — your teammate sees the same view. Valid `view=`
values are `dependency`, `mix`, `project`, `milestone`, `designdoc`. The `w=`
parameter selects a workspace profile by id, `neg=` lists the dimensions whose
selection is inverted, and `q=` carries the search box.

## Keyboard

Press `?` in the app for the full cheat sheet. Highlights:

- `Cmd/Ctrl + F` — find on canvas; `Enter` jumps to next match and returns keyboard focus to the canvas
- `Cmd/Ctrl + Shift + F` — focus the toolbar filter search
- `Cmd/Ctrl + 1..9` — switch to the Nth tab in the tab bar (each tab keeps its own filters / view / viewport)
- `c` / `Shift + C` — isolate chain on focused issue (preserve / auto-layout)
- `r` — toggle Related-edges overlay
- `h` — toggle sub-issue hierarchy overlay (violet edges; also pulls 1-hop parent/children into chain isolation)
- `Shift + R` — re-layout (re-run dagre, recenters on focused issue)
- `Esc` — peel one layer: Find → context menu → focused issue → chain isolation
- `Cmd/Ctrl + click` on a node — multi-select
- `Cmd/Ctrl + Shift + S` — screenshot the current canvas as PNG
- Right-click on a node — context menu
- Double-click a node — open in Linear

> [!NOTE]
> **Desktop-first.** Hover-highlight and the keyboard shortcuts above assume a real keyboard + pointer. On touch devices the basics still work (click to focus / pin, pinch to zoom, drag to pan, the toolbar / detail panel) but the fast hover-to-scan flow doesn't translate.

## Workstreams

A **workstream** is one feature in flight: the issues that make it, plus where it has got to.

Linear already tracks where each *issue* is. It cannot track where a *feature* is, for three reasons that are properties of the tool rather than gaps to be filled in: a pipeline is finer than a state (`In Progress` alone covers implementing, reviewing, opening a PR and waiting on CI), finishing one feature routinely spans several pull requests in several repositories, and nothing anywhere records that an agent session is alive right now.

So the pipeline belongs to the workstream, and it is the one thing here that is **stored**. Where an *issue* appears is derived from its Linear state — move it in Linear and it moves here. When the two disagree, the board says so and changes neither.

**This app never writes a Linear state.** Configuring a pipeline moves nothing; state transitions stay with Linear's own MCP or its GitHub automation.

### Stages

Edit the pipeline from the toolbar in the Workstreams view. Each stage names the Linear states whose issues belong to it, and carries one list of **fields** — everything that belongs on that step:

| Field | Names | Who fills it |
|---|---|---|
| ⚡ **automatic** | `issue` `session` `pr` `spec` `note` `blocker` `ci` | The app, by reading somewhere else. It stays current and you add nothing. |
| **attached** | any name you invent — `runbook`, `design`, `load-test` | A person or an agent. Nothing can fetch these, so they carry a `BY HAND` mark. |

The names are yours. A field called `runbook` tells a reader, and an agent, something a bare link cannot — which is why the list is free rather than fixed, and why an unlisted name is still accepted.

Give a name a one-line meaning at the bottom of the pipeline editor. That definition is written once for the workspace and handed to agents, so they learn not just what to call a field but what belongs in it.

## Claude Code plugin

[`integrations/claude-code/`](integrations/claude-code/) is a plugin with two halves — session hooks, and an MCP server.

**Hooks** report which session is alive, on which branch, and whether it is working, waiting on you, or blocked on a permission prompt. The branch is resolved to an issue server-side, so the rules can be fixed by restarting rather than by updating every install. A crashed session disappears on its own: liveness is a TTL, not the `SessionEnd` hook, which a crash never sends.

`SessionStart` also reads back: it tells the session which workstream the branch belongs to, what that workstream is for, which stage it is on, and what that stage expects attached. It states facts and gives no orders — whether a stage has been cleared is a judgement only the session that did the work can make. Compaction is covered, because `SessionStart` fires again with `source: "compact"`.

**A skill and two commands** close the loop. MCP tools are passive — a session has to decide that now is the moment to reach for one. `workstream-progress` is the skill the model reaches for when work reaches a point worth recording; `/issue-graph:where` reports position without changing anything; `/issue-graph:progress` records it. All three attach evidence freely and move a stage only when every field that stage expects is satisfied.

**The MCP server** gives an agent 18 tools over this app's own data — read the pipeline and the workstreams, build or edit a pipeline, define what a field name means, create and move workstreams, attach fields, and claim issues out of a workstream one at a time in dependency order. It never writes a Linear state.

Install, from inside Claude Code:

```
/plugin marketplace add shdennlin/issue-graph@develop
/plugin install issue-graph@issue-graph
```

The marketplace manifest lives at the repo root, so the GitHub form needs no clone of your own. `@develop` pins the branch: this work has not reached `main`, and without the suffix the add resolves to the default branch and finds no manifest there. `/plugin marketplace update issue-graph` then follows that branch's head rather than the default one. Working on the plugin itself? Point it at your checkout instead — `/plugin marketplace add /path/to/issue-graph` — and re-run `/reload-plugins` after each edit.

Then point it at your server. Both halves read the same three environment variables, so set them where Claude Code will see them — `.claude/settings.local.json` in the repo you work in is the narrowest place:

```json
{
  "env": {
    "ISSUE_GRAPH_URL": "http://localhost:31415",
    "ISSUE_GRAPH_WORKSPACE": "your-workspace-id",
    "ISSUE_GRAPH_TOKEN": "same value as AGENT_SESSION_TOKEN"
  }
}
```

`ISSUE_GRAPH_TOKEN` must equal the server's `AGENT_SESSION_TOKEN` (in `.env`). **An unset `AGENT_SESSION_TOKEN` closes the session endpoint rather than opening it** — a server deployed without the variable must not quietly accept writes from anywhere. With either side missing, the hooks do nothing at all, silently and deliberately: this ships enabled to everyone who installs the plugin, and a hook that complained on every prompt in every repo without an issue-graph would be worse than useless.

The MCP server needs only `ISSUE_GRAPH_URL` (and `ISSUE_GRAPH_WORKSPACE` if you run more than one workspace). MCP over stdio has no authorization framework by design — [the spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) says stdio transports should take credentials from the environment, which is what this does.

Run `/reload-plugins` after changing any of it.

**On Docker**, `AGENT_SESSION_TOKEN` rides in from `.env` through `env_file` — nothing to pin in `docker-compose.yml`. The container publishes on `127.0.0.1` only, so `http://localhost:31415` works from the Docker host and nowhere else: Claude Code running on a different machine needs the same path-scoped tunnel the Linear webhook uses, not the whole app.

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
bun run test:smoke  # control-plane checks; needs Bun (vitest cannot load bun:sqlite)
bun run build      # production build → dist/ + build/
```

## Troubleshooting

For common issues — stale cache after switching `LINEAR_API_KEY`, blank-slate reset, etc. — see **[Troubleshooting](docs/troubleshooting.md)**.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for what's planned, what's likely, and what's explicitly out of scope. The original engineering PRD lives at [`docs/PRD.md`](docs/PRD.md) for historical context.

## License

[MIT](LICENSE)
