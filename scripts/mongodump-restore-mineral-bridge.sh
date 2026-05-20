#!/usr/bin/env bash
# Method 1: mongodump -> mongorestore for database "mineral_bridge".
# Requires: MongoDB Database Tools on PATH. Atlas: IP allowlist on both clusters.
#
# Usage:
#   export SOURCE_MONGO_URI='mongodb+srv://OLD_USER:OLD_PASS@old.../?retryWrites=true&w=majority'
#   export TARGET_MONGO_URI='mongodb+srv://NEW_USER:NEW_PASS@new.../?retryWrites=true&w=majority'
#   bash backend/scripts/mongodump-restore-mineral-bridge.sh
#
# If TARGET_MONGO_URI is unset, parses MONGO_URI from backend/.env

set -euo pipefail
DB_NAME="mineral_bridge"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(dirname "$SCRIPT_DIR")"
DUMP_ROOT="$BACKEND_ROOT/mongo-dump-mineral-bridge"
DUMP_DB="$DUMP_ROOT/$DB_NAME"

if [[ -z "${SOURCE_MONGO_URI:-}" ]]; then
  echo "Set SOURCE_MONGO_URI to the OLD cluster URI." >&2
  exit 1
fi

TARGET="${TARGET_MONGO_URI:-}"
if [[ -z "$TARGET" ]] && [[ -f "$BACKEND_ROOT/.env" ]]; then
  TARGET="$(grep -E '^[[:space:]]*MONGO_URI=' "$BACKEND_ROOT/.env" | head -1 | cut -d= -f2- | tr -d \"\' | tr -d '\r')"
fi
if [[ -z "$TARGET" ]]; then
  echo "Set TARGET_MONGO_URI or MONGO_URI in backend/.env" >&2
  exit 1
fi

command -v mongodump >/dev/null 2>&1 || { echo "mongodump not found. Install MongoDB Database Tools." >&2; exit 1; }
command -v mongorestore >/dev/null 2>&1 || { echo "mongorestore not found." >&2; exit 1; }

rm -rf "$DUMP_ROOT"
mkdir -p "$DUMP_ROOT"

echo "Dumping $DB_NAME from SOURCE …"
mongodump --uri="$SOURCE_MONGO_URI" --db="$DB_NAME" --out="$DUMP_ROOT"

if [[ ! -d "$DUMP_DB" ]]; then
  echo "No dump at $DUMP_DB — check database name on source." >&2
  exit 1
fi

echo "Restoring $DB_NAME to TARGET …"
mongorestore --uri="$TARGET" --db="$DB_NAME" --drop "$DUMP_DB"

echo "Done. Remove $DUMP_ROOT if you like. Point MONGO_URI at the new cluster."
