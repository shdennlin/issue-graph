#!/bin/bash
# Daily SQLite backup. Local rotation only (PRD §12.1).
# Run via cron on host or container: 0 2 * * * /app/scripts/backup.sh
set -euo pipefail
DB_PATH="${SQLITE_PATH:-/app/data/graph.db}"
BACKUP_DIR="$(dirname "$DB_PATH")/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M)
sqlite3 "$DB_PATH" ".backup $BACKUP_DIR/graph-$TS.db"
find "$BACKUP_DIR" -name "graph-*.db" -mtime +30 -delete
echo "backup ok: $BACKUP_DIR/graph-$TS.db"
