# demo-repo

Sample design-doc proposals used to populate `issue-graph`'s **design-doc view**
in screenshots and demos. Not real product specs.

Each subdirectory under `openspec/changes/` is a Spectra/OpenSpec-style proposal
with a `proposal.md` and a `tasks.md` (checkbox list). The adapter links each
proposal to one or more Linear issues via three strategies — this directory
demonstrates all three:

| Folder | Strategy | Notes |
|---|---|---|
| `openspec/changes/auth-rewrite/` | **Frontmatter** — `linear: [TEAM-15, TEAM-21]` in `proposal.md` | Recommended. Survives folder renames. |
| `openspec/changes/TEAM-16-tasks-crud-streaming/` | **Folder name** — directory contains `TEAM-16` | Visible at filesystem level. |
| `openspec/changes/webhook-system/` | **Regex line** — any line in `proposal.md` mentioning "linear" | Legacy / informal. |
| `openspec/changes/archive/csv-export-streaming/` | Frontmatter (archived) | Folders under `archive/` are treated as historical. |

To use this in your own checkout, set in `.env`:

```bash
REPO_PATH=/absolute/path/to/issue-graph/demo-repo
```

Restart the dev server, hit `POST /api/sync`, and the design-doc view will
populate.
