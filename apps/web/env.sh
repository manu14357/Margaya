#!/bin/sh
set -eu

# Values are read through awk's ENVIRON, never interpolated into shell, sed,
# JavaScript, or nginx source. Do not print public or private environment values.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
asset_root=/usr/share/nginx/html
export MARGAYA_ENV_RENDERER="$script_dir/env.awk"
export MARGAYA_ASSET_ROOT="$asset_root"

# Build files that get this deployment's values keep their hashed names, so
# nginx must not let browsers keep them as immutable: their names go to this
# map, which nginx.conf includes. Each name is added once its file is filled
# in, so a restarted container (its files already filled) adds none and an
# interrupted start never lists a name twice.
export MARGAYA_RUNTIME_ASSETS_MAP=/etc/nginx/conf.d/margaya-runtime-assets.map

if [ -z "${MARGAYA_API_URL:-}" ]; then
  echo "WARNING: MARGAYA_API_URL is not set. API calls may fail." >&2
fi

# find -exec preserves spaces/newlines in filenames. Write each replacement
# beside its source before atomically replacing the complete file. Only plain
# /assets/ names enter the nginx map, so a name can never become nginx syntax.
find "$asset_root" -type f -name '*.js' -exec sh -eu -c '
  for asset do
    temporary=$(mktemp "${asset}.XXXXXX")
    trap '\''rm -f "$temporary" "$temporary.filled"'\'' EXIT HUP INT TERM
    MARGAYA_ENV_MARKER="$temporary.filled" LC_ALL=C \
      awk -v mode=bundle -f "$MARGAYA_ENV_RENDERER" "$asset" > "$temporary"
    chmod 644 "$temporary"
    mv "$temporary" "$asset"
    if [ -e "$temporary.filled" ]; then
      rm -f "$temporary.filled"
      name=${asset#"$MARGAYA_ASSET_ROOT"}
      case "$name" in
        /assets/*[!A-Za-z0-9._-]*) listed=false ;;
        /assets/?*) listed=true ;;
        *) listed=skip ;;
      esac
      # nginx.conf sizes its map for names up to 200 characters. A failed
      # write must not stop the container from starting.
      if [ "$listed" = true ] && [ "${#name}" -le 200 ] &&
        printf "\"%s\" \"no-cache\";\n" "$name" 2>/dev/null >> "$MARGAYA_RUNTIME_ASSETS_MAP"; then
        :
      elif [ "$listed" != skip ]; then
        echo "WARNING: $name may be cached with old settings." >&2
      fi
    fi
    trap - EXIT HUP INT TERM
  done
' sh {} +

# Serve JSON as static content. It must never become an nginx configuration
# string, where quotes, backslashes, and dollar signs have another meaning.
# margaya-desktop.json is the desktop app's discovery document; nginx serves
# it at /.well-known/margaya-desktop.json.
for mode in resource authorization desktop; do
  case "$mode" in
    desktop) target="$asset_root/margaya-desktop.json" ;;
    *) target="$asset_root/mcp-oauth-$mode.json" ;;
  esac
  temporary=$(mktemp "${target}.XXXXXX")
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  LC_ALL=C awk -v mode="$mode" -f "$MARGAYA_ENV_RENDERER" > "$temporary"
  chmod 644 "$temporary"
  mv "$temporary" "$target"
  trap - EXIT HUP INT TERM
done

echo "Public web configuration prepared."
