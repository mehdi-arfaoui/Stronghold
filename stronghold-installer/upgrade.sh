#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

echo ""
echo "==========================================="
echo "   Stronghold - Upgrade"
echo "==========================================="
echo ""

require_root
ensure_docker_access
ensure_compose_plugin

sync_package_tree "${PACKAGE_DIR}" "${INSTALL_DIR}"
chmod +x "${INSTALL_DIR}"/*.sh

cd "${INSTALL_DIR}"

if [[ ! -f ".env" ]]; then
  log_error "Missing .env in ${INSTALL_DIR}. Run install.sh first."
  exit 1
fi

load_env_file ".env"

PACKAGE_VERSION="$(detect_package_version || true)"
TARGET_VERSION="${1:-${PACKAGE_VERSION:-latest}}"
OLD_VERSION="${STRONGHOLD_VERSION:-latest}"

log_info "Current version: ${OLD_VERSION}"
log_info "Target version : ${TARGET_VERSION}"

if [[ -x "./backup.sh" ]]; then
  log_info "Creating automatic backup before upgrade..."
  ./backup.sh --auto
else
  log_error "backup.sh is required for upgrades."
  exit 1
fi

rollback() {
  log_warn "Rolling back to version ${OLD_VERSION}..."
  update_env_value ".env" "STRONGHOLD_VERSION" "${OLD_VERSION}"
  export STRONGHOLD_VERSION="${OLD_VERSION}"
  compose down --timeout 30 || true
  compose up -d postgres redis minio || true
  for service in postgres redis minio; do
    wait_for_service_health "${service}" 120 || true
  done
  compose up -d stronghold-api stronghold-web nginx || true
  log_warn "Rollback completed. Review logs with ./logs.sh"
}

update_env_value ".env" "STRONGHOLD_VERSION" "${TARGET_VERSION}"
export STRONGHOLD_VERSION="${TARGET_VERSION}"

if load_offline_images_if_present "${INSTALL_DIR}/images.tar"; then
  :
else
  log_info "No images.tar detected. Pulling new images online..."
  if ! compose pull; then
    rollback
    exit 1
  fi
fi

log_info "Stopping running services..."
compose down --timeout 30

log_info "Starting infrastructure services..."
compose up -d postgres redis minio
for service in postgres redis minio; do
  printf 'Waiting for %s ' "${service}"
  if wait_for_service_health "${service}" 120; then
    echo ""
    log_ok "${service} is ready"
  else
    echo ""
    rollback
    exit 1
  fi
done

echo ""
log_info "Applying migrations..."
if ! compose run --rm stronghold-api npx prisma migrate deploy; then
  rollback
  exit 1
fi

log_info "Starting upgraded services..."
if ! compose up -d stronghold-api stronghold-web nginx; then
  rollback
  exit 1
fi

for service in stronghold-api stronghold-web nginx; do
  printf 'Waiting for %s ' "${service}"
  if wait_for_service_health "${service}" 180; then
    echo ""
    log_ok "${service} is ready"
  else
    echo ""
    rollback
    exit 1
  fi
done

log_ok "Upgrade completed: ${OLD_VERSION} -> ${TARGET_VERSION}"
echo "Check the deployment with: ./status.sh"
