#!/usr/bin/env bash
set -euo pipefail

NETWORK_NAME="${NETWORK_NAME:-agent-proxy-net}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-agent-proxy-mysql}"
APP_CONTAINER="${APP_CONTAINER:-agent-proxy-app}"

docker rm -f "${APP_CONTAINER}" >/dev/null 2>&1 || true
docker rm -f "${MYSQL_CONTAINER}" >/dev/null 2>&1 || true
docker network rm "${NETWORK_NAME}" >/dev/null 2>&1 || true

echo "Stopped ${APP_CONTAINER} and ${MYSQL_CONTAINER}"

