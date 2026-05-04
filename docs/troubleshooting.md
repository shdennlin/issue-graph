# Troubleshooting

## I changed my `LINEAR_API_KEY` and the graph still shows the old workspace's issues

Issue-graph caches issues by identifier in `data/graph.db`. If you switch `LINEAR_API_KEY` to a different workspace, the old issues stay in the cache (their identifiers don't collide with the new ones), polluting the graph.
The next sync will log a warning when it notices this:

```
WARN: Cache holds far more issues than this sync returned. If you switched
LINEAR_API_KEY to a different workspace, POST /api/reset-cache to clear
stale data.
```

Fix it with a single request — clears `issue_cache`, `label_cache`, and the workspace-tied meta entries (design-doc payload, workflow states).  Snapshots, annotations, and sync history are preserved:

```bash
curl -X POST http://localhost:31415/api/reset-cache
curl -X POST http://localhost:31415/api/sync
```

Or, if you'd rather start over from a blank slate (loses snapshots + annotations too), stop the server and `rm data/graph.db data/graph.db-shm data/graph.db-wal`.

For frequent switching, use the `WORKSPACE_<ID>_*` profile variables instead.
Profiles use separate databases, so switching from the toolbar does not require
resetting cached data. See [Advanced workspace profiles](advanced-workspaces.md).
