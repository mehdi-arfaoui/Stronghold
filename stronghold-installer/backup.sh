#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

cd "${INSTALL_DIR}"

if [[ ! -f ".env" ]]; then
  log_error "Missing .env in ${INSTALL_DIR}."
  exit 1
fi

ensure_docker_access
ensure_compose_plugin
load_env_file ".env"

BACKUP_DIR="${INSTALL_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_NAME="stronghold_backup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

mkdir -p "${BACKUP_PATH}"

echo ""
log_info "Stronghold backup - ${TIMESTAMP}"

log_info "Ensuring data services are running..."
compose up -d postgres minio
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
log_info "Exporting PostgreSQL database..."
compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --format=custom \
  --compress=9 \
  > "${BACKUP_PATH}/database.dump"
log_ok "Database exported"

log_info "Saving MinIO object storage..."
MINIO_VOLUME_NAME="${COMPOSE_PROJECT_NAME:-stronghold}_miniodata"
if docker volume inspect "${MINIO_VOLUME_NAME}" >/dev/null 2>&1; then
  if docker run --rm \
    -v "${MINIO_VOLUME_NAME}:/data:ro" \
    -v "${BACKUP_PATH}:/backup" \
    alpine:3.20 \
    sh -c 'tar czf /backup/minio-data.tar.gz -C /data .'; then
    log_ok "MinIO data exported"
  else
    rm -f "${BACKUP_PATH}/minio-data.tar.gz" 2>/dev/null || true
    log_warn "MinIO data export failed. Continuing with database and configuration backup."
  fi
else
  log_warn "MinIO volume ${MINIO_VOLUME_NAME} not found. Continuing without object storage backup."
fi

log_info "Saving configuration..."
cp ".env" "${BACKUP_PATH}/env.bak"
cp "${COMPOSE_FILE_NAME}" "${BACKUP_PATH}/docker-compose.prod.yml.bak"
cp "nginx/nginx.conf" "${BACKUP_PATH}/nginx.conf.bak"
if [[ -f "stronghold.lic" ]]; then
  cp "stronghold.lic" "${BACKUP_PATH}/stronghold.lic.bak"
fi
log_ok "Configuration saved"

log_info "Compressing backup..."
tar czf "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" -C "${BACKUP_DIR}" "${BACKUP_NAME}"
rm -rf "${BACKUP_PATH}"
log_ok "Archive created: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"

mapfile -t BACKUPS < <(ls -1t "${BACKUP_DIR}"/stronghold_backup_*.tar.gz 2>/dev/null || true)
if (( ${#BACKUPS[@]} > 10 )); then
  for backup_file in "${BACKUPS[@]:10}"; do
    rm -f "${backup_file}"
  done
  log_info "Rotation applied: kept the 10 most recent backups"
fi

BACKUP_SIZE="$(du -h "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | awk '{print $1}')"
echo ""
log_ok "Backup completed: ${BACKUP_NAME}.tar.gz (${BACKUP_SIZE})"
