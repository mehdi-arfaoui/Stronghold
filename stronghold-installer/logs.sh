#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

cd "${INSTALL_DIR}"

ensure_docker_access
ensure_compose_plugin

SERVICE="${1:-}"
LINES="${2:-100}"

echo ""
echo "==========================================="
echo "   Stronghold - Logs"
echo "==========================================="
echo ""

if [[ -z "${SERVICE}" ]]; then
  echo "Usage:"
  echo "  ./logs.sh                All services (100 lines)"
  echo "  ./logs.sh api            Backend logs"
  echo "  ./logs.sh web            Frontend logs"
  echo "  ./logs.sh postgres       PostgreSQL logs"
  echo "  ./logs.sh redis          Redis logs"
  echo "  ./logs.sh minio          MinIO logs"
  echo "  ./logs.sh nginx          Nginx logs"
  echo "  ./logs.sh api 500        Last 500 lines"
  echo "  ./logs.sh api -f         Follow in real time"
  echo ""
  compose logs --tail "${LINES}"
  exit 0
fi

case "${SERVICE}" in
  api) SERVICE_NAME="stronghold-api" ;;
  web) SERVICE_NAME="stronghold-web" ;;
  postgres|pg|db) SERVICE_NAME="postgres" ;;
  redis) SERVICE_NAME="redis" ;;
  minio|s3) SERVICE_NAME="minio" ;;
  nginx) SERVICE_NAME="nginx" ;;
  *) SERVICE_NAME="${SERVICE}" ;;
esac

if [[ "${LINES}" == "-f" ]]; then
  compose logs -f "${SERVICE_NAME}"
else
  compose logs --tail "${LINES}" "${SERVICE_NAME}"
fi
