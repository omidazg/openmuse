#!/bin/bash
# Server bootstrap for an ArvanCloud cloud server (Ubuntu 24.04), run as root.
#
# ArvanCloud's `init_script` field is executed as a shell script (a #cloud-config
# document is NOT parsed as cloud-config), so create-server.sh sends this file.
# It is idempotent and can also be run by hand:
#   ssh root@<ip> 'bash -s' < deploy/arvan/bootstrap.sh
#
# Installs Docker from the Ubuntu archive, points Docker Hub pulls at ArvanCloud's
# mirror, enables ufw (22/80/443), clones the fork. It never starts the stack and
# contains no secrets: upload .env and start with deploy.sh.
set -eux

BRANCH="${BRANCH:-fa-arvan}"
REPO_URL="${REPO_URL:-https://github.com/omidazg/openmuse.git}"
REPO_DIR="${REPO_DIR:-/opt/openmuse}"
export DEBIAN_FRONTEND=noninteractive

mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://docker.arvancloud.ir"],
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON

apt-get update -y
apt-get install -y docker.io docker-compose-v2 docker-buildx git ufw ca-certificates curl
systemctl enable docker
systemctl restart docker

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# 2 GB swap: the web bundle build and Chromium can spike past 4 GB RAM.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR" || echo "clone failed; deploy.sh will retry" >&2
fi

echo "OpenMuse bootstrap finished"
