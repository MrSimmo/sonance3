#!/bin/bash
# Sonance — Dev Server
# Serves the app at http://localhost:8080
cd "$(dirname "$0")"
echo "[Sonance] Starting dev server at http://localhost:8080"
python3 -m http.server 8080
