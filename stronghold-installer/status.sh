#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

cd "${INSTALL_DIR}"

ensure_docker_access
ensure_compose_plugin
if [[ -f ".env" ]]; then
  load_env_file ".env"
fi

echo ""
echo "==========================================="
echo "   Stronghold - Service Status"
echo "==========================================="
echo ""

compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

echo ""
printf 'API health : '
if compose exec -T stronghold-api wget -q -O- http://localhost:4000/health/live >/dev/null 2>&1; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAILED${NC}"
fi

printf 'License    : '
LICENSE_JSON="$(compose exec -T stronghold-api wget -q -O- http://localhost:4000/api/license/status 2>/dev/null || true)"
if [[ -n "${LICENSE_JSON}" ]]; then
  STATUS_VALUE="$(echo "${LICENSE_JSON}" | grep -o '"status":"[^"]*"' | head -n 1 | cut -d'"' -f4 || true)"
  PLAN_VALUE="$(echo "${LICENSE_JSON}" | grep -o '"plan":"[^"]*"' | head -n 1 | cut -d'"' -f4 || true)"
  DAYS_VALUE="$(echo "${LICENSE_JSON}" | grep -o '"daysUntilExpiry":[0-9]*' | head -n 1 | cut -d: -f2 || true)"
  if [[ "${STATUS_VALUE}" == "valid" ]]; then
    echo -e "${GREEN}${STATUS_VALUE}${NC} - plan ${PLAN_VALUE} - expires in ${DAYS_VALUE:-?}d"
  elif [[ "${STATUS_VALUE}" == "grace_period" ]]; then
    echo -e "${YELLOW}${STATUS_VALUE}${NC} - plan ${PLAN_VALUE}"
  else
    echo -e "${RED}${STATUS_VALUE:-unknown}${NC}"
  fi
else
  echo -e "${RED}UNREACHABLE${NC}"
fi

echo ""
echo "Disk usage:"
echo "  PostgreSQL : $(compose exec -T postgres du -sh /var/lib/postgresql/data 2>/dev/null | awk '{print $1}' || echo 'N/A')"
echo "  MinIO      : $(compose exec -T minio du -sh /data 2>/dev/null | awk '{print $1}' || echo 'N/A')"
echo "  Backups    : $(du -sh "${INSTALL_DIR}/backups" 2>/dev/null | awk '{print $1}' || echo 'N/A')"

if [[ -n "${STRONGHOLD_VERSION:-}" ]]; then
  echo ""
  echo "Version : ${STRONGHOLD_VERSION}"
fi
echo ""
