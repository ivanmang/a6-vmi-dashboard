#!/usr/bin/env bash
# serve.sh — best-effort static server for the dashboard (no deps).
# Tries python3, then python2, then node `npx`-free inline, then busybox httpd.
# Usage: ./scripts/serve.sh [port] [host]
set -eu
PORT="${1:-8002}"
HOST="${2:-0.0.0.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$(cd "$HERE/.." && pwd)/web"

cd "$WEB"

if command -v python3 >/dev/null 2>&1; then
  echo ">> python3 http.server on ${HOST}:${PORT}  (dir: $WEB)"
  exec python3 -m http.server "$PORT" --bind "$HOST"
fi
if command -v python >/dev/null 2>&1; then
  echo ">> python SimpleHTTPServer on ${HOST}:${PORT}"
  exec python -m SimpleHTTPServer "$PORT"
fi
if command -v php >/dev/null 2>&1; then
  echo ">> php built-in server on ${HOST}:${PORT}"
  exec php -S "$HOST:$PORT" -t "$WEB"
fi
if command -v busybox >/dev/null 2>&1; then
  echo ">> busybox httpd on ${HOST}:${PORT}"
  exec busybox httpd -f -p "$PORT" -h "$WEB"
fi

cat <<EOF
No static server found. Options:
  1. Install python3 (preferred) and re-run.
  2. Just open the file directly:    file://$WEB/index.html
     (works fully offline, no server needed)
EOF
exit 1
