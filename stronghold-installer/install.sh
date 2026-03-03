#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

echo ""
echo "==========================================="
echo "   Stronghold - Installation"
echo "==========================================="
echo ""

require_root

log_info "Running preflight checks..."

if [[ ! -f /etc/os-release ]]; then
  log_error "Unsupported system. Linux is required."
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
log_info "Detected OS: ${PRETTY_NAME}"

ARCH="$(uname -m)"
if [[ "${ARCH}" != "x86_64" && "${ARCH}" != "aarch64" ]]; then
  log_error "Unsupported architecture: ${ARCH}. Expected x86_64 or aarch64."
  exit 1
fi

TOTAL_RAM_MB="$(free -m | awk '/^Mem:/{print $2}')"
if (( TOTAL_RAM_MB < 3500 )); then
  log_error "Insufficient RAM: ${TOTAL_RAM_MB} MB. Minimum 3500 MB required."
  exit 1
elif (( TOTAL_RAM_MB < 8192 )); then
  log_warn "RAM: ${TOTAL_RAM_MB} MB. 8192 MB recommended."
else
  log_ok "RAM: ${TOTAL_RAM_MB} MB"
fi

AVAILABLE_DISK_GB="$(df -BG /opt 2>/dev/null | awk 'NR==2{gsub(/G/, "", $4); print $4}')"
if [[ -z "${AVAILABLE_DISK_GB}" ]]; then
  AVAILABLE_DISK_GB="$(df -BG / | awk 'NR==2{gsub(/G/, "", $4); print $4}')"
fi
if (( AVAILABLE_DISK_GB < 20 )); then
  log_error "Insufficient disk space: ${AVAILABLE_DISK_GB} GB. Minimum 20 GB required."
  exit 1
elif (( AVAILABLE_DISK_GB < 50 )); then
  log_warn "Disk space: ${AVAILABLE_DISK_GB} GB. 50 GB recommended."
else
  log_ok "Disk space: ${AVAILABLE_DISK_GB} GB"
fi

CPU_CORES="$(nproc)"
if (( CPU_CORES < 2 )); then
  log_error "Insufficient CPU: ${CPU_CORES} core(s). Minimum 2 required."
  exit 1
elif (( CPU_CORES < 4 )); then
  log_warn "CPU: ${CPU_CORES} core(s). 4 recommended."
else
  log_ok "CPU: ${CPU_CORES} cores"
fi

require_command openssl

log_info "Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  require_command curl
  log_warn "Docker is not installed. Installing with get.docker.com..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  log_ok "Docker installed"
else
  log_ok "Docker present: $(docker --version)"
fi

ensure_docker_access
ensure_compose_plugin
log_ok "Docker Compose: $(docker compose version --short)"

if [[ -d "${INSTALL_DIR}" ]]; then
  log_warn "Installation directory already exists: ${INSTALL_DIR}"
  read -r -p "Refresh the existing installation files? (y/N) " confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    log_info "Installation cancelled."
    exit 0
  fi
fi

log_info "Copying package files to ${INSTALL_DIR}..."
sync_package_tree "${PACKAGE_DIR}" "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/nginx" "${INSTALL_DIR}/certs" "${INSTALL_DIR}/backups" "${INSTALL_DIR}/docs" "${INSTALL_DIR}/lib"
chmod +x "${INSTALL_DIR}"/*.sh
if [[ ! -f "${INSTALL_DIR}/frontend-nginx.conf" ]]; then
  log_error "Missing frontend-nginx.conf in ${INSTALL_DIR}."
  exit 1
fi

cd "${INSTALL_DIR}"

ENV_FILE="${INSTALL_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  log_warn "Existing .env detected. Current values will be reused as defaults."
  load_env_file "${ENV_FILE}"
fi

PACKAGE_VERSION="$(detect_package_version || true)"
DEFAULT_VERSION="${STRONGHOLD_VERSION:-${PACKAGE_VERSION:-latest}}"
DEFAULT_HOST_IP="$(short_host_ip)"
DEFAULT_HTTP_PORT="${HTTP_PORT:-80}"
DEFAULT_HTTPS_PORT="${HTTPS_PORT:-443}"
DEFAULT_FRONTEND_URL="${FRONTEND_URL:-}"
if [[ -z "${DEFAULT_FRONTEND_URL}" ]]; then
  if [[ "${DEFAULT_HTTP_PORT}" == "80" ]]; then
    DEFAULT_FRONTEND_URL="http://${DEFAULT_HOST_IP}"
  else
    DEFAULT_FRONTEND_URL="http://${DEFAULT_HOST_IP}:${DEFAULT_HTTP_PORT}"
  fi
fi

echo ""
log_info "Interactive configuration"

read -r -p "Stronghold version [${DEFAULT_VERSION}]: " input
STRONGHOLD_VERSION="${input:-${DEFAULT_VERSION}}"

read -r -p "HTTP port [${DEFAULT_HTTP_PORT}]: " input
HTTP_PORT="${input:-${DEFAULT_HTTP_PORT}}"

read -r -p "HTTPS port [${DEFAULT_HTTPS_PORT}]: " input
HTTPS_PORT="${input:-${DEFAULT_HTTPS_PORT}}"

read -r -p "Public URL [${DEFAULT_FRONTEND_URL}]: " input
FRONTEND_URL="${input:-${DEFAULT_FRONTEND_URL}}"

POSTGRES_USER="${POSTGRES_USER:-stronghold}"
POSTGRES_DB="${POSTGRES_DB:-stronghold}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-stronghold}"

if [[ -z "${POSTGRES_PASSWORD:-}" || "${POSTGRES_PASSWORD}" == "CHANGE_ME" ]]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  log_info "Generated PostgreSQL password."
fi

if [[ -z "${JWT_SECRET:-}" || "${JWT_SECRET}" == "CHANGE_ME" ]]; then
  JWT_SECRET="$(openssl rand -hex 64)"
  log_info "Generated JWT secret."
fi

if [[ -z "${SESSION_SECRET:-}" || "${SESSION_SECRET}" == "CHANGE_ME" ]]; then
  SESSION_SECRET="$(openssl rand -hex 64)"
  log_info "Generated session secret."
fi

if [[ -z "${LICENSE_SIGNING_SECRET:-}" || "${LICENSE_SIGNING_SECRET}" == "CHANGE_ME" ]]; then
  LICENSE_SIGNING_SECRET="$(openssl rand -hex 64)"
  log_info "Generated license signing secret."
fi

if [[ -z "${CREDENTIAL_ENCRYPTION_KEY:-}" || "${CREDENTIAL_ENCRYPTION_KEY}" == "CHANGE_ME_HEX_64" ]]; then
  CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  log_info "Generated credential encryption key."
fi

if [[ -z "${MINIO_ROOT_PASSWORD:-}" || "${MINIO_ROOT_PASSWORD}" == "CHANGE_ME" ]]; then
  MINIO_ROOT_PASSWORD="$(openssl rand -hex 24)"
  log_info "Generated MinIO password."
fi

CORS_ORIGINS="${CORS_ORIGINS:-${FRONTEND_URL}}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-${FRONTEND_URL}}"

cat > "${ENV_FILE}" <<EOF
# Stronghold configuration - generated by install.sh on $(date -Iseconds)
COMPOSE_PROJECT_NAME=stronghold
STRONGHOLD_VERSION=${STRONGHOLD_VERSION}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=${SESSION_SECRET}
LICENSE_SIGNING_SECRET=${LICENSE_SIGNING_SECRET}
CREDENTIAL_ENCRYPTION_KEY=${CREDENTIAL_ENCRYPTION_KEY}
FRONTEND_URL=${FRONTEND_URL}
CORS_ORIGINS=${CORS_ORIGINS}
CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
HTTP_PORT=${HTTP_PORT}
HTTPS_PORT=${HTTPS_PORT}
EOF
chmod 600 "${ENV_FILE}"
log_ok "Configuration written to ${ENV_FILE}"

LICENSE_FILE="${INSTALL_DIR}/stronghold.lic"
if [[ ! -f "${LICENSE_FILE}" ]]; then
  log_warn "No license file detected."
  echo "Create or copy your license file to: ${LICENSE_FILE}"
  echo "The application can also be activated later from the web interface."
  touch "${LICENSE_FILE}"
elif [[ -s "${LICENSE_FILE}" ]]; then
  log_ok "License file already present"
else
  log_warn "License placeholder created at ${LICENSE_FILE}"
fi

if load_offline_images_if_present "${INSTALL_DIR}/images.tar"; then
  :
else
  log_info "No images.tar detected. Pulling images online..."
  compose pull
  log_ok "Images pulled"
fi

log_info "Starting infrastructure services..."
compose up -d postgres redis minio

for service in postgres redis minio; do
  printf 'Waiting for %s ' "${service}"
  if wait_for_service_health "${service}" 120; then
    echo ""
    log_ok "${service} is ready"
  else
    log_error "${service} did not become healthy in time."
    compose logs --tail 100 "${service}" || true
    exit 1
  fi
done

echo ""
log_info "Running database migrations..."
compose run --rm stronghold-api npx prisma migrate deploy
log_ok "Database migrations applied"

log_info "Starting application services..."
compose up -d stronghold-api stronghold-web nginx

for service in stronghold-api stronghold-web nginx; do
  printf 'Waiting for %s ' "${service}"
  if wait_for_service_health "${service}" 180; then
    echo ""
    log_ok "${service} is ready"
  else
    log_warn "${service} is still starting. Check logs with: cd ${INSTALL_DIR} && ./logs.sh ${service}"
    echo ""
  fi
done

echo ""
echo "==========================================="
echo "   Installation completed"
echo "==========================================="
echo ""
echo "URL : ${FRONTEND_URL}"
echo "Dir : ${INSTALL_DIR}"
echo ""
echo "Useful commands:"
echo "  cd ${INSTALL_DIR}"
echo "  ./status.sh"
echo "  ./logs.sh"
echo "  ./backup.sh"
echo "  ./upgrade.sh ${STRONGHOLD_VERSION}"
echo ""
if [[ ! -s "${LICENSE_FILE}" ]]; then
  echo "Reminder: place stronghold.lic in ${INSTALL_DIR}/ or activate the license from the web UI."
  echo ""
fi
