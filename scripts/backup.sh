#!/bin/bash
# Daily SQLite backup. Local rotation only (PRD §12.1).
# Run via cron on host or container: 0 2 * * * /app/scripts/backup.sh
set -euo pipefail
DB_PATH="${SQLITE_PATH:-/app/data/graph.db}"
DATA_DIR="$(dirname "$DB_PATH")"
BACKUP_DIR="$DATA_DIR/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M)

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

find "$BACKUP_DIR" -name "graph-*.db" -mtime +30 -delete
find "$BACKUP_DIR" -name "workspace-*.db" -mtime +30 -delete
