#!/usr/bin/env bash
set -euo pipefail
umask 077

if (( EUID != 0 )); then
  echo "Run with sudo: sudo bash install.sh" >&2
  exit 1
fi
command -v java >/dev/null 2>&1 || { echo "Install Java 17 or newer first." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd is required; otherwise run bash start.sh manually." >&2; exit 1; }

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=/opt/paper-desk
if [[ "$SOURCE_DIR" == "$INSTALL_DIR" ]]; then
  echo "Extract the release to a separate directory before running the installer." >&2
  exit 1
fi
for required in paper-desk.jar start.sh config/application.properties deploy/paper-desk.service tools/backup_mysql.py; do
  [[ -f "$SOURCE_DIR/$required" ]] || { echo "Incomplete release: $required" >&2; exit 1; }
done

if ! id paperdesk >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$INSTALL_DIR" --no-create-home --shell /usr/sbin/nologin paperdesk
fi
if systemctl is-active --quiet paper-desk.service; then
  systemctl stop paper-desk.service
fi
install -d -m 0755 "$INSTALL_DIR" "$INSTALL_DIR/web" "$INSTALL_DIR/lib" "$INSTALL_DIR/db" "$INSTALL_DIR/db/mysql" "$INSTALL_DIR/deploy" "$INSTALL_DIR/tools"
install -d -m 0750 -o root -g paperdesk "$INSTALL_DIR/config"
install -d -m 0700 -o paperdesk -g paperdesk "$INSTALL_DIR/data"
install -m 0644 "$SOURCE_DIR/paper-desk.jar" "$INSTALL_DIR/"
install -m 0755 "$SOURCE_DIR/start.sh" "$INSTALL_DIR/"
install -m 0644 "$SOURCE_DIR/DEPLOY.md" "$SOURCE_DIR/MYSQL-MIGRATION.md" "$SOURCE_DIR/README.md" "$SOURCE_DIR/RELEASE.json" "$INSTALL_DIR/"
install -m 0644 "$SOURCE_DIR"/web/* "$INSTALL_DIR/web/"
install -m 0644 "$SOURCE_DIR"/lib/*.jar "$INSTALL_DIR/lib/"
install -m 0644 "$SOURCE_DIR"/db/mysql/*.sql "$INSTALL_DIR/db/mysql/"
install -m 0644 "$SOURCE_DIR"/deploy/* "$INSTALL_DIR/deploy/"
install -m 0644 "$SOURCE_DIR/tools/backup_mysql.py" "$INSTALL_DIR/tools/"
install -m 0640 -o root -g paperdesk "$SOURCE_DIR/config/mysql-client.example.cnf" "$INSTALL_DIR/config/"
install -m 0640 -o root -g paperdesk "$SOURCE_DIR/config/application.mysql.example.properties" "$INSTALL_DIR/config/"
if [[ ! -e "$INSTALL_DIR/config/application.properties" ]]; then
  install -m 0640 -o root -g paperdesk "$SOURCE_DIR/config/application.properties" "$INSTALL_DIR/config/"
fi
install -m 0644 "$SOURCE_DIR/deploy/paper-desk.service" /etc/systemd/system/paper-desk.service
systemctl daemon-reload
systemctl enable paper-desk.service

echo "Installed to $INSTALL_DIR. Existing config and data have been preserved."
echo "Configure storage first, then run: sudo systemctl start paper-desk"
echo "Logs: sudo journalctl -u paper-desk -n 80 --no-pager"
