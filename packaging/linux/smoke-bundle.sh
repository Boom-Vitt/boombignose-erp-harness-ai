#!/bin/sh
# Boot the Linux or macOS bundle and require GET http://127.0.0.1:3100/api/health.
# This uses the harness serve command, not a click of the AppImage or DMG.
# Windows uses packaging/windows/smoke-bundle.ps1 (node.exe / postgres.exe).
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"
bundle=${BOOMBIGNOSE_SMOKE_BUNDLE:-$root/dist/bundle}
need_exec() {
  if [ ! -x "$1" ]; then
    echo "not executable: $1" >&2
    ls -l "$1" >&2 || true
    exit 1
  fi
}
need_exec "$bundle/node"
test -s "$bundle/erp/server.js"
need_exec "$bundle/postgres/bin/postgres"
test -s "$bundle/postgres/prelude.sql"
test -s "$bundle/postgres/prelude-after-auth.sql"
need_exec "$bundle/auth/auth"
test -d "$bundle/auth/migrations"
need_exec "$bundle/postgrest/postgrest"
if [ -x "$bundle/ollama/ollama" ]; then
  ollama_bin=$bundle/ollama/ollama
elif [ -x "$bundle/ollama/bin/ollama" ]; then
  ollama_bin=$bundle/ollama/bin/ollama
else
  echo "ollama binary missing in $bundle" >&2
  ls -l "$bundle/ollama" "$bundle/ollama/bin" >&2 || true
  exit 1
fi
test -s "$bundle/ollama/OLLAMA_LICENSE.txt"
if [ -d "$bundle/ollama/lib/ollama/cuda_v12" ] || [ -d "$bundle/ollama/lib/ollama/cuda_v13" ]; then
  echo "cuda runner was packed" >&2
  exit 1
fi
# This smoke does not run `ollama pull` or `boombignose pull-model`.

# shellcheck disable=SC1091
. "$root/packaging/linux/port-free.sh"
pg_port=54329
# The tarball smoke and the AppImage smoke share this runner. TIME_WAIT
# still refuses PostgREST's bind after connect() already fails.
wait_ports_free 3100 "$pg_port" 54321 54323 54324

data=$(mktemp -d)
pgdata=$data/pg
mkdir -p "$pgdata"
trap 'rm -rf "$data"' EXIT
unset OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY RESEND_API_KEY OPENROUTER_MODEL || true
export BOOMBIGNOSE_BUNDLE="$bundle"
export BOOMBIGNOSE_DATA="$pgdata"
export BOOMBIGNOSE_PG_PORT="$pg_port"
export BOOMBIGNOSE_ERP_URL="http://127.0.0.1:3100"
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-local-anon-not-a-secret}"
unset LD_LIBRARY_PATH || true

( cd "$root/boombignose" && go build -o "$data/boombignose" ./cmd/boombignose )
pid=""
cleanup() {
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
trap 'cleanup; rm -rf "$data"' EXIT
"$data/boombignose" serve > "$data/serve.log" 2>&1 &
pid=$!

ok=0
i=0
while [ "$i" -lt 150 ]; do
  i=$((i + 1))
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "serve exited before the health check" >&2
    cat "$data/serve.log" >&2 || true
    exit 1
  fi
  if body=$(curl -fsS --max-time 2 http://127.0.0.1:3100/api/health 2>/dev/null); then
    case "$body" in
      *'"ok":true'*) ok=1; break ;;
    esac
  fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "health check failed" >&2
  cat "$data/serve.log" >&2 || true
  exit 1
fi
test -s "$pgdata/PG_VERSION"
echo "health ok"
if grep -F "pull qwen2.5" "$data/serve.log"; then
  echo "serve pulled a model" >&2
  exit 1
fi
anon=$(tr -d '\n\r' < "$pgdata/anon.key")
email="smoke-$(date +%s)@example.com"
dump_auth() {
  secret=""
  if [ -s "$pgdata/jwt.secret" ]; then
    secret=$(tr -d '\n\r' < "$pgdata/jwt.secret")
  fi
  if [ -s "$pgdata/auth.log" ]; then
    if [ -n "$secret" ]; then
      sed "s|$secret|[redacted]|g" "$pgdata/auth.log" >&2 || true
    else
      cat "$pgdata/auth.log" >&2 || true
    fi
  fi
}
signup=$(curl -fsS -X POST http://127.0.0.1:54321/auth/v1/signup \
  -H "apikey: $anon" \
  -H "Authorization: Bearer $anon" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$email\",\"password\":\"SmokeTest1a\"}" || true)
case "$signup" in
  *'"access_token"'*) echo signup ok ;;
  *)
    echo "signup failed" >&2
    dump_auth
    exit 1
    ;;
esac
signin=$(curl -fsS -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $anon" \
  -H "Authorization: Bearer $anon" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$email\",\"password\":\"SmokeTest1a\"}" || true)
case "$signin" in
  *'"access_token"'*) echo signin ok ;;
  *)
    echo "signin failed" >&2
    dump_auth
    exit 1
    ;;
esac
unset signup signin anon
kill -TERM "$pid"
wait "$pid" || true
pid=""

if ! wait_ports_free 3100 "$pg_port" 54321 54323 54324; then
  echo "postgres stayed up on 127.0.0.1:$pg_port" >&2
  cat "$data/serve.log" >&2 || true
  exit 1
fi
echo "postgres stopped"
echo "ports free"
