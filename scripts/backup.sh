#!/bin/bash
# Daily SQLite backup. Local rotation only (PRD §12.1).
# Run via cron on host or container: 0 2 * * * /app/scripts/backup.sh
set -euo pipefail
DB_PATH="${SQLITE_PATH:-/app/data/graph.db}"
DATA_DIR="$(dirname "$DB_PATH")"
BACKUP_DIR="$DATA_DIR/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M)

# The control plane FIRST, and unconditionally. It holds the workspace roster,
# API keys and webhook secrets, and unlike everything else here it cannot be
# rebuilt from Linear — losing it means re-entering every workspace by hand.
# The per-workspace graph.db files below are a cache; they are backed up only
# for their snapshot history, which is the one part a re-sync will not restore.
#
# NOTE: this backup therefore contains credentials. Keep $BACKUP_DIR as
# private as the data directory itself, and be deliberate about where any
# off-site copy goes.
CONTROL_DB="$DATA_DIR/workspaces.db"
if [ -f "$CONTROL_DB" ]; then
  sqlite3 "$CONTROL_DB" ".backup $BACKUP_DIR/workspaces-$TS.db"
  echo "backup ok: $BACKUP_DIR/workspaces-$TS.db"
else
  echo "warning: no control plane at $CONTROL_DB — nothing configured yet?" >&2
fi

# Legacy single-workspace DB at the base path. Pre-control-plane installs kept
# real data here; current ones do not create it at all.
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" ".backup $BACKUP_DIR/graph-$TS.db"
  echo "backup ok: $BACKUP_DIR/graph-$TS.db"
fi

if [ -d "$DATA_DIR/workspaces" ]; then
  find "$DATA_DIR/workspaces" -mindepth 2 -maxdepth 2 -name graph.db | while read -r workspace_db; do
    workspace_id="$(basename "$(dirname "$workspace_db")")"
    sqlite3 "$workspace_db" ".backup $BACKUP_DIR/workspace-$workspace_id-$TS.db"
    echo "backup ok: $BACKUP_DIR/workspace-$workspace_id-$TS.db"
  done
fi

find "$BACKUP_DIR" -name "workspaces-*.db" -mtime +30 -delete
find "$BACKUP_DIR" -name "graph-*.db" -mtime +30 -delete
find "$BACKUP_DIR" -name "workspace-*.db" -mtime +30 -delete
