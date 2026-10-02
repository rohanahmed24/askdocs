#!/usr/bin/env bash
# Writes the environment variables for the two hosts into files you can paste
# into their dashboards: .env.vercel (web app) and .env.render (worker).
# It reads your OpenRouter key from .env and the Neon addresses from .env.neon,
# and makes two new random secrets. It prints only the NAMES of the variables.
# Running it again keeps the secrets it already made, so sessions stay valid.
#
#   bash scripts/prepare-deploy-env.sh --web-url https://askdocs-rohan.vercel.app --worker-url https://askdocs-worker.onrender.com
set -euo pipefail
umask 077

web_url=""
worker_url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --web-url) web_url="${2%/}"; shift 2 ;;
    --worker-url) worker_url="${2%/}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[ -n "$web_url" ] && [ -n "$worker_url" ] || { echo "Pass --web-url and --worker-url" >&2; exit 1; }

# Reads one variable from a .env style file without printing it.
get() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2-; }

openrouter_key="$(get .env OPENROUTER_API_KEY)"
pooled="$(get .env.neon DATABASE_URL)"
direct="$(get .env.neon DATABASE_URL_DIRECT)"
for pair in "OPENROUTER_API_KEY:$openrouter_key" "Neon pooled address:$pooled" "Neon direct address:$direct"; do
  [ -n "${pair#*:}" ] || { echo "Missing: ${pair%%:*}" >&2; exit 1; }
done

auth_secret=""
cron_secret=""
if [ -f .env.vercel ]; then
  auth_secret="$(get .env.vercel BETTER_AUTH_SECRET)"
  cron_secret="$(get .env.vercel CRON_SECRET)"
fi
[ -n "$auth_secret" ] || auth_secret="$(openssl rand -base64 32 | tr -d '\n=+/')"
[ -n "$cron_secret" ] || cron_secret="$(openssl rand -base64 32 | tr -d '\n=+/')"

cat > .env.vercel <<VERCEL
DATABASE_URL=$pooled
DB_POOL_MAX=3
BETTER_AUTH_SECRET=$auth_secret
BETTER_AUTH_URL=$web_url
OPENROUTER_API_KEY=$openrouter_key
WORKER_URL=$worker_url
CRON_SECRET=$cron_secret
VERCEL

cat > .env.render <<RENDER
DATABASE_URL_DIRECT=$direct
OPENROUTER_API_KEY=$openrouter_key
RENDER

chmod 600 .env.vercel .env.render
echo "Wrote .env.vercel with: $(cut -d= -f1 .env.vercel | tr '\n' ' ')"
echo "Wrote .env.render with: $(cut -d= -f1 .env.render | tr '\n' ' ')"
echo "Both files are ignored by git. Delete them after you have pasted them."
