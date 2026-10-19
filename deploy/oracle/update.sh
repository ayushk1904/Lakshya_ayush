#!/usr/bin/env bash
# Pulls the latest code from GitHub and restarts the services. Run by the GitHub Action on every
# push to main (or by hand: sudo bash /opt/lakshya/deploy/oracle/update.sh).
set -euo pipefail
APP_DIR=/opt/lakshya
APP_USER="$(stat -c %U "$APP_DIR")"

cd "$APP_DIR"
sudo -u "$APP_USER" git fetch --quiet origin main
sudo -u "$APP_USER" git reset --quiet --hard origin/main   # server/.env and .venv are git-ignored, so they stay
sudo -u "$APP_USER" bash deploy/oracle/install-deps.sh

for unit in lakshya-backend lakshya-planner lakshya-proctor; do
  sed "s/__USER__/$APP_USER/g" "deploy/oracle/$unit.service" > "/etc/systemd/system/$unit.service"
done
systemctl daemon-reload
systemctl restart lakshya-planner lakshya-proctor lakshya-backend
echo "Updated to $(sudo -u "$APP_USER" git log -1 --format='%h %s')"
