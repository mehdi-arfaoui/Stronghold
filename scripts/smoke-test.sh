#!/usr/bin/env bash
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-stronghold_smoke}"

API_PORT="3000"
WEB_PORT="8080"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-180}"
COMPOSE_ARGS=(compose --env-file .env.example)

cleanup() {
  local exit_code="$1"

  if [[ "$exit_code" -ne 0 ]]; then
    echo "[smoke] Failure detected, dumping compose status and logs..."
    docker "${COMPOSE_ARGS[@]}" ps || true
    docker "${COMPOSE_ARGS[@]}" logs --no-color || true
  fi

  docker "${COMPOSE_ARGS[@]}" down -v --remove-orphans || true
}

wait_for_container_health() {
  local service_name="$1"
  local timeout_seconds="$2"
  local container_id
  local deadline

  container_id="$(docker "${COMPOSE_ARGS[@]}" ps -q "$service_name")"
  if [[ -z "$container_id" ]]; then
    echo "[smoke] Service '$service_name' has no container id." >&2
    return 1
  fi

  deadline=$((SECONDS + timeout_seconds))
  while (( SECONDS < deadline )); do
    local status
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$container_id" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      echo "[smoke] Service '$service_name' is healthy."
      return 0
    fi
    sleep 2
  done

  echo "[smoke] Timed out waiting for '$service_name' to become healthy." >&2
  return 1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout_seconds="$3"
  local deadline

  deadline=$((SECONDS + timeout_seconds))
  while (( SECONDS < deadline )); do
    local status
    status="$(curl -sS -o /dev/null -w "%{http_code}" "$url" || true)"
    if [[ "$status" == "200" ]]; then
      echo "[smoke] $name is ready at $url."
      return 0
    fi
    sleep 2
  done

  echo "[smoke] Timed out waiting for $name at $url." >&2
  return 1
}

assert_http_200() {
  local name="$1"
  local url="$2"
  local status

  status="$(curl -sS -o /dev/null -w "%{http_code}" "$url" || true)"
  if [[ "$status" != "200" ]]; then
    echo "[smoke] $name failed: expected HTTP 200, got ${status:-000} for $url." >&2
    return 1
  fi
}

trap 'cleanup $?' EXIT

echo "[smoke] Cleaning any previous compose state..."
docker "${COMPOSE_ARGS[@]}" down -v --remove-orphans || true

echo "[smoke] Building images..."
docker "${COMPOSE_ARGS[@]}" build

echo "[smoke] Starting services..."
docker "${COMPOSE_ARGS[@]}" up -d

wait_for_container_health "postgres" "$MAX_WAIT_SECONDS"
wait_for_http "API health" "http://localhost:${API_PORT}/api/health" "$MAX_WAIT_SECONDS"
wait_for_http "API DB health" "http://localhost:${API_PORT}/api/health/db" "$MAX_WAIT_SECONDS"
wait_for_http "Web root" "http://localhost:${WEB_PORT}" "$MAX_WAIT_SECONDS"
wait_for_http "Web API proxy health" "http://localhost:${WEB_PORT}/api/health" "$MAX_WAIT_SECONDS"

assert_http_200 "API health" "http://localhost:${API_PORT}/api/health"
assert_http_200 "API DB health" "http://localhost:${API_PORT}/api/health/db"
assert_http_200 "Web root" "http://localhost:${WEB_PORT}"
assert_http_200 "Web API proxy health" "http://localhost:${WEB_PORT}/api/health"

echo "[smoke] Compose smoke test passed."
