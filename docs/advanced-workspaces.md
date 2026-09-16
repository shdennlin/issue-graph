[English](advanced-workspaces.md) · [繁體中文](advanced-workspaces.zh-TW.md)

# Workspaces

Workspaces are managed in the app — **Settings → Workspaces**, or the setup form
you see on a fresh install. There is no `WORKSPACE_*` env configuration; the
roster lives in `data/workspaces.db`.

## Ids

Every workspace has a short id alongside its display name. The app suggests one
from the name (`Client A` → `client-a`), and you can edit it.

The id is not cosmetic:

- it appears in the URL as `?w=client-a`, so links are shareable per workspace
- it names the folder holding that workspace's cached issues,
  `data/workspaces/client-a/graph.db`

Because the id derives the data path, **re-adding an id you used before
reconnects that workspace's existing cache** instead of re-syncing from scratch.
That is also why the field is visible and editable rather than a hidden
generated value.

Ids must be lowercase letters, digits and dashes, starting with a letter or
digit. The id becomes a directory name, so the server enforces this rather than
trusting the form.

## What is stored where

```text
data/workspaces.db                   the roster: names, API keys, webhook secrets,
                                     and which workspace is the default
data/workspaces/<id>/graph.db        that workspace's cached issues, labels,
                                     annotations, notes and snapshots
```

`workspaces.db` is small, holds your credentials, and cannot be rebuilt — it is
the file worth backing up. The `graph.db` files are a cache; deleting one and
re-syncing is a normal way to recover from bad cached data, and it costs you
nothing but the sync.

Credentials are deliberately **not** kept in `graph.db` for exactly that reason.

## Removing a workspace

Deleting a workspace removes its roster entry and leaves
`data/workspaces/<id>/` on disk. Nothing is destroyed behind a delete button; if
you want the data gone, remove the directory yourself.

Its API key and webhook secret go with the roster entry, so re-adding the id
means entering credentials again — the cached issues come back, the secrets do
not.

## Changing credentials

Editing a workspace's API key takes effect on the next sync. No restart.

## Design docs and `REPO_PATH`

> [!NOTE]
> **Per-workspace repo paths are no longer supported.** `REPO_PATH` is a single
> server-wide env var, and the design-doc watcher follows whichever workspace is
> the current default.
>
> This is a deliberate trade. A path stored per workspace would have to be
> editable from the setup form, and a form field that aims a filesystem scanner
> at any absolute path is a file-read primitive in an app that has no
> authentication. If you need design docs for several repos, run one instance
> per repo.

Set it in `.env`:

```env
REPO_PATH=/Users/you/workspace/proj-a
```

Under Docker the path must also be mounted into the container, at the same
absolute path so one `.env` works for both `bun run dev` and Compose:

```yaml
services:
  app:
    volumes:
      - ./data:/app/data
      - /Users/you/workspace/proj-a:/Users/you/workspace/proj-a:ro
```

Leaving `REPO_PATH` unset disables design-doc scanning entirely, which is the
right choice on a remote server where the repo is not checked out.

### When edits do not show up

1. Check the spec directory exists under `REPO_PATH` — `openspec/` for OpenSpec
   projects, or whatever `spec_dir` resolves to for Spectra projects (default
   `docs/specs/`; see `.spectra.yaml`).
2. Under Docker, check the repo is mounted into the container.
3. Restart the backend after changing `REPO_PATH`. Switching workspaces in the
   UI does not need a restart; changing `.env` does.
