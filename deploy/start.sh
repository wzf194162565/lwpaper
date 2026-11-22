#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

APP_PORT="${APP_PORT:-8080}"
APP_DATA="${APP_DATA:-$APP_DIR/data}"
APP_CONFIG="${APP_CONFIG:-$APP_DIR/config/application.properties}"
JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/}java"

if ! command -v "$JAVA_BIN" >/dev/null 2>&1; then
  echo "Java 17 or newer is required. Install a JRE/JDK before starting." >&2
  exit 1
fi
if [[ ! "$APP_PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$APP_PORT < 1 || 10#$APP_PORT > 65535 )); then
  echo "APP_PORT must be a port between 1 and 65535." >&2
  exit 1
fi

mkdir -p -- "$APP_DATA"
exec "$JAVA_BIN" -Xms64m -Xmx512m -Dfile.encoding=UTF-8 -Duser.timezone=Asia/Shanghai \
  "-Dapp.root=$APP_DIR" "-Dapp.data=$APP_DATA" "-Dapp.config=$APP_CONFIG" "-Dapp.port=$APP_PORT" \
  -cp "$APP_DIR/paper-desk.jar:$APP_DIR/lib/*" Main
