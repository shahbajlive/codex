#!/bin/bash
# Starts codex-app-server with optional fixture support
# Usage: ./start-app-server.sh [port] [fixture_path]
#
# Environment variables:
#   CODEX_FIXTURE_PATH - path to SSE fixture (optional)

set -e

PORT="${1:-8766}"
FIXTURE_PATH="${CODEX_FIXTURE_PATH:-}"
APP_SERVER="./../codex-rs/target/debug/codex-app-server"

if [ -n "$FIXTURE_PATH" ]; then
    echo "Starting app server on port $PORT with fixture: $FIXTURE_PATH"
    CODEX_RS_SSE_FIXTURE="$FIXTURE_PATH" "$APP_SERVER" --listen "ws://127.0.0.1:$PORT"
else
    echo "Starting app server on port $PORT (no fixture)"
    "$APP_SERVER" --listen "ws://127.0.0.1:$PORT"
fi
