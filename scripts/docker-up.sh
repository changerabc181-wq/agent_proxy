#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK_NAME="${NETWORK_NAME:-agent-proxy-net}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-agent-proxy-mysql}"
APP_CONTAINER="${APP_CONTAINER:-agent-proxy-app}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0}"
APP_IMAGE="${APP_IMAGE:-agent-proxy:dev}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
APP_PORT="${APP_PORT:-4000}"
MYSQL_DATABASE="${MYSQL_DATABASE:-agent_proxy}"
MYSQL_USER="${MYSQL_USER:-agent_proxy}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-agent_proxy}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-rootpass}"

if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  docker network create "${NETWORK_NAME}" >/dev/null
fi

if docker ps -a --format '{{.Names}}' | grep -qx "${MYSQL_CONTAINER}"; then
  docker rm -f "${MYSQL_CONTAINER}" >/dev/null
fi

if docker ps -a --format '{{.Names}}' | grep -qx "${APP_CONTAINER}"; then
  docker rm -f "${APP_CONTAINER}" >/dev/null
fi

docker build -t "${APP_IMAGE}" "${ROOT_DIR}" >/dev/null

docker run -d \
  --name "${MYSQL_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -e MYSQL_DATABASE="${MYSQL_DATABASE}" \
  -e MYSQL_USER="${MYSQL_USER}" \
  -e MYSQL_PASSWORD="${MYSQL_PASSWORD}" \
  -e MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD}" \
  -p "${MYSQL_PORT}:3306" \
  -v "${ROOT_DIR}/docs/mysql-schema.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro" \
  "${MYSQL_IMAGE}" >/dev/null

echo "Waiting for MySQL to become ready..."
for _ in $(seq 1 40); do
  if docker exec "${MYSQL_CONTAINER}" mysqladmin ping -h 127.0.0.1 -uroot -p"${MYSQL_ROOT_PASSWORD}" --silent >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker run -d \
  --name "${APP_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -e PORT=4000 \
  -e MYSQL_HOST="${MYSQL_CONTAINER}" \
  -e MYSQL_PORT=3306 \
  -e MYSQL_DATABASE="${MYSQL_DATABASE}" \
  -e MYSQL_USER="${MYSQL_USER}" \
  -e MYSQL_PASSWORD="${MYSQL_PASSWORD}" \
  -p "${APP_PORT}:4000" \
  "${APP_IMAGE}" >/dev/null

echo "App URL: http://127.0.0.1:${APP_PORT}"
echo "MySQL URL: mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@127.0.0.1:${MYSQL_PORT}/${MYSQL_DATABASE}"
echo "Containers:"
docker ps --filter "name=${MYSQL_CONTAINER}" --filter "name=${APP_CONTAINER}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
