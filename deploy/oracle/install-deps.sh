#!/usr/bin/env bash
# Installs/updates the backend's npm packages and the two Python services' virtualenvs.
# Run as the app user (not root). Quick when nothing changed.
set -euo pipefail
APP_DIR=/opt/lakshya

cd "$APP_DIR/server"
npm install --omit=dev --no-audit --no-fund

for service in planner-ai proctor-ai; do
  cd "$APP_DIR/$service"
  [ -d .venv ] || python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
done

# Download the OCR models now, so the first scanned paper does not wait for them.
cd "$APP_DIR/planner-ai"
.venv/bin/python -c "from papers.extract import _ocr; _ocr()"
