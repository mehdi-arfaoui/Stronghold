#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

echo ""
echo "==========================================="
echo "   Stronghold - Restore"
echo "==========================================="
echo ""

require_root
ensure_docker_access
ensure_compose_plugin

cd "${INSTALL_DIR}"

BACKUP_DIR="${INSTALL_DIR}/backups"
if [[ ! -d "${BACKUP_DIR}" ]]; then
  log_error "Backup directory not found: ${BACKUP_DIR}"
  exit 1
fi

mapfile -t BACKUPS < <(ls -1t "${BACKUP_DIR}"/stronghold_backup_*.tar.gz 2>/dev/null || true)
if (( ${#BACKUPS[@]} == 0 )); then
  log_error "No backup archive found in ${BACKUP_DIR}"
  exit 1
fi

echo "Available backups:"
echo ""
for i in "${!BACKUPS[@]}"; do
  SIZE="$(du -h "${BACKUPS[$i]}" | awk '{print $1}')"
  echo "  [${i}] $(basename "${BACKUPS[$i]}") (${SIZE})"
done
echo ""

if [[ -n "${1:-}" && -f "${1}" ]]; then
  SELECTED="${1}"
else
  read -r -p "Backup number to restore: " idx
  if [[ -z "${BACKUPS[${idx}]:-}" ]]; then
    log_error "Invalid selection."
    exit 1
  fi
  SELECTED="${BACKUPS[${idx}]}"
fi

log_warn "This will replace the current database, MinIO data and local configuration."
read -r -p "Confirm restore? (y/N) " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  log_info "Restore cancelled."
  exit 0
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

log_info "Extracting backup..."
tar xzf "${SELECTED}" -C "${TEMP_DIR}"
EXTRACTED_DIR="$(find "${TEMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "${EXTRACTED_DIR}" ]]; then
  log_error "Backup archive is invalid."
  exit 1
fi

cp "${EXTRACTED_DIR}/env.bak" ".env"
cp "${EXTRACTED_DIR}/docker-compose.prod.yml.bak" "${COMPOSE_FILE_NAME}"
cp "${EXTRACTED_DIR}/nginx.conf.bak" "nginx/nginx.conf"
if [[ -f "${EXTRACTED_DIR}/stronghold.lic.bak" ]]; then
  cp "${EXTRACTED_DIR}/stronghold.lic.bak" "stronghold.lic"
fi

load_env_file ".env"

log_info "Stopping application services..."
compose stop nginx stronghold-web stronghold-api || true

log_info "Starting infrastructure services..."
compose up -d postgres redis minio
for service in postgres minio; do
  printf 'Waiting for %s ' "${service}"
  if wait_for_service_health "${service}" 120; then
    echo ""
    log_ok "${service} is ready"
  else
    echo ""
    log_error "${service} did not become healthy in time."
    exit 1
  fi
done

echo ""
log_info "Restoring PostgreSQL database..."
compose exec -T postgres dropdb -U "${POSTGRES_USER}" --if-exists "${POSTGRES_DB}" || true
compose exec -T postgres createdb -U "${POSTGRES_USER}" "${POSTGRES_DB}"
compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --no-owner \
  --no-privileges \
  < "${EXTRACTED_DIR}/database.dump"
log_ok "Database restored"

if [[ -f "${EXTRACTED_DIR}/minio-data.tar.gz" ]]; then
  log_info "Restoring MinIO data..."
  compose exec -T minio sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
  compose exec -T minio sh -c 'tar xzf - -C /data' < "${EXTRACTED_DIR}/minio-data.tar.gz"
  log_ok "MinIO data restored"
fi

log_info "Restarting full stack..."
compose up -d

for service in stronghold-api stronghold-web nginx; do
  printf 'Waiting for %s ' "${service}"
  if wait_for_service_health "${service}" 180; then
    echo ""
    log_ok "${service} is ready"
  else
    echo ""
    log_warn "${service} is still starting. Check ./logs.sh ${service}"
  fi
done

echo ""
log_ok "Restore completed. Verify the stack with ./status.sh"
