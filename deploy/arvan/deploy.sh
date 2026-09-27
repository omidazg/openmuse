#!/usr/bin/env bash
# Idempotent deploy/update of OpenMuse on an ArvanCloud server over SSH.
#
#   SERVER=root@1.2.3.4 SSH_KEY=~/.ssh/openmuse_arvan ./deploy/arvan/deploy.sh   (Arvan images log in as root)
#
# Env:
#   SERVER      (required) SSH target, e.g. ubuntu@<server-ip>
#   SSH_KEY     optional private key path
#   BRANCH      git branch to deploy (default: fa-arvan)
#   REPO_URL    git remote (default: https://github.com/omidazg/openmuse.git)
#   REPO_DIR    checkout on the server (default: /opt/openmuse)
#   ENV_FILE    local env file to upload (default: deploy/arvan/.env); only when the server has none
#   FORCE_ENV   1 = overwrite the server's .env with ENV_FILE
#   SMOKE       1 = run smoke.sh from THIS machine afterwards (the server cannot reach its
#               own public IP); uses SMOKE_URL or https://<DOMAIN from the server .env>
#               and SMOKE_ACCESS_KEY if set
#   DISK_WARN_PCT  warn when the server's root disk is fuller than this (default 85)
set -euo pipefail

: "${SERVER:?Set SERVER=user@host}"
BRANCH="${BRANCH:-fa-arvan}"
REPO_URL="${REPO_URL:-https://github.com/omidazg/openmuse.git}"
REPO_DIR="${REPO_DIR:-/opt/openmuse}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/.env}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")

echo "==> Preparing $REPO_DIR on $SERVER ($BRANCH)"
ssh "${SSH_OPTS[@]}" "$SERVER" sudo bash -s -- "$REPO_URL" "$BRANCH" "$REPO_DIR" <<'REMOTE'
set -euo pipefail
repo_url="$1"; branch="$2"; dir="$3"
command -v docker >/dev/null || { echo "Docker is not installed (run deploy/arvan/bootstrap.sh on the server first)" >&2; exit 1; }
if [ ! -d "$dir/.git" ]; then
  git clone --branch "$branch" "$repo_url" "$dir"
fi
cd "$dir"
git fetch --prune origin "$branch"
git checkout -q "$branch"
git merge --ff-only "origin/$branch"
git log -1 --oneline
REMOTE

# The server's .env is the source of truth once it exists (keys, domain and model are edited
# there). Set FORCE_ENV=1 to replace it with the local file.
if [ -f "$ENV_FILE" ] && { [ "${FORCE_ENV:-0}" = 1 ] || ! ssh "${SSH_OPTS[@]}" "$SERVER" "test -f '$REPO_DIR/deploy/arvan/.env'"; }; then
  echo "==> Uploading $(basename "$ENV_FILE")"
  scp "${SSH_OPTS[@]}" "$ENV_FILE" "$SERVER:/tmp/openmuse.env"
  ssh "${SSH_OPTS[@]}" "$SERVER" "sudo install -m 600 -o root -g root /tmp/openmuse.env '$REPO_DIR/deploy/arvan/.env' && rm -f /tmp/openmuse.env"
fi

echo "==> Building and starting containers"
ssh "${SSH_OPTS[@]}" "$SERVER" sudo bash -s -- "$REPO_DIR" "${DISK_WARN_PCT:-85}" <<'REMOTE'
set -euo pipefail
cd "$1/deploy/arvan"
[ -f .env ] || { echo ".env missing in $PWD; set ENV_FILE or copy env.example" >&2; exit 1; }
docker compose config --quiet
export GIT_SHA="$(git -C "$1" rev-parse --short HEAD)"
docker compose up -d --build --remove-orphans
# Disk is small: drop dangling images and build cache older than a week after each build.
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null || true
bash "$1/deploy/arvan/host/install-maintenance.sh" >/dev/null || echo "WARN: prune timer not installed" >&2
docker compose ps
echo "==> Disk usage"
df -h / | sed 's/^/    /'
docker system df | sed 's/^/    /'
used=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "$used" -ge "$2" ]; then
  echo "WARNING: root disk ${used}% full (>= $2%). هشدار: دیسک ${used}٪ پر است؛ «docker system prune» یا پاک‌سازی پشتیبان‌ها را بررسی کنید." >&2
fi
REMOTE

if [ "${SMOKE:-0}" = 1 ]; then
  if [ -z "${SMOKE_URL:-}" ]; then
    domain=$(ssh "${SSH_OPTS[@]}" "$SERVER" "sudo sed -n 's/^DOMAIN=//p' '$REPO_DIR/deploy/arvan/.env'" | tail -1 | tr -d "\"'\r")
    SMOKE_URL="https://$domain"
  fi
  echo "==> Smoke test against $SMOKE_URL (Caddy may need a minute for a new certificate)"
  SMOKE_RETRIES="${SMOKE_RETRIES:-6}" bash "$HERE/smoke.sh" "$SMOKE_URL"
else
  echo "==> Done. Check from your machine: SMOKE=1 or ./deploy/arvan/smoke.sh https://<DOMAIN>"
fi
