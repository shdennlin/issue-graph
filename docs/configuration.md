**English** | [繁體中文](configuration.zh-TW.md)

# Customizing labels and icons

`issue-graph` uses Linear labels to group issues into buckets (Mix view) and pick leading icons. Two levels of customization are available.

## Quick override (env vars)

Out of the box, `issue-graph` autodetects label groups whose names match `service|component|owner|module|team|area|domain` (used to group issues into buckets) and `type|kind|category` (used to pick a leading icon).

If your team uses different names — e.g. you call your buckets "squads" — set:

```bash
PRIMARY_GROUP=squad
TYPE_GROUP=Type
TYPE_ICONS={"Bug":"🐛","Feature":"✨","Spike":"🔬"}
```

Restart, and the Mix view buckets, filter sidebar, and node icons all pick up the override.

## Full control (`label-schema.yaml`)

For full control over how every label group and prefix renders, drop a YAML file at `LABEL_SCHEMA_PATH` (default `/app/data/label-schema.yaml`). See `label-schema.example.yaml` for a complete reference. The file is hot-reloaded — edit it, then click "Refresh" in the banner to pick up changes without restarting the container.
