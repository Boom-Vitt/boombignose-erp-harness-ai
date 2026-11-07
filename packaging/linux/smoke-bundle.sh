#!/bin/sh
# Boot the Linux or macOS native bundle and require its configured /api/health.
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
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) erp_target=linux-x64 ;;
  Darwin:arm64) erp_target=darwin-arm64 ;;
  *) echo "unsupported ERP smoke host" >&2; exit 1 ;;
esac
"$bundle/node" "$root/packaging/erp-dependencies.mjs" smoke "$bundle/erp" "$erp_target"
need_exec "$bundle/postgres/bin/postgres"
for tool in psql pg_dump pg_restore; do
  need_exec "$bundle/postgres/bin/$tool"
  "$bundle/postgres/bin/$tool" --version | grep -F '(PostgreSQL) 16.15'
done
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
# Resolve the native environment once, before any process can adopt a listener.
# The smoke requires plain HTTP loopback: the native children do not terminate TLS.
resolved=$("$bundle/node" <<'JS'
const env = process.env;
function port(value) {
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 65535) {
    throw new Error("smoke ports must be canonical decimal integers 1..65535");
  }
  return value;
}
function origin(raw) {
  const u = new URL(raw);
  const explicit = raw.match(/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]+)\/?$/);
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
      u.username || u.password || u.pathname !== "/" || u.search || u.hash || !explicit) {
    throw new Error("smoke endpoints must be HTTP loopback origins with explicit ports");
  }
  return { port: port(explicit[1]) };
}
const erp = origin(env.BOOMBIGNOSE_ERP_URL || "http://127.0.0.1:3100");
const api = port(env.BOOMBIGNOSE_API_PORT || "54321");
const auth = port(env.BOOMBIGNOSE_AUTH_PORT || "54323");
const rest = port(env.BOOMBIGNOSE_REST_PORT || "54324");
const pg = port(env.BOOMBIGNOSE_PG_PORT || "54329");
const rawOllama = env.OLLAMA_HOST || "127.0.0.1:11434";
const ollama = origin(rawOllama.includes("://") ? rawOllama : `http://${rawOllama}`);
const ports = [erp.port, api, auth, rest, pg, ollama.port];
if (new Set(ports).size !== ports.length) throw new Error("smoke ports must all be distinct");
// Native services bind IPv4 loopback; resolve accepted loopback aliases to it.
console.log([`http://127.0.0.1:${erp.port}`, ...ports, `127.0.0.1:${ollama.port}`].join(" "));
JS
)
read -r erp_origin erp_port api_port auth_port rest_port pg_port ollama_port ollama_host <<EOF
$resolved
EOF
api_origin="http://127.0.0.1:$api_port"
# The tarball smoke and AppImage smoke share this runner. Require bindability,
# including the model port, so an existing shared daemon is never adopted.
wait_ports_free "$erp_port" "$pg_port" "$api_port" "$auth_port" "$rest_port" "$ollama_port"

data=$(mktemp -d)
pgdata=$data/pg
trap 'rm -rf "$data"' EXIT
unset OPENROUTER_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY RESEND_API_KEY OPENROUTER_MODEL || true
export BOOMBIGNOSE_BUNDLE="$bundle"
export BOOMBIGNOSE_DATA="$pgdata"
export BOOMBIGNOSE_PG_PORT="$pg_port"
export BOOMBIGNOSE_ERP_URL="$erp_origin"
export BOOMBIGNOSE_API_PORT="$api_port"
export BOOMBIGNOSE_AUTH_PORT="$auth_port"
export BOOMBIGNOSE_REST_PORT="$rest_port"
export OLLAMA_HOST="$ollama_host"
export BOOMBIGNOSE_ALLOW_SIGNUP=1
unset BOOMBIGNOSE_PUBLIC_ORIGIN || true
export NEXT_PUBLIC_SUPABASE_URL="$api_origin"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-local-anon-not-a-secret}"
unset LD_LIBRARY_PATH || true

( cd "$root/boombignose" && go build -o "$data/boombignose" ./cmd/boombignose )
# Ollama's allowlisted child environment forwards HOME, not OLLAMA_MODELS.
# Change HOME only after compilation so Go keeps the caller's build cache.
export HOME="$data/home"
mkdir -m 700 "$HOME"
assert_no_weights() {
  for directory in "$HOME/.ollama/models/manifests" "$HOME/.ollama/models/blobs"; do
    if [ -d "$directory" ] && [ -n "$(find "$directory" -type f -print)" ]; then
      echo "ordinary startup/auth created model manifests or blobs" >&2
      exit 1
    fi
  done
}
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
  assert_no_weights
  if body=$(curl -fsS --max-time 2 "$erp_origin/api/health" 2>/dev/null); then
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
assert_no_weights
test -s "$pgdata/ollama.pid"
curl -fsS --max-time 5 "http://$ollama_host/api/tags" > "$data/models.json"
"$bundle/node" -e '
const fs = require("node:fs");
const tags = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(tags.models) || tags.models.length !== 0) {
  throw new Error("isolated startup daemon must have no installed models");
}
' "$data/models.json"
echo "owned model daemon empty"
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
signup=$(curl -fsS -X POST "$api_origin/auth/v1/signup" \
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
signin=$(curl -fsS -X POST "$api_origin/auth/v1/token?grant_type=password" \
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
assert_no_weights
kill -TERM "$pid"
wait "$pid" || true
pid=""

assert_no_weights
if ! wait_ports_free "$erp_port" "$pg_port" "$api_port" "$auth_port" "$rest_port" "$ollama_port"; then
  echo "owned stack left a configured loopback port busy" >&2
  cat "$data/serve.log" >&2 || true
  exit 1
fi
echo "postgres stopped"
echo "ports free"
