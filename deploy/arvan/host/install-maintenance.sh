#!/usr/bin/env bash
# Installs (idempotently) the weekly Docker cleanup timer on the server. Run as root;
# deploy.sh and bootstrap.sh call it. The disk is small (25 GB) and every `--build`
# leaves dangling images and build cache behind.
#
#   openmuse-prune.timer  Fridays 04:30 Asia/Tehran (+ catch-up after downtime)
#   → docker system prune -f        stopped containers, unused networks, dangling images
#   → docker builder prune -af      build cache unused for 7 days
# Volumes are never touched (database and backups live there).
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd not found; skipping prune timer" >&2; exit 0; }

cat >/usr/local/sbin/openmuse-prune <<'SH'
#!/bin/sh
set -eu
echo "before: $(df -h / | awk 'NR==2 {print $3" used, "$4" free ("$5")"}')"
docker system prune -f
docker builder prune -af --filter until=168h
echo "after:  $(df -h / | awk 'NR==2 {print $3" used, "$4" free ("$5")"}')"
SH
chmod 755 /usr/local/sbin/openmuse-prune

cat >/etc/systemd/system/openmuse-prune.service <<'UNIT'
[Unit]
Description=OpenMuse weekly Docker cleanup (dangling images, build cache)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/openmuse-prune
Nice=10
IOSchedulingClass=idle
UNIT

cat >/etc/systemd/system/openmuse-prune.timer <<'UNIT'
[Unit]
Description=Weekly OpenMuse Docker cleanup

[Timer]
OnCalendar=Fri *-*-* 04:30:00 Asia/Tehran
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now openmuse-prune.timer >/dev/null
systemctl list-timers openmuse-prune.timer --no-pager | head -2 || true
