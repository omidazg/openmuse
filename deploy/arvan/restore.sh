#!/usr/bin/env bash
# Restore OpenMuse from the backups written by the `backup` service. Run ON THE SERVER as
# root, from any directory (README.fa.md, section «پشتیبان‌گیری و بازگردانی»):
#
#   sudo ./deploy/arvan/restore.sh list                     local (+ S3) backups
#   sudo ./deploy/arvan/restore.sh backup-now               run one backup immediately
#   sudo ./deploy/arvan/restore.sh fetch daily/<file>       download from S3 to /backups/restore/
#   sudo ./deploy/arvan/restore.sh db latest                restore the newest local dump
#   sudo ./deploy/arvan/restore.sh db /backups/daily/openmuse-20260923T000000Z.dump
#   sudo ./deploy/arvan/restore.sh appdata latest           restore session key + PDFs
#
# `db` and `appdata` stop app + worker, keep a safety copy of the current state in
# /backups/restore/, restore, and start them again. They ask for confirmation unless
# CONFIRM=yes. Paths are inside the `backups` volume (as the backup container sees them).
set -euo pipefail

cd "$(dirname "$0")"
PROJECT="${COMPOSE_PROJECT:-openmuse}"
dc() { docker compose "$@"; }
bexec() { dc exec -T backup "$@"; }

[ -f .env ] || { echo ".env missing in $PWD" >&2; exit 1; }
dc ps --status running --services | grep -qx backup || {
  echo "The backup service is not running: docker compose up -d backup" >&2
  exit 1
}

confirm() {
  [ "${CONFIRM:-}" = yes ] && return 0
  echo "$1"
  read -r -p "Type 'restore' to continue / برای ادامه restore را بنویسید: " answer
  [ "$answer" = restore ] || { echo "Cancelled / لغو شد"; exit 1; }
}

resolve() { # resolve latest|path pattern
  if [ "$1" = latest ]; then
    bexec sh -c "ls -1 /backups/daily/$2 2>/dev/null | sort | tail -1"
  else
    echo "$1"
  fi
}

stop_app() { dc stop app worker; }
start_app() { dc up -d app worker; }

cmd="${1:-}"
case "$cmd" in
  list) bexec /bin/sh /opt/backup/backup.sh list ;;
  backup-now) bexec /bin/sh /opt/backup/backup.sh once ;;
  fetch)
    [ -n "${2:-}" ] || { echo "usage: $0 fetch daily/<file>" >&2; exit 2; }
    bexec /bin/sh /opt/backup/backup.sh fetch "$2"
    ;;
  db)
    file=$(resolve "${2:-}" 'openmuse-*.dump')
    [ -n "$file" ] && bexec test -f "$file" || { echo "dump not found: ${2:-} ($file)" >&2; exit 1; }
    confirm "Database 'openmuse' will be replaced by $file. پایگاه داده با این نسخه جایگزین می‌شود."
    safety="/backups/restore/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
    echo "==> Safety dump of the current database: $safety"
    bexec sh -c "mkdir -p /backups/restore && pg_dump -Fc -f '$safety'"
    echo "==> Stopping app and worker"
    stop_app
    trap start_app EXIT
    echo "==> pg_restore $file"
    bexec pg_restore --clean --if-exists --no-owner --single-transaction -d openmuse "$file"
    echo "==> Done. Starting app and worker"
    ;;
  appdata)
    file=$(resolve "${2:-}" 'app-data-*.tar.gz')
    [ -n "$file" ] && bexec test -f "$file" || { echo "archive not found: ${2:-} ($file)" >&2; exit 1; }
    confirm "Files in the app-data volume (session key, PDFs) will be replaced by $file."
    image=$(dc images -q backup | head -1)
    stop_app
    trap start_app EXIT
    safety="/backups/restore/pre-restore-app-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
    echo "==> Safety copy: $safety, then extracting $file"
    docker run --rm --entrypoint /bin/sh \
      -v "${PROJECT}_app-data:/appdata" -v "${PROJECT}_backups:/backups" "$image" -c "
        set -e
        mkdir -p /backups/restore
        tar czf '$safety' -C /appdata .
        find /appdata -mindepth 1 -maxdepth 1 ! -name postgres -exec rm -rf {} +
        tar xzf '$file' -C /appdata"
    echo "==> Done. Starting app and worker (web users must log in again if the session key changed)"
    ;;
  *)
    sed -n '2,14p' "$0"
    exit 2
    ;;
esac
