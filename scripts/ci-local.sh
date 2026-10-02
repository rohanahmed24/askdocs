#!/usr/bin/env bash
# Runs the same steps as .github/workflows/ci.yml, on a clean clone of the
# committed code and a fresh pgvector database, so uncommitted files cannot hide
# a problem. Use it when GitHub Actions is unavailable, or before a release.
#
#   pnpm ci:local          (needs Docker and network for pnpm install)
set -euo pipefail

repo="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
db="askdocs-ci-$$"
log="$work/step.log"

cleanup() {
  docker rm -f "$db" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

docker run -d --name "$db" -e POSTGRES_USER=askdocs -e POSTGRES_PASSWORD=askdocs -e POSTGRES_DB=askdocs \
  -p 127.0.0.1::5432 pgvector/pgvector:pg17 >/dev/null
port="$(docker port "$db" 5432/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 30); do
  docker exec "$db" pg_isready -U askdocs -d askdocs >/dev/null 2>&1 && break
  sleep 1
done

git clone -q --no-hardlinks "$repo" "$work/repo"
cd "$work/repo"
commit="$(git log --oneline -1)"

export DATABASE_URL="postgres://askdocs:askdocs@127.0.0.1:${port}/askdocs"
export TEST_DATABASE_URL="$DATABASE_URL"
# CI-only values. They protect nothing.
export BETTER_AUTH_SECRET="ci-only-secret-0123456789abcdef0123456789abcdef"
export BETTER_AUTH_URL="http://localhost:3000"

echo "Clean clone at: $commit"
step() {
  local name="$1"
  shift
  printf '== %s ... ' "$name"
  if "$@" >"$log" 2>&1; then
    echo ok
  else
    echo FAILED
    tail -30 "$log"
    exit 1
  fi
}

step "install" pnpm install --frozen-lockfile
step "lint" pnpm lint
step "typecheck" pnpm typecheck
step "migrations apply to a clean database" pnpm db:migrate
step "test" pnpm test
tests="$(grep -E '^ +Tests ' "$log" | head -1 | sed 's/^ *//')"
step "build" pnpm build

echo
echo "CI passed locally for: $commit"
echo "$tests"
