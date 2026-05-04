# Advanced workspace profiles

The default setup still uses one `LINEAR_API_KEY`. Workspace profiles are for
people who regularly switch between multiple Linear workspaces and want each one
to keep separate cached data.

## Profile ids and names

Profile ids come from the middle part of the env var name:

```env
WORKSPACE_CLIENT_A_NAME=Client A
WORKSPACE_CLIENT_A_LINEAR_API_KEY=lin_api_xxx
```

This defines profile id `client_a`. The `NAME` value is only the display label
shown in the UI.

By default, profile data is stored under:

```text
data/workspaces/<profile-id>/graph.db
```

For example:

```text
data/workspaces/client_a/graph.db
```

Override the path only when you have a specific reason:

```env
WORKSPACE_CLIENT_A_SQLITE_PATH=/app/data/client-a.db
```

## Active workspace

`WORKSPACE_ACTIVE` selects the initial active profile:

```env
WORKSPACE_ACTIVE=client_a
```

When you switch from the UI, issue-graph remembers that choice locally so the
next page load opens the same workspace. This runtime state lives under
`data/` and is managed by the app.

If the app opens a different workspace than you expected, use the selector in
the top-left label to switch back.

## Docker and multiple repo paths

SQLite data works with the default Compose volume:

```yaml
volumes:
  - ./data:/app/data
```

Design-doc scanning is different: Docker can only read host paths mounted into
the container. If profiles use different `WORKSPACE_<ID>_REPO_PATH` values,
mount each repo path.

Copy the example override:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
```

Then edit the paths:

```yaml
services:
  app:
    volumes:
      - ./data:/app/data
      - /Users/you/workspace/proj-a:/Users/you/workspace/proj-a:ro
      - /Users/you/workspace/proj-b:/Users/you/workspace/proj-b:ro
```

Use the same absolute path on both sides when you want one `.env` to work for
both local dev and Docker:

```env
WORKSPACE_PROJ_A_REPO_PATH=/Users/you/workspace/proj-a
WORKSPACE_PROJ_B_REPO_PATH=/Users/you/workspace/proj-b
```

If you only run Docker, you can mount repos under a container-only prefix such
as `/repos/proj-a`, but then local `bun run dev` will not see those paths unless
they also exist on the host.

## Troubleshooting realtime design-doc updates

Realtime design-doc updates watch only the active profile's `REPO_PATH`.

If editing `tasks.md` or `proposal.md` does not update the graph:

1. Check the top-left workspace selector points at the profile whose repo you
   are editing.
2. Check that `WORKSPACE_<ID>_REPO_PATH/openspec` exists.
3. Under Docker, check that the repo path is mounted into the container.
4. Restart the backend after editing `.env`; UI workspace switching itself does
   not require a restart.
