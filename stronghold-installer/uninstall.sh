#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

echo ""
echo "==========================================="
echo "   Stronghold - Uninstall"
echo "==========================================="
echo ""

require_root
ensure_docker_access
ensure_compose_plugin

cd "${INSTALL_DIR}"

log_warn "This will:"
echo "  - stop all Stronghold services"
echo "  - delete Docker volumes (PostgreSQL, Redis, MinIO)"
echo "  - remove ${INSTALL_DIR}"
echo ""
read -r -p "Create a backup before uninstall? (Y/n) " backup_confirm
if [[ "${backup_confirm}" != "n" && "${backup_confirm}" != "N" ]]; then
  if [[ -x "./backup.sh" ]]; then
    ./backup.sh
    LATEST_BACKUP="$(ls -1t "${INSTALL_DIR}"/backups/stronghold_backup_*.tar.gz 2>/dev/null | head -n 1 || true)"
    if [[ -n "${LATEST_BACKUP}" ]]; then
      SAFE_BACKUP="/tmp/$(basename "${LATEST_BACKUP}")"
      cp "${LATEST_BACKUP}" "${SAFE_BACKUP}"
      log_ok "Latest backup copied to ${SAFE_BACKUP}"
    fi
  else
    log_warn "backup.sh not found. Continuing without backup."
  fi
fi

echo ""
read -r -p "Type REMOVE to confirm complete uninstall: " confirm
if [[ "${confirm}" != "REMOVE" ]]; then
  log_info "Uninstall cancelled."
  exit 0
fi

log_info "Stopping services and removing volumes..."
compose down --volumes --remove-orphans --timeout 30 || true
log_ok "Services stopped"

log_info "Removing Docker images referenced by the compose project..."
compose images -q 2>/dev/null | xargs -r docker rmi >/dev/null 2>&1 || true

log_info "Removing installation directory..."
cd /
rm -rf "${INSTALL_DIR}"
log_ok "Installation directory removed"

echo ""
log_ok "Uninstall completed"
if [[ -n "${SAFE_BACKUP:-}" ]]; then
  echo "Backup preserved at: ${SAFE_BACKUP}"
fi
