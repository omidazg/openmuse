#!/usr/bin/env bash
# Switch the live server to a new domain (e.g. from the bare IP to dastyar-gpt.ir).
# Run from your machine; README.fa.md «تغییر دامنه» covers DNS first.
#
#   SERVER=root@37.32.27.135 ./deploy/arvan/set-domain.sh dastyar-gpt.ir
#
# Over SSH it backs up the server .env, sets DOMAIN=<domain> and ACME_PROFILE=classic
# (shortlived for a bare IP), and rebuilds: EXPO_PUBLIC_API_URL is baked into the web
# bundle at build time, and Caddy must request a certificate for the new name.
#
# Env: SERVER (required), SSH_KEY, REPO_DIR (default /opt/openmuse),
#      SKIP_DNS_CHECK=1 to skip the local A-record check, SMOKE=1 to run smoke.sh after.
set -euo pipefail

DOMAIN_NEW="${1:-}"
[ -n "$DOMAIN_NEW" ] || { echo "usage: SERVER=root@<ip> $0 <domain>" >&2; exit 2; }
: "${SERVER:?Set SERVER=user@host}"
REPO_DIR="${REPO_DIR:-/opt/openmuse}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DOMAIN_NEW="${DOMAIN_NEW#https://}"
DOMAIN_NEW="${DOMAIN_NEW%%/*}"
if ! [[ "$DOMAIN_NEW" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "invalid domain: $DOMAIN_NEW (use the punycode form for non-ASCII names)" >&2
  exit 2
fi
if [[ "$DOMAIN_NEW" =~ ^[0-9.]+$ ]]; then PROFILE=shortlived; else PROFILE=classic; fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")

server_ip="${SERVER#*@}"
if [ "$PROFILE" = classic ] && [ "${SKIP_DNS_CHECK:-0}" != 1 ]; then
  resolved=""
  if command -v dig >/dev/null; then
    resolved=$(dig +short A "$DOMAIN_NEW" | tail -1)
  elif command -v nslookup >/dev/null; then
    resolved=$(nslookup "$DOMAIN_NEW" 2>/dev/null | awk '/^Address/ {a=$2} END {print a}')
  fi
  if [ "$resolved" != "$server_ip" ]; then
    echo "DNS: $DOMAIN_NEW -> '${resolved:-nothing}', server is $server_ip." >&2
    echo "رکورد A دامنه هنوز به IP سرور اشاره نمی‌کند؛ Caddy نمی‌تواند گواهی بگیرد." >&2
    echo "If the domain is behind the ArvanCloud CDN proxy (or DNS is still propagating), rerun with SKIP_DNS_CHECK=1." >&2
    exit 1
  fi
fi

echo "==> $SERVER: DOMAIN=$DOMAIN_NEW ACME_PROFILE=$PROFILE"
ssh "${SSH_OPTS[@]}" "$SERVER" sudo bash -s -- "$REPO_DIR" "$DOMAIN_NEW" "$PROFILE" <<'REMOTE'
set -euo pipefail
cd "$1/deploy/arvan"
domain="$2"; profile="$3"
[ -f .env ] || { echo ".env missing in $PWD" >&2; exit 1; }
backup=".env.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p .env "$backup"
chmod 600 "$backup"
echo "old: $(grep -E '^(DOMAIN|ACME_PROFILE)=' .env | tr '\n' ' ')"
set_var() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >>.env; fi
}
set_var DOMAIN "$domain"
set_var ACME_PROFILE "$profile"
echo "new: $(grep -E '^(DOMAIN|ACME_PROFILE)=' .env | tr '\n' ' ') (previous file: $backup)"
docker compose config --quiet
export GIT_SHA="$(git -C "$1" rev-parse --short HEAD)"
# Rebuilds the app image (web bundle gets the new API URL); recreates app, worker, caddy
# and monitor, whose environment includes DOMAIN.
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
docker compose ps
echo "Caddy log (certificate):"
sleep 20
docker compose logs --since 2m caddy | grep -iE 'certificate|obtain|error' | tail -5 || true
REMOTE

cat <<EOF
==> Done. Next / گام‌های بعد:
  - Google OAuth redirect URI (if used): https://$DOMAIN_NEW/api/google/callback
  - Users of the old address must open https://$DOMAIN_NEW and log in again.
  - Undo: rerun with the previous domain (the old .env is kept as .env.bak-* on the server).
EOF
if [ "${SMOKE:-0}" = 1 ]; then
  SMOKE_RETRIES="${SMOKE_RETRIES:-9}" bash "$HERE/smoke.sh" "https://$DOMAIN_NEW"
fi
