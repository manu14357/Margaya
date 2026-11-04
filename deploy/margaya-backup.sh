#!/bin/sh
# Backs up a Docker Compose install of Margaya: the database, uploaded files and
# .env (which holds the keys that unlock saved secrets). Each run writes a new
# dated folder. Run it next to compose.yml, from Linux, macOS or WSL:
#
#   sh margaya-backup.sh [destination-folder]
#
# Restoring is covered in the docs: core/installation/backup-and-restore.
# With an external database or S3, back those up with their own tools.
set -eu

destination="${1:-margaya-backups}/$(date +%Y-%m-%d-%H%M%S)"

# The backup holds passwords and signing keys, so only this user can read it.
umask 077
mkdir -p "$destination"

echo "Backing up the database..."
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  >"$destination/database.dump"
# A dump that can't be listed can't be restored, so find that out now.
docker compose exec -T postgres pg_restore --list \
  <"$destination/database.dump" >/dev/null

echo "Backing up uploaded files..."
docker compose exec -T margaya sh -c \
  'dir="${MARGAYA_STORAGE_DIR:-data/uploads}"; mkdir -p "$dir" && tar -czf - -C "$dir" .' \
  >"$destination/uploads.tar.gz"
gzip -t "$destination/uploads.tar.gz"

if [ -f .env ]; then
  cp .env "$destination/env.backup"
else
  echo "WARNING: no .env here. Keep your own copy of AUTH_SECRET: saved secrets can't be read without it." >&2
fi

echo "Backup written to $destination"
echo "Copy it to another machine: a backup on this server won't survive losing the server."
