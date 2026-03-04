#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${COMMON_DIR}/.." && pwd)"
INSTALL_DIR="${STRONGHOLD_INSTALL_DIR:-/opt/stronghold}"
COMPOSE_FILE_NAME="${STRONGHOLD_COMPOSE_FILE:-docker-compose.prod.yml}"

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    log_error "This script must be run as root."
    exit 1
  fi
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    log_error "Missing required command: ${cmd}"
    exit 1
  fi
}

ensure_docker_access() {
  if ! docker info >/dev/null 2>&1; then
    log_error "Docker is not running or the current user cannot access it."
    exit 1
  fi
}

ensure_compose_plugin() {
  if ! docker compose version >/dev/null 2>&1; then
    log_error "Docker Compose v2 plugin is required."
    exit 1
  fi
}

compose() {
  docker compose -f "${COMPOSE_FILE_NAME}" "$@"
}

sync_package_tree() {
  local source_dir="$1"
  local target_dir="$2"

  mkdir -p "${target_dir}"

  local source_real
  local target_real
  source_real="$(cd "${source_dir}" && pwd)"
  target_real="$(cd "${target_dir}" && pwd)"

  if [[ "${source_real}" == "${target_real}" ]]; then
    return 0
  fi

  cp -a "${source_real}/." "${target_real}/"
}

load_env_file() {
  local env_file="${1:-.env}"
  if [[ ! -f "${env_file}" ]]; then
    log_error "Environment file not found: ${env_file}"
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

update_env_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"

  if grep -q "^${key}=" "${env_file}" 2>/dev/null; then
    sed -i "s#^${key}=.*#${key}=${value}#" "${env_file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
  fi
}

detect_package_version() {
  local version_file="${PACKAGE_DIR}/VERSION"
  if [[ -f "${version_file}" ]]; then
    tr -d '[:space:]' < "${version_file}"
    return 0
  fi
  return 1
}

wait_for_service_health() {
  local service="$1"
  local timeout="${2:-120}"
  local elapsed=0

  while (( elapsed < timeout )); do
    local container_id=""
    container_id="$(compose ps -q "${service}" 2>/dev/null | head -n 1)"
    if [[ -n "${container_id}" ]]; then
      local status=""
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      if [[ "${status}" == "healthy" || "${status}" == "running" ]]; then
        return 0
      fi
      if [[ "${status}" == "exited" || "${status}" == "dead" ]]; then
        break
      fi
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    printf '.'
  done

  echo ""
  return 1
}

load_offline_images_if_present() {
  local archive_path="${1:-images.tar}"
  if [[ ! -f "${archive_path}" ]]; then
    return 1
  fi

  log_info "Loading Docker images from ${archive_path}..."
  docker load -i "${archive_path}"
  log_ok "Offline images loaded"
  return 0
}

short_host_ip() {
  local detected=""
  detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -z "${detected}" ]]; then
    detected="localhost"
  fi
  printf '%s\n' "${detected}"
}
