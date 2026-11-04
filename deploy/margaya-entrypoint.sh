#!/bin/sh
set -eu

urlencode() {
  node -e 'const input = process.argv[1]; process.stdout.write(encodeURIComponent(input).replace(/[!\x27()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`));' -- "$1"
}

api_pid=""
nginx_pid=""

cleanup() {
  if [ -n "$api_pid" ]; then
    kill "$api_pid" 2>/dev/null || true
  fi

  if [ -n "$nginx_pid" ]; then
    kill "$nginx_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

on_mounted_volume() {
  awk -v dir="$1" '$2 != "/" && (dir == $2 || index(dir, $2 "/") == 1) { found = 1 } END { exit !found }' /proc/mounts 2>/dev/null
}

warn_auth_secret() {
  echo "WARNING: $1" >&2
  echo "WARNING: Saved SMTP passwords, OAuth client secrets, AI keys and webhook signing secrets are encrypted with a key derived from AUTH_SECRET. They become unreadable, and everyone is signed out, when it changes." >&2
  echo "WARNING: Fix this by setting AUTH_SECRET in your environment (openssl rand -hex 32) or by mounting a writable volume." >&2
}

new_auth_secret() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
}

# The built-in file store's folder, by the API's own rule (localStorageRoot).
storage_dir() {
  dir="$(printf '%s' "${MARGAYA_STORAGE_DIR:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  dir="${dir:-data/uploads}"
  case "$dir" in
    /*) printf '%s' "$dir" ;;
    *) printf '%s/%s' "$PWD" "${dir#./}" ;;
  esac
}

# A blank AUTH_SECRET is generated once and kept in the file store's folder,
# which is on the volume in every documented install. Its leading dot keeps it
# out of reach of the asset routes: storage keys can't start with a dot. Using
# the store's folder means an install that already mounts a volume needs no
# change.
load_auth_secret() {
  folder="$(storage_dir)"

  if ! mkdir -p -- "$folder" 2>/dev/null || [ ! -d "$folder" ]; then
    AUTH_SECRET="$(new_auth_secret)"
    warn_auth_secret "AUTH_SECRET is not set and the folder $folder can't be used to save one, so a new secret is generated on every start."
    return 0
  fi

  secret_file="$folder/.auth-secret"
  if [ -e "$secret_file" ]; then
    stored_secret="$(tr -d '\r\n' 2>/dev/null <"$secret_file" || true)"
    if [ "${#stored_secret}" -lt 32 ]; then
      AUTH_SECRET="$(new_auth_secret)"
      warn_auth_secret "AUTH_SECRET is not set and $secret_file can't be read or holds less than 32 characters. It was left as it is, and a new secret is generated on every start."
      return 0
    fi
    AUTH_SECRET="$stored_secret"
    echo "AUTH_SECRET not set — using the generated secret saved in $secret_file"
  else
    AUTH_SECRET="$(new_auth_secret)"
    if ! (umask 077 && printf '%s\n' "$AUTH_SECRET" >"$secret_file.tmp") 2>/dev/null || ! mv -f -- "$secret_file.tmp" "$secret_file" 2>/dev/null; then
      rm -f -- "$secret_file.tmp" 2>/dev/null || true
      warn_auth_secret "AUTH_SECRET is not set and $folder isn't writable, so the generated secret could not be saved and a new one is generated on every start."
      return 0
    fi
    echo "AUTH_SECRET not set — generated one and saved it in $secret_file"
  fi

  if ! on_mounted_volume "$folder"; then
    warn_auth_secret "AUTH_SECRET is saved in $secret_file, but that folder isn't on a mounted volume, so it survives a restart and is lost when the container is recreated (for example, on upgrade)."
  fi
}

# Derive MARGAYA_API_URL from MARGAYA_CLIENT_URL if not explicitly set
client_url_trimmed="$(printf '%s' "${MARGAYA_CLIENT_URL:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
client_url="${client_url_trimmed%/}"
if [ -z "${MARGAYA_API_URL:-}" ] && [ -n "$client_url" ]; then
  export MARGAYA_API_URL="${client_url}/api"
  echo "MARGAYA_API_URL not set — derived from MARGAYA_CLIENT_URL: $MARGAYA_API_URL"
fi

# Derive DATABASE_URL for the bundled image when it is not explicitly set.
# This image requires either DATABASE_URL or POSTGRES_PASSWORD so startup
# fails fast instead of silently falling back to localhost inside the container.
if [ -z "${DATABASE_URL:-}" ]; then
  POSTGRES_DB="${POSTGRES_DB:-margaya}"
  POSTGRES_USER="${POSTGRES_USER:-margaya}"
  if [ -n "${POSTGRES_PASSWORD:-}" ]; then
    encoded_user="$(urlencode "$POSTGRES_USER")"
    encoded_password="$(urlencode "$POSTGRES_PASSWORD")"
    export DATABASE_URL="postgresql://${encoded_user}:${encoded_password}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"
    echo "DATABASE_URL not set — derived from POSTGRES_* vars"
  else
    echo "ERROR: DATABASE_URL is not set and POSTGRES_PASSWORD is not set for bundled-image startup" >&2
    exit 1
  fi
fi

if [ -z "${AUTH_SECRET:-}" ]; then
  load_auth_secret
  export AUTH_SECRET
fi

# The built-in file store loses files without a volume, so say so at every start.
if [ -z "${S3_ENDPOINT:-}" ] && [ -z "${S3_BUCKET:-}" ] && [ "${MARGAYA_LOCAL_STORAGE:-true}" != "false" ]; then
  uploads_dir="$(storage_dir)"
  if ! on_mounted_volume "$uploads_dir"; then
    echo "WARNING: Uploads are stored in $uploads_dir, which isn't on a mounted volume. Recreating the container (for example, on upgrade) deletes them. See the upgrade notes in the docs before you recreate it." >&2
  fi
fi

/docker-entrypoint.d/env.sh

node --enable-source-maps /app/apps/api/dist/index.js &
api_pid=$!

echo "Waiting for API to be ready..."
until wget --spider --quiet http://127.0.0.1:1337/api/health 2>/dev/null; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "API process exited unexpectedly"
    exit 1
  fi
  sleep 1
done
echo "API is ready"

nginx -g "daemon off;" &
nginx_pid=$!

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done

first_failed_pid=""
first_failed_status=""
api_status=""
nginx_status=""

if ! kill -0 "$api_pid" 2>/dev/null; then
  wait "$api_pid" || api_status=$?
  api_status=${api_status:-0}
  first_failed_pid="$api_pid"
  first_failed_status="$api_status"
fi

if [ -z "$first_failed_pid" ] && ! kill -0 "$nginx_pid" 2>/dev/null; then
  wait "$nginx_pid" || nginx_status=$?
  nginx_status=${nginx_status:-0}
  first_failed_pid="$nginx_pid"
  first_failed_status="$nginx_status"
fi

cleanup

if [ "$first_failed_pid" != "$api_pid" ]; then
  wait "$api_pid" || api_status=$?
fi

if [ "$first_failed_pid" != "$nginx_pid" ]; then
  wait "$nginx_pid" || nginx_status=$?
fi

api_status=${api_status:-0}
nginx_status=${nginx_status:-0}

if [ -n "$first_failed_status" ]; then
  exit "$first_failed_status"
fi

if [ "$api_status" -ne 0 ]; then
  exit "$api_status"
fi

exit "$nginx_status"
