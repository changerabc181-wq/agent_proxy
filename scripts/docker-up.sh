#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-4000}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-agent_proxy}"

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    COMPOSE_VARIANT="v2"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    COMPOSE_VARIANT="v1"
    return
  fi

  echo "Docker Compose is required but was not found." >&2
  exit 1
}

remove_legacy_conflict() {
  local container_name="$1"
  local expected_service="$2"

  if ! docker ps -a --format '{{.Names}}' | grep -qx "$container_name"; then
    return
  fi

  local project_label service_label
  project_label="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_name" 2>/dev/null || true)"
  service_label="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "$container_name" 2>/dev/null || true)"

  if [[ "$project_label" == "$COMPOSE_PROJECT_NAME" && "$service_label" == "$expected_service" ]]; then
    return
  fi

  echo "Removing legacy container that conflicts with compose: $container_name"
  docker rm -f "$container_name" >/dev/null
}

remove_matching_containers() {
  local pattern="$1"
  local names

  names="$(docker ps -a --format '{{.Names}}' | grep -E "$pattern" || true)"
  if [[ -z "$names" ]]; then
    return
  fi

  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    echo "Removing conflicting container: $name"
    docker rm -f "$name" >/dev/null 2>&1 || true
  done <<< "$names"
}

resolve_compose_cmd
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

export COMPOSE_PROJECT_NAME
export TOKEN_SECRET="${TOKEN_SECRET:-agent-proxy-dev-secret}"

remove_legacy_conflict "agent-proxy-mysql" "db"
remove_legacy_conflict "agent-proxy-app" "app"

if [[ "${COMPOSE_VARIANT}" == "v1" ]]; then
  echo "Compose V1 detected. Removing service containers to avoid recreate bug..."
  remove_matching_containers '(^agent-proxy-app$|_agent-proxy-app$|^agent-proxy-mysql$|_agent-proxy-mysql$)'
fi

echo "Using: ${COMPOSE_CMD[*]}"
echo "Starting services with persistent MySQL volume..."
"${COMPOSE_CMD[@]}" up -d --build

echo "Waiting for app health endpoint..."
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
  echo "App health check failed. Inspect logs with: ${COMPOSE_CMD[*]} logs" >&2
  exit 1
fi

echo "App URL: http://127.0.0.1:${APP_PORT}"
echo "MySQL data is persisted in volume: agent_proxy_mysql_data"
"${COMPOSE_CMD[@]}" ps
