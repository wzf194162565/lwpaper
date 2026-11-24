#!/usr/bin/env bash
set -euo pipefail
# Briefly quiesce writes so SQL, encryption keys and immutable files share a snapshot.
was_running=false
if systemctl is-active --quiet paper-desk.service; then
  was_running=true
  systemctl stop paper-desk.service
fi
resume_service() {
  if [[ "$was_running" == true ]]; then systemctl start paper-desk.service; fi
}
trap resume_service EXIT
python3 /opt/paper-desk/tools/backup_mysql.py "$@"
