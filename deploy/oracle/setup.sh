#!/usr/bin/env bash
# One-time setup of Lakshya on an Oracle Cloud "Always Free" Ubuntu VM (Ampere A1, arm64).
# Runs the backend, planner AI and proctor AI on one always-on machine, behind Caddy (HTTPS).
#
#   sudo bash setup.sh <your-domain>          e.g. sudo bash setup.sh lakshya-ayush.duckdns.org
#
# Safe to run again: it only adds what is missing. The backend starts once server/.env exists.
set -euo pipefail

DOMAIN="${1:?Usage: sudo bash setup.sh <domain>}"
APP_DIR=/opt/lakshya
REPO_URL=https://github.com/ayushk1904/Lakshya_ayush.git
APP_USER="${SUDO_USER:-ubuntu}"

echo "==> System packages"
apt-get update -y
apt-get install -y git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https \
  python3 python3-venv python3-pip libglib2.0-0 libgl1

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Caddy (HTTPS reverse proxy)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Code"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Dependencies"
sudo -u "$APP_USER" bash "$APP_DIR/deploy/oracle/install-deps.sh"

echo "==> Services"
for unit in lakshya-backend lakshya-planner lakshya-proctor; do
  sed "s/__USER__/$APP_USER/g" "$APP_DIR/deploy/oracle/$unit.service" > "/etc/systemd/system/$unit.service"
done
systemctl daemon-reload
systemctl enable --now lakshya-planner lakshya-proctor

echo "==> HTTPS for $DOMAIN"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "==> Firewall: allow web traffic (Oracle's Ubuntu image blocks it by default)"
for port in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi

# Lets the GitHub auto-deploy run the update script without a password prompt.
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/bash $APP_DIR/deploy/oracle/update.sh" > /etc/sudoers.d/lakshya-deploy
chmod 440 /etc/sudoers.d/lakshya-deploy

if [ -f "$APP_DIR/server/.env" ]; then
  systemctl enable --now lakshya-backend
  systemctl restart lakshya-backend
  echo
  echo "Done. Check: curl https://$DOMAIN/api/health"
else
  echo
  echo "Almost done: create $APP_DIR/server/.env (same contents as your local server/.env), then run:"
  echo "  sudo bash $APP_DIR/deploy/oracle/setup.sh $DOMAIN"
fi
